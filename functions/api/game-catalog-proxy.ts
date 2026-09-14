/**
 * Game Catalog Proxy — Cloudflare Pages Function
 *
 * Same purpose as /api/game-catalog-proxy.ts (Vercel): reverse-engineered
 * catalog access to crazygames.com for the "VIDEO GAMES" tab.
 *
 * CrazyGames' game pages send X-Frame-Options: SAMEORIGIN and their category
 * pages send no Access-Control-Allow-Origin, so the browser can't embed or
 * scrape them directly. BUT the real game builds at
 *   https://games.crazygames.com/en_US/<slug>/index.html
 * are clean (200, no XFO/CSP, zero ad-SDK refs) — verified live 2026-09-15.
 *
 * This function fetches the category page server-side (where no JS runs),
 * pulls the embedded __NEXT_DATA__ JSON, and returns a clean typed catalog
 * with CORS. The client iframes embedUrl (games.crazygames.com) directly.
 *
 * NOTE: Cloudflare Pages Functions bundle each file independently (no
 * cross-file imports from api/_lib), so the parser is inlined here. Keep in
 * sync with api/_lib/crazygames-catalog.ts + api/game-catalog-proxy.ts.
 *
 * Lives at functions/api/game-catalog-proxy.ts -> /api/game-catalog-proxy
 * on Cloudflare Pages (same-origin as the SPA).
 *
 * GET /api/game-catalog-proxy?cat=<category>&page=<n>
 */

interface Env {
  // Cloudflare bindings (none needed for this function)
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CRAZYGAMES_CATALOG = "https://www.crazygames.com/c";
const CRAZYGAMES_EMBED = "https://games.crazygames.com/en_US";
const CRAZYGAMES_IMGS = "https://imgs.crazygames.com";

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

function crazygamesEmbedUrl(slug: string): string {
  return `${CRAZYGAMES_EMBED}/${encodeURIComponent(slug)}/index.html`;
}

function crazygamesCoverUrl(cover: string): string {
  if (!cover) return "";
  const path = cover.replace(/^\//, "");
  return `${CRAZYGAMES_IMGS}/${path}?format=auto&quality=70&metadata=none`;
}

function sanitizeText(v: unknown, max = 120): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function parseCrazygamesCatalog(html: string) {
  const m = html.match(NEXT_DATA_RE);
  if (!m) return { games: [], total: 0, page: 1, size: 0 };
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { games: [], total: 0, page: 1, size: 0 };
  }
  const games = data?.props?.pageProps?.games;
  if (!games || !Array.isArray(games.items)) {
    return { games: [], total: 0, page: 1, size: 0 };
  }
  const out = games.items
    .filter((it: any) => it && it.slug && it.name)
    .map((it: any) => ({
      id: sanitizeText(it.id, 40),
      name: sanitizeText(it.name),
      slug: sanitizeText(it.slug, 80),
      cover: sanitizeText(it.cover, 200),
      coverUrl: crazygamesCoverUrl(it.cover || ""),
      embedUrl: crazygamesEmbedUrl(String(it.slug)),
      plays: typeof it.totalPlays === "number" ? it.totalPlays : 0,
      year: typeof it.releaseYear === "number" ? it.releaseYear : undefined,
      category: sanitizeText(it.categoryName, 60),
      mobile: Boolean(it.mobileFriendly),
    }));
  return {
    games: out,
    total: typeof games.total === "number" ? games.total : out.length,
    page: games.pagination?.page ?? 1,
    size: games.pagination?.size ?? out.length,
  };
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
      ...CORS_HEADERS,
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const cat = (url.searchParams.get("cat") || "action")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const pageRaw = url.searchParams.get("page") || "1";
  const page = Math.max(1, Math.min(2000, parseInt(pageRaw, 10) || 1));

  if (!cat) return json({ error: "Missing 'cat' parameter" }, 400);

  try {
    const upstream = await fetch(`${CRAZYGAMES_CATALOG}/${cat}/?page=${page}`, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return json(
        { error: `CrazyGames returned HTTP ${upstream.status}` },
        upstream.status === 404 ? 404 : 502,
      );
    }
    const html = await upstream.text();
    const parsed = parseCrazygamesCatalog(html);
    if (!parsed.games.length) {
      return json({ error: "No games parsed" }, 502);
    }
    return json(
      {
        source: "crazygames",
        category: cat,
        ...parsed,
        fetchedAt: Date.now(),
      },
      200,
      { "Cache-Control": "public, max-age=600, s-maxage=900" },
    );
  } catch (e) {
    return json({ error: String(e).slice(0, 160) }, 502);
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
