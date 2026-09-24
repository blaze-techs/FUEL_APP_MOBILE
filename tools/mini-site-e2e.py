#!/usr/bin/env python3
"""End-to-end proof of the mini-site through the REAL Supabase Storage API.

This is the strongest available evidence for the cross-tenant fix: it goes
through GoTrue (real JWT issuance) and through Storage's own upload endpoint
(real RLS evaluation), not through SQL. A policy that exists but is granted to
the wrong role, or that the Storage service bypasses, would still fail here.

It provisions two throwaway, email-confirmed users, runs the attempt, then
tears everything down (objects, claims, users) so no real data is touched.

Usage: python3 tools/mini-site-e2e.py
"""
import json
import secrets
import sys
import urllib.error
import urllib.request

SUPA = "https://ojjscjwatikixlpshmub.supabase.co"
ANON = open("/tmp/.anon_pub").read().strip()
SVC = open("/tmp/.svc").read().strip()
SLUG = f"e2e-probe-{secrets.token_hex(4)}"
PASSWORD = secrets.token_urlsafe(18)
EMAILS = [f"mini-site-e2e-{secrets.token_hex(4)}@example.com" for _ in range(2)]


def call(url, body=None, headers=None, method="POST"):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None,
        headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def svc_headers():
    return {"apikey": SVC, "Authorization": f"Bearer {SVC}",
            "Content-Type": "application/json"}


def create_user(email):
    s, b = call(f"{SUPA}/auth/v1/admin/users",
                {"email": email, "password": PASSWORD, "email_confirm": True},
                svc_headers())
    if s not in (200, 201):
        raise SystemExit(f"could not create {email}: {s} {b[:200]}")
    return json.loads(b)["id"]


def delete_user(uid):
    call(f"{SUPA}/auth/v1/admin/users/{uid}", None, svc_headers(), method="DELETE")


def token(email):
    s, b = call(f"{SUPA}/auth/v1/token?grant_type=password",
                {"email": email, "password": PASSWORD},
                {"apikey": ANON, "Authorization": f"Bearer {ANON}",
                 "Content-Type": "application/json"})
    if s != 200:
        return None, f"auth {s}: {b[:200]}"
    return json.loads(b)["access_token"], None


def user_headers(tok):
    return {"apikey": ANON, "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json"}


def attempt(label, email, filename="site.json"):
    tok, err = token(email)
    if err:
        print(f"  {label}: TOKEN FAILED — {err}")
        return None
    s, b = call(f"{SUPA}/rest/v1/rpc/minisite_claim_slug", {"p_slug": SLUG},
                user_headers(tok))
    print(f"  {label}: claim -> {s} {b.strip()[:40]}")
    h = user_headers(tok)
    h["x-upsert"] = "true"
    s, b = call(f"{SUPA}/storage/v1/object/fuelpro-files/mini-site/{SLUG}/{filename}",
                {"slug": SLUG, "siteName": f"E2E probe ({label})", "headline": "probe"}, h)
    ok = s in (200, 201)
    print(f"  {label}: upload -> {s} {'ALLOWED' if ok else 'blocked'}"
          + ("" if ok else f" :: {b.strip()[:130]}"))
    return ok


uids = []
try:
    print(f"provisioning 2 throwaway users; slug = {SLUG}")
    uids = [create_user(e) for e in EMAILS]

    print("user A (claims and owns the slug):")
    first = attempt("A", EMAILS[0])
    print("user B (different tenant — must be refused):")
    second = attempt("B", EMAILS[1], filename="evil.json")

    print()
    if first is True and second is False:
        print("PASS — B could not write into A's mini-site (Storage API)")
        code = 0
    elif second is True:
        print("FAIL — CROSS-TENANT WRITE SUCCEEDED through the Storage API")
        code = 1
    else:
        print(f"INCONCLUSIVE — A_allowed={first} B_allowed={second}")
        code = 1
finally:
    # Teardown: objects, claims, then the users. Service role bypasses RLS.
    s, b = call(f"{SUPA}/storage/v1/object/list/fuelpro-files",
                {"prefix": f"mini-site/{SLUG}", "limit": 100}, svc_headers())
    for obj in json.loads(b) if s == 200 else []:
        call(f"{SUPA}/storage/v1/object/fuelpro-files/mini-site/{SLUG}/{obj['name']}",
             None, svc_headers(), method="DELETE")
    call(f"{SUPA}/rest/v1/minisite_slug_claims?slug=eq.{SLUG}",
         None, svc_headers(), method="DELETE")
    call(f"{SUPA}/rest/v1/minisite_views?slug=eq.{SLUG}",
         None, svc_headers(), method="DELETE")
    for u in uids:
        delete_user(u)
    print("teardown done (objects, claims, views, users removed)")

sys.exit(code)

