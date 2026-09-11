/**
 * MovieService — client-side service for the Movies sub-tab.
 *
 * Talks to the /api/movies reverse-engineered proxy (Vercel api/movies.ts +
 * Cloudflare functions/api/movies.ts), which fetches the streamingunity.vip
 * (StreamingCommunity mirror) catalog/search/title/player server-side and
 * returns clean normalized JSON. The client NEVER sees the upstream hostname.
 *
 * Uses a relative /api/movies path that works same-origin on both platforms.
 * Includes an in-memory cache + a background prefetch so the Movies sub-tab
 * renders instantly when the user opens it.
 */

export interface MovieItem {
  id: number;
  slug: string;
  name: string;
  type: "movie" | "tv";
  score: string | null;
  age: number | null;
  seasonsCount: number;
  year: string | null;
  poster: string | null;
  cover: string | null;
  background: string | null;
  logo: string | null;
}

export interface MovieSlider {
  name: string;
  label: string;
  titles: MovieItem[];
}

export interface MovieGenre {
  id: number;
  name: string;
  type: "movie" | "tv" | "all";
}

export interface MovieCatalog {
  sliders: MovieSlider[];
  genres: MovieGenre[];
}

export interface MovieEpisode {
  id: number;
  number: number;
  name: string | null;
  plot: string | null;
  duration: number | null;
  scwsId: number;
  quality: string | null;
}

