#!/usr/bin/env python3
"""Publish a real mini-site as the station owner, exactly as the app does.

Claims the slug through the RPC, then uploads the document through the Storage
API using the owner's own access token — identical to `publishMiniSite()`.

Usage: python3 tools/pub-probe.py <slug> <email> <password>
"""
import json
import sys
import urllib.error
import urllib.request

SUPA = "https://ojjscjwatikixlpshmub.supabase.co"
ANON = open("/tmp/.anon_pub").read().strip()
SLUG, EMAIL, PASSWORD = sys.argv[1], sys.argv[2], sys.argv[3]


def call(url, body=None, headers=None, method="POST"):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None,
        headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


s, b = call(f"{SUPA}/auth/v1/token?grant_type=password",
            {"email": EMAIL, "password": PASSWORD},
            {"apikey": ANON, "Authorization": f"Bearer {ANON}",
             "Content-Type": "application/json"})
assert s == 200, f"login failed {s} {b[:200]}"
tok = json.loads(b)["access_token"]
H = {"apikey": ANON, "Authorization": f"Bearer {tok}",
     "Content-Type": "application/json"}

s, b = call(f"{SUPA}/rest/v1/rpc/minisite_claim_slug", {"p_slug": SLUG}, H)
print("claim:", s, b.strip()[:40])
assert b.strip() == "true", "slug claim refused"

doc = {
    "slug": SLUG,
    "siteName": "THE PUBLICAN ENERGY",
    "headline": "Fuel you can count on",
    "tagline": "Serving Turkana since 2019",
    "about": "A family-run forecourt with clean fuel, fair prices and a shop "
             "that stays open late.",
    "currencySymbol": "KSh",
    "country": "KE",
    "address": "Lodwar - Kitale Road, Lodwar, Turkana",
    "phone": "+254754458501",
    "whatsapp": "+254754458501",
    "email": "support@fuelpro.com",
    "mapUrl": "https://www.google.com/maps/search/?api=1&query=Lodwar",
    "theme": {"primary": "#c5a059"},
    "sections": ["prices", "about", "services", "hours", "contact",
                 "location", "team", "faqs"],
    "services": [
        {"id": "svc1", "title": "Super Petrol",
         "description": "EPRA-compliant unleaded", "icon": "fuel"},
        {"id": "svc2", "title": "Diesel",
         "description": "Low-sulphur automotive gas oil", "icon": "fuel"},
        {"id": "svc3", "title": "Car wash",
         "description": "Full exterior wash", "icon": "sparkles"},
    ],
    # day is 0=Sunday .. 6=Saturday
    "hours": [
        {"day": 1, "open": "05:00", "close": "21:00", "closed": False},
        {"day": 2, "open": "05:00", "close": "21:00", "closed": False},
        {"day": 3, "open": "05:00", "close": "21:00", "closed": False},
        {"day": 4, "open": "05:00", "close": "21:00", "closed": False},
        {"day": 5, "open": "05:00", "close": "21:00", "closed": False},
        {"day": 6, "open": "06:00", "close": "20:00", "closed": False},
        {"day": 0, "open": "07:00", "close": "18:00", "closed": False},
    ],
    "socials": {},
    "showPricesInHero": True,
    "allowIndexing": True,
    "footerNote": "Prices updated daily.",
    "prices": [
        {"label": "Super Petrol", "code": "PMS", "price": 220.08, "unit": "L"},
        {"label": "Diesel", "code": "AGO", "price": 224.95, "unit": "L"},
    ],
    "team": [{"name": "Daniel Ekitela", "role": "Station Manager"}],
    "testimonials": [{"author": "Akolong M.", "quote": "Always fast service."}],
    "faqs": [
        {"question": "Do you accept M-PESA?",
         "answer": "Yes - M-PESA, card and cash are all accepted at the till."},
        {"question": "Do you sell kerosene?",
         "answer": "Yes, kerosene is available by the litre."},
    ],
    "gallery": [], "blog": [], "careers": [],
}

H["x-upsert"] = "true"
s, b = call(f"{SUPA}/storage/v1/object/fuelpro-files/mini-site/{SLUG}/site.json",
            doc, H)
print("upload:", s, b.strip()[:180])
sys.exit(0 if s in (200, 201) else 1)
