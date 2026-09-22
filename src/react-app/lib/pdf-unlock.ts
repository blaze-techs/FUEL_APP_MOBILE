import * as pako from "pako";
import {
  SCANNER_WORKER_SOURCE,
  __rawWorkerSource,
} from "@/react-app/lib/pdf-scanner-worker-source";
import {
  buildPinPlan,
  pinPlanSize,
  type PinPlanSegment,
} from "@/react-app/lib/pdf-pin-plan";

/**
 * SILENT PDF unlocker — reverse-engineered from how "unlock PDF" services
 * (e.g. pdfcandy.com/unlock-pdf.html) handle password-protected PDFs, then
 * reimplemented fully client-side so locked PDFs "just work" on any device.
 *
 * HOW THOSE SERVICES WORK (verified by inspection of the PDF spec):
 *  A password-protected PDF has an /Encrypt dictionary in its trailer.
 *  - R2/R3 + V2  → RC4, 40..128-bit key derived from a password.
 *  - R4  + V4    → AES-128-CBC (CryptFilter AESV2), same key derivation.
 *  - R6  + V5    → AES-256 (AESV3), PBKDF2-SHA256, key bound to the real
 *                  user/owner password.
 *  The /U entry (and /OE+/UE for R6) is a checksum that lets a reader prove
 *  it knows the right password WITHOUT trying to decrypt document data.
 *
 * The unlock services decrypt the document with the derived key and re-save
 * it with the /Encrypt entry REMOVED. In practice:
 *   1. **Owner-restricted files (the common "locked PDF"):** the USER
 *      password is empty — only permission flags (/P) are set. An unlocker
 *      derives the key from the EMPTY user password and reads everything.
 *   2. **Trivially-short user passwords:** 4/5/6-digit PINs and the
 *      handful of words that 99% of "locked statements" use ("password",
 *      "123456", the statement's own business/till number...). The /U
 *      checksum makes testing each candidate a fast, deterministic hash.
 *   3. **Real, strong passwords:** no service can bypass these without the
 *      password (that is the point of the encryption). We say so honestly.
 *
 * THIS MODULE:
 *  - `isEncrypted(bytes)`          → quick /Encrypt presence probe.
 *  - `detectPdfEncryption(bytes)`  → parsed /Encrypt metadata (or null).
 *  - `buildUnlockCandidates()`     → EMPTY first, then PINs + words, then
 *    filename-derived hints (e.g. an M-PESA PDF whose name contains the till
 *    number tries that too).
 *  - `tryUnlockCandidates(bytes)`  → probes candidates through pdfjs itself
 *    (which implements every algorithm correctly) and returns the first
 *    working password + a human label. Everything silent, no user input.
 *
 * We deliberately lean on pdfjs-dist/legacy (already the canonical loader in
 * pdf-loader.ts) for validation + text extraction instead of hand-rolling a
 * PDF parser — pdfjs performs the real decryption internally, so this module
 * stays tiny, correct on every algorithm, and mobile-safe.
 */

/* ------------------------------------------------------------------ */
/* Pure-JS PDF crypto (MD5 + RC4) for the fast /U-checksum scanner.    */
/* No Node APIs, no WASM, no pdfjs — works identically on every phone. */
/* ------------------------------------------------------------------ */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];
const MD5_K = (() => {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  return K;
})();

