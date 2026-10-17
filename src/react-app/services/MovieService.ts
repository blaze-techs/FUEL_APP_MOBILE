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
  /** TMDB id — required by the embed fallback providers (vidsrc/autoembed). */
  tmdbId?: number | null;
  /** IMDb id — secondary embed fallback key (2embed). */
  imdbId?: string | null;
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

const MOVIE_API_ORIGINS = [
  "",
  "https://fuel-app-mobile.pages.dev",
  "https://fuel-app-mobile.vercel.app",
];

function movieApiUrls(path: string): string[] {
  const currentOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const origins = [currentOrigin, ...MOVIE_API_ORIGINS]
    .filter(Boolean)
    .filter((origin, index, list) => list.indexOf(origin) === index);
  return origins.map((origin) => `${origin}${path}`);
}

async function getJson<T>(
  path: string,
  options: { forceFresh?: boolean; isUsable?: (data: T) => boolean } = {},
): Promise<T | null> {
  const cached = cache.get(path);
  if (!options.forceFresh && cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  for (const url of movieApiUrls(path)) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as T;
      if (options.isUsable && !options.isUsable(data)) continue;
      cache.set(path, { data, ts: Date.now() });
      return data;
    } catch {
      // Try the next production API origin. This makes the Movies tab
      // resilient when one deployment is stale/unavailable.
    }
  }
  return null;
}

/**
 * Bundled snapshot of the real movies/series catalog.
 *
 * The upstream (streamingunity) blocks datacenter egress, so the serverless
 * /api/movies proxy can return an empty catalog. This snapshot — captured from
 * the live upstream pages — lets the Movies/Series surface render the titles
 * that were there before even when the live proxy is empty. It is used ONLY as
 * a fallback: a successful live response always takes precedence, so the
 * catalog is never reduced by this file (purely additive).
 */
interface MovieSeedRaw {
  pool: (MovieItem & { g?: number[] })[];
  catalog: {
    sliders: { name: string; label: string; ids: number[] }[];
    genres: MovieGenre[];
  };
  browse: Record<string, { label: string; ids: number[] }>;
}

interface MovieSeed {
  catalog: MovieCatalog;
  browse: Record<string, { label: string | null; titles: MovieItem[] }>;
  allTitles: MovieItem[];
}

type MovieDetailEntry = {
  detail: MovieDetail;
  seasonsData?: Record<string, MovieDetail>;
};

let movieSeedPromise: Promise<MovieSeed | null> | null = null;
let movieDetailsPromise: Promise<Record<
  string,
  MovieDetailEntry
> | null> | null = null;

/**
 * Detail snapshot (plot, tmdb/imdb ids, seasons + episodes), fetched lazily
 * ONLY when a title is opened. Kept in a separate file from the catalog so the
 * Movies grid stays light; the tmdb id it carries is what makes playback work.
 */
function loadMovieDetails(): Promise<Record<string, MovieDetailEntry> | null> {
  if (movieDetailsPromise) return movieDetailsPromise;
  movieDetailsPromise = (async () => {
    try {
      const res = await fetch("/movies-details.json", { cache: "force-cache" });
      if (!res.ok) {
        movieDetailsPromise = null;
        return null;
      }
      return (await res.json()) as Record<string, MovieDetailEntry>;
    } catch {
      movieDetailsPromise = null;
      return null;
    }
  })();
  return movieDetailsPromise;
}

async function loadMovieSeed(): Promise<MovieSeed | null> {
  if (movieSeedPromise) return movieSeedPromise;
  movieSeedPromise = (async () => {
    try {
      const res = await fetch("/movies-seed.json", { cache: "force-cache" });
      if (!res.ok) {
        movieSeedPromise = null;
        return null;
      }
      const raw = (await res.json()) as MovieSeedRaw;
      const byId = new Map<number, MovieItem>();
      for (const t of raw.pool || []) {
        const { g: _g, ...item } = t;
        byId.set(item.id, item as MovieItem);
      }
      const pick = (ids: number[]): MovieItem[] =>
        (ids || []).map((id) => byId.get(id)).filter(Boolean) as MovieItem[];
      const catalog: MovieCatalog = {
        sliders: (raw.catalog?.sliders || []).map((s) => ({
          name: s.name,
          label: s.label,
          titles: pick(s.ids),
        })),
        genres: raw.catalog?.genres || [],
      };
      const browse: Record<
        string,
        { label: string | null; titles: MovieItem[] }
      > = {};
      for (const [key, val] of Object.entries(raw.browse || {})) {
        browse[key] = { label: val.label ?? null, titles: pick(val.ids) };
      }
      return { catalog, browse, allTitles: Array.from(byId.values()) };
    } catch {
      movieSeedPromise = null;
      return null;
    }
  })();
  return movieSeedPromise;
}

