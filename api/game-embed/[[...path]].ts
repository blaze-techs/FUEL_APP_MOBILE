/**
 * Game Embed Proxy — Vercel Edge
 *
 * Serves the raw, ad-free CrazyGames game build THROUGH our own origin so it
 * can be iframed (`VIDEO GAMES` tab). This is the "unblock embedding" piece for
 * crazygames.com.
 *
 * WHY: `games.crazygames.com/en_US/<slug>/index.html` is iframe-OK but injection
 * ~70 Google/GPT ad requests at runtime (GameFrame wrapper) — a hard NO-ADS
 * violation. The REAL game lives at `<slug>.game-files.crazygames.com/...`
 * (HTML5) or `files.crazygames.com` (Unity) and is AD-FREE (0 ad requests in a
 * headless-browser run), but it hotlink-protects (403 without a games.crazygames
 * Referer) and sends `X-Frame-Options: SAMEORIGIN`.
 *
 * Our mirror (same origin as this app):
 *   /api/game-embed/<slug>/<build>/<file>   → <slug>.game-files.crazygames.com/<slug>/<build>/<file>
 *   /api/game-embed/files/<path>            → files.crazygames.com/<path>
 *   /api/game-embed/raw?u=<url>             → pass-through for loose URLs
 *
 * The proxy adds the Referer, strips XFO/CSP, adds CORS, and rewrites absolute
 * *.crazygames.com asset URLs in HTML/JS back to the mirror — so no ad SDK ever
 * loads (raw builds have no GameFrame wrapper) and everything stays same-origin.
 */
import { serveGameEmbed } from "../_lib/crazygames-embed.js";

export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return serveGameEmbed(url.pathname, url.searchParams, {}, fetch);
}