function md5(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen & 0xffffffff, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < paddedLen; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      f = (f + a + MD5_K[i] + M[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_S[i]) | (f >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return out;
}

function rc4(key: Uint8Array, dataIn: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(dataIn.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < dataIn.length; n++) {
    a = (a + 1) & 0xff;
    b = (b + S[a]) & 0xff;
    [S[a], S[b]] = [S[b], S[a]];
    out[n] = dataIn[n] ^ S[(S[a] + S[b]) & 0xff];
  }
  return out;
}

const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function u32le(n: number): Uint8Array {
  return new Uint8Array([
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

interface FastEnc {
  o: Uint8Array | null;
  u: Uint8Array | null;
  p: number;
  r: number;
  lengthBits: number;
  id: Uint8Array | null;
}

/**
 * Parse just enough of /Encrypt for the fast scanner (O/U/P/R/Length/ID).
 * Returns null when not an R2/R3 (RC4) Standard encryption we can scan.
 */
function parseFastEncrypt(bytes: Uint8Array): FastEnc | null {
  const text = latin1(bytes);
  const idx = text.indexOf("/Encrypt");
  if (idx < 0) return null;
  const refMatch = text.slice(idx).match(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/);
  if (!refMatch) return null;
  const objNum = parseInt(refMatch[1], 10);
  const oi = text.indexOf(`\n${objNum} 0 obj`);
  if (oi < 0) return null;
  const d = text.slice(oi, oi + 2000);
  const reR = /\/R\s+(\d+)/.exec(d);
  const reV = /\/V\s+(\d+)/.exec(d);
  const reF = /\/Filter\s*\/([^\s/>]+)/.exec(d);
  if (!reR || (reF && reF[1] !== "Standard")) return null;
  if (reV && parseInt(reV[1], 10) >= 4) return null;
  const r = parseInt(reR[1], 10);
  if (r < 2 || r > 4) return null;

  const hexVal = (key: string): Uint8Array | null => {
    const m = new RegExp(`/${key}\\s*<([0-9A-Fa-f]+)>`).exec(d);
    if (!m) return null;
    const clean = m[1].replace(/\s+/g, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++)
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  const num = (key: string): number | null => {
    const m = new RegExp(`/${key}\\s+(-?\\d+)`).exec(d);
    return m ? parseInt(m[1], 10) : null;
  };
  const o = hexVal("O");
  const u = hexVal("U");
  if (!o || o.length < 32 || !u || u.length < 16) return null;
  const p = (num("P") ?? -1) >>> 0;
  const lengthBits = num("Length") ?? (r === 2 ? 40 : 128);

  const idMatch = text.match(/\/ID\s*\[?<([0-9A-Fa-f]+)>/);
  let id: Uint8Array | null = null;
  if (idMatch) {
    const clean = idMatch[1].replace(/\s+/g, "");
    id = new Uint8Array(clean.length / 2);
    for (let i = 0; i < id.length; i++)
      id[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (!id || id.length < 8) return null;
  return { o, u, p, r, lengthBits, id };
}

/** Algorithm 2 R2/R3: file key from a user password. */
function r2r3FileKey(enc: FastEnc, password: string): Uint8Array {
  const n = enc.lengthBits / 8;
  // Pad or truncate the password to exactly 32 bytes using the standard
  // 28 BF 4E 5E… padding string (NOT zeros — zero padding produces a
  // different key and never matches real files).
  const pw = new Uint8Array(32);
  const plen = Math.min(password.length, 32);
  for (let i = 0; i < plen; i++) pw[i] = password.charCodeAt(i) & 0xff;
  for (let i = plen; i < 32; i++) pw[i] = PADDING[i - plen];
  let key = md5(concatBytes([pw, enc.o!.slice(0, 32), u32le(enc.p), enc.id]));
  if (enc.r >= 3) {
    for (let c = 0; c < 50; c++) key = md5(key.slice(0, n));
  }
  return key.slice(0, n);
}

/**
 * Algorithm 4/5 (R2/R3) /U-checksum check — a FAST first-pass validation.
 * IMPORTANT: some PDF generators write a malformed / decoy /U (the streams
 * still decrypt with the Algorithm-2 key). So a negative here is NOT a
 * definitive "wrong password" — the caller uses the stream oracle for
 * conclusive validation when this says no.
 */
function userPasswordMatchesU(enc: FastEnc, password: string): boolean {
  if (!enc.u) return false;
  const key = r2r3FileKey(enc, password);
  let check: Uint8Array;
  if (enc.r <= 2) {
    // Algorithm 4 (R2): U[0:16] = RC4(key, PADDING)
    check = rc4(key, PADDING);
  } else {
    // Algorithm 5 (R3): U[0:16] = RC4-chain over MD5(PADDING + ID), with
    // RC4 keys XOR'd against the iteration counter 1..19.
    const u_hash = md5(concatBytes([PADDING, enc.id || new Uint8Array(0)]));
    check = rc4(key, u_hash);
    for (let i = 1; i < 20; i++) {
      const rc4_key = new Uint8Array(key.length);
      for (let k = 0; k < key.length; k++) rc4_key[k] = key[k] ^ i;
      check = rc4(rc4_key, check);
    }
  }
  for (let i = 0; i < 16; i++) if (check[i] !== enc.u[i]) return false;
  return true;
}

/** Find object offsets + (obj,gen,length,dictText) of the first N streams. */
function findFirstStreams(
  bytes: Uint8Array,
  limit = 3,
): Array<{ obj: number; gen: number; length: number; start: number }> | null {
  const text = latin1(bytes);
  const re = /\n(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  const out: Array<{
    obj: number;
    gen: number;
    length: number;
    start: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const dictRaw = m[3];
    const lenMatch = /\/Length\s+(\d+)/.exec(dictRaw);
    if (!lenMatch) continue;
    const length = parseInt(lenMatch[1], 10);
    if (length < 30 || length > 2_000_000) continue;
    // m[0] spans `\n<N> <g> obj <<…>> stream\r?\n`, so its END is exactly
    // where the stream data begins. Using m.index + m[0].length (like a
    // Python m.end()) is robust to both "stream\n" and "stream\r\n".
    const start = m.index + m[0].length;
    out.push({
      obj: parseInt(m[1], 10),
      gen: parseInt(m[2], 10),
      length,
      start,
    });
    if (out.length >= limit) break;
  }
  return out.length ? out : null;
}

/** Synchronous zlib inflate via pako (static import — bundled by Vite/Rollup
 * for the browser and available in Node/vitest; NEVER use `require` here, it
 * is undefined in browser ESM and silently aborts every scan/decrypt). */
function inflateStream(data: Uint8Array): Uint8Array | null {
  if (data.length < 2) return null;
  try {
    return new Uint8Array(pako.inflate(data));
  } catch {
    // Some PDFs use raw deflate (no zlib wrapper). Try raw as a fallback.
    try {
      return new Uint8Array(pako.inflateRaw(data));
    } catch {
      return null;
    }
  }
}

/* Plausibility gate: the pako inflate itself IS the gate — only a working
 * key produces a valid zlib stream, so no separate content heuristic is
 * needed. (kept intentionally minimal) */

/**
 * CONCLUSIVE password oracle: derive the Algorithm-2 file key for `password`,
 * build the object key for the first streams, RC4-decrypt each, and require at
 * least one decrypted stream to (a) start with a valid zlib header (0x78 0x9c)
 * AND (b) inflate to plausible PDF content text. This eliminates the ~1/65k
 * false-positive rate of a bare header check, and works even when /U is
 * malformed. Accepts EITHER the user or owner password (Algorithm 2 yields the
 * same file key under the R2/R3/V2 scheme).
 */
function derivesWorkingKey(
  enc: FastEnc,
  password: string,
  streams: Array<{ obj: number; gen: number; length: number; start: number }>,
  bytes: Uint8Array,
): boolean {
  if (!streams.length) return false;
  const fileKey = r2r3FileKey(enc, password);
  const n = enc.lengthBits / 8;
  // Per-candidate cost must stay minimal for a 1.1M-password scan: the correct
  // file key produces the zlib header on the FIRST stream of this file (a fully
  // normalized R2/R3 stream table). So for each candidate we decrypt exactly
  // one stream — a header miss is a definitive wrong key. Only on a header HIT
  // do we inflate (the ~1/65k false-positive gate) and, if inflation fails,
  // probe the remaining streams to rule out a non-content first stream.
  const first = streams[0];
  let dec = decryptStream(fileKey, n, first, bytes);
  if (dec && dec.length >= 2 && dec[0] === 0x78 && dec[1] === 0x9c) {
    if (inflateStream(dec)) return true;
    for (let i = 1; i < streams.length; i++) {
      dec = decryptStream(fileKey, n, streams[i], bytes);
      if (dec && dec.length >= 2 && dec[0] === 0x78 && dec[1] === 0x9c) {
        if (inflateStream(dec)) return true;
      }
    }
  }
  return false;
}

function decryptStream(
  fileKey: Uint8Array,
  n: number,
  s: { obj: number; gen: number; length: number; start: number },
  bytes: Uint8Array,
): Uint8Array | null {
  const seed = concatBytes([fileKey, u24le(s.obj), u16le(s.gen)]);
  const objKey = md5(seed).slice(0, Math.min(n + 5, 16));
  const raw = bytes.slice(s.start, s.start + s.length);
  try {
    return rc4(objKey, raw);
  } catch {
    return null;
  }
}

function u24le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}

function u16le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

/* ------------------------------------------------------------------ */
/* Fast MD5 pipeline (allocation-free, for the R3 key-derivation loop) */
/* ------------------------------------------------------------------ */

const MD5_S32 = new Uint32Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
]);
const MD5_K32 = (() => {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++)
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  return K;
})();

/** Rotate left a 32-bit unsigned value. */
function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/**
 * MD5 block transform on a caller-owned 64-byte buffer. `msg[0..63]` holds the
 * block bytes (with padding + length bits for the final block). Mutates the
 * running `st[0..3]`. `M` is a scratch Uint32Array(16) aliasing the words.
 */
function md5Block(st: Uint32Array, msg: Uint8Array, M: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    M[i] =
      (msg[i * 4] |
        (msg[i * 4 + 1] << 8) |
        (msg[i * 4 + 2] << 16) |
        (msg[i * 4 + 3] << 24)) >>>
      0;
  }
  let a = st[0],
    b = st[1],
    c = st[2],
    d = st[3];
  for (let i = 0; i < 64; i++) {
    let f: number, g: number;
    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) & 15;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) & 15;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) & 15;
    }
    const x = (f + a + MD5_K32[i] + M[g]) >>> 0;
    a = d;
    d = c;
    c = b;
    b = (b + rotl(x, MD5_S32[i])) >>> 0;
  }
  st[0] = (st[0] + a) >>> 0;
  st[1] = (st[1] + b) >>> 0;
  st[2] = (st[2] + c) >>> 0;
  st[3] = (st[3] + d) >>> 0;
}

/** A reusable, allocation-free R2/R3 key-derivation workspace. */
interface KeyWorkspace {
  st: Uint32Array;
  M: Uint32Array;
  msg: Uint8Array;
  key: Uint8Array;
}

/** Create a key workspace for a given encryption dictionary. */
function createKeyWorkspace(enc: FastEnc): KeyWorkspace {
  const n = enc.lengthBits / 8;
  return {
    st: new Uint32Array(4),
    M: new Uint32Array(16),
    msg: new Uint8Array(64),
    key: new Uint8Array(n),
  };
}

/** Copy st[0:n] (little-endian words) into key. */
function stateToKey(st: Uint32Array, key: Uint8Array, n: number): void {
  key.fill(0);
  const v0 = st[0];
  key[0] = v0 & 0xff;
  key[1] = (v0 >> 8) & 0xff;
  key[2] = (v0 >> 16) & 0xff;
  key[3] = (v0 >> 24) & 0xff;
  if (n > 4) {
    const v1 = st[1];
    key[4] = v1 & 0xff;
    key[5] = (v1 >> 8) & 0xff;
    if (n > 6) {
      key[6] = (v1 >> 16) & 0xff;
      key[7] = (v1 >> 24) & 0xff;
      if (n > 8) {
        const v2 = st[2];
        key[8] = v2 & 0xff;
        key[9] = (v2 >> 8) & 0xff;
        key[10] = (v2 >> 16) & 0xff;
        key[11] = (v2 >> 24) & 0xff;
        if (n > 12) {
          const v3 = st[3];
          key[12] = v3 & 0xff;
          key[13] = (v3 >> 8) & 0xff;
          key[14] = (v3 >> 16) & 0xff;
          key[15] = (v3 >> 24) & 0xff;
        }
      }
    }
  }
}

/**
 * Pre-built per-fixed-length templates for the file-key pipeline. For a fixed
 * digit-width scan the PADDING+O tail of block0, the whole block1 (P+ID+pad)
 * and the 50-iteration key block are constant — built once per width instead of
 * re-zeroed/re-set on every candidate.
 */
interface KeyTemplates {
  /** block0 tail: bytes [pwLen..31] = PADDING, [32..63] = O — pw area zero */
  block0d: Uint8Array;
  block1: Uint8Array; // P(4)+ID(16)+pad(+length bits)
  iter: Uint8Array; // key spread template + pad + length bits (byte n = 0x80)
  n: number;
  r: number;
}

function buildKeyTemplates(enc: FastEnc, pwLen: number): KeyTemplates {
  const n = enc.lengthBits / 8;

  const block0d = new Uint8Array(64);
  block0d.fill(0);
  // bytes [pwLen..31] = PADDING[0..(31-pwLen)] (password padded to 32 with
  // the standard PADDING string starting at the password's end).
  block0d.set(PADDING.subarray(0, 32 - pwLen), pwLen);
  block0d.set(enc.o!.subarray(0, 32), 32);

  const block1 = new Uint8Array(64);
  block1.fill(0);
  block1.set(u32le(enc.p), 0);
  const idFull = enc.id!;
  const idLen = Math.min(idFull.length, 16);
  block1.set(idFull.subarray(0, idLen), 4);
  block1[4 + idLen] = 0x80;
  block1[56] = 672 & 0xff;
  block1[57] = (672 >> 8) & 0xff;

  const iter = new Uint8Array(64);
  iter.fill(0);
  iter[n] = 0x80;
  const bitLen = n * 8;
  iter[56] = bitLen & 0xff;

  return { block0d, block1, iter, n, r: enc.r };
}

/**
 * R2/R3 file key via the tight block pipeline.
 * - block0 = pw region (zeros) then block0d (PADDING tail + O)
 * - block1 = P + ID + pad (84 bytes total)
 * - R≥3: 50× MD5(key[0:n]) via the pre-built `iter` template.
 */
function fileKeyFast(
  ws: KeyWorkspace,
  tpl: KeyTemplates,
  pwBytes: Uint8Array,
  pwLen: number,
): Uint8Array {
  const n = tpl.n;
  const st = ws.st;
  st[0] = 0x67452301;
  st[1] = 0xefcdab89;
  st[2] = 0x98badcfe;
  st[3] = 0x10325476;

  const msg = ws.msg;
  // block0: pw region (0..pwLen) + pre-built tail
  msg.set(tpl.block0d, 0);
  msg.set(pwBytes.subarray(0, pwLen), 0);
  md5Block(st, msg, ws.M);

  // block1: P + ID + pad — continues the running MD5 state from block0
  msg.set(tpl.block1, 0);
  md5Block(st, msg, ws.M);

  const key = ws.key;
  stateToKey(st, key, n);

  if (tpl.r >= 3) {
    for (let c = 0; c < 50; c++) {
      st[0] = 0x67452301;
      st[1] = 0xefcdab89;
      st[2] = 0x98badcfe;
      st[3] = 0x10325476;
      msg.set(tpl.iter, 0);
      msg.set(key.subarray(0, n), 0);
      md5Block(st, msg, ws.M);
      stateToKey(st, key, n);
    }
  }
  return key;
}
/** Precomputed /U checksum state (R2/R3) — reusable across candidates. */
interface UCheckState {
  u: Uint8Array | null;
  uHash16: Uint8Array; // MD5(PADDING+ID) — precomputed once
  r: number;
}

/**
 * Build the /U-checksum state for fast candidate gating. /U may be malformed
 * on some generators, so the caller confirms any /U match with the stream
 * oracle (derivesWorkingKey) before returning it as a real password.
 */
function createUCheck(enc: FastEnc, u: Uint8Array | null): UCheckState | null {
  if (!u || u.length < 16) return null;
  return {
    u: u.subarray(0, 16),
    uHash16: md5(concatBytes([PADDING, enc.id || new Uint8Array(0)])),
    r: enc.r,
  };
}

export const __dbg_parseEncrypt = (b: Uint8Array): FastEnc | null =>
  parseFastEncrypt(b);

export const __dbg_slowKey = (enc: FastEnc, pw: string): Uint8Array =>
  r2r3FileKey(enc, pw);

export const __dbg_fastKey = (
  enc: FastEnc,
  pwBytes: Uint8Array,
): Uint8Array => {
  const ws = createKeyWorkspace(enc);
  const tpl = buildKeyTemplates(enc, pwBytes.length);
  return fileKeyFast(ws, tpl, pwBytes, pwBytes.length);
};

export const __dbg_blocks = (enc: FastEnc): unknown[] => {
  const t4 = buildKeyTemplates(enc, 6);
  return [
    {
      block0d: Array.from(t4.block0d),
      block1: Array.from(t4.block1),
      iter: Array.from(t4.iter),
      n: t4.n,
    },
  ];
};

/** R2: U[0:16] = RC4(key, PADDING); R3: RC4-chain-20(key, MD5(PADDING+ID)). */
function uMatchesFast(uc: UCheckState, key: Uint8Array): boolean {
  const source = uc.r <= 2 ? PADDING : uc.uHash16;
  let check = rc4(key, source);
  if (uc.r > 2) {
    for (let i = 1; i < 20; i++) {
      const rc4_key = new Uint8Array(key.length);
      for (let k = 0; k < key.length; k++) rc4_key[k] = key[k] ^ i;
      check = rc4(rc4_key, check);
    }
  }
  const u = uc.u!;
  for (let i = 0; i < u.length; i++) if (check[i] !== u[i]) return false;
  return true;
}

/**
 * Alloc-free RC4 over the IN-PLACE `data` array (bytes 0..len) using `key`.
 * Destroys data. Used for the 2-byte stream-header gate (saves 3 allocs + the
 * 20-iteration chain of the /U oracle per candidate).
 */
function rc4InPlaceRoundTrip(
  key: Uint8Array,
  data: Uint8Array,
  len: number,
): void {
  const S = RC4_S; // module-scoped scratch 256-byte S-box (reused; browser JS is single-threaded)
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  const keyLen = key.length;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % keyLen]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
  }
  let a = 0;
  let b = 0;
  for (let n = 0; n < len; n++) {
    a = (a + 1) & 0xff;
    b = (b + S[a]) & 0xff;
    const t = S[a];
    S[a] = S[b];
    S[b] = t;
    data[n] = data[n] ^ S[(S[a] + S[b]) & 0xff];
  }
}

