// Read the actual Current Pump Prices card values, to confirm the legitimate
// station price survives while foreign figures are gone.
import { chromium } from "playwright";

const BASE = process.argv[2];
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
try {
  await page
    .locator('input[type="email"], input[name="email"]')
    .first()
    .fill("founder.qa.fuelpro@gmail.com");
  await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(15000);
} catch {}

await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(8000);

const cards = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".fp-price-card").forEach((c) => {
    out.push((c.textContent || "").replace(/\s+/g, " ").trim());
  });
  return out;
});
console.log("Current Pump Prices cards:");
for (const c of cards) console.log("  • " + c);

const body = await page.evaluate(() => document.body.innerText);
for (const bad of ["217.86", "229.95", "220.08", "214.35", "164.9"]) {
  if (body.includes(bad)) console.log(`  !! foreign value rendered: ${bad}`);
}
console.log("legit $1.42 rendered:", /1\.42/.test(body));

// What country does the app believe this station is in?
const ctx = await page.evaluate(() => ({
  identity: localStorage.getItem("fuelpro_auth_identity"),
  stationKeys: Object.keys(localStorage).filter((k) => k.includes("station_v3")),
}));
console.log("station cache keys:", ctx.stationKeys.join(", ") || "(none)");

await browser.close();
