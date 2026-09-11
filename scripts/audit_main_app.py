#!/usr/bin/env python3
"""Multi-device responsive audit of the MAIN app (non-founder).
Logs in as the QA user and screenshots the dashboard at multiple sizes,
checking for horizontal overflow and content-width issues."""
import asyncio
from playwright.async_api import async_playwright

BASE = "https://62a6ff6e.fuel-app-mobile.pages.dev"
EMAIL = "leonibuyanawose@gmail.com"
PASSWORD = "FuelPro@2026!"

DEVICES = [
    ("small_phone", 320, 568),   # iPhone SE 1st gen
    ("phone", 390, 844),         # iPhone 12/13
    ("phone_landscape", 844, 390),
    ("tablet", 768, 1024),       # iPad
    ("tablet_landscape", 1024, 768),
    ("laptop", 1366, 768),
    ("desktop", 1920, 1080),
    ("tv_4k", 3840, 2160),
]

async def main():
    results = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        for name, w, h in DEVICES:
            page = await b.new_page(viewport={"width": w, "height": h})
            fails = []
            def on_resp(resp, _name=name):
                if resp.status >= 400 and "fonts.gstatic" not in resp.url and "font.googleapis" not in resp.url:
                    fails.append(f"{resp.status} {resp.request.method} {resp.url[:80]}")
            page.on("response", on_resp)
            try:
                await page.goto(f"{BASE}/", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(1500)
                # Try to login
                try:
                    await page.fill('input[type="email"]', EMAIL, timeout=5000)
                    await page.fill('input[type="password"]', PASSWORD, timeout=5000)
                    await page.click('button:has-text("Sign In")', timeout=5000)
                    await page.wait_for_timeout(5000)
                except Exception:
                    pass  # may already be logged in or login form differs
                sw = await page.evaluate("document.body.scrollWidth")
                ih = await page.evaluate("window.innerHeight")
                sh = await page.evaluate("document.body.scrollHeight")
                overflow = sw > w
                results.append((name, w, sw, overflow, sh, ih, len(fails)))
                if fails:
                    for f in fails[:3]:
                        results.append((f"  {name} ERR", 0,0,0,0,0, f))
                await page.screenshot(path=f".audit_out/main_{name}.png", full_page=False)
            except Exception as e:
                results.append((f"{name} ERROR", w, 0, False, 0, 0, str(e)[:80]))
            await page.close()
        await b.close()

    print(f"{'device':<18} {'vw':>5} {'scrollW':>8} {'overflow':>9} {'scrollH':>8} {'innerH':>7} {'errs':>5}")
    print("-" * 60)
    for r in results:
        if isinstance(r[6], str) and r[0].startswith("  "):
            print(f"  ERR: {r[6]}")
        else:
            name, w, sw, overflow, sh, ih, errs = r
            flag = "✅" if not overflow else "❌"
            print(f"{name:<18} {w:>5} {sw:>8} {str(overflow):>9} {sh:>8} {ih:>7} {errs:>5} {flag}")

asyncio.run(main())
