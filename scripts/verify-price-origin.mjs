// Inspect the fuel-price caches the app leaves in localStorage and whether any
// of them still carries an implausible (foreign-market) value.
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

const dump = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return keys.filter((k) => k && k.includes("compact"));
});
console.log("FULL cache keys containing 'compact':");
for (const k of dump) console.log("  " + k);

console.log("\nRendered fuel prices on the Dashboard:");
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(6000);
const text = await page.evaluate(() => document.body.innerText);
const hits = text
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /per litre|per liter|Price/i.test(l))
  .slice(0, 20);
console.log(hits.map((h) => "  " + h).join("\n"));
console.log(
  "\nUI contains '217.86':",
  text.includes("217.86"),
  "| contains '229.95':",
  text.includes("229.95"),
  "| contains '220.08':",
  text.includes("220.08"),
);

await browser.close();
