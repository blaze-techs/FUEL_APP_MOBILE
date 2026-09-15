/**
 * Quenq Embed Proxy — Cloudflare Pages Function
 *
 * Serves a same-origin Ruffle player page for any of quenq.com's 1,316 arcade
 * games so the `VIDEO GAMES` tab can iframe it ad-free ("make quenq games
 * actually playable"). Same purpose as /api/quenq-embed (Vercel Edge).
 *
 * NOTE: Cloudflare Pages Functions bundle each file independently (no cross-file
 * imports from api/_lib), so the shared logic is inlined here. Keep in sync with
 * api/_lib/quenq-embed.ts.
 */

interface Env {}

const QUENQ_GAME_BASE = "https://quenq.com/arcade/data/games/";
const QUENQ_RUFFLE_CDN = "https://unpkg.com/@ruffle-rs/ruffle";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function buildRufflePage(slug: string, swfUrl: string): string {
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

async function resolveSwf(slug: string): Promise<string> {
  try {
    const res = await fetch(`${QUENQ_GAME_BASE}${slug}/`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (res.ok) {
      const html = await res.text();
      const m =
        html.match(/player\.load\(\s*["']([^"']+\.swf)["']/) ||
        html.match(/load\(\s*["']([^"']+\.swf)["']/);
      if (m) return m[1];
    }
  } catch {
    // fall through
  }
  return `${slug}.swf`;
}

async function serveQuenqEmbed(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // [api, quenq-embed, slug]
  const slug = (parts[2] || "").replace(/[^\w-]/g, "").slice(0, 120);
  if (!slug) return new Response("Bad slug", { status: 400 });

  const swf = await resolveSwf(slug);
  const swfUrl = `${QUENQ_GAME_BASE}${slug}/${encodeURIComponent(swf)}`;
  const html = buildRufflePage(slug, swfUrl);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, s-maxage=3600",
      // Same-origin framing (the app parent shares this host); blocks foreign
      // frames via a valid directive (no console warning) while overriding any
      // host-wide X-Frame-Options: DENY on this function.
      "X-Frame-Options": "SAMEORIGIN",
      ...CORS,
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  serveQuenqEmbed(context.request);

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
