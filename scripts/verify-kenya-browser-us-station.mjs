// Reproduce the user's exact condition: a browser located in Kenya (timezone
// Africa/Nairobi, locale en-KE) managing a US station. Under the old guard the
// station resolved to "KE", so a Kenya diesel figure (217.86) validated as
// plausible, rendered as "$217.86/L" and got persisted. Verify it can no longer
// appear on the Dashboard, and that no write carries it.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.argv[2];
const PAT = execFileSync("bash", [
  "-c",
  `grep -oE 'sbp_[A-Za-z0-9_-]{20,}' "/workspace/API KEYS.txt" | head -1`,
])
  .toString()
  .trim();

function dbWouldContain(value) {
  const out = execFileSync("bash", [
    "-c",
    `curl -s -X POST "https://api.supabase.com/v1/projects/ojjscjwatikixlpshmub/database/query" -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" -d '{"query":"select count(*) as n from app_kv where data::text like '"'"'%${value}%'"'"'"}'`,
  ]).toString();
  try {
    return JSON.parse(out)[0].n;
  } catch {
    return -1;
  }
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  locale: "en-KE",
  timezoneId: "Africa/Nairobi",
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();

const carried = [];
page.on("request", (r) => {
  const b = r.postData();
  if (b && /217\.86|229\.95|220\.08/.test(b)) carried.push(r.method());
});

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

// What country does each layer now believe?
const view = await page.evaluate(() => {
  const out = {};
  try {
    out.browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    out.navigatorLang = navigator.language;
    const raw = localStorage.getItem("fuelpro_stations_v3");
    const scoped = Object.keys(localStorage).find((k) =>
      k.startsWith("fuelpro_stations_v3_"),
    );
    out.scopedKey = scoped || "(none)";
    out.stationCountry = scoped
      ? JSON.parse(localStorage.getItem(scoped) || "[]")?.[0]?.country
      : undefined;
  } catch (e) {
    out.err = String(e);
  }
  return out;
});
console.log("\nenvironment:", JSON.stringify(view));

await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(10000);

// Read the live Current Pump Prices cards.
const cards = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".fp-price-card")).map((c) =>
    (c.textContent || "").replace(/\s+/g, " ").trim(),
  ),
);
console.log("\nCurrent Pump Prices:");
for (const c of cards) console.log("   " + c);

const body = await page.evaluate(() => document.body.innerText);
const foreign = ["217.86", "229.95", "220.08", "214.35", "164.90"].filter((v) =>
  body.includes(v),
);
console.log("\nforeign values rendered:", foreign.length ? foreign : "NONE");

// Let the app sit, then check whether it wrote a foreign value while we watched.
await page.waitForTimeout(20000);
await page
  .evaluate(() => window.dispatchEvent(new Event("beforeunload")))
  .catch(() => {});
await page.waitForTimeout(2000);
console.log(
  "requests carrying a foreign value:",
  carried.length ? carried : "NONE",
);

await browser.close();
for (const v of ["217.86", "229.95", "220.08"]) {
  console.log(`  db rows containing ${v}: ${dbWouldContain(v)}`);
}
