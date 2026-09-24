#!/usr/bin/env python3
"""Run a read-only SQL query against the live Supabase project.

Usage: python3 tools/sb-query.py "select 1"
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = os.environ.get("SB_REF", "ojjscjwatikixlpshmub")
pat = os.environ.get("SUPABASE_PAT") or open("/tmp/.sbpt").read().strip()
sql = sys.argv[1]

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
    with urllib.request.urlopen(req, timeout=120) as r:
        print(json.dumps(json.loads(r.read().decode()), indent=2)[:4000])
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": e.read().decode()[:1500]}, indent=2))
    sys.exit(1)
