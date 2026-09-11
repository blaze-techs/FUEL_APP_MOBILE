/**
 * Compression utility — transparent gzip compression/decompression for all
 * backend-bound user data and files, to minimize Supabase storage usage.
 *
 * Two layers:
 *
 * 1. JSON business data (app_kv table): values are gzip-compressed to a
 *    base64 string and stored as `{ __compressed: true, c: "<base64>" }`.
 *    On read, the marker is detected and the payload is decompressed back to
 *    the original JSON. Existing uncompressed rows continue to read
 *    correctly (backward compatible). Compression happens on every `set()`
 *    (write); decompression on every `get()` (read). While the data sits in
 *    the database unused, it stays compressed — saving storage space.
 *
 * 2. File uploads (Storage bucket): only text-based / compressible MIME types
 *    are gzipped (text/*, JSON, XML, CSV, HTML, JS, etc.). Already-compressed
 *    binary formats (JPEG, PNG, WebP, PDF, ZIP, video, audio) are stored
 *    as-is — gzipping them wastes CPU and can increase size. Compressed files
 *    carry a `.gz` segment in their path so the download path can detect and
 *    transparently decompress them on request.
 *
 * Uses `pako` (pure-JS gzip, already a dependency) + base64 for JSON transport
 * through the JSONB column. Browser-native `DecompressionStream` is NOT used
 * because it lacks wide enough streaming-base64 parity; pako is synchronous
 * and fast for the payload sizes involved.
 */

import pako from "pako";

// ─── JSON (app_kv) compression ──────────────────────────────────────────────

/** Marker stored in the JSONB column so a compressed payload is detectable. */
export const COMPRESSED_MARKER = "__compressed";

export interface CompressedPayload {
  [COMPRESSED_MARKER]: true;
  /** gzip(base64) of the original JSON, UTF-8 encoded. */
  c: string;
  /** Original uncompressed byte length (for diagnostics / ratio logging). */
  o?: number;
}

/** Minimum payload size (bytes) below which compression is skipped — overhead
 *  isn't worth it for tiny values. */
const MIN_COMPRESS_BYTES = 256;

/** Ratio below which we keep the compressed form (avoid expanding tiny data). */
const MIN_RATIO = 0.9;

/** Gzip compression level (1=fastest .. 9=smallest). 9 maximizes storage
 *  savings which is the priority on the Supabase free plan (egress + storage
 *  quotas). The CPU cost is acceptable for the payload sizes here (<1 MB). */
const GZIP_LEVEL = 9;

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Convert byte-by-byte; works in browser + Node. pako returns Uint8Array.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Legacy envelope written by an earlier build: `{__c: 1, d, n, z}`. */
interface LegacyEnvelope {
  __c: number;
  d: string;
  n?: number;
  z?: number;
}

function isLegacyEnvelope(raw: unknown): raw is LegacyEnvelope {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).__c === 1 &&
    typeof (raw as Record<string, unknown>).d === "string"
  );
}

function unwrapLegacyEnvelope<T>(env: LegacyEnvelope): T | null {
  try {
    const bytes = base64ToBytes(env.d);
    return JSON.parse(bytesToUtf8(pako.ungzip(bytes))) as T;
  } catch {
    return null;
  }
}

/**
 * Fully unwrap a value that may be wrapped in one or more compression
 * envelopes (current `{__compressed,c,o}` and/or legacy `{__c:1,d,n,z}` —
 * rows written while both formats were live can be nested, e.g. a legacy
 * envelope around a current envelope). Returns the plain value, or null when
 * an envelope is present but undecodable.
 */
export function decompressAny<T = unknown>(raw: unknown): T | null {
  let cur: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (isCompressedPayload(cur)) {
      cur = decompressJson(cur);
      continue;
    }
    if (isLegacyEnvelope(cur)) {
      cur = unwrapLegacyEnvelope(cur);
      continue;
    }
    return cur as T;
  }
  return null;
}

/**
 * Compress a JSON-serializable value into a `{__compressed, c}` payload
 * suitable for storing in the `app_kv.data` JSONB column. Returns the original
 * value unchanged when it is too small to benefit or when compression would
 * expand it. If the value is already a compression envelope (either format),
 * it is first unwrapped so rows never accumulate nested layers.
 */
