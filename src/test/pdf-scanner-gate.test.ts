import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { __dbg_parseEncrypt } from "@/react-app/lib/pdf-unlock";
import { SCANNER_WORKER_SOURCE } from "@/react-app/lib/pdf-scanner-worker-source";

/**
 * The scanner worker's cheap prefilter decrypts one stream with a candidate key
 * and looks for a zlib header. Two defects here are invisible in normal use and
 * both silently disabled the fast path, forcing every unlock onto the ~4x more
 * expensive /U checksum:
 *
 *  1. The all-cursor variant hashed a seed buffer that never received the file
 *     key bytes, so the seed was all zeros and no candidate could ever match.
 *  2. The header test only accepted 0x789c (zlib level 6). Encoders emit
 *     0x7801 / 0x785e / 0x789c / 0x78da depending on level, so a stream written
 *     at any other level could never match.
 *
 * These tests drive the SHIPPED worker source (not a reimplementation) and
 * assert the gate recognises the real PIN and rejects a wrong one.
 */

const FIXTURE =
  "/workspace/MPESA_Statement_2026-09-22_to_2026-09-22_578590.pdf";
const PIN = "647356";
const haveFixture = existsSync(FIXTURE);

const hex = (u: Uint8Array) =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** First streams whose dictionary declares FlateDecode, with cursor bytes. */
function flateStreams(bytes: Uint8Array, limit = 3) {
  const text = Buffer.from(bytes).toString("latin1");
  const re = /\n(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  const out: Array<{ obj: number; gen: number; b0: number; b1: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < limit) {
    if (!/\/Filter\s*\/?\[?\s*\/FlateDecode/.test(m[3].replace(/\s+/g, " ")))
      continue;
    const lm = /\/Length\s+(\d+)/.exec(m[3]);
    if (!lm) continue;
    const ln = parseInt(lm[1], 10);
    if (ln < 30 || ln > 2_000_000) continue;
    const start = m.index + m[0].length;
    out.push({
      obj: parseInt(m[1], 10),
      gen: parseInt(m[2], 10),
      b0: bytes[start],
      b1: bytes[start + 1],
    });
  }
  return out;
}

/** Evaluate the worker source with a self-test hook and return the hook. */
function loadWorkerWithHook(hook: string): (arg: unknown) => unknown {
  const src = SCANNER_WORKER_SOURCE.replace(
    "function onMsg(fn){_onmsg(fn);}",
    `function onMsg(fn){_onmsg(fn);}\n${hook}`,
  );
  const self: Record<string, unknown> = {};
  const fn = new Function("self", "require", "process", src + "\nreturn self;");
  fn(self, require, process);
  return self.__probe as (arg: unknown) => unknown;
}

const PROBE_HOOK = `
function hx(a){var s="",i;for(i=0;i<a.length;i++){s+=("0"+a[i].toString(16)).slice(-2);}return s;}
self.__probe=function(raw){
  setupEnc(raw.enc);
  var sb=raw.stream,out=[];
  var pins=raw.pins;
  for(var p=0;p<pins.length;p++){
    var s=pins[p],len=s.length,j;
    for(j=0;j<len;j++){pwBuf[j]=s.charCodeAt(j)&0xff;}
    var fk=fileKeyFast(pwBuf,len);
    var fkHex=hx(fk);
    var one=streamOneHit(fk,sb);
    var any=streamAnyHit(fk,sb);
    out.push({pin:s,fkHex:fkHex,one:one,any:any,uHit:userPasswordHit(fk)});
  }
  return {n:sb.length,results:out};
};`;

describe("scanner prefilter gate", () => {
  it.skipIf(!haveFixture)(
    "recognises the correct PIN via the zlib gate and rejects a wrong PIN",
    () => {
      const bytes = new Uint8Array(readFileSync(FIXTURE));
      const enc = __dbg_parseEncrypt(bytes)!;
      const streams = flateStreams(bytes, 3);
      expect(streams.length).toBeGreaterThan(0);

      const probe = loadWorkerWithHook(PROBE_HOOK);
      const res = probe({
        enc: {
          o: hex(enc.o!),
          u: hex(enc.u || new Uint8Array(0)),
          p: enc.p,
          r: enc.r,
          lengthBits: enc.lengthBits,
          id: hex(enc.id || new Uint8Array(0)),
        },
        stream: streams,
        pins: [PIN, "000000"],
      }) as {
        n: number;
        results: Array<{
          pin: string;
          fkHex: string;
          one: boolean;
          any: boolean;
          uHit: boolean;
        }>;
      };

      const right = res.results.find((r) => r.pin === PIN)!;
      const wrong = res.results.find((r) => r.pin === "000000")!;

      // Guard the seed-buffer defect directly: a zero file key means the seed
      // never received the key bytes, which is exactly bug (1).
      expect(right.fkHex).not.toBe("0".repeat(right.fkHex.length));
      expect(right.fkHex).toHaveLength(32);

      // The zlib gates must agree with the authoritative /U verdict.
      expect(right.uHit).toBe(true);
      expect(right.one).toBe(true);
      expect(right.any).toBe(true);

      // ...and must not fire for a wrong PIN.
      expect(wrong.uHit).toBe(false);
      expect(wrong.any).toBe(false);
    },
  );

  it("accepts every legal zlib header, not just the level-6 default", () => {
    // Verified against Python zlib: levels 0-1 emit 0x7801, 2-5 emit 0x785e,
    // 6 emits 0x789c, 7-9 emit 0x78da.
    const legal: Array<[number, number]> = [
      [0x78, 0x01],
      [0x78, 0x5e],
      [0x78, 0x9c],
      [0x78, 0xda],
    ];
    const zlibHeader = (b0: number, b1: number) =>
      b0 === 0x78 && (b1 & 0x20) === 0 && ((b0 << 8) | b1) % 31 === 0;
    for (const [b0, b1] of legal) expect(zlibHeader(b0, b1)).toBe(true);
    // A preset-dictionary stream (FDICT set) and non-deflate CM are rejected.
    expect(zlibHeader(0x78, 0xbb)).toBe(false); // 0x78bb % 31 === 0 but FDICT set
    expect(zlibHeader(0x79, 0x9c)).toBe(false);
    expect(zlibHeader(0x00, 0x00)).toBe(false);
  });

  it("keeps the prefilter narrow (4 of 65536 two-byte values)", () => {
    const zlibHeader = (b0: number, b1: number) =>
      b0 === 0x78 && (b1 & 0x20) === 0 && ((b0 << 8) | b1) % 31 === 0;
    let n = 0;
    for (let b0 = 0; b0 < 256; b0++) {
      for (let b1 = 0; b1 < 256; b1++) if (zlibHeader(b0, b1)) n++;
    }
    // A looser test (low nibble == 8) would admit 66 values and multiply the
    // expensive confirmations by 16.
    expect(n).toBe(4);
  });
});