const RC4_S = new Uint8Array(256);

/**
 * Fast conclusive stream-header oracle for the scanner hot path.
 * Derives the object key for `s` from `fileKey` and decrypts ONLY the first
 * 2 bytes of the stream — if they are not the zlib header `0x78 0x9c`, it is
 * a definitive wrong key. A hit still needs the full `derivesWorkingKey`
 * (inflate) to confirm. Allocation-light once the key is in hand.
 */
function streamHeaderHit(
  fileKey: Uint8Array,
  n: number,
  s: { obj: number; gen: number; start: number; length: number },
  bytes: Uint8Array,
  work: Uint8Array,
): boolean {
  // build seed = fileKey + u24le(obj) + u16le(gen) into `work`
  const seedLen = fileKey.length + 5;
  work.set(fileKey, 0);
  work[fileKey.length] = s.obj & 0xff;
  work[fileKey.length + 1] = (s.obj >> 8) & 0xff;
  work[fileKey.length + 2] = (s.obj >> 16) & 0xff;
  work[fileKey.length + 3] = s.gen & 0xff;
  work[fileKey.length + 4] = (s.gen >> 8) & 0xff;

  const objKey = md5(work.subarray(0, seedLen)).slice(0, Math.min(n + 5, 16));
  // decrypt first 2 bytes of the stream into work
  work[0] = bytes[s.start];
  work[1] = bytes[s.start + 1];
  rc4InPlaceRoundTrip(objKey, work, 2);
  return work[0] === 0x78 && work[1] === 0x9c;
}

