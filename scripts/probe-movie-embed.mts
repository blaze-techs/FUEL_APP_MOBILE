import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8891";
const TITLE = process.argv[3] || "movie&id=550";
const url = `${BASE}/api/movie-embed?type=${TITLE}`;

const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const pg = await ctx.newPage();
const bad = [],
  errs = [];

pg.on("response", (r) => {
  if (r.status() >= 400) bad.push(r.status() + " " + r.url().slice(0, 120));
});
pg.on("pageerror", (e) => errs.push("PAGEERR " + String(e).slice(0, 140)));
pg.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text().slice(0, 140));
});

console.log("URL:", url);
await pg
  .goto(url, { waitUntil: "networkidle", timeout: 60000 })
  .catch((e) => console.log("goto:", e.message));
await pg.click("#bigPlay").catch(() => console.log("(no bigPlay)"));

let best = null;
for (let i = 0; i < 24; i++) {
  await pg.waitForTimeout(2500);
  for (const f of pg.frames()) {
    let st = null;
    try {
      st = await f.evaluate(() => {
        const v = document.querySelector("video");
        if (!v) return null;
        return {
          url: location.href.slice(0, 90),
          hasSrc: !!(v.currentSrc || v.src),
          src: (v.currentSrc || v.src || "").slice(0, 100),
          readyState: v.readyState,
          currentTime: Math.round(v.currentTime * 100) / 100,
          paused: v.paused,
          duration: Number.isFinite(v.duration) ? v.duration : -1,
          videoWidth: v.videoWidth,
          err: v.error ? v.error.code : null,
          srcCount: document.querySelectorAll("source").length,
        };
      });
    } catch {
      st = null;
    }
    if (st && (st.hasSrc || st.srcCount > 0)) best = st;
    if (st && st.currentTime > 0) {
      best = st;
    }
  }
  if (best && best.currentTime > 0) break;
}

console.log("=== BEST MEDIA STATE ===");
console.log(JSON.stringify(best, null, 1));
console.log("=== FRAMES ===");
pg.frames().forEach((f) => console.log(" ", f.url().slice(0, 100)));
console.log("=== HTTP >=400 ===");
[...new Set(bad)].slice(0, 20).forEach((x) => console.log(" ", x));
console.log("=== ERRORS ===");
[...new Set(errs)].slice(0, 12).forEach((x) => console.log(" ", x));

await b.close();
