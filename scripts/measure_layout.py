#!/usr/bin/env python3
"""Measure rendered sidebar/content widths + detect crushed layouts per device."""
import asyncio, os, json
from playwright.async_api import async_playwright

BASE = os.environ.get("AUDIT_URL", "https://7759c572.fuel-app-mobile.pages.dev")
OUT = "/workspace/project/FUEL_APP_MOBILE/.audit_out"

DEVICES = [
    ("phone_portrait", 390, 844),
    ("phone_landscape", 844, 390),
    ("small_phone", 320, 568),
    ("tablet_portrait", 768, 1024),
    ("tablet_landscape", 1024, 768),
    ("laptop", 1280, 800),
    ("desktop_wide", 1920, 1080),
]

async def main():
    async with async_playwright() as p:
        # login once at desktop
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(locale="en-US")
        page = await ctx.new_page()
        await page.set_viewport_size({"width":1280,"height":800})
        await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
        await page.wait_for_timeout(1200)
        await page.fill('input[placeholder="Enter username"]', "FOUNDER")
        await page.fill('input[placeholder="Enter password"]', "FuelPro@2026!")
        await page.click('button:has-text("Authenticate")')
        await page.wait_for_selector("aside", timeout=12000)
        await page.wait_for_timeout(1200)
        storage = await ctx.storage_state()
        await b.close()

        report = []
        for name, w, h in DEVICES:
            b = await p.chromium.launch(headless=True)
            ctx = await b.new_context(viewport={"width":w,"height":h}, storage_state=OUT+"/storage.json")
            # reuse storage just saved
            with open(OUT+"/storage.json","w") as f:
                json.dump(storage, f)
            page = await ctx.new_page()
            await page.goto(f"{BASE}/#/founder", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            m = await page.evaluate("""() => {
                const aside = document.querySelector('aside');
                const main = document.querySelector('main');
                const grid = document.querySelector('main .grid');
                const header = document.querySelector('header');
                const nav = document.querySelector('aside nav');
                const r = el => el ? el.getBoundingClientRect() : null;
                const vw = document.documentElement.clientWidth;
                return {
                    vw,
                    aside_w: aside ? aside.getBoundingClientRect().width : null,
                    main_w: main ? main.getBoundingClientRect().width : null,
                    header_h: header ? header.getBoundingClientRect().height : null,
                    grid_cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
                    nav_scrollW: nav ? nav.scrollWidth : null,
                    nav_clientW: nav ? nav.clientWidth : null,
                    body_overflow: getComputedStyle(document.body).overflow,
                    main_overflow: main ? getComputedStyle(main).overflow : null,
                    main_maxH: main ? getComputedStyle(main).maxHeight : null,
                };
            }""")
            report.append({"device":name,"w":w,"h":h, **m})
            await b.close()

        print("device          vw   aside  main   header grid_cols")
        for r in report:
            print(f"{r['device']:<16} {r['vw']:>4} {str(r.get('aside_w'))[:5]:>5} {str(r.get('main_w'))[:5]:>5} {str(r.get('header_h'))[:4]:>5} {(r.get('grid_cols') or '')[:40]}")

asyncio.run(main())
