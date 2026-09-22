/**
 * Tab sweep: navigate every registered tab, capture console errors and confirm
 * the app renders. Used to catch regressions from the pricing hardening.
 */
import { chromium } from "playwright";

const HOST = process.argv[2] || "https://fuel-app-mobile.pages.dev";
const TABS = [
  "dashboard", "pos", "livetransaction", "sales", "pumpmapping", "offloading",
  "delivery", "inventory", "suppliers", "maintenance", "invoice", "credit",
  "mpesa", "payroll", "customers", "fuelsales", "reports", "analytics",
  "audit", "communication", "news", "data", "integration", "compliance",
  "fueltypes", "team", "documents", "expenses", "automation", "terminal",
  "price-finder", "videogames", "projtime", "webstudio", "quality",
];

const browser = await chromium.launch({
  
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 160)));

await page.goto(HOST + "/?cb=sweep", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// Sign in if the login screen is showing.
const isLogin = await page.evaluate(() =>
  /sign in|log in|welcome back/i.test(document.body.innerText || ""),
);
if (isLogin) {
  const emailBox = page.locator('input[type="email"]').first();
  const passBox = page.locator('input[type="password"]').first();
  if ((await emailBox.count()) && (await passBox.count())) {
    await emailBox.fill(process.env.QA_EMAIL || "founder.qa.fuelpro@gmail.com");
    await passBox.fill(process.env.QA_PASS || "FuelPro@2026!");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(12000);
  }
}

const results = [];
for (const t of TABS) {
  const before = errors.length;
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("changeTab", { detail: id }));
  }, t);
  await page.waitForTimeout(1800);
  const txt = await page.evaluate(() => document.body.innerText || "");
  const crashed = /Something went wrong|Application error/i.test(txt);
  const blank = txt.trim().length < 200;
  results.push({
    tab: t,
    newErrors: errors.length - before,
    crashed,
    blank,
  });
}

console.log("TAB".padEnd(18), "ERRS", "STATE");
for (const r of results) {
  const state = r.crashed ? "CRASH" : r.blank ? "BLANK" : "ok";
  console.log(r.tab.padEnd(18), String(r.newErrors).padStart(4), state);
}
const uniq = [...new Set(errors)];
console.log("\nunique console errors:", uniq.length);
uniq.slice(0, 12).forEach((e) => console.log(" -", e));

await browser.close();
