import { chromium } from "playwright";

// Verify the in-app Movies tab plays a title (the user-reported surface).
const BASE = process.argv[2] || "https://fuel-app-mobile.vercel.app";
const EMAIL = process.argv[3];
const PASS = process.argv[4];

const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
const bad = [],
  errs = [];
pg.on("response", (r) => {
  if (r.status() >= 400) bad.push(r.status() + " " + r.url().slice(0, 110));
});
pg.on("pageerror", (e) =>
  errs.push(
    "PAGEERR " +
      String(e).slice(0, 140) +
      (e && e.stack ? " || STACK: " + String(e.stack).slice(0, 700) : ""),
  ),
);

await pg.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await pg.waitForTimeout(6000);

// Login
const emailBox = await pg.$("input[type=email], input[name=email]");
if (emailBox) {
  await emailBox.fill(EMAIL);
  const pw = await pg.$("input[type=password]");
  if (pw) await pw.fill(PASS);
  await pg.click("button[type=submit]").catch(() => {});
  await pg.waitForTimeout(12000);
}

// Skip onboarding overlay if present.
await pg
  .getByText(/Skip tour|Skip/i)
  .first()
  .click({ timeout: 4000 })
  .catch(() => {});
await pg.waitForTimeout(1500);

// Navigate via the app's own event bus (reliable) then open the Movies sub-tab.
await pg.evaluate(() => {
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "news" }));
});
await pg.waitForTimeout(4000);

const moviesBtn = pg.locator("button", { hasText: /^\s*Movies\s*$/i }).first();
await moviesBtn
  .click({ timeout: 15000 })
  .catch(() => console.log("movies click failed"));
await pg.waitForTimeout(7000);

const body = (await pg.evaluate(() => document.body.innerText)).replace(
  /\s+/g,
  " ",
);
console.log("HAS_MEDIA_UNAVAILABLE:", /media is unavailable/i.test(body));
console.log("HAS_MOVIES_SUBTAB:", /Movies/i.test(body));
console.log("HAS_WATCH_NOW:", /Watch Now/i.test(body));
console.log("HAS_SEARCH:", /Search/i.test(body));
console.log(
  "MOVIES_SECTION:",
  body.slice(body.search(/Movies/i), body.search(/Movies/i) + 400),
);
console.log("=== HTTP >=400 ===");
[...new Set(bad)].slice(0, 12).forEach((x) => console.log(" ", x));
console.log("=== ERRORS ===");
[...new Set(errs)].slice(0, 8).forEach((x) => console.log(" ", x));
await pg.screenshot({ path: "/tmp/movies-app.png" });
await b.close();
