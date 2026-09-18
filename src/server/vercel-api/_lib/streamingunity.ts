/**
 * Reverse-engineered streamingunity.vip (StreamingCommunity mirror) contract.
 *
 * The site is an Inertia.js (Laravel) SPA. Every GET page returns an HTML
 * document whose root element carries a `data-page` attribute containing the
 * full Inertia page object as HTML-entity-encoded JSON. That is the whole
 * "API" — there is no public JSON REST endpoint that works without a session
 * (the api/* routes require POST + CSRF token), so the server-side proxy
 * simply GETs the public pages and parses the embedded `data-page` JSON.
 *
 * Reverse-engineered route map (from the injected Ziggy route table):
 *   catalog  GET /en                                  -> Home/Home   (sliders + genres)
 *   browse   GET /en/browse/{slider}[?genre=N]        -> Titles/Browse
 *   search   GET /en/search?q=X                       -> Titles/Browse
 *   title    GET /en/titles/{id}-{slug}               -> Titles/Title (movie scws_id | tv loadedSeason.episodes[].scws_id)
 *   season   GET /en/titles/{id}-{slug}/season-{num}  -> Titles/Title
 *   player   GET /en/iframe/{id}[?episode_id=N]       -> HTML with <iframe src="https://vixcloud.co/embed/{scws_id}?token=...">
 *
 * Image CDN: https://cdn.streamingunity.vip/images/{filename}
 * Video CDN: https://vixcloud.co/embed/{scws_id}?token=... (time-limited token,
 *            must be fetched fresh per play via the /en/iframe route).
 */

export const SU_BASE = "https://streamingunity.vip";
export const SU_CDN = "https://cdn.streamingunity.vip";
export const SU_LOCALE = "en";

export interface SuImage {
  filename: string;
  type: "poster" | "cover" | "background" | "logo" | "cover_mobile" | string;
  lang?: string | null;
}

export interface SuTitle {
  id: number;
  slug: string;
  name: string;
  type: "movie" | "tv";
  score?: string;
  age?: number;
  seasons_count?: number;
  last_air_date?: string;
  images?: SuImage[];
  plot?: string;
  runtime?: number | null;
  release_date?: string;
  scws_id?: number | null;
  quality?: string;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  genres?: SuGenre[];
  main_actors?: SuPerson[];
  main_directors?: SuPerson[];
  trailers?: SuTrailer[];
  seasons?: SuSeason[];
  keywords?: string[];
}

export interface SuGenre {
  id: number;
  name: string;
  type: "movie" | "tv" | "all";
}

export interface SuPerson {
  id: number;
  name: string;
}

export interface SuTrailer {
  id?: number;
  youtube_id?: string;
  url?: string;
}

export interface SuEpisode {
  id: number;
  number: number;
  name?: string;
  plot?: string;
  duration?: number;
  scws_id: number;
  season_id: number;
  quality?: string;
}

export interface SuSeason {
  id: number;
  number: number;
  name?: string | null;
  plot?: string;
  title_id: number;
  episodes?: SuEpisode[];
}

export interface SuSlider {
  name: string;
  label: string;
  titles: SuTitle[];
}

