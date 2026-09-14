/**
 * Live E2E of the REAL game-embed mirror logic (from api/_lib/crazygames-embed)
 * served over a local HTTP server, then loaded inside an IFRAME — verifying
 * the exact deployed architecture end-to-end against real game-files URLs.
 *
 * Flow: iframe → /api/game-embed/<slug>/<slug>/<build>/index.html
 *        → serveGameEmbed proxies to <slug>.game-files.crazygames.com (Referer)
 *        → no XFO, ad-free. Assert canvas + zero ad requests.
 */
import * as http from "node:http";
import { chromium } from "@playwright/test";
import { serveGameEmbed } from "../api/_lib/crazygames-embed";

const PORT = 8791;
const SLUG = "war-the-knights";

// Simulate the ENTRY endpoint: iframe.srce = /api/game-embed/<SLUG> and the
// proxy resolves the loader server-side -> 307 median -> full mirror.
const ENTRY_PATH = `/api/game-embed/${SLUG}`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/api/game-embed/")) {
    res.writeHead(404);
    res.end("nope");
    return;
  }
  serveGameEmbed(url.pathname, url.searchParams, {})
    .then(async (r) => {
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(Buffer.from(await r.arrayBuffer()));
    })
    .catch((e) => {
      res.writeHead(502);
      res.end(String(e));
    });
});

await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const adRefs: string[] = [];
const mirrorReqs: string[] = [];
page.on("request", (req) => {
  const u = req.url();
  if (/doubleclick|googletag|gpt\.js|adsbygoogle|poki|pubads/i.test(u))
    adRefs.push(u);
  if (u.includes(`localhost:${PORT}/api/game-embed`))
    mirrorReqs.push(
      `${req.resourceType()} ${u.replace(/^https?:\/\/[^/]+/, "")}`,
    );
});

await page.setContent(
  `<iframe style="width:100%;height:90vh" src="http://localhost:${PORT}${ENTRY_PATH}"></iframe>`,
);
await page.waitForTimeout(18000);

const frame = page.frames().find((f) => f !== page.mainFrame());
let canvas = 0;
let title = "";
try {
  if (frame) {
    canvas = await frame.locator("canvas").count();
    title = await frame.title();
  }
} catch (e) {
  console.log("frame err", e.message);
}

console.log("\n===== LIVE MIRROR E2E =====");
console.log("entryPath:", ENTRY_PATH, "(307 -> full mirror)");
console.log("iframe canvas:", canvas, "| title:", title.slice(0, 50));
console.log("ad requests:", adRefs.length);
if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 6));
console.log("mirror requests:", mirrorReqs.length);
for (const r of mirrorReqs.slice(0, 15)) console.log("  ", r.slice(0, 130));

await browser.close();
server.close(() => process.exit(adRefs.length === 0 && canvas > 0 ? 0 : 1));
