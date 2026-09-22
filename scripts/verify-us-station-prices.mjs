// End-to-end: force the US station into view, then confirm the Dashboard shows
// its genuine $1.42 and that the Kenya EPRA diesel figure cannot render.
import { chromium } from "playwright";

const BASE = process.argv[2];
const STATION_ID = "52c24393-55e1-4ff4-9087-f06009f69da3";

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
await page.waitForTimeout(20000);

// Force the station into view, then reload so StationContext restores it.
await page.evaluate((id) => {
  localStorage.setItem("fuelpro_current_station_v3", id);
}, STATION_ID);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(22000);
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(10000);

const state = await page.evaluate(() => ({
  currentId: localStorage.getItem("fuelpro_current_station_v3"),
  cards: Array.from(document.querySelectorAll(".fp-price-card")).map((c) =>
    (c.textContent || "").replace(/\s+/g, " ").trim(),
  ),
}));
console.log("currentId:", state.currentId);
console.log("cards:", JSON.stringify(state.cards, null, 2));

const body = await page.evaluate(() => document.body.innerText);
const foreign = ["217.86", "229.95", "220.08", "214.35", "164.90"].filter((v) =>
  body.includes(v),
);
console.log("foreign rendered:", foreign.length ? foreign : "NONE");
console.log("legit 1.42 rendered:", body.includes("1.42"));

await browser.close();
