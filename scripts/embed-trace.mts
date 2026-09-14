import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const reqs: string[] = [];
  page.on("request", (r) => reqs.push(`${r.resourceType()} ${r.url()}`));

  await page.goto(
    "https://games.crazygames.com/en_US/war-the-knights/index.html",
    { waitUntil: "domcontentloaded", timeout: 45000 }
  );
  await page.waitForTimeout(10000);

  console.log("\n===== FULL REQUEST TRACE =====");
  const interesting = reqs.filter((l) =>
    /builds\.crazygames\.com|\.zip|\.unityweb|\.wasm|gameframe/gi.test(l)
  );
  console.log("build/bundle requests:", interesting.length);
  for (const l of interesting.slice(0, 30)) console.log(" ", l.slice(0, 160));
  console.log(
    "\ngpt/ad requests:",
    reqs.filter((l) => /doubleclick|gpt|pubads/i.test(l)).length
  );

  await browser.close();
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});