/**
 * The FULL catalogue snapshot (every harvested title + every genre's ids).
 *
 * The first-paint seed only carries the titles the home sliders reference
 * (~2k); this file carries the whole catalogue (~17k), which is what makes
 * search and genre browse exhaustive. It is fetched on demand (first search
 * or first genre tap) so it never slows the initial render, and it is purely
 * additive: a live response still wins whenever the proxy succeeds.
 */
interface FullCatalog {
  titles: MovieItem[];
  byId: Map<number, MovieItem>;
  genres: Record<string, { label: string; ids: number[] }>;
}

let fullCatalogPromise: Promise<FullCatalog | null> | null = null;

function loadFullCatalog(): Promise<FullCatalog | null> {
  if (fullCatalogPromise) return fullCatalogPromise;
  fullCatalogPromise = (async () => {
    try {
      const res = await fetch("/movies-catalog.json", { cache: "force-cache" });
      if (!res.ok) {
        fullCatalogPromise = null;
        return null;
      }
      const raw = (await res.json()) as {
        pool: MovieItem[];
        genres: Record<string, { label: string; ids: number[] }>;
      };
      const byId = new Map<number, MovieItem>();
      for (const t of raw.pool || []) byId.set(t.id, t);
      return { titles: raw.pool || [], byId, genres: raw.genres || {} };
    } catch {
      fullCatalogPromise = null;
      return null;
    }
  })();
  return fullCatalogPromise;
}

/** Genre id -> name, for the local genre-browse fallback. */
let genreNamesPromise: Promise<MovieGenre[]> | null = null;
function loadGenreNames(): Promise<MovieGenre[]> {
  if (!genreNamesPromise) {
    genreNamesPromise = (async () => {
      const seed = await loadMovieSeed();
      if (seed?.catalog.genres?.length) return seed.catalog.genres;
      const full = await loadFullCatalog();
      return full
        ? Object.values(full.genres).map((g, i) => ({
            id: i,
            name: g.label,
            type: "all" as const,
          }))
        : [];
    })();
  }
  return genreNamesPromise;
}

/**
 * Compact per-title playback ids for the WHOLE catalogue
 * ({ id: { tmdbId, imdbId, type, seasonsCount } }).
 *
 * The rich detail snapshot only covers the browsable first-paint set; this map
 * covers every harvested title so a movie opened from search or genre browse
 * still resolves the tmdb/imdb id the embed providers require.
 */
interface MovieIdsEntry {
  tmdbId: number | null;
  imdbId: string | null;
  type: "movie" | "tv";
  seasonsCount: number;
}
let movieIdsPromise: Promise<Record<string, MovieIdsEntry> | null> | null =
  null;
function loadMovieIds(): Promise<Record<string, MovieIdsEntry> | null> {
  if (movieIdsPromise) return movieIdsPromise;
  movieIdsPromise = (async () => {
    try {
      const res = await fetch("/movies-ids.json", { cache: "force-cache" });
      if (!res.ok) {
        movieIdsPromise = null;
        return null;
      }
      return (await res.json()) as Record<string, MovieIdsEntry>;
    } catch {
      movieIdsPromise = null;
      return null;
    }
  })();
  return movieIdsPromise;
}

/**
 * GLOBAL catalogue snapshot (`/movies-global.json`) — hundreds of thousands of
 * titles harvested from Wikidata, each carrying an IMDb id.
 *
 * streamingunity (the playable upstream) only carries ~17k titles, so it can
 * never represent "all movies". The embed providers, however, key on an IMDb /
 * TMDB id, which Wikidata supplies for essentially every notable film/series.
 * This is therefore the deepest layer of the catalogue: it makes search and
 * browse exhaustive while playback resolves through the same embed chain.
 *
 * On-disk form is compact rows `[imdb, name, year]` (movies and tv separate).
 * Ids are assigned NEGATIVE (movies from -1, tv from -1_000_001) so they can
 * never collide with an upstream (positive) id.
 */
