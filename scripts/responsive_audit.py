#!/usr/bin/env python3
"""
Responsive design audit across device aspect ratios.
Logs into the Founder console, then screenshots every nav section at every
device size. Also captures the main app login page. Writes a markdown report.
"""
import asyncio, os, json, time
from playwright.async_api import async_playwright

BASE = os.environ.get("AUDIT_URL", "https://7759c572.fuel-app-mobile.pages.dev")
OUT = "/workspace/project/FUEL_APP_MOBILE/.audit_out"
os.makedirs(OUT, exist_ok=True)

# (name, width, height, device_label, is_landscape)
DEVICES = [
    ("phone_portrait", 390, 844, "iPhone 14", False),
    ("phone_landscape", 844, 390, "iPhone 14 landscape", True),
    ("small_phone", 320, 568, "iPhone SE", False),
    ("tablet_portrait", 768, 1024, "iPad", False),
    ("tablet_landscape", 1024, 768, "iPad landscape", True),
    ("laptop", 1280, 800, "Laptop", True),
    ("desktop_wide", 1920, 1080, "Desktop/TV", True),
]

SECTIONS = [
    ("overview", "Overview"),
    ("users", "All Users"),
    ("stations", "All Stations"),
    ("analytics", "Analytics"),
    ("secrets", "Secrets"),
    ("audit", "Audit Log"),
    ("flags", "Feature Flags"),
    ("health", "System Health"),
    ("security", "Security & 2FA"),
    ("ratelimits", "Rate Limits"),
    ("backup", "Backup & Restore"),
    ("config", "Site Config"),
    ("notifications", "Notifications"),
    ("branding", "Branding"),
    ("emailtemplates", "Email Templates"),
    ("paywall", "Paywall Control"),
    ("performance", "Performance Center"),
    ("apihooks", "API & Webhooks"),
    ("datamanager", "Data Manager"),
]

results = []

async def click_nav(page, section_id):
    """Click a nav button by its data-section or text. Returns True if section switched."""
    # nav buttons have onClick setActiveSection(id). Try clicking by visible text.
    # We'll find the button whose text matches (strip counts).
    try:
        # Find nav buttons in the sidebar
        btns = await page.query_selector_all("aside nav button, nav button")
        for b in btns:
            txt = (await b.inner_text()).strip().split("\n")[0].strip()
            # match against SECTIONS labels
            for sid, label in SECTIONS:
                if txt == label or txt.replace("\n","").strip() == label:
                    if sid == section_id:
                        await b.click(timeout=3000)
                        await page.wait_for_timeout(400)
                        return True
        return False
    except Exception:
        return False

async def get_header_label(page):
    """Read the header section label span."""
    try:
        # header has 'Super Admin | <Section>' — grab last span
        spans = await page.query_selector_all("header span")
        texts = []
        for s in spans:
            texts.append((await s.inner_text()).strip())
        return " | ".join(texts[-3:])
    except Exception:
        return "?"

async def measure_overflow(page):
    """Return (horizontal_scroll_width, viewport_width)."""
    return await page.evaluate("""() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        scrollH: document.documentElement.scrollHeight,
        clientH: document.documentElement.clientHeight,
    })""")

async def login(page):
    await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
    await page.wait_for_timeout(1500)
    await page.fill('input[placeholder="Enter username"]', "FOUNDER")
    await page.fill('input[placeholder="Enter password"]', "FuelPro@2026!")
    await page.click('button:has-text("Authenticate")')
    # wait for sidebar to appear
    try:
        await page.wait_for_selector("aside", timeout=12000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(locale="en-US")
        page = await ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type in ("error","warning") else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        # ---- LOGIN ONCE (desktop width is fine for login) ----
        await page.set_viewport_size({"width": 1280, "height": 800})
        await login(page)
        # save storage state so each device run can reuse session
        storage = await ctx.storage_state()
        with open(f"{OUT}/storage.json","w") as f:
            json.dump(storage, f)
        await browser.close()

        # ---- FOR EACH DEVICE: new context reusing storage, audit each section ----
        for name, w, h, label, landscape in DEVICES:
            print(f"\n=== {label} {w}x{h} ({name}) ===")
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=2 if "phone" in name or "tablet" in name else 1,
                locale="en-US",
                storage_state=f"{OUT}/storage.json",
            )
            page = await ctx.new_page()
            dev_errors = []
            page.on("console", lambda m: dev_errors.append(f"{m.type}: {m.text}") if m.type=="error" else None)
            page.on("pageerror", lambda e: dev_errors.append(f"pageerror: {e}"))

            await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
            await page.wait_for_timeout(1500)

            row = {"device": name, "label": label, "w": w, "h": h, "sections": [], "errors": dev_errors}

            # screenshot the overview (initial)
            ov = await measure_overflow(page)
            row["overview_overflow"] = ov
            await page.screenshot(path=f"{OUT}/{name}_00_overview.png", full_page=True)

            for sid, slabel in SECTIONS[1:]:  # skip overview (already on it)
                ok = await click_nav(page, sid)
                await page.wait_for_timeout(350)
                hdr = await get_header_label(page)
                ov2 = await measure_overflow(page)
                # screenshot just the main content area if possible
                await page.screenshot(path=f"{OUT}/{name}_{sid}.png", full_page=False)
                row["sections"].append({
                    "section": slabel,
                    "clicked": ok,
                    "header": hdr,
                    "scrollW": ov2["scrollW"], "clientW": ov2["clientW"],
                    "h_overflow": ov2["scrollW"] - ov2["clientW"],
                    "v_scroll": ov2["scrollH"] - ov2["clientH"],
                })
            row["errors"] = dev_errors[:30]
            results.append(row)
            await browser.close()

    # ---- write report ----
    with open(f"{OUT}/report.md","w") as f:
        f.write("# Responsive Audit Report\n\n")
        f.write(f"Base URL: {BASE}\n\n")
        for r in results:
            f.write(f"## {r['label']} — {r['w']}x{r['h']}\n\n")
            ov = r.get("overview_overflow",{})
            f.write(f"- Overview overflow: scrollW={ov.get('scrollW')} clientW={ov.get('clientW')} h_overflow={ov.get('scrollW',0)-ov.get('clientW',0)}px  v_scroll={ov.get('scrollH',0)-ov.get('clientH',0)}px\n")
            f.write(f"- Console errors: {len(r.get('errors',[]))}\n")
            if r.get("errors"):
                for e in r["errors"][:8]:
                    f.write(f"  - {e[:200]}\n")
            f.write("\n| Section | Header | H-overflow | V-scroll |\n|---|---|---|---|\n")
            for s in r["sections"]:
                f.write(f"| {s['section']} | {s['header'][:40]} | {s['h_overflow']}px | {s['v_scroll']}px |\n")
            f.write("\n")
    print(f"\nReport written to {OUT}/report.md")
    print(f"Screenshots in {OUT}/")

asyncio.run(main())