export interface SuCatalog {
  sliders: SuSlider[];
  genres: SuGenre[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Fetch a streamingunity page and return the decoded Inertia page object. */
export async function fetchSuPage(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${SU_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  return parseDataPage(html);
}

/** Extract + decode the Inertia `data-page` JSON from an HTML document. */
export function parseDataPage(html: string): any {
  const m = html.match(/data-page="([\s\S]*?)"/);
  if (!m) return null;
  const decoded = decodeEntities(m[1]);
  try {
    // The attribute value ends at the closing quote; trim any trailing junk.
    const end = decoded.lastIndexOf("}");
    return JSON.parse(decoded.slice(0, end + 1));
  } catch {
    return null;
  }
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

/** Build the public image URL for a title image. */
export function suImageUrl(filename?: string | null): string | null {
  if (!filename) return null;
  return `${SU_CDN}/images/${filename}`;
}

/** Pick the best image of a given type from a title's images array. */
export function pickImage(
  images: SuImage[] | undefined,
  type: string,
): string | null {
  if (!images || images.length === 0) return null;
  const found = images.find((i) => i.type === type);
  return suImageUrl(found?.filename);
}

/** The three home sliders (trending/latest/top10) — the movie catalog. */
export function suSliderPath(slider: string): string {
  return `/${SU_LOCALE}/browse/${encodeURIComponent(slider)}`;
}

export function suSearchPath(q: string): string {
  return `/${SU_LOCALE}/search?q=${encodeURIComponent(q)}`;
}

export function suTitlePath(id: number | string, slug: string): string {
  return `/${SU_LOCALE}/titles/${id}-${encodeURIComponent(slug)}`;
}

export function suSeasonPath(
  id: number | string,
  slug: string,
  num: number,
): string {
  return `/${SU_LOCALE}/titles/${id}-${encodeURIComponent(slug)}/season-${num}`;
}

export function suIframePath(
  id: number | string,
  episodeId?: number | string,
): string {
  const ep = episodeId ? `?episode_id=${episodeId}` : "";
  return `/${SU_LOCALE}/iframe/${id}${ep}`;
}

/**
 * Fetch the player iframe route and extract the vixcloud embed URL.
 * The iframe route returns a tiny HTML page whose <iframe src> is the
 * token-bearing vixcloud player URL. That URL is what the client iframes.
 */
export async function fetchSuPlayerUrl(
  id: number | string,
  episodeId?: number | string,
): Promise<string | null> {
  const res = await fetch(`${SU_BASE}${suIframePath(id, episodeId)}`, {
    headers: { "User-Agent": UA, Referer: `${SU_BASE}/` },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/src="(https:\/\/vixcloud\.co\/embed\/[^"]+)"/);
  if (!m) return null;
  return decodeEntities(m[1]);
}

/**
 * Reverse-engineered vixcloud stream info for NATIVE (hls.js) playback.
 *
 * The vixcloud embed page (https://vixcloud.co/embed/{scws_id}?token=...)
 * carries a dynamic `Content-Security-Policy: frame-ancestors` header that
 * only allows framing from the upstream site itself, so iframing it from our
 * domain is blocked. BUT the page's inline config exposes the raw HLS
 * playlist endpoints, and the entire playlist/rendition/segment chain is
 * served with `Access-Control-Allow-Origin: *` and no Referer check. So the
 * client can play the stream natively with hls.js — no iframe, no ads, no
 * analytics, no CSP block.
 *
 * This function extracts that config server-side:
 *   window.video          -> { id, filename }
 *   window.streams        -> [{ name, active, url }] (Server1/Server2 playlist URLs)
 *   window.masterPlaylist -> { params: { token, expires, asn }, url }
 *   window.thumbnailsUrl  -> storyboard sprite (seek preview)
 *   window.canPlayFHD     -> boolean
 */
export interface SuStreamInfo {
  playlistUrl: string;
  servers: { name: string; active: boolean; url: string }[];
  thumbnailsUrl: string | null;
  canPlayFHD: boolean;
  embedUrl: string | null;
}

export async function fetchSuStreamInfo(
  id: number | string,
  episodeId?: number | string,
  debug?: Record<string, unknown>,
): Promise<SuStreamInfo | null> {
  const embedUrl = await fetchSuPlayerUrl(id, episodeId);
  if (debug) {
    debug.embedUrlFound = Boolean(embedUrl);
    debug.embedUrl = embedUrl;
  }
  if (!embedUrl) return null;
  return fetchSuStreamInfoFromEmbed(embedUrl, debug);
}

/**
 * Fetch + parse the vixcloud embed page given its (fresh, token-bearing) URL.
 * Split from fetchSuStreamInfo so callers that already hold the embed URL
 * (e.g. the Cloudflare relay) can skip the upstream iframe fetch.
 *
 * NOTE: vixcloud.co blocks some serverless IP ranges (Vercel/AWS -> 403) but
 * allows Cloudflare Workers. Callers on a blocked platform should relay the
 * embed URL to a non-blocked platform's endpoint.
 */
export async function fetchSuStreamInfoFromEmbed(
  embedUrl: string,
  debug?: Record<string, unknown>,
): Promise<SuStreamInfo | null> {
  const res = await fetch(embedUrl, {
    headers: { "User-Agent": UA, Referer: `${SU_BASE}/` },
  });
  if (debug) debug.embedStatus = res.status;
  if (!res.ok) return null;
  const html = await res.text();
  if (debug) {
    debug.embedLen = html.length;
    debug.hasStreams = /window\.streams\s*=/.test(html);
    debug.hasMaster = /window\.masterPlaylist\s*=/.test(html);
  }

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

  // Prefer the active server URL; fall back to the masterPlaylist base url.
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
    embedUrl,
  };
}

/** Movie genre ids -> labels (type "movie" or "all", from the live catalog). */
export const SU_MOVIE_GENRES: Record<number, string> = {
  4: "Action",
  11: "Adventure",
  19: "Animation",
  12: "Comedy",
  2: "Crime",
  24: "Documentary",
  1: "Drama",
  16: "Family",
  8: "Fantasy",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

/** Filter a title list to movies only (type === "movie"). */
export function moviesOnly(titles: SuTitle[] | undefined): SuTitle[] {
  return (titles || []).filter((t) => t && t.type === "movie");
}

/**
 * Keep every playable title — movies AND TV (series / TV shows / limited
 * series all arrive with type "tv"). Per the product requirement, the Movies
 * sub-tab must not be limited to movies only.
 */
export function playableOnly(titles: SuTitle[] | undefined): SuTitle[] {
  return (titles || []).filter(
    (t) => t && (t.type === "movie" || t.type === "tv"),
  );
}

/**
 * Validate trailer YouTube ids and keep only playable ones.
 *
 * The upstream trailer ids are frequently stale — they point at private,
 * deleted, or embedding-disabled YouTube videos (the player then shows
 * "This video is private" / "Video unavailable"). YouTube's oEmbed endpoint
 * returns HTTP 200 only for PUBLIC, embeddable videos (401/403/404
 * otherwise), which is a reliable availability signal.
 *
 * Results are cached in-memory for 6h per serverless instance so the extra
 * oEmbed round-trips only happen once per video id.
 */
const TRAILER_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const trailerCheckCache = new Map<string, { ok: boolean; at: number }>();

export async function filterPlayableTrailers(
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
 * page (no API key needed). Extracts candidate video ids from the embedded
 * ytInitialData JSON, then validates them through the oEmbed check so the
 * returned id is guaranteed public + embeddable. Returns null when nothing
 * playable is found.
 */
export async function findYoutubeTrailerId(
  query: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
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
