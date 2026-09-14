import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    extraHTTPHeaders: { Referer: "https://games.crazygames.com/" },
  });
  const page = await ctx.newPage();
  const reqs: string[] = [];
  const adRefs: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    reqs.push(`${r.resourceType()} ${u}`);
    if (/doubleclick|googletag|gpt\.js|adsbygoogle|poki|pubads/i.test(u))
      adRefs.push(u);
  });

  await page.goto(
    "https://war-the-knights.game-files.crazygames.com/war-the-knights/29/index.html",
    { waitUntil: "domcontentloaded", timeout: 45000 }
  );
  await page.waitForTimeout(12000);

  console.log("\n===== RAW GAME (no GameFrame) REQUEST TRACE =====");
  for (const l of reqs.slice(0, 40)) console.log(" ", l.slice(0, 150));
  console.log("\ntotal requests:", reqs.length, "| ad requests:", adRefs.length);
  if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 5));
  const canvas = await page.locator("canvas").count();
  const body = (await page.textContent("body")) || "";
  console.log("canvas:", canvas, "| title:", (await page.title()).slice(0, 60));
  console.log("playable hint:", /loading|play|start/i.test(body.slice(0, 300)));

  await browser.close();
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});