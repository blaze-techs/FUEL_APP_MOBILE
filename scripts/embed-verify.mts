import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const adRefs: string[] = [];
  const gameReq: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|yieldlab|yandex|mgid|taboola/i.test(u)) {
      adRefs.push(u);
    }
    if (u.includes("builds.crazygames.com") || /\.crazygames\.com\/en_US\//.test(u)) {
      gameReq.push(u.slice(0, 90));
    }
  });

  // Load a clean CrazyGames game embed directly (same as the app iframe would)
  await page.goto(
    "https://games.crazygames.com/en_US/war-the-knights/index.html",
    { waitUntil: "domcontentloaded", timeout: 45000 }
  );
  await page.waitForTimeout(8000);

  const title = await page.title().catch(() => "");
  const hasCanvas = (await page.locator("canvas").count()) > 0;
  const bodyText = (await page.textContent("body")) || "";
  const playableHint = /loading|error|playButton|start/i.test(bodyText.slice(0, 400));

  console.log("\n===== CrazyGames embed verification =====");
  console.log("title:", title);
  console.log("canvas elements:", hasCanvas);
  console.log("iframe-based embeds detected (should be game boostrap): none-required");
  console.log("ad requests observed:", adRefs.length);
  if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 5));
  console.log("game/build requests:", gameReq.length);
  console.log("sample game reqs:", gameReq.slice(0, 4));

  await browser.close();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});