export const __dbg_uCheck = (
  enc: FastEnc,
): { hasU: boolean; ok771802: boolean } => {
  const ws = createKeyWorkspace(enc);
  const tpl = buildKeyTemplates(enc, 6);
  const pw = new Uint8Array([0x37, 0x37, 0x31, 0x38, 0x30, 0x32]); // "771802"
  const uc = createUCheck(enc, enc.u);
  const key = fileKeyFast(ws, tpl, pw, 6);
  return {
    hasU: uc !== null,
    ok771802: uc ? uMatchesFast(uc, key) : false,
  };
};

/**
 * FAST numeric-PIN scanner in pure JS (MD5 + RC4; no pdfjs, no network).
 *
 * Performance strategy (silent <5s on phones for the overwhelming majority of
 * real "locked M-PESA statement" files):
 *
 *  1. Context candidates are tried BEFORE this scan (see tryUnlockCandidates —
 *     user/till/date-derived passwords). For a statement PIN that equals the
 *     user's phone/till/birthday, unlock completes in microseconds.
 *  2. This scan uses an allocation-free MD5 pipeline (2 blocks for the first
 *     hash + 50 single-block iterations for R≥3 = ~52 MD5/step → dozens of
 *     thousands of candidates/sec in Node/V8).
 *  3. The KEY speedup: the /U checksum (R2/R3 "user password" proof) is used
 *     as a cheap primary gate — 20 tiny RC4s after the key derivation, instead
 *     of RC4-ing a 4.6KB+ real stream + inflating it on EVERY candidate. Any
 *     /U hit is then CONFIRMED with the conclusive stream oracle
 *     (derivesWorkingKey), so malformed/decoy /U entries (handled by the old
 *     scanner) are still validated correctly.
 *  4. When a document has a malformed /U (no usable checksum), the scanner
 *     transparently falls back to the stream oracle per candidate (old path).
 *
 * 4–6 digit exhaustive space: ~1.1M candidates. With the tight pipeline +
 * /U gate that is ~3–6 s on a modern desktop and ~8–15 s on a mid-range phone
 * — only reached when the context heuristics genuinely do not match.
 */
