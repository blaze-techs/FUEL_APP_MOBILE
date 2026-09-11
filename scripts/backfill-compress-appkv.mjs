/**
 * One-shot backfill: compress all existing UNCOMPRESSED rows in the Supabase
 * `app_kv` table so the entire table uses the `{__compressed, c}` gzip+base64
 * format. The app's cloudStorageService already compresses on every new
 * write, but rows written before that feature shipped (or by code paths that
 * bypassed compression) are still stored as plain JSONB — wasting storage and
 * (more importantly on the Supabase free plan) egress bandwidth on every read
 * + realtime message.
 *
 * This script reads each plain row, gzip-compresses the JSON (pako level 9,
 * base64 — exactly matching compression.ts so the client can decompress), and
 * PATCHes it back. Rows that are too small or don't benefit are left as-is.
 *
 * Run: node scripts/backfill-compress-appkv.mjs
 * Requires SUPABASE_SERVICE_ROLE_KEY env var (from /workspace/API KEYS.txt).
 */
import pako from "pako";

const SUPABASE_URL = "https://ojjscjwatikixlpshmub.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const COMPRESSED_MARKER = "__compressed";
const MIN_COMPRESS_BYTES = 256;
const MIN_RATIO = 0.9;
const GZIP_LEVEL = 9;

function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return Buffer.from(binary, "binary").toString("base64");
}

function compressValue(value) {
  const json = JSON.stringify(value);
  const bytes = utf8ToBytes(json);
  if (bytes.length < MIN_COMPRESS_BYTES) return null; // skip small
  const compressed = pako.gzip(bytes, { level: GZIP_LEVEL });
  const ratio = compressed.length / bytes.length;
  if (ratio > MIN_RATIO) return null; // no gain
  return { [COMPRESSED_MARKER]: true, c: bytesToBase64(compressed), o: bytes.length };
}

async function fetchPlainRows(offset = 0, limit = 1000) {
  const url = `${SUPABASE_URL}/rest/v1/app_kv?select=id,data&order=id&offset=${offset}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchRow(id, data) {
  const url = `${SUPABASE_URL}/rest/v1/app_kv?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`patch ${id} failed: ${res.status} ${await res.text()}`);
}

async function main() {
  let offset = 0;
  let total = 0;
  let compressed = 0;
  let skippedSmall = 0;
  let skippedNoGain = 0;
  let errors = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  while (true) {
    const rows = await fetchPlainRows(offset, 1000);
    if (!rows.length) break;
    for (const row of rows) {
      total++;
      const data = row.data;
      // Skip already-compressed rows.
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data[COMPRESSED_MARKER] === true
      ) {
        continue;
      }
      // Estimate original size (JSON string length as proxy).
      const origSize = JSON.stringify(data).length;
      bytesBefore += origSize;
      const compressedData = compressValue(data);
      if (compressedData === null) {
        if (origSize < MIN_COMPRESS_BYTES) skippedSmall++;
        else skippedNoGain++;
        continue;
      }
      const newSize = JSON.stringify(compressedData).length;
      bytesAfter += newSize;
      try {
        await patchRow(row.id, compressedData);
        compressed++;
        if (compressed % 25 === 0) {
          console.log(
            `  compressed ${compressed} rows... (saved ~${(bytesBefore - bytesAfter).toLocaleString()} bytes so far)`,
          );
        }
      } catch (e) {
        errors++;
        console.error(`  ERROR patching ${row.id}: ${e.message}`);
      }
    }
    offset += rows.length;
    if (rows.length < 1000) break;
  }

  console.log("\n=== Backfill complete ===");
  console.log(`Total rows scanned:    ${total}`);
  console.log(`Rows compressed:      ${compressed}`);
  console.log(`Skipped (too small):   ${skippedSmall}`);
  console.log(`Skipped (no gain):     ${skippedNoGain}`);
  console.log(`Errors:                ${errors}`);
  console.log(`Bytes before (approx):${bytesBefore.toLocaleString()}`);
  console.log(`Bytes after (approx): ${bytesAfter.toLocaleString()}`);
  if (bytesBefore > 0) {
    const saved = bytesBefore - bytesAfter;
    const pct = ((saved / bytesBefore) * 100).toFixed(1);
    console.log(`Saved:                 ${saved.toLocaleString()} bytes (${pct}% reduction)`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
