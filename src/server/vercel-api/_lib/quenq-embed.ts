/**
 * Quenq arcade — same-origin Ruffle player for all 1,316 quenq.com arcade
 * games. Shared by the Vercel route (/api/quenq-embed) and the Cloudflare
 * Pages function (functions/api/quenq-embed). Dependency-free for vitest.
 *
 * Why a mirror player at all?
 *   A quenq arcade game is a tiny HTML shell that loads Ruffle from unpkg and
 *   plays <slug>.swf (served with CORS `*`, no ads). If we iframe that page
 *   DIRECTLY (cross-origin) Ruffle's canvas often never attaches (verified in
 *   a headless browser; Ruffle initializes but no canvas appears). When the
 *   same shell is served FROM OUR OWN origin (same-origin as the app parent)
 *   Ruffle reliably creates its WebGL canvas.
 *
 * So this route serves a self-contained Ruffle player page from our origin:
 *     /api/quenq-embed/<slug>
 *   → (server-side) resolve the real swf filename from quenq's shell
 *   → return an inline HTML page that loads Ruffle from unpkg and plays the
 *     swf directly from quenq (CORS `*`, no proxy of game bytes, no ads).
 *
 * The iframe's src is our origin → same-origin parent + frame → canvas renders.
 */

export const QUENQ_GAME_BASE = "https://quenq.com/arcade/data/games/";
export const QUENQ_RUFFLE_CDN = "https://unpkg.com/@ruffle-rs/ruffle";
const GAME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Freshness for a slug→swf resolution (the filename is stable). */
const SWF_CACHE_TTL = 60 * 60 * 1000;
const swfCache = new Map<string, { swf: string; url: string; ts: number }>();

/**
 * Build a self-contained, ad-free Ruffle player page. `swfUrl` is the absolute
 * quenq swf URL (CORS `*` — the browser fetches it cross-origin without XFO
 * because it's loaded via Ruffle's net downloader, not via an iframe).
 */
export function buildRufflePage(slug: string, swfUrl: string): string {
  const safeSlug = slug.replace(/[^\w-]/g, "").slice(0, 120);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
      ruffle-player { width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <script src="${QUENQ_RUFFLE_CDN}"></script>
    <script>
      window.__QUENQ_SLUG__ = ${JSON.stringify(safeSlug)};
      window.__QUENQ_SWF__ = ${JSON.stringify(swfUrl)};
      function boot() {
        try {
          if (!window.RufflePlayer || !window.RufflePlayer.newest) {
            return setTimeout(boot, 150);
          }
          var player = window.RufflePlayer.newest().createPlayer();
          player.config = { autoplay: "on", backgroundColor: "#000000", letterbox: "on", unflattenOnFocus: false };
          player.style.width = "100%";
          player.style.height = "100%";
          document.body.appendChild(player);
          player.load(window.__QUENQ_SWF__);
        } catch (e) {
          console.error("quenq ruffle boot failed", e);
        }
      }
      if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", boot);
      } else {
        boot();
      }
    </script>
  </body>
</html>`;
}

/** Resolve the actual swf filename for a quenq arcade game (cached). */
async function resolveSwf(
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now();
  const hit = swfCache.get(slug);
  if (hit && now - hit.ts < SWF_CACHE_TTL) return hit.swf;

  let swf: string | null = null;
  try {
    const res = await fetchImpl(`${QUENQ_GAME_BASE}${slug}/`, {
      headers: { "User-Agent": GAME_UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (res.ok) {
      const html = await res.text();
      // player.load("8-ball-pool.swf")
      const m =
        html.match(/player\.load\(\s*["']([^"']+\.swf)["']/) ||
        html.match(/load\(\s*["']([^"']+\.swf)["']/);
      if (m) swf = m[1];
    }
  } catch {
    swf = null;
  }

  const resolved = swf || `${slug}.swf`;
  swfCache.set(slug, { swf: resolved, url: "", ts: now });
  return resolved;
}

/**
 * Serve /api/quenq-embed/<slug> — a same-origin Ruffle player page that plays
 * the quenq swf ad-free. No XFO, permissive CORS.
 */
export async function serveQuenqEmbed(
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const safeSlug = slug.replace(/[^\w-]/g, "").slice(0, 120);
  if (!safeSlug) {
    return new Response("Bad slug", { status: 400 });
  }
  const swf = await resolveSwf(safeSlug, fetchImpl);
  const swfUrl = `${QUENQ_GAME_BASE}${safeSlug}/${encodeURIComponent(swf)}`;
  const html = buildRufflePage(safeSlug, swfUrl);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, s-maxage=3600",
      // Same-origin framing (the app parent shares this host); blocks foreign
      // frames. This overrides any host-wide XFO DENY rule for this function.
      "X-Frame-Options": "SAMEORIGIN",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