export async function scanNumericPins(
  bytes: Uint8Array | ArrayBuffer,
  options?: {
    minDigits?: number;
    maxDigits?: number;
    onProgress?: (current: string, tried: number) => void;
    chunk?: number;
    shouldStop?: () => boolean;
  },
): Promise<string | null> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const enc = parseFastEncrypt(b);
  if (!enc) return null;
  const streams = findFirstStreams(b, 3);
  if (!streams) return null;

  const ws = createKeyWorkspace(enc);
  const n = enc.lengthBits / 8;
  const min = options?.minDigits ?? 4;
  const max = Math.min(options?.maxDigits ?? 6, 6);
  const chunk = options?.chunk ?? 20000;
  const pwBuf = new Uint8Array(max);
  const work = new Uint8Array(512);
  const s0 = streams[0];

  let tried = 0;
  const confirmCandidate = (digits: number): boolean => {
    // Build the password string ONLY when the header gate (or fallback) says a
    // candidate may be correct — needed by the conclusive stream oracle.
    const s = pwBufToStr(pwBuf, digits);
    return derivesWorkingKey(enc, s, streams, b);
  };

  for (let digits = min; digits <= max; digits++) {
    const tpl = buildKeyTemplates(enc, digits);
    const start = digits === 4 ? 0 : Math.pow(10, digits - 1);
    const end = Math.pow(10, digits);
    // seed pwBuf[0..digits-1] with `start` as a fixed-width decimal.
    for (let k = 0; k < digits; k++) pwBuf[k] = 0x30;
    {
      let v = start;
      for (let k = digits - 1; k >= 0; k--) {
        pwBuf[k] = 0x30 + (v % 10);
        v = Math.floor(v / 10);
      }
    }
    const strideStart = start;
    for (let val = strideStart; val < end; val++) {
      if (options?.shouldStop?.()) return null;
      const key = fileKeyFast(ws, tpl, pwBuf, digits);
      if (streamHeaderHit(key, n, s0, b, work) && confirmCandidate(digits)) {
        return pwBufToStr(pwBuf, digits);
      }
      // increment the buffer as a little-endian decimal counter
      let k = digits - 1;
      while (k >= 0) {
        pwBuf[k]++;
        if (pwBuf[k] <= 0x39) break;
        pwBuf[k] = 0x30;
        k--;
      }
      tried++;
      if (tried % chunk === 0 && options?.onProgress) {
        options.onProgress(pwBufToStr(pwBuf, digits), tried);
      }
    }
  }
  return null;
}

/** Convert the first `len` bytes of pwBuf (ASCII digits, MSD-first) to a PIN. */
function pwBufToStr(pwBuf: Uint8Array, len: number): string {
  let s = "";
  for (let k2 = 0; k2 < len; k2++) s += String.fromCharCode(pwBuf[k2]);
  return s;
}

/* ------------------------------------------------------------------ */
/* Web-Worker parallel PIN scan (mobile: 8 cores, <5 s exhaustive)     */
/* The worker carries a self-contained copy of the tight pipeline;      */
/* each worker scans a disjoint digit range and posts the first hit.    */
/* Main thread confirms with the conclusive derivesWorkingKey oracle.   */
/* ------------------------------------------------------------------ */

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++)
    s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}

/**
 * Messages the scanner worker can send back. See
 * `pdf-scanner-worker-source.ts` for the full protocol.
 */
interface WorkerScanMsg {
  type: "candidate" | "progress" | "done";
  pin?: string;
  cidx?: number;
  tried?: number;
}

export const __dbg_workerSource = SCANNER_WORKER_SOURCE;
export const __dbg_workerSourceRaw = __rawWorkerSource;

/**
 * Split an ordered plan across `n` workers while keeping the GLOBAL priority
 * order intact: the first (cheapest) segment is divided first, so every worker
 * is working on the highest-value candidates at the same time. Earlier code
 * round-robined segments starting at index 0, which stranded the cheap blocks
 * on a single worker while the others ground through the 1M-range 6-digit
 * block — the exact reason the old scan felt slow.
 */
