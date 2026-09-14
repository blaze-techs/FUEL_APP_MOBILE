/**
 * Verify Unity6 game (dragon-archers, files.crazygames.com) is ad-free +
 * iframe-able through a mirror proxy. The loader options point to:
 *   unityLoaderUrl: https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/...loader.js
 *   unityConfigOptions: codeUrl/frameworkUrl/dataUrl on files.crazygames.com
 *
 * The mirror proxies the whole files.crazygames.com/dragon-archers/... subtree.
 */
import * as http from "node:http";
import { chromium } from "@playwright/test";

const UPSTREAM = "https://files.crazygames.com";
const BASE_FILES = UPSTREAM + "/dragon-archers/28/CrazyGamesRelease/Build/";
const LOADER = "5e334a00a125b3a91401238fc2a230a6.loader.js";

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://localhost:8789");
  const target = `${UPSTREAM}${u.pathname}${u.search}`;
  fetch(target, {
    headers: {
      Referer: "https://games.crazygames.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Accept: req.headers.accept || "*/*",
    },
  })
    .then(async (up) => {
      const body = await up.arrayBuffer();
      res.writeHead(up.status, {
        "Content-Type": up.headers.get("content-type") || "application/octet-stream",
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
  await new Promise<void>((r) => server.listen(8789, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const reqs: string[] = [];
  const adRefs: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    reqs.push(`${r.resourceType()} ${u}`);
    if (/doubleclick|googletag|gpt\.js|adsbygoogle|poki|pubads/i.test(u)) adRefs.push(u);
  });

  // A real Unity6 page: loader + output config
  await page.setContent(`<!doctype html><html><head>
    <meta charset="utf-8">
    </head><body>
    <script>
    window.gameConfig = {
      loaderUrl: ${JSON.stringify(`http://localhost:8789/dragon-archers/28/CrazyGamesRelease/Build/${LOADER}`)},
      config: {
        codeUrl: "http://localhost:8789/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.wasm",
        frameworkUrl: "http://localhost:8789/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.framework.js",
        dataUrl: "http://localhost:8789/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.data",
        streamingAssetsUrl: "",
        companyName: "CrazyGames.com",
        productName: "Dragon Archers",
      }
    };
    </script>
    <div id="unity-container" style="width:960px;height:540px"><canvas id="unity-canvas"></canvas></div>
    <script src="http://localhost:8789/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.loader.js"></script>
    </body></html>`);
  await page.waitForTimeout(8000);

  const body = (await page.textContent("body")) || "";
  const canvasAfter = await page.locator("#unity-canvas").count();

  console.log("\n===== UNITY6 files.crazygames.com VERIFY =====");
  console.log("loader.js reached proxy:", reqs.some((l) => l.includes(".loader.js")));
  console.log("canvas present:", canvasAfter > 0);
  console.log("total requests:", reqs.length, "| AD requests:", adRefs.length);
  if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 6));
  const filesReqs = reqs.filter((l) => l.includes("localhost:8789"));
  console.log("mirrored files requests:", filesReqs.length, "of", reqs.length);
  for (const l of filesReqs.slice(0, 12)) console.log("  ", l.slice(0, 140));

  await browser.close();
  server.close(() => process.exit(adRefs.length === 0 && canvasAfter > 0 ? 0 : 1));
}

main().catch((e) => {
  console.error("ERR", e.message);
  server.close(() => process.exit(1));
});