/**
 * Game Catalog Proxy — Vercel serverless
 *
 * Reverse-engineered catalog + embed access for crazygames.com (the "VIDEO
 * GAMES" tab's pure-web, no-ads source).
 *
 * WHY this exists:
 *   - The crazygames GAME pages (www.crazygames.com/game/<slug>) send
 *     `X-Frame-Options: SAMEORIGIN` and need a click-through, and their
 *     `www.crazygames.com/c/<cat>/` pages send NO Access-Control-Allow-Origin
 *     — so a normal browser can neither embed nor scrape them.
 *   - BUT the games' ACTUAL builds live at
 *         https://games.crazygames.com/en_US/<slug>/index.html
 *     which (verified live) returns HTTP 200 with NO X-Frame-Options, NO
 *     CSP frame-ancestors, and ZERO ad-SDK references in the loader shell.
 *     It's the exact target CrazyGames' own `/embed/<slug>` redirects to.
 *
 * So this endpoint:
 *   GET /api/game-catalog-proxy?cat=<category>&page=<n>
 *     -> fetches https://www.crazygames.com/c/<cat>/?page=<n>, extracts the
 *        embedded __NEXT_DATA__ JSON (games.items[], games.total,
 *        games.pagination), and returns a clean, typed list:
 *        [{ id, name, slug, cover, coverUrl, embedUrl, plays, year }]
 *        with CORS + caching. The client NEVER hits CrazyGames directly.
 *
 * Categories verified (2026-09-15): action (719), puzzle (665), racing,
 * shooting (215), io (120), … — thousands of no-ads browser games total.
 *
 * Embeds: the client iframes `embedUrl` directly (games.crazygames.com is
 * clean, no ad SDKs, no XFO/CSP). No upstream branding is surfaced.
 */
import { fetchCrazygamesPage } from "./_lib/crazygames-catalog.js";

// Run as a Vercel EDGE Function (not a Node Serverless Function): the Edge
// runtime is a separate quota from Vercel's Hobby-plan cap of 12 Node
// serverless functions per deployment. This endpoint uses only Web APIs
// (Request/Response/fetch/URLSearchParams) so it runs natively on Edge.
export const config = { runtime: "edge" };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** Generic JSON response helper. */
function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
      ...CORS_HEADERS,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cat = (url.searchParams.get("cat") || "action")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const page = Math.max(
    1,
    Math.min(2000, parseInt(url.searchParams.get("page") || "1", 10) || 1),
  );

  if (!cat) {
    return json({ error: "Missing 'cat' parameter" }, 400);
  }

  const { ok, status, data } = await fetchCrazygamesPage(cat, page);
  if (!ok) {
    return json(
      {
        error:
          status === 404 ? "Category not found" : "CrazyGames fetch failed",
      },
      status === 404 ? 404 : 502,
    );
  }
  if (!data.games.length) {
    return json({ error: "No games parsed" }, 502);
  }
  return json(
    {
      source: "crazygames",
      category: cat,
      ...data,
      fetchedAt: Date.now(),
    },
    200,
    { "Cache-Control": "public, max-age=600, s-maxage=900" },
  );
}