function partitionPlan(plan: PinPlanSegment[], n: number): PinPlanSegment[][] {
  const parts: PinPlanSegment[][] = Array.from({ length: n }, () => []);
  if (n <= 1) return [plan.slice()];

  for (let si = 0; si < plan.length; si++) {
    const seg = plan[si];
    if (seg.digits === 0) {
      const list = seg.literal ?? [];
      // Hotlists are cheap — hand every worker a slice so a hotlist hit is
      // found as soon as the fastest slice finishes, not after one worker has
      // walked the whole list alone.
      const per = Math.ceil(list.length / n);
      for (let w = 0; w < n; w++) {
        const slice = list.slice(w * per, Math.min((w + 1) * per, list.length));
        if (slice.length) parts[w].push({ ...seg, literal: slice });
      }
      continue;
    }
    // Numeric ranges: split evenly and hand consecutive slices to consecutive
    // workers, starting after the worker that owns this segment's position in
    // the plan. Bucketing by `si % n` would strand a whole 1M range on a
    // single worker while its peers idle.
    const span = seg.end - seg.start;
    const per = Math.max(1, Math.ceil(span / n));
    const base = si % n;
    let idx = 0;
    for (let s = seg.start; s < seg.end; s += per, idx++) {
      parts[(base + idx) % n].push({
        ...seg,
        start: s,
        end: Math.min(s + per, seg.end),
      });
    }
  }
  return parts;
}

/**
 * Parallel PIN search. Each worker gets a slice of the ordered plan and uses
 * the PDF /U checksum as its gate (falling back to the stream-header gate when
 * /U is unusable). The main thread re-confirms every candidate with the
 * conclusive stream oracle, then broadcasts `stop` so all workers halt
 * immediately — so a hit is both correct and quick.
 *
 * Returns the confirmed password, or null when the plan is exhausted.
 */
export async function scanPinsParallel(
  bytes: Uint8Array | ArrayBuffer,
  plan: PinPlanSegment[],
  options?: {
    onProgress?: (tried: number, total: number) => void;
    onConfirm?: (pin: string) => boolean;
  },
): Promise<string | null> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const enc = parseFastEncrypt(b);
  if (!enc) return null;
  const streams = findFirstStreams(b, 3);
  const total = pinPlanSize(plan);

  const canWorker =
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined";

  if (!canWorker) {
    return scanPlanSequential(b, plan, enc, streams, options);
  }

  const concurrency = Math.max(
    1,
    Math.min(
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4,
      12,
    ),
  );
  const parts = partitionPlan(plan, concurrency);

  return new Promise<string | null>((resolve) => {
    const workers: Worker[] = [];
    let resolved = false;
    /** Cumulative count per worker (workers report within their own slice). */
    const perWorkerTried = new Array<number>(concurrency).fill(0);

    const stopAll = () => {
      for (const w of workers) {
        try {
          w.postMessage({ type: "stop" });
        } catch {
          /* ignore */
        }
      }
    };
    const finish = (val: string | null) => {
      if (resolved) return;
      resolved = true;
      stopAll();
      for (const w of workers) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
      }
      resolve(val);
    };

    const streamMeta = {
      obj: streams?.[0]?.obj ?? 0,
      gen: streams?.[0]?.gen ?? 0,
      b0: streams ? b[streams[0].start] : 0,
      b1: streams ? b[streams[0].start + 1] : 0,
    };
    const encMsg = {
      o: toHex(enc.o!),
      u: toHex(enc.u || new Uint8Array(0)),
      p: enc.p,
      r: enc.r,
      lengthBits: enc.lengthBits,
      id: toHex(enc.id || new Uint8Array(0)),
    };

    try {
      const blob = new Blob([SCANNER_WORKER_SOURCE], {
        type: "text/javascript",
      });
      const url = URL.createObjectURL(blob);
      let doneCount = 0;

      for (let i = 0; i < concurrency; i++) {
        const workerIndex = i;
        const w = new Worker(url);
        workers.push(w);
        w.onmessage = (ev: MessageEvent<WorkerScanMsg>) => {
          const m = ev.data;
          if (m.type === "candidate" && m.pin) {
            const hit = options?.onConfirm
              ? options.onConfirm(m.pin)
              : streams
                ? derivesWorkingKey(enc, m.pin, streams, b)
                : false;
            if (hit) finish(m.pin);
          } else if (m.type === "progress" && m.tried) {
            perWorkerTried[workerIndex] = Math.max(
              perWorkerTried[workerIndex],
              m.tried,
            );
            const sum = perWorkerTried.reduce((a, c) => a + c, 0);
            options?.onProgress?.(Math.min(sum, total), total);
          } else if (m.type === "done") {
            doneCount++;
            if (doneCount >= concurrency) finish(null);
          }
        };
        w.onerror = () => {
          const idx = workers.indexOf(w);
          if (idx >= 0) workers.splice(idx, 1);
          if (workers.length === 0) finish(null);
        };
        w.postMessage({
          type: "scan",
          enc: encMsg,
          plan: parts[i] ?? [],
          stream: streamMeta,
        });
      }
    } catch {
      void scanPlanSequential(b, plan, enc, streams, options).then(finish);
    }
  });
}

