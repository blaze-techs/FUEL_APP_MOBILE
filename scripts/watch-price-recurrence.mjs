import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

// Poll the DB while a logged-in session runs, to see exactly when (and whether)
// a foreign price reappears — and whether it comes back on load or on save.
const BASE = process.argv[2];
const PAT = execFileSync("bash", [
  "-c",
  `grep -oE 'sbp_[A-Za-z0-9_-]{20,}' "/workspace/API KEYS.txt" | head -1`,
])
  .toString()
  .trim();

function count() {
  const out = execFileSync("bash", [
    "-c",
    `curl -s -X POST "https://api.supabase.com/v1/projects/ojjscjwatikixlpshmub/database/query" -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" -d '{"query":"select count(*) as n from app_kv where data::text like '"'"'%217.86%'"'"'"}'`,
  ]).toString();
  try {
    return JSON.parse(out)[0].n;
  } catch {
    return -1;
  }
}

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
console.log(`${stamp()} rows with 217.86 before session: ${count()}`);

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const seen = [];
page.on("request", (r) => {
  const b = r.postData();
  if (b && b.includes("217.86")) seen.push(`${r.method()} ${r.url().slice(-50)}`);
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
console.log(`${stamp()} login submitted`);

for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(5000);
  console.log(`${stamp()} rows: ${count()}  (outbound reqs w/ value: ${seen.length})`);
}

await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(8000);
console.log(`${stamp()} after dashboard tab: ${count()}`);

await browser.close();
console.log(`${stamp()} rows after browser close: ${count()}`);
console.log("outbound requests carrying 217.86:", seen.length);
for (const s of seen) console.log("   " + s);
