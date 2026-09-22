/**
 * Verify the healing propagates back to storage: the persisted compact blob
 * must stop carrying the implausible value after a save cycle.
 */
import { chromium } from "playwright";

const HOST = process.argv[2] || "https://fuel-app-mobile.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.goto(HOST + "/?cb=heal2", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

const isLogin = await page.evaluate(() =>
  /sign in|log in|welcome back/i.test(document.body.innerText || ""),
);
if (isLogin) {
  await page
    .locator('input[type="email"]')
    .first()
    .fill("founder.qa.fuelpro@gmail.com");
  await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(14000);
}

const read = () =>
  page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.includes("compact")) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (v && v.fuelPricesByType) out[k.slice(0, 52)] = v.fuelPricesByType;
      } catch {}
    }
    return out;
  });

console.log("t=0 :", JSON.stringify(await read(), null, 0));
// Trigger a state change (visit a tab) then wait past the 2s save debounce.
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "pos" })),
);
await page.waitForTimeout(20000);
console.log("t=20s:", JSON.stringify(await read(), null, 0));

await browser.close();
