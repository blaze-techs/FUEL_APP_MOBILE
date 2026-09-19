import { describe, it, expect } from "vitest";
import {
  isEncrypted,
  detectPdfEncryption,
  buildUnlockCandidates,
  candidatesFromFilename,
  unlockCandidateCount,
  scanNumericPins,
  scanNumericPinsParallel,
  __dbg_workerSource,
  __dbg_parseEncrypt,
} from "@/react-app/lib/pdf-unlock";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname ?? process.cwd(), "../..");

const LOCKED_FIXTURE =
  "/workspace/MPESA_Statement_2026-09-ss1_to_2026-09-11_578590.pdf";
const hasFixture = existsSync(LOCKED_FIXTURE);

describe("pdf-unlock detection", () => {
  it("detects /Encrypt presence on a locked PDF", () => {
    // A minimal PDF header + a trailer carrying an /Encrypt reference
    // (exactly what an encrypted file looks like at the byte level).
    const bytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0d, 0x25, 0xe2, 0xe3,
      0xcf, 0xd3, 0x0d, 0x0d, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x3c,
      0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c,
      0x6f, 0x67, 0x3e, 0x3e, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x0d,
      // trailer with /Encrypt 15 0 R + /Root 1 0 R
      0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x3c, 0x3c, 0x2f, 0x45, 0x6e,
      0x63, 0x72, 0x79, 0x70, 0x74, 0x20, 0x31, 0x35, 0x20, 0x30, 0x20, 0x52,
      0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x3e,
      0x3e,
    ]);
    expect(isEncrypted(bytes)).toBe(true);
    const meta = detectPdfEncryption(bytes);
    expect(meta).not.toBeNull();
  });

  it("returns null for an unencrypted PDF", () => {
    const plain = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0d, 0x74, 0x72, 0x61,
      0x69, 0x6c, 0x65, 0x72, 0x3c, 0x3c, 0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20,
      0x31, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e,
    ]);
    expect(isEncrypted(plain)).toBe(false);
    expect(detectPdfEncryption(plain)).toBeNull();
  });
});

describe("pdf-unlock candidates", () => {
  it("always tries the empty password first", () => {
    const cands = buildUnlockCandidates();
    expect(cands[0]).toBe("");
    expect(cands.indexOf("")).toBe(0);
  });

  it("accepts only the empty password and explicitly supplied passwords", () => {
    const cands = buildUnlockCandidates(undefined, ["known-password", "known-password"]);
    expect(cands).toEqual(["", "known-password"]);
    expect(cands).not.toContain("1234");
    expect(cands).not.toContain("password");
  });

  it("does not guess passwords from filenames", () => {
    expect(candidatesFromFilename(
      "MPESA_Statement_2026-09-ss1_to_2026-09-11_578590.pdf",
    )).toEqual([]);
  });

  it("dedupes explicit password candidates", () => {
    const cands = buildUnlockCandidates("MPESA_1234.pdf", ["known", "known"]);
    expect(cands).toEqual(["", "known"]);
  });

  it("counts candidates for progress UI", () => {
    const n = unlockCandidateCount();
    expect(n).toBe(buildUnlockCandidates().length);
    expect(n).toBeGreaterThan(0);
  });
});

