/**
 * Cloudflare Pages Function — Movies API
 *
 * Reverse-engineered proxy for streamingunity.vip (a StreamingCommunity
 * mirror, an Inertia.js/Laravel SPA). Mirrors the Vercel handler in
 * api/movies.ts. The reverse-engineered contract (the public GET pages whose
 * HTML embeds an Inertia `data-page` JSON object) is captured inline here
 * because Cloudflare Pages Functions bundle each file independently (no
 * cross-file imports from api/_lib). Keep this in sync with
 * api/_lib/streamingunity.ts.
 *
 * Lives at functions/api/movies.ts → /api/movies
 *
 * GET /api/movies?mode=catalog
 * GET /api/movies?mode=browse&slider=trending|latest|top10[&genre=N]
 * GET /api/movies?mode=search&q=X
 * GET /api/movies?mode=title&id=429&slug=avatar
 * GET /api/movies?mode=player&id=429[&episode=9977]
 */

interface Env {}

const SU_BASE = "https://streamingunity.vip";
const SU_CDN = "https://cdn.streamingunity.vip";
const SU_LOCALE = "en";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300",
};

interface SuImage {
  filename: string;
  type: string;
  lang?: string | null;
}
interface SuTitle {
  id: number;
  slug: string;
  name: string;
  type: "movie" | "tv";
  score?: string;
  age?: number;
  seasons_count?: number;
  last_air_date?: string;
  release_date?: string;
  images?: SuImage[];
  plot?: string;
  runtime?: number | null;
  scws_id?: number | null;
  quality?: string;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  genres?: { id: number; name: string }[];
  main_actors?: { id: number; name: string }[];
  main_directors?: { id: number; name: string }[];
  trailers?: { youtube_id?: string; url?: string }[];
  seasons?: { id: number; number: number; name?: string | null }[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
}

/**
 * Keep only playable trailer YouTube ids. Upstream trailer ids are often
 * stale (private/deleted/embedding-disabled videos). YouTube's oEmbed
 * endpoint returns 200 only for public embeddable videos — a reliable
 * availability signal. Cached in-memory for 6h per isolate.
 */
const TRAILER_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const trailerCheckCache = new Map<string, { ok: boolean; at: number }>();

async function filterPlayableTrailers(
  ids: (string | undefined | null)[],
): Promise<string[]> {
  const clean = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (clean.length === 0) return [];
  const now = Date.now();
  const checks = await Promise.all(
    clean.map(async (id) => {
      const cached = trailerCheckCache.get(id);
      if (cached && now - cached.at < TRAILER_CHECK_TTL_MS) {
        return { id, ok: cached.ok };
      }
      let ok = false;
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`,
          {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; FuelPro/1.0)" },
            signal: AbortSignal.timeout(6000),
          },
        );
        ok = res.ok;
      } catch {
        ok = false;
      }
      trailerCheckCache.set(id, { ok, at: now });
      return { id, ok };
    }),
  );
  return checks.filter((c) => c.ok).map((c) => c.id);
}

/**
 * Find a playable YouTube trailer id by scraping the YouTube search results
 * page (no API key needed). Validates candidates through the oEmbed check so
 * the returned id is guaranteed public + embeddable.
 */
async function findYoutubeTrailerId(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const html = await res.text();
    const candidates = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)]
      .map((m) => m[1])
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
    const playable = await filterPlayableTrailers(candidates);
    return playable[0] ?? null;
  } catch {
    return null;
  }
}

function parseDataPage(html: string): any {
  const m = html.match(/data-page="([\s\S]*?)"/);
  if (!m) return null;
  const decoded = decodeEntities(m[1]);
  try {
    const end = decoded.lastIndexOf("}");
    return JSON.parse(decoded.slice(0, end + 1));
  } catch {
    return null;
  }
}

class UpstreamBlocked extends Error {}

async function viaVercelProxy(search: string): Promise<Response> {
  const r = await fetch(VERCEL_PROXY_BASE + search, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.ok ? 200 : r.status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const VERCEL_PROXY_BASE = "https://fuel-app-mobile.vercel.app/api/movies";

async function fetchSuPage(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${SU_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.status === 403) throw new UpstreamBlocked("cf-blocked");
  if (!res.ok) return null;
  return parseDataPage(await res.text());
}

function suImageUrl(filename?: string | null): string | null {
  return filename ? `${SU_CDN}/images/${filename}` : null;
}

function pickImage(images: SuImage[] | undefined, type: string): string | null {
  if (!images || images.length === 0) return null;
  return suImageUrl(images.find((i) => i.type === type)?.filename);
}

function playableOnly(titles: SuTitle[] | undefined): SuTitle[] {
  return (titles || []).filter(
    (t) => t && (t.type === "movie" || t.type === "tv"),
  );
}

function normalizeTitle(t: SuTitle) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    type: t.type,
    score: t.score ?? null,
    age: t.age ?? null,
    seasonsCount: t.seasons_count ?? 0,
    year: (t.last_air_date || t.release_date || "").slice(0, 4) || null,
    poster: pickImage(t.images, "poster"),
    cover: pickImage(t.images, "cover"),
    background: pickImage(t.images, "background"),
    logo: pickImage(t.images, "logo"),
  };
}

async function fetchSuPlayerUrl(
  id: string,
  episodeId?: string,
): Promise<string | null> {
  const ep = episodeId ? `?episode_id=${episodeId}` : "";
  const res = await fetch(`${SU_BASE}/${SU_LOCALE}/iframe/${id}${ep}`, {
    headers: { "User-Agent": UA, Referer: `${SU_BASE}/` },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/src="(https:\/\/vixcloud\.co\/embed\/[^"]+)"/);
  return m ? decodeEntities(m[1]) : null;
}

interface SuStreamInfo {
  playlistUrl: string;
  servers: { name: string; active: boolean; url: string }[];
  thumbnailsUrl: string | null;
  canPlayFHD: boolean;
}

/**
 * Reverse-engineered vixcloud stream info for NATIVE (hls.js) playback.
 * The vixcloud embed page is frame-ancestors-locked to the upstream site,
 * but its inline config exposes raw HLS playlist endpoints that are served
 * with Access-Control-Allow-Origin: * and no Referer check. Extracted
 * server-side so the client can play natively — no iframe, no CSP block.
 */
async function fetchSuStreamInfo(
  id: string,
  episodeId?: string,
): Promise<SuStreamInfo | null> {
  const embedUrl = await fetchSuPlayerUrl(id, episodeId);
  if (!embedUrl) return null;
  return fetchSuStreamInfoFromEmbed(embedUrl);
}

/**
 * Fetch + parse the vixcloud embed page given its (fresh, token-bearing) URL.
 * Cloudflare Workers are NOT blocked by vixcloud (unlike Vercel/AWS IPs), so
 * this is also the relay path used by the Vercel endpoint when its local
 * vixcloud fetch is blocked (403).
 */
async function fetchSuStreamInfoFromEmbed(
  embedUrl: string,
): Promise<SuStreamInfo | null> {
  const res = await fetch(embedUrl, {
    headers: { "User-Agent": UA, Referer: `${SU_BASE}/` },
  });
  if (!res.ok) return null;
  const html = await res.text();

  const streamsMatch = html.match(/window\.streams\s*=\s*(\[[\s\S]*?\]);/);
  let servers: SuStreamInfo["servers"] = [];
  try {
    if (streamsMatch) servers = JSON.parse(streamsMatch[1]);
  } catch {
    servers = [];
  }

  const mpMatch = html.match(/window\.masterPlaylist\s*=\s*\{([\s\S]*?)\}\s*;/);
  const mpBody = mpMatch?.[1] ?? "";
  const pick = (key: string): string => {
    // Keys may be quoted ('token': '...') or bare (url: '...').
    const m = mpBody.match(new RegExp(`['"]?${key}['"]?:\\s*'([^']*)'`));
    return m?.[1] ?? "";
  };
  const baseUrl = pick("url");
  const token = pick("token");
  const expires = pick("expires");
  const asn = pick("asn");

  const thumbMatch = html.match(/window\.thumbnailsUrl\s*=\s*'([^']+)'/);
  const fhdMatch = html.match(/window\.canPlayFHD\s*=\s*(true|false)/);

  const active = servers.find((s) => s.active) ?? servers[0];
  const rawUrl = active?.url || baseUrl;
  if (!rawUrl || !token) return null;
  const sep = rawUrl.includes("?") ? "&" : "?";
  // The upstream player appends h=1 when the embed allows Full HD.
  const playlistUrl =
    `${rawUrl}${sep}token=${encodeURIComponent(token)}` +
    `&expires=${encodeURIComponent(expires)}` +
    (asn ? `&asn=${encodeURIComponent(asn)}` : "") +
    (fhdMatch?.[1] === "true" ? "&h=1" : "");

  return {
    playlistUrl,
    servers,
    thumbnailsUrl: thumbMatch?.[1] ?? null,
    canPlayFHD: fhdMatch?.[1] === "true",
  };
}

// In-memory cache (per isolate, 5-min TTL). Player URLs are NOT cached.
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("mode") || "catalog";

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  try {
    if (mode === "player") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id", url: null }, 400);
      const playerUrl = await fetchSuPlayerUrl(
        id,
        url.searchParams.get("episode") || undefined,
      );
      if (playerUrl) return json({ url: playerUrl });
      // Direct fetch blocked/empty — fall back to the Vercel endpoint.
      return await viaVercelProxy(url.search);
    }

    // ---- STREAMS: raw HLS playlist info for native hls.js playback ----
    if (mode === "streams") {
      // Relay path: the Vercel endpoint passes a fresh, token-bearing embed
      // URL when its own vixcloud fetch is IP-blocked (403). Cloudflare
      // Workers are not blocked, so fetch vixcloud from here.
      const embedParam = url.searchParams.get("embed");
      if (embedParam) {
        const info = await fetchSuStreamInfoFromEmbed(embedParam);
        return json({ streams: info });
      }
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id", streams: null }, 400);
      try {
        const info = await fetchSuStreamInfo(
          id,
          url.searchParams.get("episode") || undefined,
        );
        if (info) return json({ streams: info });
      } catch (e) {
        if (e instanceof UpstreamBlocked) throw e;
      }
      // Direct fetch blocked/empty — fall back to the Vercel endpoint.
      return await viaVercelProxy(url.search);
    }

    // ?season=N loads that season's episodes into loadedSeason (the default
    // title page loads season 1). Used by the season selector in the UI.
    if (mode === "title") {
      const id = url.searchParams.get("id");
      const slug = url.searchParams.get("slug") || "";
      if (!id) return json({ error: "Missing id", title: null }, 400);
      const seasonNum = Number(url.searchParams.get("season"));
      const page = await fetchSuPage(
        Number.isInteger(seasonNum) && seasonNum >= 1
          ? `/${SU_LOCALE}/titles/${id}-${encodeURIComponent(slug)}/season-${seasonNum}`
          : `/${SU_LOCALE}/titles/${id}-${encodeURIComponent(slug)}`,
      );
      const t: SuTitle | undefined = page?.props?.title;
      if (!t) return json({ title: null });
      const loadedSeason = page?.props?.loadedSeason;
      return json({
        title: {
          ...normalizeTitle(t),
          plot: t.plot ?? null,
          runtime: t.runtime ?? null,
          releaseDate: t.release_date ?? null,
          scwsId: t.scws_id ?? null,
          quality: t.quality ?? null,
          tmdbId: t.tmdb_id ?? null,
          imdbId: t.imdb_id ?? null,
          genres: (t.genres || []).map((g) => ({ id: g.id, name: g.name })),
          actors: (t.main_actors || []).map((a) => a.name),
          directors: (t.main_directors || []).map((d) => d.name),
          trailers: await (async () => {
            const valid = await filterPlayableTrailers(
              (t.trailers || []).map((tr) => tr.youtube_id || tr.url),
            );
            if (valid.length > 0) return valid;
            // Upstream trailer ids are stale — find a real working trailer
            // via YouTube search so the preview always plays.
            const found = await findYoutubeTrailerId(
              `${t.name} ${t.last_air_date?.slice(0, 4) ?? ""} official trailer`,
            );
            return found ? [found] : [];
          })(),
          seasons: (t.seasons || []).map((s) => ({
            id: s.id,
            number: s.number,
            name: s.name ?? null,
          })),
          loadedSeason: loadedSeason
            ? {
                id: loadedSeason.id,
                number: loadedSeason.number,
                episodes: (loadedSeason.episodes || []).map((e: any) => ({
                  id: e.id,
                  number: e.number,
                  name: e.name ?? null,
                  plot: e.plot ?? null,
                  duration: e.duration ?? null,
                  scwsId: e.scws_id,
                  quality: e.quality ?? null,
                })),
              }
            : null,
        },
      });
    }

    const cacheKey = `${mode}|${url.searchParams.get("slider") || ""}|${url.searchParams.get("genre") || ""}|${url.searchParams.get("q") || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return json(cached.data);

    if (mode === "catalog") {
      const page = await fetchSuPage(`/${SU_LOCALE}`);
      const props = page?.props || {};
      const sliders = (props.sliders || []).map((s: any) => ({
        name: s.name,
        label: s.label,
        titles: playableOnly(s.titles).map(normalizeTitle),
      }));
      const genres = (props.genres || [])
        .filter(
          (g: any) => g.type === "movie" || g.type === "tv" || g.type === "all",
        )
        .map((g: any) => ({ id: g.id, name: g.name, type: g.type }));
      const payload = { sliders, genres };
      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return json(payload);
    }

    if (mode === "browse") {
      const slider = url.searchParams.get("slider") || "trending";
      const genre = url.searchParams.get("genre");
      const genreQ = genre ? `?genre=${encodeURIComponent(genre)}` : "";
      const page = await fetchSuPage(
        `/${SU_LOCALE}/browse/${encodeURIComponent(slider)}${genreQ}`,
      );
      const titles = playableOnly(page?.props?.titles).map(normalizeTitle);
      const payload = {
        label: page?.props?.label ?? null,
        titles,
        count: titles.length,
      };
      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return json(payload);
    }

    if (mode === "search") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) return json({ titles: [], count: 0 });
      const page = await fetchSuPage(
        `/${SU_LOCALE}/search?q=${encodeURIComponent(query)}`,
      );
      const titles = playableOnly(page?.props?.titles).map(normalizeTitle);
      const payload = { titles, count: titles.length };
      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return json(payload);
    }

    return json({ error: "Unknown mode", titles: [] }, 400);
  } catch (e) {
    if (e instanceof UpstreamBlocked) {
      // The origin blocks Cloudflare Workers (error 1106). Proxy the request
      // through the Vercel-hosted endpoint (Node runtime is allowed upstream).
      try {
        return await viaVercelProxy(url.search);
      } catch {
        return json({ error: "proxy failed" }, 502);
      }
    }
    return json({ error: "fetch failed", titles: [] });
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });
