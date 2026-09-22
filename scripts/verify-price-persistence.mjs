// Reproduce the exact user report: a Kenya-based user on a US station watches
// diesel revert to the Kenya EPRA figure "after logout / some time".
import { chromium } from "playwright";

const BASE = process.argv[2];
const STATION_ID = "52c24393-55e1-4ff4-9087-f06009f69da3";
const FOREIGN = ["217.86", "229.95", "220.08", "214.35", "164.90"];

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  locale: "en-KE",
  timezoneId: "Africa/Nairobi",
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();

const login = async () => {
  try {
    await page
      .locator('input[type="email"], input[name="email"]')
      .first()
      .fill("founder.qa.fuelpro@gmail.com");
    await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(20000);
  } catch {}
};

const readCards = async () => {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
  );
  await page.waitForTimeout(9000);
  return page.evaluate(() => {
    const body = document.body.innerText;
    return {
      cards: Array.from(document.querySelectorAll(".fp-price-card")).map((c) =>
        (c.textContent || "").replace(/\s+/g, " ").trim(),
      ),
      foreign: body.match(/217\.86|229\.95|220\.08|214\.35|164\.90/g) || [],
      has142: body.includes("1.42"),
    };
  });
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await login();
await page.evaluate((id) => {
  localStorage.setItem("fuelpro_current_station_v3", id);
}, STATION_ID);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(20000);
console.log("STEP 1 (initial):", JSON.stringify(await readCards()));

// "leave for a while" — background the tab, then return.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    }),
  );
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(20000);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    }),
  );
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(12000);
  console.log(`STEP 2.${i + 1} (after idle):`, JSON.stringify(await readCards()));
}

// Visit several tabs, then come back to the Dashboard.
for (const tab of ["pos", "sales", "inventory", "fueltypes", "invoice", "credit"]) {
  await page.evaluate(
    (t) => window.dispatchEvent(new CustomEvent("changeTab", { detail: t })),
    tab,
  );
  await page.waitForTimeout(2500);
}
console.log("STEP 3 (after visiting tabs):", JSON.stringify(await readCards()));

// Log out, then log back in — the exact trigger in the report.
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("sb-") || k.includes("supabase.auth")) localStorage.removeItem(k);
  }
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await login();
await page.evaluate((id) => {
  localStorage.setItem("fuelpro_current_station_v3", id);
}, STATION_ID);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(20000);
console.log("STEP 4 (after logout+login):", JSON.stringify(await readCards()));

await browser.close();
