#!/usr/bin/env python3
"""Verify the responsive fixes on the fresh Cloudflare deployment.
Logs into the Founder Console and measures the layout at 375px (iPhone)
to confirm the sidebar drawer works and no 405 errors occur."""
import asyncio
from playwright.async_api import async_playwright

BASE = "https://62a6ff6e.fuel-app-mobile.pages.dev"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await b.new_page(viewport={"width": 375, "height": 812})
        fails = []
        def on_resp(resp):
            if resp.status >= 400 and "fonts.gstatic" not in resp.url:
                fails.append((resp.status, resp.url, resp.request.method))
        page.on("response", on_resp)
        await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await page.fill('input[placeholder="Enter username"]', "FOUNDER")
        await page.fill('input[placeholder="Enter password"]', "FuelPro@2026!")
        await page.click('button:has-text("Authenticate")')
        await page.wait_for_timeout(4000)
        # Take screenshot of the founder console at phone size
        await page.screenshot(path=".audit_out/founder_phone_after.png", full_page=False)
        # Check: is the sidebar visible (should be HIDDEN on mobile until hamburger clicked)
        aside = await page.query_selector("aside")
        aside_box = await aside.bounding_box() if aside else None
        print(f"aside bounding box: {aside_box}")
        # Check for hamburger button
        hamburger = await page.query_selector('button[aria-label="Open navigation menu"]')
        print(f"hamburger present: {hamburger is not None}")
        if hamburger:
            await hamburger.click()
            await page.wait_for_timeout(500)
            await page.screenshot(path=".audit_out/founder_phone_drawer.png", full_page=False)
            aside_box2 = await aside.bounding_box() if aside else None
            print(f"aside after hamburger: {aside_box2}")
        # Overview grid
        grid = await page.query_selector("div.grid")
        grid_box = await grid.bounding_box() if grid else None
        print(f"overview grid box: {grid_box}")
        # Check content width
        body_width = await page.evaluate("document.body.scrollWidth")
        print(f"body scrollWidth: {body_width} (viewport 375)")
        print("\n--- HTTP errors (excluding fonts) ---")
        if not fails:
            print("None! 405s eliminated.")
        for status, url, method in fails[:10]:
            print(f"{status} {method} {url}")
        await b.close()

asyncio.run(main())
