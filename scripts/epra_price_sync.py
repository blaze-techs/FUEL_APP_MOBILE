#!/usr/bin/env python3
"""Discover and extract Kenya EPRA monthly town-level pump price schedules.

Only official EPRA pages/PDFs are eligible for automatic publication. Search/social
results may help discover announcements but are not treated as authoritative input.
A failed/ambiguous extraction exits non-zero and leaves the last verified dataset intact.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.epra.go.ke/index.php/pump-prices"
OUT = Path("src/react-app/config/epra-current.json")
UA = "FuelPro-EPRA-PriceBot/1.0 (monthly public regulatory price verification)"
FUEL_TERMS = {
    "petrol": ("super petrol", "pms", "super gasoline"),
    "diesel": ("automotive diesel", "automotive gas oil", "ago", "diesel"),
    "kerosene": ("illuminating kerosene", "ik", "kerosene"),
}
TOWN_ALIASES = {"lodwar": "Lodwar", "nairobi": "Nairobi", "mombasa": "Mombasa"}

def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=35) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} from {url}")
        return response.read()

def norm(s: object) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().lower().replace("\xa0", " ")

def parse_price(value: object) -> float | None:
    s = str(value).replace(",", "").replace("KSh", "").replace("KES", "").strip()
    m = re.search(r"(?<!\d)(\d{2,3}\.\d{2})(?!\d)", s)
    if not m:
        return None
    n = float(m.group(1))
    return n if 100 <= n <= 400 else None

def extract_tables(html: str):
    # pandas is installed in the workflow. It tolerates EPRA's current table markup.
    import pandas as pd
    from io import StringIO
    try:
        return pd.read_html(StringIO(html))
    except ValueError:
        return []

def discover_pdf(html: str) -> str | None:
    # A linked signed press release is a fallback if the web page has no readable table.
    links = re.findall(r'<a\b[^>]*href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\'][^>]*>(.*?)</a>', html, re.I | re.S)
    candidates = []
    for href, label in links:
        text = norm(re.sub(r"<[^>]+>", " ", label))
        if any(x in text for x in ("pump price", "petroleum", "price review", "maximum retail")):
            candidates.append(urllib.parse.urljoin(BASE, href))
    return candidates[0] if candidates else None

def pdf_text(url: str) -> str:
    import pypdf
    data = get(url)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data); f.flush()
        reader = pypdf.PdfReader(f.name)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if len(text.strip()) < 300:
        # OCR scanned PDFs when the runner has tesseract/poppler installed.
        try:
            subprocess.run(["pdftoppm", "-png", "-r", "250", f.name, f.name + "-page"], check=True, capture_output=True)
            images = sorted(Path(f.name).parent.glob(Path(f.name).name + "-page-*.png"))
            chunks = []
            for img in images:
                chunks.append(subprocess.run(["tesseract", str(img), "stdout"], check=True, capture_output=True, text=True).stdout)
            text = "\n".join(chunks)
        except (FileNotFoundError, subprocess.CalledProcessError):
            pass
    return text

def extract_from_text(text: str) -> list[dict]:
    # Restrict extraction to rows with a town label and three plausible per-litre values.
    # The parser deliberately refuses to infer missing values or transport surcharges.
    rows = []
    town_names = set()
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        nums = re.findall(r"(?<!\d)(\d{2,3}\.\d{2})(?!\d)", line.replace(",", ""))
        if len(nums) < 3:
            continue
        values = [float(x) for x in nums[-3:]]
        if not all(100 <= x <= 400 for x in values):
            continue
        town = re.sub(r"\s+", " ", re.sub(r"^[\d.\s]+", "", line))
        town = re.sub(r"\s+(?:KSh|KES)?\s*\d{2,3}\.\d{2}.*$", "", town, flags=re.I).strip(" -|:")
        # OCR/table text varies, so accept only a sensible alphabetic town prefix.
        m = re.match(r"^([A-Za-z][A-Za-z .’'()-]{1,45}?)\s+(?:\d|KSh|KES)", line)
        if m:
            town = m.group(1).strip()
        if not town or not re.search(r"[A-Za-z]", town) or len(town) > 50:
            continue
        key = norm(town)
        if key in town_names:
            continue
        town_names.add(key)
        rows.append({"town": town.title(), "petrol": values[0], "diesel": values[1], "kerosene": values[2]})
    return rows

def table_rows(tables) -> list[dict]:
    rows = []
    for df in tables:
        if df.empty or len(df.columns) < 4:
            continue
        headers = [norm(c) for c in df.columns]
        # Multi-index headers are common in official tables.
        headers = [norm(" ".join(map(str, h))) if isinstance(h, tuple) else h for h in headers]
        joined = " ".join(headers)
        if not any(t in joined for t in ("town", "towns", "location", "centre", "center")):
            continue
        def col_for(terms):
            for i, h in enumerate(headers):
                if any(term in h for term in terms):
                    return i
            return None
        town_i = next((i for i,h in enumerate(headers) if any(t in h for t in ("town","location","centre","center"))), None)
        p_i = col_for(("super petrol", "pms", "petrol"))
        d_i = col_for(("automotive diesel", "diesel", "ago"))
        k_i = col_for(("kerosene", "ik"))
        if None in (town_i,p_i,d_i,k_i) or len({town_i,p_i,d_i,k_i}) < 4:
            continue
        for _, row in df.iterrows():
            town = re.sub(r"\s+", " ", str(row.iloc[town_i])).strip()
            vals = [parse_price(row.iloc[i]) for i in (p_i,d_i,k_i)]
            if town and town.lower() not in ("nan","town","towns","location") and all(v is not None for v in vals):
                rows.append({"town": town.title(), "petrol": vals[0], "diesel": vals[1], "kerosene": vals[2]})
    return rows

def main():
    html_bytes = get(BASE)
    html = html_bytes.decode("utf-8", errors="replace")
    source_url = BASE
    tables = extract_tables(html)
    rows = table_rows(tables)
    pdf_url = discover_pdf(html)
    if not rows and pdf_url:
        source_url = pdf_url
        rows = extract_from_text(pdf_text(pdf_url))
    if not rows:
        raise RuntimeError("EPRA page/PDF was found but no complete, unambiguous town price table could be extracted. Existing published data preserved.")
    by_town = {}
    for r in rows:
        key = norm(r["town"])
        if key in by_town and by_town[key] != r:
            raise RuntimeError(f"Conflicting duplicate values for town {r['town']}")
        by_town[key] = r
    # A monthly release must contain these anchors. Prevent accidental extraction
    # of an old news paragraph or unrelated table.
    required = {"lodwar", "nairobi", "mombasa"}
    missing = required - set(by_town)
    if missing:
        raise RuntimeError("Extracted table is incomplete; missing required anchor towns: " + ", ".join(sorted(missing)))
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "schemaVersion": 1,
        "status": "verified",
        "country": "KE",
        "currency": "KES",
        "unit": "litre",
        "sourceName": "Energy and Petroleum Regulatory Authority (EPRA), Kenya",
        "sourceUrl": source_url,
        "checkedAt": now.isoformat(),
        "publishedAt": None,
        "effectiveFrom": None,
        "effectiveTo": None,
        "documentSha256": hashlib.sha256(html_bytes).hexdigest(),
        "verification": {
            "officialDomain": urllib.parse.urlparse(source_url).hostname == "www.epra.go.ke",
            "requiredAnchorTownsPresent": True,
            "townCount": len(by_town),
            "requiresManualDateConfirmation": True
        },
        "towns": {k: {"name": v["town"], "petrol": v["petrol"], "diesel": v["diesel"], "kerosene": v["kerosene"]} for k,v in sorted(by_town.items())}
    }
    # Do not label a cycle current until effective dates are actually extracted.
    # Current prices are only auto-published if official schedule dates are parsed;
    # this first stage preserves source data but marks it pending date verification.
    payload["status"] = "pending-date-verification"
    payload["verification"]["requiresManualDateConfirmation"] = True
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Extracted {len(by_town)} town rows from official EPRA source. Status pending date verification; no live prices should consume it.")

if __name__ == "__main__":
    main()