interface GlobalCatalog {
  movies: MovieItem[];
  tv: MovieItem[];
  all: MovieItem[];
}

let globalCatalogPromise: Promise<GlobalCatalog | null> | null = null;

function globalRowToItem(
  row: [string, string, number | null, number | null],
  id: number,
  type: "movie" | "tv",
): MovieItem {
  return {
    id,
    slug: row[0],
    name: row[1],
    type,
    score: null,
    age: null,
    seasonsCount: 0,
    year: row[2] != null ? String(row[2]) : null,
    poster: null,
    cover: null,
    background: null,
    logo: null,
    tmdbId: row[3] != null ? row[3] : null,
    imdbId: row[0],
  };
}

function loadGlobalCatalog(): Promise<GlobalCatalog | null> {
  if (globalCatalogPromise) return globalCatalogPromise;
  globalCatalogPromise = (async () => {
    try {
      const res = await fetch("/movies-global.json", { cache: "force-cache" });
      if (!res.ok) {
        globalCatalogPromise = null;
        return null;
      }
      const raw = (await res.json()) as {
        movies: [string, string, number | null, number | null][];
        tv: [string, string, number | null, number | null][];
      };
      const movies = (raw.movies ?? []).map((r, i) =>
        globalRowToItem(r, -(i + 1), "movie"),
      );
      const tv = (raw.tv ?? []).map((r, i) =>
        globalRowToItem(r, -(1_000_001 + i), "tv"),
      );
      return { movies, tv, all: [...movies, ...tv] };
    } catch {
      globalCatalogPromise = null;
      return null;
    }
  })();
  return globalCatalogPromise;
}

/** Total titles in the global catalogue (0 until it loads). */
export async function fetchGlobalCatalogCount(): Promise<number> {
  const g = await loadGlobalCatalog();
  return g ? g.all.length : 0;
}

/**
 * TVMaze episode resolver.
 *
 * The bundled detail snapshot only carries episode lists for a minority of
 * series, and streamingunity is datacenter-blocked, so most series opened from
 * browse/search had a Season dropdown but NO episodes to pick — the user could
 * change the season yet never choose an episode. TVMaze is keyless, sends
 * `Access-Control-Allow-Origin: *`, and is keyed by IMDb id, so it fills that
 * gap for ANY series (tens of thousands of shows).
 *
 * Results are cached per show so switching seasons is instant after the first
 * load. Episode ids are TVMaze's (stable + unique), which is all the player
 * needs — it resolves the season/episode NUMBERS from this list.
 */
interface TvmazeEpisode {
  id: number;
  season: number;
  number: number | null;
  name: string | null;
  runtime: number | null;
  summary: string | null;
}

const tvmazeCache = new Map<string, TvmazeEpisode[]>();

async function fetchTvmazeEpisodes(
  imdbId: string | null | undefined,
): Promise<TvmazeEpisode[]> {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return [];
  const cached = tvmazeCache.get(imdbId);
  if (cached) return cached;
  try {
    // lookup follows a 301 to /shows/<id>; browsers follow it transparently.
    const showRes = await fetch(
      `https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`,
    );
    if (!showRes.ok) return [];
    const show = (await showRes.json()) as { id?: number } | null;
    if (!show?.id) return [];
    const epRes = await fetch(
      `https://api.tvmaze.com/shows/${show.id}/episodes`,
    );
    if (!epRes.ok) return [];
    const raw = (await epRes.json()) as TvmazeEpisode[];
    const eps = (raw || []).filter((e) => e.number != null);
    tvmazeCache.set(imdbId, eps);
    return eps;
  } catch {
    return [];
  }
}

/**
 * Merge a TVMaze episode list into a series detail for the requested season.
 * Keeps the detail's own metadata (poster, plot, ids) and only replaces the
 * season/episode structure, so a snapshot detail that lacks episodes becomes
 * fully navigable.
 */