export function compressJson<T>(value: T): unknown {
  try {
    if (isCompressedPayload(value) || isLegacyEnvelope(value)) {
      const plain = decompressAny<T>(value);
      if (plain == null) return value; // undecodable — store as-is
      value = plain;
    }
    const json = JSON.stringify(value);
    const bytes = utf8ToBytes(json);
    if (bytes.length < MIN_COMPRESS_BYTES) return value;

    const compressed = pako.gzip(bytes, { level: GZIP_LEVEL });
    const ratio = compressed.length / bytes.length;
    if (ratio > MIN_RATIO) return value; // no meaningful gain

    const payload: CompressedPayload = {
      [COMPRESSED_MARKER]: true,
      c: bytesToBase64(compressed),
      o: bytes.length,
    };
    return payload;
  } catch {
    // Compression failed — never break the write; store uncompressed.
    return value;
  }
}

/**
 * Detect a compressed payload and decompress it back to the original value.
 * Non-compressed values are returned unchanged (backward compatible with all
 * existing rows). Also unwraps the legacy double-encoded-string shape handled
 * by coerceJson in cloud-storage-service.
 */
export function decompressJson<T = unknown>(raw: unknown): T | null {
  if (raw == null) return null;

  // Compressed payload marker.
  if (
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>)[COMPRESSED_MARKER] === true
  ) {
    const cp = raw as CompressedPayload;
    try {
      const bytes = base64ToBytes(cp.c);
      const inflated = pako.ungzip(bytes);
      const json = bytesToUtf8(inflated);
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }

  return raw as T;
}

/** Whether a raw value read from app_kv is a compressed payload. */
export function isCompressedPayload(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>)[COMPRESSED_MARKER] === true
  );
}

// ─── File (Blob) compression ────────────────────────────────────────────────

/**
 * MIME types that benefit from gzip. Already-compressed formats (images,
 * video, audio, PDF, archives) are excluded — gzipping them is wasteful.
 */
const COMPRESSIBLE_EXTENSIONS = new Set([
  "txt",
  "json",
  "xml",
  "csv",
  "html",
  "htm",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "svg",
  "md",
  "log",
  "yaml",
  "yml",
  "sql",
  "geojson",
]);

/**
 * Whether a file should be gzipped on upload. True only for text-based /
 * structural formats where gzip yields a real size reduction.
 */
export function isCompressibleMimeType(
  mimeType: string,
  fileName?: string,
): boolean {
  if (!mimeType) {
    // Fall back to extension when MIME is unknown.
    if (fileName) {
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      return COMPRESSIBLE_EXTENSIONS.has(ext);
    }
    return false;
  }
  if (mimeType.startsWith("text/")) return true;
  if (
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/xhtml+xml" ||
    mimeType === "image/svg+xml"
  ) {
    return true;
  }
  // csv is sometimes application/vnd.ms-excel but the extension is the signal.
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (ext === "csv" || ext === "json" || ext === "xml" || ext === "svg") {
      return true;
    }
  }
  return false;
}

/**
 * Gzip a Blob/File and return a new Blob with the compressed bytes. Use only
 * when `isCompressibleMimeType` is true. The returned Blob has `application/gzip`
 * as its type so Storage stores the correct content type.
 */
export async function compressBlob(file: Blob): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const compressed = pako.gzip(bytes, { level: GZIP_LEVEL });
  return new Blob([compressed], { type: "application/gzip" });
}

/**
 * Decompress a gzip Blob back to its original bytes. Returns the original
 * Blob unchanged if decompression fails (defensive — never blocks a download).
 */
export async function decompressBlob(blob: Blob): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  try {
    const inflated = pako.ungzip(bytes);
    return new Blob([inflated]);
  } catch {
    return blob;
  }
}

/** Append `.gz` before the final extension, e.g. `report.json` → `report.json.gz`. */
export function compressedFilePath(path: string): string {
  if (path.endsWith(".gz")) return path;
  return `${path}.gz`;
}

/** Whether a stored file path denotes a gzip-compressed upload. */
export function isCompressedPath(path: string): boolean {
  return path.endsWith(".gz");
}
