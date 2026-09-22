// Diagnose why Current Pump Prices renders "Price not configured" for the US
// station: dump the resolved station record, the cached fuel_types_config, and
// what the accessor actually resolves per fuel.
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

page.on("console", (m) => {
  const t = m.text();
  if (/authoritative|useStationFuelTypes|price|fuel/i.test(t)) {
    console.log("[console]", m.type(), t.slice(0, 200));
  }
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

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
await page.waitForTimeout(22000);
await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(8000);

const dump = await page.evaluate(() => {
  const out = { keys: [], stations: null, currentId: null, cfgCache: null };
  for (const k of Object.keys(localStorage)) {
    if (/station|fuel_types|cloud_fuel_types|current_station/i.test(k)) {
      out.keys.push(k);
    }
  }
  out.currentId =
    localStorage.getItem("fuelpro_current_station_v3") ||
    localStorage.getItem("fuelpro_current_station");
  for (const k of out.keys) {
    if (!k.includes("stations_v3")) continue;
    const raw = localStorage.getItem(k) || "";
    try {
      const parsed = JSON.parse(raw);
      out.stations = { key: k, countries: parsed.map?.((s) => `${s.id?.slice(0, 8)}:${s.country || "-"}:${s.currency || "-"}`) };
    } catch (e) {
      out.stations = { key: k, parseError: String(e), head: raw.slice(0, 60) };
    }
  }
  const cfgKey = out.keys.find((k) => k.includes("cloud_fuel_types_config"));
  if (cfgKey) {
    out.cfgCache = { key: cfgKey, value: localStorage.getItem(cfgKey) };
  }
  return out;
});
console.log(JSON.stringify(dump, null, 2));

const cards = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".fp-price-card")).map((c) =>
    (c.textContent || "").replace(/\s+/g, " ").trim(),
  ),
);
console.log("\ncards:", JSON.stringify(cards));

await browser.close();
