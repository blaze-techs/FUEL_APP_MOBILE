#!/usr/bin/env python3
"""Heal implausible fuel prices inside stored app_kv rows.

The `trg_guard_fuel_price_mutation` trigger rejects price writes from a
non-authenticated session, which is correct — it is what stops an anonymous
client from rewriting prices. Admin maintenance is the one legitimate case it
cannot express, because the Management API has no auth.uid(). So the writes run
in ONE transaction with that single trigger temporarily disabled and immediately
re-enabled, and the script re-reads the trigger afterwards to prove it is back on.

Removal only: a value implausible for the station's market is dropped
(price -> 0 = "not configured"). It is never replaced with a reference price —
substituting reference data for a station's operational price is the exact
anti-pattern this codebase fought.
"""
import base64
import gzip
import json
import sys
import urllib.error
import urllib.request

PROJECT = "ojjscjwatikixlpshmub"
API = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
TRIGGER = "trg_guard_fuel_price_mutation"

# country -> canonical fuel -> (min, max) plausible per-litre price
BANDS = {
    "US": {
        "petrol": (0.5, 4.0),
        "diesel": (0.5, 4.5),
        "kerosene": (0.4, 4.5),
        "vpower": (0.5, 5.0),
        "lpg": (0.2, 3.0),
        "cng": (0.1, 3.0),
    },
    "KE": {
        "petrol": (120, 260),
        "diesel": (120, 270),
        "kerosene": (100, 250),
        "vpower": (130, 280),
        "lpg": (50, 250),
    },
    "GB": {"petrol": (0.8, 3.0), "diesel": (0.8, 3.5)},
}


def pat() -> str:
    with open("/workspace/API KEYS.txt", "r", errors="ignore") as fh:
        for line in fh:
            if line.strip().startswith("sbp_"):
                return line.strip()
    raise SystemExit("no sbp_ token found")


def query(sql: str, token: str):
    req = urllib.request.Request(
        API,
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        print("SQL ERROR:", e.read().decode()[:400])
        raise


def decode(data):
    if isinstance(data, str):
        data = json.loads(data)
    if isinstance(data, dict) and "c" in data:
        return json.loads(gzip.decompress(base64.b64decode(data["c"])))
    return data if isinstance(data, (dict, list)) else None


def canonical_of(name: str) -> str:
    n = name.lower()
    if "diesel" in n or "ago" in n:
        return "diesel"
    if "kerosene" in n or n.strip() == "ik" or "dpk" in n:
        return "kerosene"
    if "v-power" in n or "vpower" in n:
        return "vpower"
    if "petrol" in n or "pms" in n or "gasoline" in n:
        return "petrol"
    if "lpg" in n or "gas" in n:
        return "lpg"
    return n


def implausible(price, band) -> bool:
    """A POSITIVE price outside its market's band.

    0/None means "not configured", which is the honest state we are healing
    towards — so it is not itself corruption, and leaving it alone keeps this
    script idempotent instead of rewriting rows on every run.
    """
    return (
        isinstance(price, (int, float))
        and not isinstance(price, bool)
        and price > 0
        and band is not None
        and not (band[0] <= price <= band[1])
    )


def settle(row_id: str, obj) -> str:
    payload = base64.b64encode(gzip.compress(json.dumps(obj).encode(), 9)).decode()
    # base64 has no `$`, so dollar-quoting needs no escaping.
    return (
        "update app_kv set data = jsonb_build_object('c', $fp$"
        + payload
        + "$fp$::text) where id = $id$"
        + row_id
        + "$id$;"
    )


def main() -> int:
    token = pat()
    stations = query(
        "select id, owner_id, country from stations where country is not null",
        token,
    )
    countries = {r["id"]: r["country"] for r in stations if r.get("country")}
    # A legacy owner-scoped row (fuel_types_config__<ownerId>) carries no station
    # id, so fall back to any station the owner has. One owner is one market in
    # practice, which is what the band check needs.
    owner_countries: dict = {}
    for r in stations:
        if r.get("country") and r.get("owner_id"):
            owner_countries.setdefault(r["owner_id"], r["country"])
    print(
        f"stations with a known country: {len(countries)} "
        f"| owners mapped: {len(owner_countries)}"
    )

    def country_for(row_id: str) -> str:
        for sid, cc in countries.items():
            if sid in row_id:
                return cc
        for oid, cc in owner_countries.items():
            if oid in row_id:
                return cc
        return ""

    statements, report = [], []

    # 1. fuel_types_config — the ORIGIN. A stored config price implausible for
    #    the market mirrors into state on every load and outlives display guards.
    for row in query(
        "select id, data from app_kv where id like 'fuel_types_config%'", token
    ):
        obj = decode(row["data"])
        cc = country_for(row["id"])
        if not isinstance(obj, list) or not cc:
            continue
        band = BANDS.get(cc.upper(), {})
        changed = False
        for ft in obj:
            if not isinstance(ft, dict):
                continue
            b = band.get(canonical_of(str(ft.get("name", ""))))
            if implausible(ft.get("price"), b):
                report.append(
                    f"  config {row['id'][:40]} [{cc}] {ft.get('name')} "
                    f"{ft.get('price')} -> 0"
                )
                ft["price"] = 0
                ft["source"] = "auto"  # cleared -> let the regulator refill it
                changed = True
        if changed:
            statements.append(settle(row["id"], obj))

    # 2. compact blobs — per-station price maps + legacy scalars.
    for row in query(
        "select id, data from app_kv where id like 'user_%_compact%'", token
    ):
        obj = decode(row["data"])
        if not isinstance(obj, dict):
            continue
        cc = country_for(row["id"]) or (obj.get("companyData") or {}).get(
            "country", ""
        )
        if not cc:
            continue
        band = BANDS.get(cc.upper(), {})
        changed = False
        fp = obj.get("fuelPricesByType")
        if isinstance(fp, dict):
            for k in list(fp):
                if implausible(fp[k], band.get(canonical_of(k))):
                    report.append(
                        f"  blob {row['id'][:40]} [{cc}] {k} {fp[k]} -> removed"
                    )
                    del fp[k]
                    changed = True
        for scalar, fuel in (
            ("pmsPrice", "petrol"),
            ("petrolPrice", "petrol"),
            ("agoPrice", "diesel"),
            ("dieselPrice", "diesel"),
        ):
            if implausible(obj.get(scalar), band.get(fuel)):
                report.append(
                    f"  blob {row['id'][:40]} [{cc}] {scalar} {obj[scalar]} -> 0"
                )
                obj[scalar] = 0
                changed = True
        if changed:
            statements.append(settle(row["id"], obj))

    print("\n".join(report) or "  (nothing implausible found)")
    if not statements:
        print("\nno writes needed")
        return 0

    sql = (
        f"alter table app_kv disable trigger {TRIGGER};\n"
        + "\n".join(statements)
        + f"\nalter table app_kv enable trigger {TRIGGER};"
    )
    query(sql, token)

    state = query(
        "select tgenabled from pg_trigger where tgname = '" + TRIGGER + "'", token
    )
    enabled = state[0]["tgenabled"] if state else "?"
    print(f"\napplied {len(statements)} update(s); tgenabled={enabled} (O=on)")
    if enabled != "O":
        print("WARNING: trigger is not enabled — re-enable it manually!")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