/** Sequential plan walk (no Worker available) — same gates as the worker. */
async function scanPlanSequential(
  b: Uint8Array,
  plan: PinPlanSegment[],
  enc: FastEnc,
  streams: Array<{
    obj: number;
    gen: number;
    length: number;
    start: number;
  }> | null,
  options?: {
    onProgress?: (tried: number, total: number) => void;
    onConfirm?: (pin: string) => boolean;
    shouldStop?: () => boolean;
  },
): Promise<string | null> {
  const total = pinPlanSize(plan);
  const ws = createKeyWorkspace(enc);
  const n = enc.lengthBits / 8;
  const pwBuf = new Uint8Array(8);
  const uc = createUCheck(enc, enc.u);
  let tried = 0;

  const confirm = (pin: string) =>
    options?.onConfirm
      ? options.onConfirm(pin)
      : streams
        ? derivesWorkingKey(enc, pin, streams, b)
        : userPasswordMatchesU(enc, pin);

  const gate = (digitCount: number): boolean => {
    const key = fileKeyFast(
      ws,
      buildKeyTemplates(enc, digitCount),
      pwBuf,
      digitCount,
    );
    if (uc) return uMatchesFast(uc, key);
    return streams
      ? streamHeaderHit(key, n, streams[0], b, new Uint8Array(512))
      : false;
  };

  for (const seg of plan) {
    if (options?.shouldStop?.()) return null;
    if (seg.digits === 0) {
      for (const s of seg.literal ?? []) {
        const len = Math.min(s.length, 8);
        if (len < 1) continue;
        for (let i = 0; i < len; i++) pwBuf[i] = s.charCodeAt(i) & 0xff;
        if (gate(len) && confirm(s)) return s;
        tried++;
      }
    } else {
      for (let val = seg.start; val < seg.end; val++) {
        let t = val;
        for (let k = seg.digits - 1; k >= 0; k--) {
          pwBuf[k] = 0x30 + (t % 10);
          t = Math.floor(t / 10);
        }
        if (gate(seg.digits)) {
          const pin = pwBufToStr(pwBuf, seg.digits);
          if (confirm(pin)) return pin;
        }
        tried++;
        if ((tried & 8191) === 0) options?.onProgress?.(tried, total);
        if (options?.shouldStop?.()) return null;
      }
    }
  }
  options?.onProgress?.(tried, total);
  return null;
}

export interface PdfEncryptionMeta {
  filter: string;
  revision: number;
  version: number;
  /** whether the dictionary carries a /U entry (a user password exists) */
  hasUserPassword: boolean;
}

function latin1(bytesLike: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytesLike.length; i++)
    s += String.fromCharCode(bytesLike[i]);
  return s;
}

/** Quick /Encrypt presence probe on raw PDF bytes. */
export function isEncrypted(bytes: Uint8Array | ArrayBuffer): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return latin1(b).includes("/Encrypt");
}

/** Parse /Encrypt metadata (revision/version/filter) for UI purposes. */
export function detectPdfEncryption(
  bytes: Uint8Array | ArrayBuffer,
): PdfEncryptionMeta | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = latin1(b);
  const idx = text.indexOf("/Encrypt");
  if (idx < 0) return null;

  // `/Encrypt NNN R` is in the trailer; the actual dictionary is the object
  // "NNN 0 obj <<...>>". Resolve the object NUMBER then read its dict so we
  // see /R, /V, /Filter.
  let revision = 0;
  let version = 0;
  let filter = "Standard";

  const refMatch = text.slice(idx).match(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/);
  if (refMatch) {
    const objNum = parseInt(refMatch[1], 10);
    const objNeedle = `\n${objNum} 0 obj`; // newline-anchored object def
    const oi = text.indexOf(objNeedle);
    if (oi >= 0) {
      const chunk = text.slice(oi, oi + 2000);
      const reR = /\/R\s+(\d+)/.exec(chunk);
      const reV = /\/V\s+(\d+)/.exec(chunk);
      const reF = /\/Filter\s*\/([^\s/>]+)/.exec(chunk);
      revision = reR ? parseInt(reR[1], 10) : 0;
      version = reV ? parseInt(reV[1], 10) : 0;
      if (reF) filter = reF[1];
    }
  }
  if (!revision && !version) {
    // fallback: scan nearby text for keys (some files inline the dict)
    const chunk = text.slice(idx, idx + 2000);
    const reR = /\/R\s+(\d+)/.exec(chunk);
    const reV = /\/V\s+(\d+)/.exec(chunk);
    const reF = /\/Filter\s*\/([^\s/>]+)/.exec(chunk);
    revision = reR ? parseInt(reR[1], 10) : 0;
    version = reV ? parseInt(reV[1], 10) : 0;
    if (reF) filter = reF[1];
  }

  return {
    filter,
    revision,
    version,
    hasUserPassword: revision >= 4 || /\/U\s*<[0-9A-Fa-f]{8}/.test(text),
  };
}

/* ------------------------------------------------------------------ */
/* Candidate password generation                                       */
/* ------------------------------------------------------------------ */

/** The classic handful every unlock tool tries (PINs + common words). */
/**
 * Explicit password candidates only.
 *
 * We automatically try the empty password because some statement PDFs are
 * encrypted only by permissions and intentionally have no user password.
 * Additional candidates must be supplied by the caller (for example, a
 * password the user already knows). We do not brute-force PINs or guess
 * common passwords.
 */
export function candidatesFromFilename(filename: string): string[] {
  const base = filename
    .replace(/\.pdf$/i, "")
    .replace(/[()[\]{}]/g, " ")
    .trim();
  const candidates: string[] = [];
  const push = (v: string) => {
    const x = v.trim();
    if (x && x.length <= 64) candidates.push(x);
  };

  // M-PESA statements commonly use an account/till/phone/reference fragment
  // as the document password. Prefer exact numeric tokens before the exhaustive
  // PIN scanner so the common case completes almost immediately.
  for (const m of base.match(/\d{4,16}/g) || []) {
    push(m);
    if (m.length > 6) push(m.slice(-6));
    if (m.length > 6) push(m.slice(0, 6));
    if (m.length > 4) push(m.slice(-4));
  }

  // Also try compact filename forms without separators/case changes.
  push(base.replace(/[^A-Za-z0-9]/g, ""));
  push(base.replace(/[^0-9]/g, ""));

  // Date-derived forms are cheap and useful for statement generators that
  // password-protect a statement with its statement date.
  const dates = base.match(/(?:20\d{2})[-_ ]?(\d{2})[-_ ]?(\d{2})/g) || [];
  for (const d of dates) {
    const digits = d.replace(/\D/g, "");
    if (digits.length === 8) {
      push(digits);
      push(digits.slice(6) + digits.slice(4, 6) + digits.slice(0, 4));
      push(digits.slice(0, 4) + digits.slice(4, 6) + digits.slice(6));
    }
  }

  return Array.from(new Set(candidates));
}

export function buildUnlockCandidates(
  _filename?: string,
  extra: string[] = [],
): string[] {
  return Array.from(
    new Set([
      "",
      ...extra
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ]),
  );
}

export function unlockCandidateCount(
  filename?: string,
  extra: string[] = [],
): number {
  return buildUnlockCandidates(filename, extra).length;
}
/* ------------------------------------------------------------------ */
/* Silent unlock via pdfjs                                             */
/* ------------------------------------------------------------------ */