function withTvmazeSeasons(
  detail: MovieDetail,
  eps: TvmazeEpisode[],
  season?: number,
): MovieDetail {
  const seasonNums = Array.from(new Set(eps.map((e) => e.season))).sort(
    (a, b) => a - b,
  );
  const target = season && seasonNums.includes(season) ? season : seasonNums[0];
  const forSeason = eps.filter((e) => e.season === target);
  return {
    ...detail,
    seasonsCount: seasonNums.length,
    seasons: seasonNums.map((n) => ({
      id: n,
      number: n,
      name: `Season ${n}`,
    })),
    loadedSeason: {
      id: target,
      number: target,
      episodes: forSeason.map((e) => ({
        id: e.id,
        number: e.number ?? 0,
        name: e.name,
        plot: e.summary ? e.summary.replace(/<[^>]+>/g, "") : null,
        duration: e.runtime,
        scwsId: 0,
        quality: null,
      })),
    },
  };
}

export async function fetchMovieCatalog(): Promise<MovieCatalog> {
  const path = `/api/movies?mode=catalog`;
  const data = await getJson<MovieCatalog>(path, {
    forceFresh: true,
    isUsable: (value) =>
      Array.isArray(value?.sliders) &&
      value.sliders.some(
        (slider) => Array.isArray(slider.titles) && slider.titles.length > 0,
      ),
  });
  if (data) return data;
  // Upstream (streamingunity) is datacenter-blocked for the serverless proxy,
  // so the live catalog can come back empty. Fall back to the bundled snapshot
  // of the real movies/series catalog so the Movies/Series surface ALWAYS
  // renders the titles that were there before — never an empty screen. The
  // live proxy still wins whenever it succeeds (purely additive fallback).
  const seed = await loadMovieSeed();
  return seed ? seed.catalog : { sliders: [], genres: [] };
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
  if (data && Array.isArray(data.titles) && data.titles.length > 0) return data;
  const seed = await loadMovieSeed();
  // Genre browse first: the harvested genre lists span the WHOLE catalogue
  // (up to the end of pagination), whereas a slider snapshot is only the first
  // few pages. Prefer the genre list when a genre was selected.
  if (genre != null) {
    const names = await loadGenreNames();
    const name = names.find((x) => x.id === genre)?.name;
    const full = await loadFullCatalog();
    const entry = name ? full?.genres?.[name] : undefined;
    if (entry) {
      const titles = entry.ids
        .map((id) => full?.byId.get(id))
        .filter(Boolean) as MovieItem[];
      return {
        label: entry.label ?? name ?? null,
        titles,
        count: titles.length,
      };
    }
  }
  const entry = seed?.browse?.[slider];
  if (entry) {
    return {
      label: entry.label ?? null,
      titles: entry.titles,
      count: entry.titles.length,
    };
  }
  return data ?? { label: null, titles: [], count: 0 };
}

/**
 * Browse the GLOBAL catalogue with paging (used by the "All titles" pill).
 * Returns a page of titles plus the total, so the UI can page without
 * mounting hundreds of thousands of cards at once.
 */
export async function browseGlobalTitles(
  offset = 0,
  limit = 120,
  type: "all" | "movie" | "tv" = "all",
): Promise<{ titles: MovieItem[]; total: number }> {
  const g = await loadGlobalCatalog();
  if (!g) return { titles: [], total: 0 };
  const list = type === "movie" ? g.movies : type === "tv" ? g.tv : g.all;
  return { titles: list.slice(offset, offset + limit), total: list.length };
}

