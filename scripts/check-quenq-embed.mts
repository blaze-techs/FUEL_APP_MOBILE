import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=swiftshader",
    "--disable-gpu-sandbox",
    "--enable-features=SharedArrayBuffer",
  ],
  headless: true,
});
const page = await browser.newPage();
const errs: string[] = [];
const allLogs: string[] = [];
const reqs: string[] = [];
page.on("console", (m) => {
  let t = m.text();
  if (m.type() === "error") errs.push(t);
  allLogs.push(`[${m.type()}] ${t.slice(0, 160)}`);
});
page.on("request", (r) => {
  const u = r.url();
  if (/ruffle|swf|arcade|unpkg|eaglercraft/i.test(u))
    reqs.push(u.slice(0, 110));
});
const respFailures: string[] = [];
page.on("requestfailed", (r) =>
  respFailures.push(`${r.url().slice(0, 90)} :: ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.status() >= 400)
    respFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`);
});
// Load the target inside an iframe from a same-origin parent (real-app-like).
const target =
  process.argv[2] || "https://quenq.com/arcade/data/games/8-ball-pool/";
const waitMs = parseInt(process.argv[3] || "12000");
const parent = process.argv[4] || "https://quenq.com/";
await page
  .goto(parent, { waitUntil: "domcontentloaded" })
  .catch(() => console.log("parent nav failed", parent));
await page.evaluate((u) => {
  const f = document.createElement("iframe");
  f.style.width = "100%";
  f.style.height = "92vh";
  f.style.border = "0";
  f.allow = "fullscreen; autoplay; gamepad";
  f.src = u;
  document.body.appendChild(f);
}, target);
await page.waitForTimeout(waitMs);
const frame = page.frames().find((x) => x !== page.mainFrame());
let canvas = 0;
try {
  if (frame) canvas = await frame.locator("canvas").count();
} catch (e) {
  console.log("frame err:", (e as Error).message);
}
console.log("canvas:", canvas);
let hasRuffle = false;
try {
  if (frame) {
    hasRuffle = await frame.evaluate(
      () => typeof (window as any).RufflePlayer !== "undefined",
    );
  }
} catch (e) {}
console.log("canvas:", canvas, "| ruffle:", hasRuffle);
console.log("errors:", errs.slice(0, 6));
console.log("ALL LOGS:");
for (const l of allLogs.slice(0, 20)) console.log("  LOG", l);
console.log("reqs:", reqs.length);
console.log("failures:");
for (const f of respFailures.slice(0, 15)) console.log("  FAIL", f);
await browser.close();
process.exit(canvas > 0 ? 0 : 1);
