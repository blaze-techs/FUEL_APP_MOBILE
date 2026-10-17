import { chromium } from "playwright";

// Verify genre browse + grid paging in the live Movies tab.
const BASE = process.argv[2] || "https://fuel-app-mobile.pages.dev";
const EMAIL = process.argv[3];
const PASS = process.argv[4];

const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

await pg.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await pg.waitForTimeout(6000);
const email = await pg.$("input[type=email], input[name=email]");
if (email) {
  await email.fill(EMAIL);
  const pw = await pg.$("input[type=password]");
  if (pw) await pw.fill(PASS);
  await pg.click("button[type=submit]").catch(() => {});
  await pg.waitForTimeout(12000);
}
await pg.getByText(/Skip tour|Skip/i).first().click({ timeout: 4000 }).catch(() => {});
await pg.waitForTimeout(1200);
await pg.evaluate(() => window.dispatchEvent(new CustomEvent("changeTab", { detail: "news" })));
await pg.waitForTimeout(3500);
await pg.locator("button", { hasText: /^\s*Movies\s*$/i }).first().click({ timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(6000);

const cards = () => pg.locator("text=/^Watch$/").count();
console.log("initial cards:", await cards());

// Reveal all genres, then click "Horror".
await pg.locator("button", { hasText: /more/i }).first().click().catch(() => {});
await pg.waitForTimeout(500);
const horror = pg.locator("button", { hasText: /^Horror$/i }).first();
const hasHorror = await horror.count();
if (hasHorror) {
  await horror.click();
  await pg.waitForTimeout(6000);
}
const body = (await pg.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
console.log("HAS_HORROR_PILL:", hasHorror > 0);
console.log("HORROR_SECTION:", body.slice(Math.max(0, body.search(/Horror/)), body.search(/Horror/) + 220));

// Paging: the "Load more" control appears when the list exceeds the window.
const loadMore = pg.locator("button", { hasText: /Load more/i }).first();
const hasLoadMore = await loadMore.count();
console.log("HAS_LOAD_MORE:", hasLoadMore > 0);
if (hasLoadMore) {
  const before = await pg.locator("text=/^Watch$/").count();
  await loadMore.click();
  await pg.waitForTimeout(1500);
  const after = await pg.locator("text=/^Watch$/").count();
  console.log("LOAD_MORE_GROWS:", before, "->", after, after > before ? "PASS" : "FAIL");
}
console.log("PAGE_ERRORS:", errs.length ? errs.slice(0, 4) : "none");
await pg.screenshot({ path: "/tmp/movies-genre.png", fullPage: false });
await b.close();