/** Search movies by query. */
export async function searchMovies(q: string): Promise<MovieItem[]> {
  if (!q.trim()) return [];
  const data = await getJson<{ titles: MovieItem[]; count: number }>(
    `/api/movies?mode=search&q=${encodeURIComponent(q)}`,
  );
  const needle = q.trim().toLowerCase();
  const seen = new Set<string>();
  const out: MovieItem[] = [];
  const push = (list: MovieItem[]) => {
    for (const t of list) {
      if (!t?.name || !t.name.toLowerCase().includes(needle)) continue;
      const key = (t.imdbId || `id:${t.id}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  };
  // Live upstream results are authoritative but shallow (~17k). Merge in the
  // bundled snapshots so search is exhaustive — the GLOBAL catalogue first
  // (hundreds of thousands of titles), then the streamingunity full catalog,
  // then the first-paint seed.
  if (data && Array.isArray(data.titles)) push(data.titles);
  const global = await loadGlobalCatalog();
  if (global) push(global.all);
  const full = await loadFullCatalog();
  if (full) push(full.titles);
  if (out.length > 0) return out.slice(0, 300);
  const seed = await loadMovieSeed();
  if (!seed) return data?.titles ?? [];
  push(seed.allTitles);
  return out.slice(0, 300);
}

/** Fetch a movie's full detail (plot, actors, genres, scwsId, seasons). */
export async function fetchMovieDetail(
  id: number,
  slug: string,
  season?: number,
): Promise<MovieDetail | null> {
  const base = await fetchMovieDetailRaw(id, slug, season);
  if (!base) return null;
  // Series must ALWAYS expose a usable episode list. The upstream detail and
  // the bundled snapshot frequently carry seasons but no episodes, which left
  // the user able to change Season yet never pick an episode. TVMaze (keyless,
  // imdb-keyed, CORS-enabled) fills that gap for any series.
  if (base.type === "tv" && base.imdbId) {
    const hasEps = (base.loadedSeason?.episodes?.length ?? 0) > 0;
    if (!hasEps) {
      const eps = await fetchTvmazeEpisodes(base.imdbId);
      if (eps.length) return withTvmazeSeasons(base, eps, season);
    }
  }
  return base;
}

async function fetchMovieDetailRaw(
  id: number,
  slug: string,
  season?: number,
): Promise<MovieDetail | null> {
  const s = season && season >= 1 ? `&season=${season}` : "";
  const data = await getJson<{ title: MovieDetail | null }>(
    `/api/movies?mode=title&id=${id}&slug=${encodeURIComponent(slug)}${s}`,
  );
  if (data?.title) return data.title;
  // Live detail is datacenter-blocked upstream — fall back to the bundled
  // detail snapshot so playback can still resolve the tmdb/imdb ids the embed
  // providers need (and series still expose their seasons/episodes).
  const details = await loadMovieDetails();
  const fromSeed = details?.[String(id)];
  if (fromSeed) {
    return season && season >= 1
      ? (fromSeed.seasonsData?.[String(season)] ?? fromSeed.detail)
      : fromSeed.detail;
  }
  // Not in the rich snapshot (a title opened from search/genre browse) — build
  // a minimal detail from the full catalogue + compact id map so the embed
  // providers still get a tmdb/imdb id and the player does not dead-end.
  const ids = await loadMovieIds();
  const idEntry = ids?.[String(id)];
  // A negative id means the title came from the GLOBAL (Wikidata) catalogue,
  // which already carries its imdb id in `slug`.
  if (id < 0) {
    const global = await loadGlobalCatalog();
    const item = global?.all.find((t) => t.id === id);
    if (!item) return null;
    return {
      ...item,
      plot: null,
      runtime: null,
      releaseDate: null,
      scwsId: null,
      quality: null,
      genres: [],
      actors: [],
      directors: [],
      trailers: [],
      seasons: [],
      loadedSeason: null,
    } as MovieDetail;
  }
  const full = await loadFullCatalog();
  const item = full?.byId.get(id);
  if (!item && !idEntry) return null;
  const base = item ?? ({ id, slug } as MovieItem);
  return {
    ...(base as MovieItem),
    type: idEntry?.type ?? (base as MovieItem).type ?? "movie",
    seasonsCount:
      idEntry?.seasonsCount ?? (base as MovieItem).seasonsCount ?? 0,
    plot: null,
    runtime: null,
    releaseDate: null,
    scwsId: null,
    quality: null,
    tmdbId: idEntry?.tmdbId ?? (base as MovieItem).tmdbId ?? null,
    imdbId: idEntry?.imdbId ?? (base as MovieItem).imdbId ?? null,
    genres: [],
    actors: [],
    directors: [],
    trailers: [],
    seasons: [],
    loadedSeason: null,
  } as MovieDetail;
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
