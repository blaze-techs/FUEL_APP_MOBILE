/**
 * Verify the "game-files mirror proxy" architecture for ad-free CrazyGames:
 * 1. Local HTTP server mirrors https://{slug}.game-files.crazygames.com/...
 *    (adds the Referer, strips X-Frame-Options, no ads)
 * 2. Load the mirror URL inside an IFRAME (different origin scenario)
 * 3. Assert: game boots to canvas, ZERO ad/GPT requests
 *
 * This simulates exactly what the deployed /api/game-embed proxy will do.
 */
import * as http from "node:http";
import { chromium } from "@playwright/test";

const UPSTREAM = "https://war-the-knights.game-files.crazygames.com";

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://localhost:8788");
  const target = `${UPSTREAM}${u.pathname}${u.search}`;
  const upstreamHeaders: Record<string, string> = {
    Referer: "https://games.crazygames.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Accept: req.headers.accept || "*/*",
  };
  fetch(target, { headers: upstreamHeaders })
    .then(async (up) => {
      const body = await up.arrayBuffer();
      res.writeHead(up.status, {
        "Content-Type": up.headers.get("content-type") || "application/octet-stream",
        // NO X-Frame-Options -> the whole point of the proxy
        "Access-Control-Allow-Origin": "*",
        "Content-Length": String(body.byteLength),
      });
      res.end(Buffer.from(body));
    })
    .catch((e) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("proxy error: " + e.message);
    });
});

async function main() {
  await new Promise<void>((r) => server.listen(8788, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const reqs: string[] = [];
  const adRefs: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    reqs.push(`${r.resourceType()} ${u}`);
    if (/doubleclick|googletag|gpt\.js|adsbygoogle|poki|pubads/i.test(u)) adRefs.push(u);
  });

  // Local page hosting the proxied game in an iframe (same-origin to proxy mirror)
  await page.setContent(`<!doctype html><html><body>
    <iframe id="gm" style="width:960px;height:540px;border:0" src="http://localhost:8788/war-the-knights/29/index.html"></iframe>
  </body></html>`);
  await page.waitForTimeout(20000);

  const frameDoc = page.frames().find((f) => !f.parentFrame());
  let canvasCount = 0;
  let title = "";
  let bodyLen = 0;
  try {
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (frame) {
      canvasCount = await frame.locator("canvas").count();
      title = await frame.title();
      bodyLen = (await frame.textContent("body")).length;
    }
  } catch (e) {
    console.log("frame eval error", e.message);
  }

  console.log("\n===== MIRROR-PROXY IFRAME VERIFICATION =====");
  console.log("frames:", page.frames().length, "| iframe canvas:", canvasCount);
  console.log("iframe title:", title.slice(0, 70));
  console.log("total requests:", reqs.length, "| AD requests:", adRefs.length);
  if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 6));
  const mirrored = reqs.filter((l) => l.startsWith("document http://localhost:8788"));
  console.log("mirrored doc requests:", mirrored.length);
  const toLocal = reqs.filter((l) => /^[a-z]+ http:\/\/localhost:8788/.test(l));
  console.log("all local(proxy) requests:", toLocal.length);
  for (const l of toLocal.slice(0, 15)) console.log("  ", l.slice(0, 120));

  await browser.close();
  server.close(() => process.exit(adRefs.length === 0 && canvasCount > 0 ? 0 : 1));
}

main().catch((e) => {
  console.error("ERR", e.message);
  server.close(() => process.exit(1));
});