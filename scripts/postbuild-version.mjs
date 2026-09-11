// Post-build: copies the build version into dist/version.json so the client
// can fetch it at runtime to detect stale SW caches.
//
// ALSO: overwrites the workbox-generated dist/sw.js with our CUSTOM
// public/sw.js. The VitePWA plugin (generateSW mode) overwrites dist/sw.js
// with a workbox SW that calls skipWaiting()+clientsClaim() on every install
// — this was the ROOT CAUSE of the endless random refresh loop. Our custom
// sw.js is network-first for navigations and has a loop-guarded activate
// handler (no force-navigate, no FUELPRO_RELOAD). It does NOT precache
// assets, so there's no byte-diff → updatefound → reload cycle.
import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd());
const dist = path.join(root, "dist");
const versionFile = path.join(root, ".build-version");

if (!fs.existsSync(versionFile)) {
  console.warn("[version-postbuild] .build-version not found — skipping");
  process.exit(0);
}

const version = fs.readFileSync(versionFile, "utf-8").trim();

if (!fs.existsSync(dist)) {
  console.warn("[version-postbuild] dist/ not found — skipping");
  process.exit(0);
}

fs.writeFileSync(
  path.join(dist, "version.json"),
  JSON.stringify({ version, built: new Date().toISOString() }, null, 2),
);
console.log(`[version-postbuild] dist/version.json written: ${version}`);

// Overwrite the workbox-generated SW with our custom network-first SW.
// ALSO bump the CACHE_VERSION in the SW copy so every deploy ships a fresh
// cache namespace — old caches are purged on activate so users never see
// stale assets. This is what guarantees deploys are visible immediately.
const customSwPath = path.join(root, "public", "sw.js");
const distSwPath = path.join(dist, "sw.js");
if (fs.existsSync(customSwPath)) {
  let customSw = fs.readFileSync(customSwPath, "utf-8", "utf-8");
  // Inject the build version as the cache namespace so each deploy is unique.
  const cacheNs = version.replace(/[^a-zA-Z0-9]/g, "");
  customSw = customSw.replace(
    /const CACHE_VERSION = "fuelpro-v3-[^"]*";/,
    `const CACHE_VERSION = "fuelpro-v3-${cacheNs}";`,
  );
  fs.writeFileSync(distSwPath, customSw);
  console.log("[version-postbuild] dist/sw.js overwritten with custom public/sw.js (network-first, loop-guarded, CACHE_VERSION=" + cacheNs + ")");
  // Remove ALL workbox runtime files (hashed name changes per build) — our
  // custom SW doesn't import them, and leaving them in dist wastes bandwidth.
  const files = fs.readdirSync(dist);
  for (const f of files) {
    if (f.startsWith("workbox-") && f.endsWith(".js")) {
      fs.unlinkSync(path.join(dist, f));
      console.log(`[version-postbuild] Removed unused workbox runtime: ${f}`);
    }
  }
} else {
  console.warn("[version-postbuild] public/sw.js not found — workbox SW will be used (NOT recommended)");
}
