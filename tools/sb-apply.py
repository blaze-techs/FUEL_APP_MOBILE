#!/usr/bin/env python3
"""Apply a SQL file to the live Supabase project via the Management API.

Usage: python3 tools/sb-apply.py <sql-file> [<project-ref>]

The Management API is the only reachable route from a sandbox (the direct
db.<ref>.supabase.co host does not resolve). It needs a Personal Access Token
plus a browser-ish User-Agent, or Cloudflare answers 1010.

The token is read from $SUPABASE_PAT, falling back to /tmp/.sbpt so it is never
written into the repository.
"""
import json
import os
import sys
import urllib.error
import urllib.request

sql_path = sys.argv[1]
REF = sys.argv[2] if len(sys.argv) > 2 else "ojjscjwatikixlpshmub"

pat = os.environ.get("SUPABASE_PAT") or open("/tmp/.sbpt").read().strip()
sql = open(sql_path).read()

req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{REF}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={
        "Authorization": f"Bearer {pat}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print(json.dumps({"status": r.status, "body": r.read().decode()[:1500]}, indent=2))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": e.read().decode()[:2000]}, indent=2))
    sys.exit(1)