describe.runIf(hasFixture)("pdf-unlock real locked fixture", () => {
  it("detects encryption on the real M-PESA locked PDF", () => {
    const bytes = new Uint8Array(readFileSync(LOCKED_FIXTURE));
    expect(isEncrypted(bytes)).toBe(true);
    const meta = detectPdfEncryption(bytes);
    expect(meta).not.toBeNull();
    expect(meta!.revision).toBe(3);
    expect(meta!.version).toBe(2);
  });

  it("fast scanner recovers the real 6-digit PIN from the locked PDF", async () => {
    const bytes = new Uint8Array(readFileSync(LOCKED_FIXTURE));
    // The actual password on this fixture is the numeric PIN 771802.
    // The pure-JS stream-oracle scanner must find it in the 4→6 digit
    // space. Full space = 1,110,000 candidates; the pure-JS MD5+RC4
    // derivation is ~60-120s on a desktop-class machine, so give this
    // integration test a generous budget.
    const pin = await scanNumericPins(bytes, {
      minDigits: 4,
      maxDigits: 6,
    });
    expect(pin).toBe("771802");
  }, 240000);

  it("worker source recovers the real PIN as a candidate (Node harness)", async () => {
    // Execute the ACTUAL Blob-worker source string in a worker_threads worker
    // (the string only ever runs as data in a browser Blob worker; in Node we
    // materialize it to a temp file). A 2-byte header hit is only a candidate;
    // the real PIN MUST appear among the candidates emitted before "done".
    const bytes = new Uint8Array(readFileSync(LOCKED_FIXTURE));
    const enc = __dbg_parseEncrypt(bytes);
    expect(enc).not.toBeNull();
    expect(__dbg_workerSource).toContain('type:"candidate"');

    // Reconstruct segments exactly like scanNumericPinsParallel (concurrency 4).
    const segs = [];
    for (let digits = 4; digits <= 6; digits++) {
      const start = digits === 4 ? 0 : Math.pow(10, digits - 1);
      const end = Math.pow(10, digits);
      const per = Math.max(1, Math.ceil((end - start) / 4));
      for (let s = start; s < end; s += per)
        segs.push({ digits, start: s, end: Math.min(s + per, end) });
    }
    // find first stream for the payload
    const text = Buffer.from(bytes).toString("latin1");
    const sre = /\n(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
    let m = sre.exec(text);
    let s0 = null;
    while (m) {
      const lm = /\/Length\s+(\d+)/.exec(m[3]);
      if (lm && parseInt(lm[1], 10) >= 30) {
        s0 = {
          obj: parseInt(m[1], 10),
          gen: parseInt(m[2], 10),
          start: m.index + m[0].length,
        };
        break;
      }
      m = sre.exec(text);
    }
    expect(s0).not.toBeNull();

    const hex = (a: Uint8Array) =>
      Array.from(a)
        .map((x) => (x < 16 ? "0" : "") + x.toString(16))
        .join("");
    const payload = {
      type: "scan",
      enc: {
        o: hex(enc!.o),
        u: hex(enc!.u || new Uint8Array(0)),
        p: enc!.p,
        r: enc!.r,
        lengthBits: enc!.lengthBits,
        id: hex(enc!.id || new Uint8Array(0)),
      },
      segments: segs,
      stream: { obj: s0!.obj, gen: s0!.gen },
      // use process.cwd() fixture? Simpler: pass the two stream bytes too.
      bytes: Array.from(bytes.subarray(s0!.start, s0!.start + 2)),
    };

    const dir = mkdtempSync(join(tmpdir(), "pdfwk-"));
    const file = join(dir, "wk.cjs");
    writeFileSync(file, __dbg_workerSource);
    try {
      const { Worker } = await import("node:worker_threads");
      const candidates: string[] = await new Promise((res, rej) => {
        const w = new Worker(file);
        const out: string[] = [];
        w.on("message", (d) => {
          if (d.type === "candidate") out.push(d.pin);
          if (d.type === "done") {
            res(out);
          }
        });
        w.on("error", rej);
        w.postMessage(payload);
      });
      expect(candidates).toContain("771802");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);

  it("parallel scanner resolves the real PIN on the fixture", async () => {
    // In Node there is no `Worker`/`Blob` global, so the parallel function must
    // transparently fall back to the (verified) sequential scanner.
    const bytes = new Uint8Array(readFileSync(LOCKED_FIXTURE));
    expect(globalThis.Worker).toBeUndefined();
    const pin = await scanNumericPinsParallel(bytes, {
      minDigits: 4,
      maxDigits: 6,
    });
    expect(pin).toBe("771802");
  }, 240000);

  it("never uses Node-only require() in executable browser code", () => {
    // Regression: the scanner previously called require("pako"), which is
    // undefined in browser ESM (Vite dev / mobile WebView) and silently
    // aborted every scan — extraction "worked on laptop (Node/vitest) but
    // failed on mobile (browser)". Bundlers can tree-shake or statically
    // import pako; this keeps the browser path honest.
    // The Blob-worker source string legitimately carries a guarded
    // require("node:worker_threads") (used ONLY by the Node test harness that
    // executes that string); it is DATA, never parsed by the browser. Strip
    // the worker-string body before the executable-code check.
    const src = readFileSync(
      resolve(repoRoot, "src/react-app/lib/pdf-unlock.ts"),
      "utf8",
    );
    const executable = src.split("SCANNER_WORKER_SOURCE")[0];
    expect(executable).not.toMatch(/\brequire\(/);
    expect(src).toMatch(/import \* as pako from "pako"/);
  });
});
