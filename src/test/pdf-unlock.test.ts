import { describe, it, expect } from "vitest";
import {
  isEncrypted,
  detectPdfEncryption,
  buildUnlockCandidates,
  candidatesFromFilename,
  unlockCandidateCount,
  scanNumericPins,
} from "@/react-app/lib/pdf-unlock";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

  it("includes classic pins + words", () => {
    const cands = buildUnlockCandidates();
    for (const p of ["1234", "0000", "123456", "password", "99999999"]) {
      expect(cands).toContain(p);
    }
    expect(cands.indexOf("1234")).toBeGreaterThan(0);
  });

  it("dedupes despite filename hints overlapping generic list", () => {
    const cands = buildUnlockCandidates("MPESA_1234.pdf");
    const set = new Set(cands);
    expect(set.size).toBe(cands.length);
  });

  it("derives till-number hints from an M-PESA filename", () => {
    const hints = candidatesFromFilename(
      "MPESA_Statement_2026-09-ss1_to_2026-09-11_578590.pdf",
    );
    expect(hints).toContain("578590");
    expect(hints).toContain("2026");
    expect(hints.some((h) => /mpesa/i.test(h))).toBe(true);
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

  it("filename hints include the till number from the statement name", () => {
    const hints = candidatesFromFilename(
      "MPESA_Statement_2026-09-ss1_to_2026-09-11_578590.pdf",
    );
    expect(hints).toContain("578590");
  });

  it("never uses Node-only require() (browser-ESM guard)", () => {
    // Regression: the scanner previously called require("pako"), which is
    // undefined in browser ESM (Vite dev / mobile WebView) and silently
    // aborted every scan — extraction "worked on laptop (Node/vitest) but
    // failed on mobile (browser)". Bundlers can tree-shake or statically
    // import pako; this keeps the browser path honest.
    const src = readFileSync(
      resolve(repoRoot, "src/react-app/lib/pdf-unlock.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).toMatch(/import \* as pako from "pako"/);
  });
});
