/**
 * Verify the foreign-price healing: after loading, the persisted compact blob
 * must no longer carry the implausible value, and the UI must not show it.
 */
import { chromium } from "playwright";

const HOST = process.argv[2] || "https://fuel-app-mobile.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.goto(HOST + "/?cb=heal", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

const isLogin = await page.evaluate(() =>
  /sign in|log in|welcome back/i.test(document.body.innerText || ""),
);
if (isLogin) {
  await page.locator('input[type="email"]').first().fill("founder.qa.fuelpro@gmail.com");
  await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(14000);
}

// Read the per-station compact blob (the one that carried diesel: 217.86).
const found = await page.evaluate(() => {
  const hits = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.includes("compact")) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v && v.fuelPricesByType) hits[k] = v.fuelPricesByType;
    } catch {}
  }
  return hits;
});
console.log("fuelPricesByType after load:");
for (const [k, v] of Object.entries(found)) console.log("  ", k.slice(0, 60), JSON.stringify(v));

const body = await page.evaluate(() => document.body.innerText || "");
const hasBad = /217\.86/.test(body);
console.log("\nUI shows 217.86 anywhere:", hasBad);
console.log("UI shows 'Price not configured':", /Price not configured/.test(body));
console.log("UI shows Super Petrol $ 1.42:", /\$\s*1\.42/.test(body));

await browser.close();
