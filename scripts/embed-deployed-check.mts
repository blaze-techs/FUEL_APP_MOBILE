/**
 * Verify the DEPLOYED game-embed mirror (both hosts) plays ad-free in an iframe.
 * Usage: npx tsx scripts/embed-deployed-check.mts <host> <slug> [pages]
 *   host = fuel-app-mobile.pages.dev | fuel-app-mobile.vercel.app
 *   slug = war-the-knights | moto-x3m (any crazygames slug)
 */
import { chromium } from "@playwright/test";

const host = process.argv[2] || "fuel-app-mobile.pages.dev";
const slug = process.argv[3] || "war-the-knights";
const waitMs = Number(process.argv[4] || 15000);

const browser = await chromium.launch();
const page = await browser.newPage();
const adRefs: string[] = [];
const mirrorReqs: string[] = [];
const errs: string[] = [];
page.on("request", (req) => {
  const u = req.url();
  if (
    /doubleclick|googletag|gpt\.js|adsbygoogle|pubads\.g|securepubads|PokiSDK|yandex|mgid\.com/i.test(
      u,
    )
  ) {
    adRefs.push(u);
  }
  if (u.includes(`/api/game-embed`)) {
    mirrorReqs.push(
      `${req.resourceType()} ${new URL(u).pathname.slice(0, 80)}`,
    );
  }
});
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

// Parent must share the game-embed origin so SAMEORIGIN framing is allowed
// (matches the real app: the Video Games view lives on the same host). Load the
// host origin first and inject our iframe from the same-origin document (kept
// on the host; setContent would reset to an opaque about:blank origin).
let targetReached = await page
  .goto(`https://${host}/index.html`, { waitUntil: "domcontentloaded" })
  .then(() => true)
  .catch(() => false);
if (targetReached) {
  await page.evaluate((iframeUrl) => {
    const f = document.createElement("iframe");
    f.style.width = "100%";
    f.style.height = "92vh";
    f.src = iframeUrl;
    document.body.appendChild(f);
  }, `https://${host}/api/game-embed/${slug}`);
}
await page.waitForTimeout(waitMs);

const frame = page.frames().find((f) => f !== page.mainFrame());
let canvas = 0;
let title = "";
try {
  if (frame) {
    canvas = await frame.locator("canvas").count();
    title = await frame.title();
  }
} catch (e) {
  errs.push("frame err: " + e.message);
}

console.log("\n===== DEPLOYED MIRROR E2E =====");
console.log("host:", host, "| slug:", slug);
console.log("iframe canvas:", canvas, "| title:", title.slice(0, 50));
console.log("AD requests:", adRefs.length);
for (const a of adRefs.slice(0, 5)) console.log("  AD:", a.slice(0, 110));
console.log("mirror requests:", mirrorReqs.length);
for (const r of mirrorReqs.slice(0, 12)) console.log("  ", r);
console.log("page errors:", errs.slice(0, 4));

await browser.close();
process.exit(adRefs.length === 0 && canvas > 0 ? 0 : 1);
