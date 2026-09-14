/**
 * Verify Moto X3M (popular HTML5 game) is ad-free + iframe-able via mirror proxy.
 */
import * as http from "node:http";
import { chromium } from "@playwright/test";

const SLUG = "moto-x3m";
const UPSTREAM = `https://${SLUG}.game-files.crazygames.com`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://localhost:8790");
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
  await new Promise<void>((r) => server.listen(8790, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const reqs: string[] = [];
  const adRefs: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    reqs.push(`${r.resourceType()} ${u}`);
    if (/doubleclick|googletag|gpt\.js|adsbygoogle|poki|pubads/i.test(u)) adRefs.push(u);
  });

  await page.setContent(
    `<iframe style="width:100%;height:100%" src="http://localhost:8790/moto-x3m/13/index.html"></iframe>`
  );
  await page.waitForTimeout(15000);

  const frame = page.frames().find((f) => f !== page.mainFrame());
  let canvas = 0;
  let title = "";
  let status = "";
  try {
    if (frame) {
      canvas = await frame.locator("canvas").count();
      title = await frame.title();
      const body = (await frame.textContent("body")) || "";
      status = body.slice(0, 200).replace(/\s+/g, " ").trim();
    }
  } catch (e) {
    console.log("frame err", e.message);
  }

  console.log("\n===== MOTO X3M MIRROR VERIFY =====");
  console.log("iframe canvas:", canvas, "| title:", title.slice(0, 50));
  console.log("total reqs:", reqs.length, "| AD reqs:", adRefs.length);
  if (adRefs.length) console.log("AD SAMPLES:", adRefs.slice(0, 6));
  console.log("status:", status.slice(0, 120));

  await browser.close();
  server.close(() => process.exit(adRefs.length === 0 && canvas > 0 ? 0 : 1));
}
main().catch((e) => {
  console.error("ERR", e.message);
  server.close(() => process.exit(1));
});