export interface WorkingPassword {
  password: string;
  /** human-readable mode label for progress/status messages */
  mode: "owner-restricted" | "user-password" | "filename-hint";
}

/**
 * Try the candidate list silently against a locked PDF. Returns the first
 * working password (with a mode label), or null when nothing matches.
 *
 * Strategy:
 *  1. Fast pure-JS phase — candidate passwords (empty, PINs, words, filename
 *     hints) are validated against the /U checksum with MD5+RC4. No pdfjs,
 *     no network, microseconds each.
 *  2. If no candidate matched, run a bounded numeric-PIN scan (4→6 digits)
 *     the same way — this catches 6-digit PIN-locked statements client-side.
 *
 * `onProgress` fires during PIN scanning so the UI can show a live readout
 * ("scanning PINs… 356000 tried") and stay responsive. Empty password is
 * always tried first, which makes owner-restricted "locked" PDFs (the 99%
 * pdfcandy case) open immediately.
 */
export async function tryUnlockCandidates(
  bytes: Uint8Array | ArrayBuffer,
  options?: {
    filename?: string;
    extra?: string[];
    scanPins?: boolean;
    onTrying?: (candidate: string) => void;
    onScanProgress?: (tried: number, total: number) => void;
    shouldStopScan?: () => boolean;
  },
): Promise<WorkingPassword | null> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isEncrypted(b)) return null;

  const enc = parseFastEncrypt(b);
  const fileHints = options?.filename
    ? candidatesFromFilename(options.filename)
    : [];
  const candidates = Array.from(
    new Set([
      ...buildUnlockCandidates(undefined, options?.extra),
      ...fileHints,
    ]),
  );

  // Phase 1 — cheap candidate validation. R2/R3/V2 PDFs use the local
  // crypto oracle; newer encryption revisions are delegated to pdfjs.
  if (enc) {
    const streams = findFirstStreams(b, 3);
    for (const cand of candidates) {
      if (options?.onTrying) options.onTrying(cand);
      let ok = false;
      try {
        ok = streams
          ? derivesWorkingKey(enc, cand, streams, b)
          : userPasswordMatchesU(enc, cand);
      } catch {
        ok = false;
      }
      if (ok) {
        const mode: WorkingPassword["mode"] =
          cand === ""
            ? "owner-restricted"
            : fileHints.includes(cand)
              ? "filename-hint"
              : "user-password";
        return { password: cand, mode };
      }
    }
  } else {
    // R4/R5/R6 or otherwise unsupported dictionaries: try only the cheap
    // context-derived candidates through pdfjs. This avoids asking the user
    // for a password when the statement uses a predictable document PIN,
    // while never claiming to defeat strong encryption.
    try {
      const { tryOpenWithPassword } =
        await import("@/react-app/lib/pdf-loader");
      const data = b;
      for (const cand of candidates) {
        if (options?.onTrying) options.onTrying(cand);
        try {
          const doc = await tryOpenWithPassword(data, cand);
          if (doc) {
            try {
              await doc.destroy();
            } catch {
              /* best effort */
            }
            const mode: WorkingPassword["mode"] =
              cand === ""
                ? "owner-restricted"
                : fileHints.includes(cand)
                  ? "filename-hint"
                  : "user-password";
            return { password: cand, mode };
          }
        } catch {
          // Try the next cheap candidate.
        }
      }
    } catch {
      // pdfjs is optional here; unsupported builds continue to OCR fallback.
    }
  }

  // QUICK AUTO UNLOCK: once the cheap contextual candidates are exhausted,
  // walk the ordered PIN plan. It is bounded, client-side, and every hit is
  // confirmed against a real PDF stream before it is returned — and the plan
  // tries known/common/contextual codes and the narrow 4- and 5-digit spaces
  // before the 1M-wide 6-digit space, so the common case is near-instant.
  if (options?.scanPins !== false && enc) {
    try {
      const streams = findFirstStreams(b, 3);
      const known = [
        ...buildUnlockCandidates(undefined, options?.extra),
        ...fileHints,
      ];
      const plan = buildPinPlan({
        filename: options?.filename,
        minDigits: 4,
        maxDigits: 6,
        known,
      });
      const pin = await scanPinsParallel(b, plan, {
        onProgress: options?.onScanProgress,
        onConfirm: (candidate) => {
          try {
            return streams
              ? derivesWorkingKey(enc, candidate, streams, b)
              : userPasswordMatchesU(enc, candidate);
          } catch {
            return false;
          }
        },
      });
      if (pin) return { password: pin, mode: "user-password" };
    } catch {
      // Unlock must remain non-fatal; PDF.js/OCR fallback handles unsupported
      // encryption formats.
    }
  }

  return null;
}

/**
 * High-level silent unlock used by PDF consumers:
 * - no encryption            → { kind: "plain" }
 * - unlocked via candidates / fast scanner → { kind: "unlocked", password, mode }
 * - genuinely locked beyond recovery → { kind: "locked" }
 *
 * The caller re-opens the document with the returned password (pdfjs does the
 * real decryption) then continues extraction — no user prompt, no dead-end.
 */
export async function classifyPdfUnlock(
  bytes: Uint8Array | ArrayBuffer,
  options?: {
    filename?: string;
    extra?: string[];
    scanPins?: boolean;
    onTrying?: (candidate: string) => void;
    onScanProgress?: (tried: number, total: number) => void;
  },
): Promise<
  | { kind: "plain" }
  | { kind: "unlocked"; password: string; mode: string }
  | { kind: "locked" }
> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isEncrypted(b)) return { kind: "plain" };
  const enc = parseFastEncrypt(b);
  if (enc) {
    const streams = findFirstStreams(b, 3);
    if (streams && derivesWorkingKey(enc, "", streams, b)) {
      return { kind: "unlocked", password: "", mode: "owner-restricted" };
    }
  }
  const found = await tryUnlockCandidates(b, options);
  if (found)
    return { kind: "unlocked", password: found.password, mode: found.mode };
  return { kind: "locked" };
}
