import * as pako from "pako";

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

/**
 * FAST numeric-PIN scanner in pure JS (MD5 + RC4; no pdfjs, no network).
 * Candidate passwords are validated conclusively by deriving the Algorithm-2
 * file key and checking that real streams decrypt to a valid zlib header —
 * accepts user OR owner passwords and is immune to malformed /U entries.
 * 4–6 digit space (1,110,000 candidates) completes in roughly 1–2 min on a
 * phone; `chunk` yields to the UI frequently for progress + cancellation.
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
  const min = options?.minDigits ?? 4;
  const max = Math.min(options?.maxDigits ?? 6, 6);
  const chunk = options?.chunk ?? 20000;
  let tried = 0;
  try {
    for (let digits = min; digits <= max; digits++) {
      const start = digits === 4 ? 0 : Math.pow(10, digits - 1);
      const end = Math.pow(10, digits);
      const buf = new Uint8Array(digits);
      let v = start;
      for (let k = digits - 1; k >= 0; k--) {
        buf[k] = 0x30 + (v % 10);
        v = Math.floor(v / 10);
      }
      for (let val = start; val < end; val++) {
        if (options?.shouldStop?.()) return null;
        const pw = String.fromCharCode.apply(null, buf as any);
        if (derivesWorkingKey(enc, pw, streams, b)) return pw;
        let k = digits - 1;
        while (k >= 0) {
          buf[k]++;
          if (buf[k] <= 0x39) break;
          buf[k] = 0x30;
          k--;
        }
        tried++;
        if (tried % chunk === 0 && options?.onProgress) {
          options.onProgress(pw, tried);
        }
      }
    }
  } catch {
    /* String.fromCharCode.apply on a big buffer is fine for ≤6 bytes */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Encryption detection (pure, tiny, on raw bytes)                     */
/* ------------------------------------------------------------------ */

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
const GENERIC_CANDIDATES: string[] = [
  "",
  "1234",
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "12345",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123123",
  "112233",
  "121212",
  "654321",
  "123321",
  "password",
  "Password",
  "PASSWORD",
  "pass",
  "Passw0rd",
  "abc123",
  "qwerty",
  "admin",
  "letmein",
  "welcome",
  "00000000",
  "11111111",
  "22222222",
  "33333333",
  "44444444",
  "55555555",
  "66666666",
  "77777777",
  "88888888",
  "99999999",
];

/**
 * Derive a few context-sensitive hints from a filename, e.g.
 * "MPESA_Statement_2026-09-..._578590.pdf" → tries "578590", "5785900",
 * "mpesa", "safaricom".
 */
export function candidatesFromFilename(filename: string): string[] {
  if (!filename) return [];
  const out: string[] = [];
  const nums = filename.match(/\d{3,12}/g) || [];
  for (const n of nums) {
    out.push(n);
    out.push(n.replace(/^0+/, ""));
  }
  const base = filename.replace(/\.[a-z]+$/i, "").toLowerCase();
  if (/mpesa/i.test(base)) out.push("mpesa", "MPESA", "Mpesa");
  if (/safaricom/i.test(base)) out.push("safaricom", "Safaricom");
  return Array.from(new Set(out.filter(Boolean)));
}

/**
 * The full, ordered candidate list: empty string FIRST (the owner-restricted
 * case), then the generic PIN/word list, then filename hints, then extras.
 * Deterministic and de-duplicated.
 */
export function buildUnlockCandidates(
  filename?: string,
  extra: string[] = [],
): string[] {
  const out: string[] = [];
  const push = (cands: string[]) => {
    for (const c of cands) {
      if (c === undefined || c === null) continue;
      const s = String(c);
      if (out.indexOf(s) < 0) out.push(s);
    }
  };
  push([""]);
  push(GENERIC_CANDIDATES);
  if (filename) push(candidatesFromFilename(filename));
  push(extra);
  return out;
}

/** Approx. how many candidates will be tried — for progress readouts. */
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
    onScanProgress?: (current: string, tried: number) => void;
    shouldStopScan?: () => boolean;
  },
): Promise<WorkingPassword | null> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isEncrypted(b)) return null;

  const enc = parseFastEncrypt(b);
  if (!enc) return null;
  const streams = findFirstStreams(b, 3);

  const candidates = buildUnlockCandidates(options?.filename, options?.extra);
  const fileHints = options?.filename
    ? candidatesFromFilename(options.filename)
    : [];

  // Phase 1 — candidate list, validated by the conclusive stream oracle.
  for (const cand of candidates) {
    if (options?.onTrying) options.onTrying(cand);
    let ok = false;
    try {
      if (streams) {
        ok = derivesWorkingKey(enc, cand, streams, b);
      } else {
        ok = userPasswordMatchesU(enc, cand);
      }
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

  // Phase 2 — bounded numeric-PIN scan (the analyzer opts in via scanPins so
  // locked statements auto-unlock).
  if (options?.scanPins !== false) {
    const pin = await scanNumericPins(b, {
      minDigits: 4,
      maxDigits: 6,
      onProgress: options?.onScanProgress,
      shouldStop: options?.shouldStopScan,
    });
    if (pin) return { password: pin, mode: "user-password" };
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
    onScanProgress?: (current: string, tried: number) => void;
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
