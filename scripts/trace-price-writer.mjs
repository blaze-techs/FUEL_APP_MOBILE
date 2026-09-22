// Find the exact write that reintroduces a foreign price, by intercepting every
// request the app makes and decoding any compressed app_kv payload that carries
// the offending value. This pinpoints the writer instead of guessing at guards.
import { chromium } from "playwright";
import zlib from "node:zlib";

const BASE = process.argv[2];
const NEEDLE = "217.86";

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// Trace where the value sits inside a payload (top-level or nested bytes).
function findNeedle(obj, path = "$", depth = 0) {
  const hits = [];
  if (depth > 6 || obj == null) return hits;
  if (typeof obj === "string") {
    if (obj.includes(NEEDLE)) hits.push(path);
    // base64+gzip envelopes
    if (obj.length > 40 && /^[A-Za-z0-9+/=]+$/.test(obj)) {
      try {
        const inner = zlib.gunzipSync(Buffer.from(obj, "base64")).toString();
        if (inner.includes(NEEDLE)) hits.push(`${path} (gzip)`);
        // one nesting level is possible
        try {
          const j = JSON.parse(inner);
          if (typeof j?.c === "string") {
            const deep = zlib.gunzipSync(Buffer.from(j.c, "base64")).toString();
            if (deep.includes(NEEDLE)) hits.push(`${path} (gzip+gzip)`);
          }
        } catch {}
      } catch {}
    }
    return hits;
  }
  if (typeof obj === "number") {
    if (String(obj) === NEEDLE) hits.push(path);
    return hits;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => hits.push(...findNeedle(v, `${path}[${i}]`, depth + 1)));
    return hits;
  }
  for (const [k, v] of Object.entries(obj)) {
    hits.push(...findNeedle(v, `${path}.${k}`, depth + 1));
  }
  return hits;
}

const writes = [];
page.on("request", (req) => {
  const url = req.url();
  if (!url.includes("supabase")) return;
  const method = req.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const body = req.postData();
  if (!body || !body.includes(NEEDLE)) return;
  let paths = [];
  try {
    paths = findNeedle(JSON.parse(body));
  } catch {
    paths = ["(unparsed body)"];
  }
  writes.push({ method, url: url.split("?")[0].slice(-60), paths });
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
try {
  await page
    .locator('input[type="email"], input[name="email"]')
    .first()
    .fill("founder.qa.fuelpro@gmail.com");
  await page.locator('input[type="password"]').first().fill("FuelPro@2026!");
  await page.locator('button[type="submit"]').first().click();
} catch {}
await page.waitForTimeout(30000);

await page.evaluate(() =>
  window.dispatchEvent(new CustomEvent("changeTab", { detail: "dashboard" })),
);
await page.waitForTimeout(15000);

console.log(`\nrequests carrying "${NEEDLE}": ${writes.length}`);
for (const w of writes) {
  console.log(`  ${w.method} ...${w.url}`);
  for (const p of w.paths) console.log(`      at ${p}`);
}

await browser.close();
