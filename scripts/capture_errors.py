#!/usr/bin/env python3
"""Capture the exact URLs returning 4xx during page load."""
import asyncio
from playwright.async_api import async_playwright

BASE = "https://7759c572.fuel-app-mobile.pages.dev"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await b.new_page()
        fails = []
        def on_resp(resp):
            if resp.status >= 400:
                fails.append((resp.status, resp.url, resp.request.method))
        page.on("response", on_resp)
        await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await page.fill('input[placeholder="Enter username"]', "FOUNDER")
        await page.fill('input[placeholder="Enter password"]', "FuelPro@2026!")
        await page.click('button:has-text("Authenticate")')
        await page.wait_for_timeout(4000)
        for status, url, method in fails:
            print(f"{status} {method} {url}")
        await b.close()

asyncio.run(main())
