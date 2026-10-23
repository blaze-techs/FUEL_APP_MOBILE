#!/usr/bin/env node
/**
 * Quantify the cost of mounting every row vs a bounded window.
 *
 * Serves the built dist/ (so the app's real CSS applies) and measures the
 * synchronous build + layout cost of appending N table rows — the exact work
 * the browser does when a tab renders one <tr> per record.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DIST = path.resolve(__dirname, "..", "dist");
const PORT = 8932;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(DIST, urlPath === "/" ? "index.html" : urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(DIST, "index.html");
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Load the app shell so its real stylesheets are present.
  await page.goto(`http://localhost:${PORT}/`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  const measure = async (rows) =>
    page.evaluate((n) => {
      document.getElementById("__bench")?.remove();
      const host = document.createElement("div");
      host.id = "__bench";
      host.innerHTML =
        '<div class="bg-white dark:bg-gray-800 rounded-xl overflow-hidden"><div class="overflow-x-auto max-h-[600px] overflow-y-auto"><table class="w-full text-xs"><tbody></tbody></table></div></div>';
      document.body.appendChild(host);
      const tbody = host.querySelector("tbody");
      const t0 = performance.now();
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const tr = document.createElement("tr");
        tr.className =
          "border-b border-gray-100 dark:border-gray-700/50 hover:bg-green-50";
        tr.innerHTML =
          `<td class="px-3 py-2"><div class="flex items-center gap-1.5"><span>2547100${i} - Customer ${i}</span></div></td>` +
          `<td class="px-3 py-2 text-right font-semibold text-green-700">${(1000 + i).toFixed(2)}</td>` +
          `<td class="px-3 py-2 text-right text-gray-500">${(50000 + i).toFixed(2)}</td>` +
          `<td class="px-3 py-2 font-mono text-[10px] text-gray-500">RCPT${i}</td>` +
          `<td class="px-3 py-2 text-gray-500 whitespace-nowrap">2026-10-14 09:15:22</td>`;
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
      // Force layout so the measurement includes real style + layout work.
      void host.offsetHeight;
      const build = performance.now() - t0;

      const t1 = performance.now();
      window.scrollTo(0, document.body.scrollHeight);
      void document.body.offsetHeight;
      const layout = performance.now() - t1;
      return { build: Math.round(build), layout: Math.round(layout) };
    }, rows);

  const before = await measure(5000);
  const after = await measure(200);

  console.log(`app shell loaded, page errors: ${errors.length}`);
  console.log("");
  console.log("rows mounted | build+style | forced layout");
  console.log(
    `       5000  |  ${String(before.build).padStart(6)}ms   | ${String(before.layout).padStart(6)}ms`,
  );
  console.log(
    `        200  |  ${String(after.build).padStart(6)}ms   | ${String(after.layout).padStart(6)}ms`,
  );
  const speedup =
    (before.build + before.layout) / Math.max(1, after.build + after.layout);
  console.log("");
  console.log(`windowed is ~${speedup.toFixed(1)}x cheaper for this table`);

  await browser.close();
  server.close();
})().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
