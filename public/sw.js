/*
 * FuelPro Service Worker - bulletproof network-first strategy.
 *
 * Why this exists: the workbox-generated SW served index.html from a precache
 * (cache-first), so users were stuck on old builds after deploys. This SW is
 * NETWORK-FIRST for navigations (index.html), so a deployed update is visible
 * on the very next page load. It only falls back to cache when offline.
 *
 * CACHE_VERSION is bumped automatically by a build-time stamp. On activate,
 * all caches from previous versions are purged so stale entries never leak.
 */
// CACHE_VERSION is bumped by the build postbuild-version.mjs script so every
// deploy ships a fresh cache namespace. Combined with the network-first
// navigation strategy + the in-page update polling, this guarantees users
// see a new deploy within seconds of the next page load.
const CACHE_VERSION = "fuelpro-v3-20260821a";
const ASSET_CACHE = CACHE_VERSION + "-assets";
const NAV_CACHE = CACHE_VERSION + "-nav";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge every cache that does not belong to this version so stale
      // entries (including the old workbox precache) can never leak back.
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (name !== ASSET_CACHE && name !== NAV_CACHE) {
            return caches.delete(name);
          }
          return undefined;
        }),
      );
      // Take control of all open clients immediately so the new network-first
      // strategy governs the very next fetch (no waiting for a re-navigation).
      await self.clients.claim();
      // NOTE: We do NOT force-navigate or post FUELPRO_RELOAD here anymore.
      // The page's controllerchange listener handles the reload (via
      // safeReload, which is loop-guarded). The previous dual mechanism
      // (client.navigate + FUELPRO_RELOAD + controllerchange) caused
      // double-reloads and infinite refresh loops. Now there is exactly
      // ONE reload path: controllerchange → safeReload.
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Network error / offline" },
              id: null,
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    return;
  }

  if (
    url.pathname === "/sw.js" ||
    url.pathname.endsWith("/sw.js") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/manifest.json"
  ) {
    return;
  }

  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");
  const isHashedAsset =
    url.pathname.startsWith("/assets/") &&
    (url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".woff") ||
      url.pathname.endsWith(".woff2"));

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches
              .open(NAV_CACHE)
              .then((cache) => cache.put(req, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("/index.html")),
        ),
    );
    return;
  }

  if (isHashedAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((response) => {
            if (response.status === 200) {
              const clone = response.clone();
              caches
                .open(ASSET_CACHE)
                .then((cache) => cache.put(req, clone))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches
            .open(ASSET_CACHE)
            .then((cache) => cache.put(req, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(req)),
  );
});
