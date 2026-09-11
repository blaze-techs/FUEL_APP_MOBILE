#!/usr/bin/env python3
"""
One-shot backfill: compress every plain JSONB row in the Supabase `app_kv`
table to the {__compressed:true, c:<base64>} gzip format (matching the app's
compression.ts so the client decompresses transparently).

Uses ONLY the Supabase Management API `database/query` endpoint (reachable
from this environment; the REST API hostname is not). Reads rows via SELECT,
gzip-compresses in Python, writes back via UPDATE with dollar-quoted JSON
literals.

Run: python3 scripts/backfill_compress_appkv.py
"""
import json
import gzip
import base64
import os
import sys
import urllib.request
import urllib.error

PAT = None
for line in open("/workspace/API KEYS.txt", "r", errors="ignore"):
    m = line.strip()
    if m.startswith("sbp_") and len(m) > 20:
        PAT = m
        break
if not PAT:
    print("Could not find Supabase PAT (sbp_...) in /workspace/API KEYS.txt")
    sys.exit(1)

PROJECT = "ojjscjwatikixlpshmub"
MGMT = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"

MARKER = "__compressed"
MIN_BYTES = 256
MIN_RATIO = 0.9
GZIP_LEVEL = 9


def run_sql(sql: str):
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        MGMT,
        data=body,
        headers={
            "Authorization": f"Bearer {PAT}",
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code}: {body}") from None
    if not raw.strip():
        return []
    data = json.loads(raw)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "message" in data:
        raise RuntimeError(f"SQL error: {data['message']}")
    return data


def compress_value(value):
    j = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    b = j.encode("utf-8")
    if len(b) < MIN_BYTES:
        return None, len(b), len(b)
    c = gzip.compress(b, compresslevel=GZIP_LEVEL)
    if len(c) / len(b) > MIN_RATIO:
        return None, len(b), len(b)
    b64 = base64.b64encode(c).decode("ascii")
    payload = {MARKER: True, "c": b64, "o": len(b)}
    pj = json.dumps(payload, separators=(",", ":"))
    return pj, len(b), len(pj)


def dollar_quote(s: str) -> str:
    # Pick a tag that does not appear in the string.
    tag = "q"
    i = 0
    while f"${tag}$" in s:
        i += 1
        tag = f"q{i}"
    return f"${tag}${s}${tag}$"


def main():
    # Count current state.
    rows = run_sql(
        "SELECT count(*) AS n, "
        "count(*) FILTER (WHERE data ? '__compressed') AS comp, "
        "sum(pg_column_size(data)) AS bytes FROM app_kv;"
    )
    print("Before:", rows[0] if rows else "no data")

    # Fetch all plain rows (id + data).
    total = 0
    compressed = 0
    skipped_small = 0
    skipped_nogain = 0
    errors = 0
    bytes_before = 0
    bytes_after = 0

    offset = 0
    batch = 200
    while True:
        rows = run_sql(
            f"SELECT id, data::text AS d FROM app_kv "
            f"WHERE NOT (data ? '__compressed') "
            f"ORDER BY id OFFSET {offset} LIMIT {batch};"
        )
        if not rows:
            break
        for row in rows:
            total += 1
            rid = row["id"]
            try:
                value = json.loads(row["d"])
            except Exception as e:
                errors += 1
                print(f"  parse error {rid}: {e}")
                continue
            pj, ob, oa = compress_value(value)
            bytes_before += ob
            if pj is None:
                if ob < MIN_BYTES:
                    skipped_small += 1
                else:
                    skipped_nogain += 1
                continue
            bytes_after += oa
            # UPDATE with dollar-quoted JSON literal cast to jsonb.
            lit = dollar_quote(pj)
            sql = (
                f"UPDATE app_kv SET data = {lit}::jsonb WHERE id = "
                f"{dollar_quote(rid)};"
            )
            try:
                run_sql(sql)
                compressed += 1
                if compressed % 25 == 0:
                    saved = bytes_before - bytes_after
                    print(f"  compressed {compressed} rows (~{saved:,} bytes saved)")
            except Exception as e:
                errors += 1
                print(f"  ERROR {rid}: {e}")
        offset += len(rows)
        if len(rows) < batch:
            break

    print("\n=== Backfill complete ===")
    print(f"Total rows scanned:  {total}")
    print(f"Rows compressed:     {compressed}")
    print(f"Skipped (too small): {skipped_small}")
    print(f"Skipped (no gain):   {skipped_nogain}")
    print(f"Errors:              {errors}")
    print(f"Bytes before:        {bytes_before:,}")
    print(f"Bytes after:         {bytes_after:,}")
    if bytes_before > 0:
        saved = bytes_before - bytes_after
        pct = saved / bytes_before * 100
        print(f"Saved:               {saved:,} bytes ({pct:.1f}% reduction)")

    # Final state.
    rows = run_sql(
        "SELECT count(*) AS n, "
        "count(*) FILTER (WHERE data ? '__compressed') AS comp, "
        "sum(pg_column_size(data)) AS bytes FROM app_kv;"
    )
    print("After:", rows[0] if rows else "no data")


if __name__ == "__main__":
    main()
