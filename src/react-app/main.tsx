import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/react-app/index.css";
import "@/react-app/styles/dark-theme.css";
import "@/react-app/styles/grid-responsive.css";
import App from "@/react-app/App.tsx";
import { initErrorMonitoring } from "@/react-app/lib/errorMonitoring";
import "@/react-app/services/enhanced/SyncService";
import "@/react-app/lib/enhanced/performance";
import { prefetchLiveChannelsInBackground } from "@/react-app/services/LiveStreamService";
import { initAdBlocker } from "@/react-app/lib/ad-blocker";
import { startConnectivity } from "@/react-app/lib/connectivity";
import { prefetchMoviesInBackground } from "@/react-app/services/MovieService";
import { prefetchGameCatalogInBackground } from "@/react-app/services/GameCatalogService";
import { installFullscreenState } from "@/react-app/lib/fullscreen";
import { installNativeDownloadInterceptor } from "@/react-app/lib/file-save";

installFullscreenState();

// Inside the Android shell, route anchor downloads (direct, file-saver and
// jsPDF alike) to the native file bridge. Android's WebView does not
// implement createObjectURL + <a download>, so without this every PDF/Excel/
// CSV/text export silently did nothing in the APK. No-op on the web.
installNativeDownloadInterceptor();

// Silently pre-fetch live channel data in the background so it's cached
// and instantly available when the user opens News → Live TV. Runs
// invisibly — no UI, no attribution, fire-and-forget.
prefetchLiveChannelsInBackground();

// Silently pre-fetch the movie catalog in the background so News → Movies
// renders instantly. Same invisible, fire-and-forget pattern.
prefetchMoviesInBackground();

// Silently pre-fetch the quenq arcade game catalog so the Video Games tab
// renders instantly. Same invisible, fire-and-forget pattern.
prefetchGameCatalogInBackground();

// Drop any stale Service Worker response cache left by an earlier build.
// The old workbox config runtime-cached Supabase REST responses, whose SW
// cache key is the request URL. PostgREST authorises via the JWT + RLS rather
// than the URL, so that cache was shared across accounts and could replay one
// signed-in user's rows to another. The rule is gone from vite.config.ts; this
// purge frees devices that still hold the poisoned cache. Purely additive —
// losing the HTML/asset caches only costs a re-fetch.
(function purgeLegacyServiceWorkerCaches() {
  try {
    if (typeof caches === "undefined") return;
    void caches
      .keys()
      .then((names) => {
        for (const name of names) {
          const lower = name.toLowerCase();
          if (lower === "supabase-cache" || lower.includes("supabase")) {
            void caches.delete(name);
          }
        }
      })
      .catch(() => {});
  } catch {
    /* Cache API unavailable; nothing to purge */
  }
})();

// Drop any stale Service Worker response cache left by an earlier build.
// The old workbox config runtime-cached Supabase REST responses. A SW cache
// key is the request URL, but PostgREST authorises via the JWT + RLS rather
// than the URL, so that cache was shared across accounts and could replay one
// signed-in user's rows to another. The rule is gone from vite.config.ts; this
// purge frees devices that still hold the poisoned cache. Purely additive —
// losing the HTML/asset caches only costs a re-fetch.
(function purgeLegacyServiceWorkerCaches() {
  try {
    if (typeof caches === "undefined") return;
    void caches
      .keys()
      .then((names) => {
        for (const name of names) {
          const lower = name.toLowerCase();
          if (lower === "supabase-cache" || lower.includes("supabase")) {
            void caches.delete(name);
          }
        }
      })
      .catch(() => {});
  } catch {
    /* Cache API unavailable; nothing to purge */
  }
})();

// Activate error monitoring (Sentry when VITE_SENTRY_DSN is set; otherwise
// the listeners below still surface uncaught errors to the console + a
// best-effort localStorage ring buffer so crashes are diagnosable).
initErrorMonitoring();
// In-app ad & popup blocker (uBlock Origin + Popup Blocker Pro equivalents):
// blocks ad-network network requests/DOM injection and manages the strict
// popup shield that the media players auto-engage while open.
initAdBlocker();

// Begin connectivity tracking. This owns the "only offline when the link is
// actually gone" state and the session checkpoint that bounds offline resume
// to SESSION_CHECKPOINT_WINDOW_MS (30s) of genuine work in progress.
startConnectivity();

// Global unhandled-promise-rejection + window-error capture. These catch
// errors that escape React's render tree (async fetch failures, SW errors,
// third-party script errors) so they aren't silently lost. When Sentry is
// configured, initErrorMonitoring wires these into Sentry.captureException
// too; without Sentry we at least keep a rolling local log for debugging.
const ERROR_RING_BUFFER_KEY = "fuelpro_error_ring_buffer";
const MAX_RING_ENTRIES = 25;

function appendErrorRingBuffer(entry: {
  type: string;
  message: string;
  stack?: string | null;
  at: string;
}): void {
  try {
    const raw = localStorage.getItem(ERROR_RING_BUFFER_KEY);
    const list: unknown[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return;
    list.unshift(entry);
    while (list.length > MAX_RING_ENTRIES) list.pop();
    localStorage.setItem(ERROR_RING_BUFFER_KEY, JSON.stringify(list));
  } catch {
    /* storage may be full / unavailable; ignore */
  }
}

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    (reason instanceof Error && reason.message) ||
    (typeof reason === "string" && reason) ||
    "Unhandled promise rejection";
  console.error("[FuelPro] Unhandled promise rejection:", reason);
  appendErrorRingBuffer({
    type: "unhandledrejection",
    message,
    stack: reason instanceof Error ? reason.stack : null,
    at: new Date().toISOString(),
  });
  // Best-effort Sentry capture (no-op if Sentry isn't loaded/configured).
  import("@sentry/react")
    .then((Sentry) => Sentry.captureException(reason))
    .catch(() => {});
});

window.addEventListener("error", (event) => {
  const message = event.message || "Uncaught error";
  console.error("[FuelPro] Uncaught error:", event.error || message);
  appendErrorRingBuffer({
    type: "error",
    message,
    stack: event.error?.stack ?? null,
    at: new Date().toISOString(),
  });
  import("@sentry/react")
    .then((Sentry) => Sentry.captureException(event.error || message))
    .catch(() => {});
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
