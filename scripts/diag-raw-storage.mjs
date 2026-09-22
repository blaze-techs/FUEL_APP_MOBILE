// Dump the RAW localStorage values the price guard depends on, so the resolved
// market and the configured price can both be read directly.
import { chromium } from "playwright";

const BASE = process.argv[2];
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  locale: "en-KE",
  timezoneId: "Africa/Nairobi",
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
try {
  await page
    .locator('input[type="email"], input[name="email"]')
    .first()
    .fill("founder.qa.fuelpro@gmail.com");
  await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
  await page.locator('button[type="submit"]').first().click();
} catch {}
await page.waitForTimeout(24000);

const raw = await page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (k.includes("stations_v3_87e6502b")) {
      out.stationKey = k;
      out.stationRaw = (localStorage.getItem(k) || "").slice(0, 900);
    }
    if (k.endsWith("__fuel_types_config")) {
      out.cfgKey = k;
      out.cfgRaw = (localStorage.getItem(k) || "").slice(0, 700);
    }
    if (k === "fuelpro_station_countries") {
      out.stationCountries = localStorage.getItem(k);
    }
  }
  return out;
});
console.log(JSON.stringify(raw, null, 2));
await browser.close();