export interface MovieDetail extends MovieItem {
  plot: string | null;
  runtime: number | null;
  releaseDate: string | null;
  scwsId: number | null;
  quality: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  genres: { id: number; name: string }[];
  actors: string[];
  directors: string[];
  trailers: string[];
  seasons: { id: number; number: number; name: string | null }[];
  loadedSeason: {
    id: number;
    number: number;
    episodes: MovieEpisode[];
  } | null;
}

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function getJson<T>(path: string): Promise<T | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data as T;
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cache.set(path, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/** Fetch the full movie catalog (home sliders + genres). */
export async function fetchMovieCatalog(): Promise<MovieCatalog> {
  const data = await getJson<MovieCatalog>(`/api/movies?mode=catalog`);
  return data ?? { sliders: [], genres: [] };
}

/** Fetch a full slider (trending | latest | top10), optionally genre-filtered. */
export async function fetchMovieBrowse(
  slider: string,
  genre?: number,
): Promise<{ label: string | null; titles: MovieItem[]; count: number }> {
  const g = genre ? `&genre=${genre}` : "";
  const data = await getJson<{
    label: string | null;
    titles: MovieItem[];
    count: number;
  }>(`/api/movies?mode=browse&slider=${encodeURIComponent(slider)}${g}`);
  return data ?? { label: null, titles: [], count: 0 };
}

/** Search movies by query. */
export async function searchMovies(q: string): Promise<MovieItem[]> {
  if (!q.trim()) return [];
  const data = await getJson<{ titles: MovieItem[]; count: number }>(
    `/api/movies?mode=search&q=${encodeURIComponent(q)}`,
  );
  return data?.titles ?? [];
}

/** Fetch a movie's full detail (plot, actors, genres, scwsId, seasons). */
export async function fetchMovieDetail(
  id: number,
  slug: string,
  season?: number,
): Promise<MovieDetail | null> {
  const s = season && season >= 1 ? `&season=${season}` : "";
  const data = await getJson<{ title: MovieDetail | null }>(
    `/api/movies?mode=title&id=${id}&slug=${encodeURIComponent(slug)}${s}`,
  );
  return data?.title ?? null;
}

/**
 * Fetch the fresh player iframe URL for a movie (or a TV episode).
 * The vixcloud token is time-limited, so this is always fetched fresh
 * (the proxy does not cache player URLs).
 */
export async function fetchMoviePlayerUrl(
  id: number,
  episodeId?: number,
): Promise<string | null> {
  const ep = episodeId ? `&episode=${episodeId}` : "";
  try {
    const res = await fetch(`/api/movies?mode=player&id=${id}${ep}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.url ?? null;
  } catch {
    return null;
  }
}

export interface MovieStreamInfo {
  playlistUrl: string;
  servers: { name: string; active: boolean; url: string }[];
  thumbnailsUrl: string | null;
  canPlayFHD: boolean;
}

// ---------------------------------------------------------------------------
// Classics source — public-domain full movies (no CORS / IP block, no ads).
// Always-playable fallback + extra catalog. Items carry the full playable
// URL so the player can use them directly.
// ---------------------------------------------------------------------------
export interface ClassicMovieItem {
  id: string; // classic:<identifier>
  identifier: string;
  name: string;
  type: "classic";
  year: string | null;
  poster: string; // always services/img/<id>
  plot: string | null;
  videoUrl: string | null;
  durationSec: number | null;
}

const CLASSICS_CACHE_TTL = 60 * 60 * 1000; // public-domain data changes rarely
const classicsCache = new Map<string, { data: unknown; ts: number }>();

async function getClassicJson<T>(url: string): Promise<T | null> {
  const c = classicsCache.get(url);
  if (c && Date.now() - c.ts < CLASSICS_CACHE_TTL) return c.data as T;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    classicsCache.set(url, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

const CLASSIC_COLLECTION = "feature_films";

/** Fetch the top public-domain classic films (curated by view count). */
export async function fetchClassicMovies(
  limit = 48,
): Promise<ClassicMovieItem[]> {
  const url =
    `https://archive.org/advancedsearch.php` +
    `?q=${encodeURIComponent(`mediatype:movies AND collection:${CLASSIC_COLLECTION} AND (language:eng OR language:english OR language:English)`)}` +
    `&fl[]=identifier,title,year,description` +
    `&rows=${limit}&page=1&output=json&sort[]=downloads desc`;
  const data = await getClassicJson<{ response?: { docs?: any[] } }>(url);
  const docs = data?.response?.docs ?? [];
  return docs.map((d) => ({
    id: `classic:${d.identifier}`,
    identifier: d.identifier,
    name: String(d.title ?? d.identifier),
    type: "classic",
    year: d.year ? String(d.year).slice(0, 4) : null,
    poster: `https://archive.org/services/img/${d.identifier}`,
    plot: typeof d.description === "string" ? d.description : null,
    videoUrl: null,
    durationSec: null,
  }));
}

/** Search public-domain classic films. */
export async function searchClassicMovies(
  q: string,
): Promise<ClassicMovieItem[]> {
  if (!q.trim()) return [];
  const url =
    `https://archive.org/advancedsearch.php` +
    `?q=${encodeURIComponent(`mediatype:movies AND collection:${CLASSIC_COLLECTION} AND (language:eng OR language:english OR language:English) AND title:(${q})`)}` +
    `&fl[]=identifier,title,year,description&rows=48&output=json`;
  const data = await getClassicJson<{ response?: { docs?: any[] } }>(url);
  const docs = data?.response?.docs ?? [];
  return docs.map((d) => ({
    id: `classic:${d.identifier}`,
    identifier: d.identifier,
    name: String(d.title ?? d.identifier),
    type: "classic",
    year: d.year ? String(d.year).slice(0, 4) : null,
    poster: `https://archive.org/services/img/${d.identifier}`,
    plot: typeof d.description === "string" ? d.description : null,
    videoUrl: null,
    durationSec: null,
  }));
}

/**
 * Fetch a classic film's playable mp4 URL + duration from the metadata API.
 * Prefers the 512kb progressive mp4 (small, reliable); falls back to any mp4.
 */
export async function fetchClassicDetail(
  identifier: string,
): Promise<ClassicMovieItem | null> {
  const url = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const data = await getClassicJson<{ files?: any[]; metadata?: any }>(url);
  if (!data) return null;
  const files = data.files ?? [];
  const vids = files.filter((f) =>
    String(f?.name ?? "")
      .toLowerCase()
      .endsWith(".mp4"),
  );
  const pick =
    vids.find((f) => /512kb/i.test(f?.name ?? "")) ??
    vids.find((f) => !/part|sample|trailer/i.test(f?.name ?? "")) ??
    vids[0];
  const videoUrl = pick
    ? `https://archive.org/download/${identifier}/${encodeURIComponent(
        pick.name,
      )}`
    : null;
  return {
    id: `classic:${identifier}`,
    identifier,
    name: String(data.metadata?.title ?? identifier),
    type: "classic",
    year: data.metadata?.year ? String(data.metadata.year).slice(0, 4) : null,
    poster: `https://archive.org/services/img/${identifier}`,
    plot:
      typeof data.metadata?.description === "string"
        ? data.metadata.description
        : null,
    videoUrl,
    durationSec: null,
  };
}

/**
 * Fetch the raw HLS playlist info for NATIVE (hls.js) playback.
 * The vixcloud iframe is frame-ancestors-locked to the upstream site, but
 * the HLS playlist/rendition/segment chain is CORS-open, so the client can
 * play the stream natively — no iframe, no ads, no CSP block. Always fetched
 * fresh (the playlist token is time-limited).
 */
export async function fetchMovieStreams(
  id: number,
  episodeId?: number,
): Promise<MovieStreamInfo | null> {
  const ep = episodeId ? `&episode=${episodeId}` : "";
  try {
    const res = await fetch(`/api/movies?mode=streams&id=${id}${ep}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.streams ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Background prefetch — warm the catalog cache so the Movies sub-tab renders
// instantly. Runs once per page load, ~3s after app boot, fire-and-forget.
// ---------------------------------------------------------------------------
let prefetchStarted = false;
export function prefetchMoviesInBackground(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;
  setTimeout(() => {
    void Promise.allSettled([
      fetchMovieCatalog(),
      fetchMovieBrowse("trending"),
      fetchMovieBrowse("latest"),
      fetchClassicMovies(),
    ]);
  }, 3000);
}
