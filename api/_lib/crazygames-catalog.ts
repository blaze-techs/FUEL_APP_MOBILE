/**
 * CrazyGames catalog parsing + URL builders — shared by the Vercel route
 * (/api/game-catalog-proxy) and the Cloudflare Pages function
 * (functions/api/game-catalog-proxy). Kept dependency-free so vitest can
 * import it directly (see src/test/game-catalog-proxy.test.ts).
 *
 * Reverse-engineered 2026-09-15:
 *   The game pages send X-Frame-Options: SAMEORIGIN and category pages send
 *   no CORS headers, so a browser can't embed/scrape them directly. BUT the
 *   real game builds at
 *     https://games.crazygames.com/en_US/<slug>/index.html
 *   are clean (HTTP 200, no XFO, no CSP frame-ancestors, zero ad-SDK refs in
 *   the loader shell — verified live). CrazyGames' own /embed/<slug> simply
 *   redirects there. So we serve OUR OWN catalog (parsed server-side from
 *   the __NEXT_DATA__ blob) and the client iframes the clean build directly.
 */

export interface CrazyGamesCatalogItem {
  id: string;
  name: string;
  slug: string;
  cover: string;
  /** Direct clean loader URL (games.crazygames.com). */
  embedUrl: string;
  /** Cover art URL (imgs.crazygames.com, verified 200). */
  coverUrl: string;
  plays: number;
  year?: number;
  category: string;
  mobile: boolean;
}

export interface CrazyGamesCatalogResult {
  games: CrazyGamesCatalogItem[];
  total: number;
  page: number;
  size: number;
}

export const CRAZYGAMES_CATALOG = "https://www.crazygames.com/c";
export const CRAZYGAMES_EMBED = "https://games.crazygames.com/en_US";
export const CRAZYGAMES_IMGS = "https://imgs.crazygames.com";

export const CRAZYGAMES_NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

export function crazygamesEmbedUrl(slug: string): string {
  return `${CRAZYGAMES_EMBED}/${encodeURIComponent(slug)}/index.html`;
}

export function crazygamesCoverUrl(cover: string): string {
  if (!cover) return "";
  const path = cover.replace(/^\//, "");
  return `${CRAZYGAMES_IMGS}/${path}?format=auto&quality=70&metadata=none`;
}

function sanitizeText(v: unknown, max = 120): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Extract the CrazyGames catalog from a category page's embedded
 * __NEXT_DATA__ blob (props.pageProps.games.{items,total,pagination}).
 */
export function parseCrazygamesCatalog(html: string): CrazyGamesCatalogResult {
  const empty: CrazyGamesCatalogResult = {
    games: [],
    total: 0,
    page: 1,
    size: 0,
  };
  const m = html.match(CRAZYGAMES_NEXT_DATA_RE);
  if (!m) return empty;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return empty;
  }
  const games = data?.props?.pageProps?.games;
  if (!games || !Array.isArray(games.items)) return empty;
  const out: CrazyGamesCatalogItem[] = games.items
    .filter((it: any) => it && it.slug && it.name)
    .map((it: any) => ({
      id: sanitizeText(it.id, 40),
      name: sanitizeText(it.name),
      slug: sanitizeText(it.slug, 80),
      cover: sanitizeText(it.cover, 200),
      embedUrl: crazygamesEmbedUrl(String(it.slug)),
      coverUrl: crazygamesCoverUrl(it.cover || ""),
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

/** Fetch + parse one CrazyGames category page server-side. */
export async function fetchCrazygamesPage(
  category: string,
  page: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; data: CrazyGamesCatalogResult }> {
  const cat = (category || "action").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const safePage = Math.max(1, Math.min(2000, page || 1));
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  try {
    const res = await fetchImpl(
      `${CRAZYGAMES_CATALOG}/${cat}/?page=${safePage}`,
      {
        headers: {
          "User-Agent": UA,
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: { games: [], total: 0, page: safePage, size: 0 },
      };
    }
    const html = await res.text();
    return { ok: true, status: 200, data: parseCrazygamesCatalog(html) };
  } catch {
    return {
      ok: false,
      status: 502,
      data: { games: [], total: 0, page: safePage, size: 0 },
    };
  }
}
