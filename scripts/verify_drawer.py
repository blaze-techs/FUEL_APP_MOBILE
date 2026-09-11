#!/usr/bin/env python3
"""Confirm the founder sidebar drawer slides in when hamburger is clicked."""
import asyncio
from playwright.async_api import async_playwright

BASE = "https://62a6ff6e.fuel-app-mobile.pages.dev"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await b.new_page(viewport={"width": 375, "height": 812})
        await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await page.fill('input[placeholder="Enter username"]', "FOUNDER")
        await page.fill('input[placeholder="Enter password"]', "FuelPro@2026!")
        await page.click('button:has-text("Authenticate")')
        await page.wait_for_timeout(4000)
        aside = await page.query_selector("aside")
        box1 = await aside.bounding_box()
        print(f"aside BEFORE click: x={box1['x']} (should be negative/off-screen)")
        # Click hamburger
        await page.click('button[aria-label="Open navigation menu"]')
        await page.wait_for_timeout(600)
        # Re-query aside (fresh element handle)
        aside2 = await page.query_selector("aside")
        box2 = await aside2.bounding_box()
        print(f"aside AFTER click: x={box2['x']} (should be 0 = on-screen)")
        # Click a nav item (Overview) and confirm drawer closes
        await page.click("aside button:has-text('Overview')")
        await page.wait_for_timeout(400)
        aside3 = await page.query_selector("aside")
        box3 = await aside3.bounding_box()
        print(f"aside after nav click: x={box3['x']} (should be off-screen again)")
        await b.close()

asyncio.run(main())
