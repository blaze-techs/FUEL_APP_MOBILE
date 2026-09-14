/**
 * GameCatalogService — client-side service for the Video Games tab.
 *
 * Reverse-engineered quenq.com (a Kongregate-style Flash/HTML5 arcade site):
 *
 *   Catalog page   GET https://quenq.com/arcade/  ->  HTML grid of
 *                  <a class="game-card" href="/arcade/<slug>/"
 *                     data-bg="thumbnails/<slug>.jpg"
 *                     data-game-id="<slug>" data-game-name="<name>"
 *                     data-game-genre="<g,gg>"><h2><Name></h2>...
 *                  (1316 games) — the page sends Access-Control-Allow-Origin: *
 *                  when an Origin header is present, so the client can fetch
 *                  + parse it directly (no serverless proxy needed).
 *
 *   Game embed     GET https://quenq.com/arcade/data/games/<slug>/ -> a
 *                  BLACK fullscreen Ruffle (SWF) player page with NO ads and
 *                  NO X-Frame-Options / frame-ancestors -> iframe-embeddable.
 *                  Ruffle loads from unpkg with a same-origin fallback.
 *
 *   Thumbnails     GET https://quenq.com/arcade/data/thumbnails/<slug>.jpg
 *                  (CORS-open, used as the grid card artwork).
 *
 * The client NEVER shows any upstream branding ("quenq.com", "Ruffle" hints);
 * only the game name/genre/play button are surfaced. Catalog data is cached
 * in-memory (30 min) + in localStorage, with a static "featured top games"
 * seed so the grid still renders when the network is unavailable.
 */

// ─── Types -----------------------------------------------------------------
export interface GameItem {
  slug: string;
  name: string;
  /** Comma-separated genre tags from the source (e.g. "puzzle,adventure"). */
  genre: string;
  /** Thumbnail filename (relative to the thumbnails dir). */
  thumb: string;
  /** Normalized, human-readable genre list. */
  genres: string[];
}

export interface GameCatalog {
  games: GameItem[];
  /** Canonical genre labels (deduped, normalized). */
  genres: string[];
  total: number;
  fetchedAt: number;
}

// ─── Constants ---------------------------------------------------------------
export const QUENQ_ARCADE_URL = "https://quenq.com/arcade/";
export const QUENQ_GAME_EMBED_BASE = "https://quenq.com/arcade/data/games/";
export const QUENQ_THUMB_BASE = "https://quenq.com/arcade/data/thumbnails/";
const CATALOG_CACHE_KEY = "fuelpro_videogames_catalog";
const CACHE_TTL = 30 * 60 * 1000;

let memoryCache: { data: GameCatalog; ts: number } | null = null;

// ─── Normalization ------------------------------------------------------------
const GENRE_ALIASES: Record<string, string> = {
  shooter: "Shooter",
  platformer: "Platformer",
  adventure: "Adventure",
  action: "Action",
  arcade: "Arcade",
  puzzle: "Puzzle",
  racing: "Racing",
  sports: "Sports",
  strategy: "Strategy",
  simulation: "Simulation",
  creative: "Creative",
  educational: "Educational",
  quiz: "Quiz",
  logic: "Logic",
};

function normalizeGenreTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  if (!t) return "Other";
  const label = GENRE_ALIASES[t];
  return label || t.charAt(0).toUpperCase() + t.slice(1);
}

const parseGameCardRegex =
  /<a class="game-card"\s*href="\/arcade\/([^/"']+)\/"\s*data-bg="thumbnails\/([^"]+)"\s*data-game-id="([^"]+)"\s*data-game-name="([^"]*)"\s*data-game-genre="([^"]*)">/g;

export function parseGameCatalogHtml(html: string): GameItem[] {
  const seen = new Set<string>();
  const games: GameItem[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(parseGameCardRegex.source, "g");
  while ((match = re.exec(html)) !== null) {
    const slug = match[1];
    const thumb = match[2] || `${slug}.jpg`;
    const id = match[3];
    const rawName = match[4] || id || slug;
    const genre = match[5] || "Other";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const genres = genre
      .split(",")
      .map((g) => normalizeGenreTag(g))
      .filter(Boolean);
    games.push({
      slug,
      name: rawName,
      genre,
      thumb,
      genres: genres.length ? genres : ["Other"],
    });
  }
  return games;
}

// ─── Static fallback catalog (verified-real seed games, plays offline / on
// fetch fail). Slugs + names verified against the live quenq arcade grid.
const SEED_GAMES: GameItem[] = [
  ["8-ball-pool", "8 Ball Pool", "sports,arcade"],
  ["age-of-war", "Age of War", "strategy,action"],
  ["bloons-tower-defense", "Bloons Tower Defense", "strategy"],
  ["bloons-tower-defense-2", "Bloons Tower Defense 2", "strategy"],
  ["bloons-tower-defense-3", "Bloons Tower Defense 3", "strategy"],
  ["boxhead", "Boxhead", "shooter,action"],
  ["boxhead-the-zombie-wars", "Boxhead: The Zombie Wars", "shooter,action"],
  ["achievement-unlocked", "Achievement Unlocked", "puzzle"],
  ["earn-to-die", "Earn to Die", "racing,arcade"],
  ["line-rider", "Line Rider", "creative"],
  ["the-worlds-hardest-game", "The World's Hardest Game", "puzzle,platformer"],
  [
    "the-worlds-hardest-game-2",
    "The World's Hardest Game 2",
    "puzzle,platformer",
  ],
  ["tank-trouble", "Tank Trouble", "strategy,action"],
  ["strike-force-heroes", "Strike Force Heroes", "shooter,action"],
  ["strike-force-heroes-2", "Strike Force Heroes 2", "shooter,action"],
  ["strike-force-heroes-3", "Strike Force Heroes 3", "shooter,action"],
  ["1-on-1-soccer", "1 on 1 Soccer", "sports"],
  ["airport-tycoon", "Airport Tycoon", "strategy,simulation"],
  [
    "fireboy-and-watergirl-dark-temple",
    "Fireboy and Watergirl – Dark Temple",
    "puzzle,platformer",
  ],
  ["stick-figure-penalty", "Stick Figure Penalty", "sports,arcade"],
  ["awesome-tanks", "Awesome Tanks", "shooter,action"],
  ["awesome-tanks-2", "Awesome Tanks 2", "shooter,action"],
  ["learn-to-fly", "Learn to Fly", "simulation,arcade"],
  ["learn-to-fly-2", "Learn to Fly 2", "simulation,arcade"],
  ["space-invaders", "Space Invaders", "shooter,arcade"],
  ["space-is-key", "Space is Key", "platformer,puzzle"],
  ["3-foot-ninja", "3 Foot Ninja", "action"],
  ["3-foot-ninja-ii", "3 Foot Ninja II", "action"],
  ["bike-champ", "Bike Champ", "racing,arcade"],
  [
    "ducklife2-world-champion",
    "Ducklife 2: World Champion",
    "simulation,creative",
  ],
  ["ageofwar2", "Age of War 2", "strategy,action"],
  ["bubble-tanks", "Bubble Tanks", "shooter,arcade"],
  ["snake-runner", "Snake Runner", "arcade"],
].map(([slug, name, genre]) => ({
  slug,
  name,
  thumb: `${slug}.jpg`,
  genre,
  genres: genre.split(",").map(normalizeGenreTag),
}));

function toCatalog(games: GameItem[]): GameCatalog {
  const genreSet = new Set<string>();
  for (const g of games) for (const tag of g.genres) genreSet.add(tag);
  const genres = Array.from(genreSet).sort();
  return { games, genres, total: games.length, fetchedAt: Date.now() };
}

function loadCachedCatalog(): GameCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameCatalog;
    if (
      !parsed ||
      !Array.isArray(parsed.games) ||
      !parsed.games.length ||
      Date.now() - (parsed.fetchedAt || 0) > CACHE_TTL
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedCatalog(cat: GameCatalog) {
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(cat));
  } catch {
    /* storage full / disabled — catalog stays in memory */
  }
}

// ─── Public API ----------------------------------------------------------------

/**
 * Fetch the full quenq arcade catalog (parses the game-card grid). Falls back
 * to the localStorage cache (30 min TTL), then to the static seed list, so the
 * Video Games tab always renders something.
 */
export async function fetchGameCatalog(): Promise<GameCatalog> {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL) {
    return memoryCache.data;
  }
  const cached = loadCachedCatalog();
  if (cached) {
    memoryCache = { data: cached, ts: Date.now() };
    return cached;
  }
  try {
    const res = await fetch(QUENQ_ARCADE_URL, {
      headers: {
        Origin: window.location.origin,
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`arcade catalog returned ${res.status}`);
    const html = await res.text();
    const games = parseGameCatalogHtml(html);
    if (!games.length) throw new Error("catalog parse produced zero games");
    const cat = toCatalog(games);
    memoryCache = { data: cat, ts: Date.now() };
    saveCachedCatalog(cat);
    return cat;
  } catch {
    if (cached) return cached;
    const seed = toCatalog(SEED_GAMES);
    memoryCache = { data: seed, ts: Date.now() };
    return seed;
  }
}

/** Direct game-embed iframe URL (black fullscreen Ruffle player, no ads). */
export function gameEmbedUrl(game: GameItem): string {
  return `${QUENQ_GAME_EMBED_BASE}${encodeURIComponent(game.slug)}/`;
}

/** Thumbnail URL for a game card. */
export function gameThumbUrl(game: GameItem): string {
  return `${QUENQ_THUMB_BASE}${encodeURIComponent(game.thumb)}`;
}

/** Human-readable genre chips for a game. */
export function gameGenreLabels(game: GameItem): string[] {
  return game.genres.length ? game.genres : ["Other"];
}

// ─────────────────────────────────────────────────────────────────────────────
// "Greatest Classics" catalog — in-browser DOS/Windows games streamed
// (ad-free, no login, iframe-embeddable) from archive.org's Internet Arcade /
// softwarelibrary collection (the official, legally-hosted emulator). These
// are the closest browser-playable titles to the requested "AAA classics"
// (DOOM, DOOM II, Duke Nukem 3D, Wolfenstein 3D, Quake, GTA, Road Rash…).
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassicGame {
  /** archive.org item identifier. */
  id: string;
  name: string;
  /** Display genre. */
  genre: string;
  /** Short human note. */
  note: string;
  /** archive.org search collection used to backfill related items. */
  collection: string;
}

/** Direct in-browser emulator embed URL (ad-free, no login). */
export function classicGameEmbedUrl(id: string): string {
  return `https://archive.org/embed/${encodeURIComponent(id)}`;
}

/** Human "open game page" URL for a classic. */
export function classicGamePageUrl(id: string): string {
  return `https://archive.org/details/${encodeURIComponent(id)}`;
}

/**
 * Curated "Greatest Classics" (verified archive.org identifiers that embed +
 * return HTTP 200 — validated 2026-09-14). These are the browser-playable
 * stand-ins for the AAA titles that cannot legally run in a plain iframe.
 */
export const CLASSIC_GAMES: ClassicGame[] = [
  {
    id: "dosbox-doom",
    name: "DOOM",
    genre: "First-Person Shooter",
    note: "The 1993 classic — in-browser DOS emulator",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "3dduke13SW",
    name: "Duke Nukem 3D",
    genre: "First-Person Shooter",
    note: "Shareware build, in-browser DOS emulator",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "msdos_Wolfenstein_3D_1992",
    name: "Wolfenstein 3D",
    genre: "First-Person Shooter",
    note: "id Software classic — in-browser",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "quake2-msdos-alpha-2",
    name: "Quake 2 (DOS Alpha)",
    genre: "First-Person Shooter",
    note: "Quake engine — in-browser DOS emulator",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "msdos_Shadow_Warrior_1997",
    name: "Shadow Warrior",
    genre: "First-Person Shooter",
    note: "Build-engine FPS — in-browser",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "msdos_Wolfendoom_2000",
    name: "Wolfendoom",
    genre: "First-Person Shooter",
    note: "Doom+WolfenStein hybrid — in-browser",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "msdos_Avoid_the_Noid_1989",
    name: "Avoid the Noid",
    genre: "Arcade",
    note: "Classic 1989 arcade — in-browser",
    collection: "softwarelibrary_msdos_games",
  },
  {
    id: "msdos_Rastan_1990",
    name: "Rastan",
    genre: "Platformer",
    note: "1980s platformer — in-browser",
    collection: "softwarelibrary_msdos_games",
  },
];

/** Archive.org advanced-search JSON for a query. */
export interface ArchiveSearchDoc {
  identifier: string;
  title?: string;
  genre?: string | string[];
  description?: string;
}

/**
 * Fetch more classic games from archive.org's advancedsearch API (the same
 * in-browser emulator catalog). Bounded + fire-and-forget with a fallback to
 * the curated CLASSIC_GAMES list, so the section always renders.
 */
export async function fetchMoreClassics(
  query: string,
  limit = 12,
): Promise<ArchiveSearchDoc[]> {
  try {
    const url =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
      `&fl[]=identifier&fl[]=title&fl[]=genre&rows=${limit}&output=json`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`archive search ${res.status}`);
    const json = await res.json();
    const docs: ArchiveSearchDoc[] = (json?.response?.docs ||
      []) as ArchiveSearchDoc[];
    return docs.filter((d) => d && d.identifier);
  } catch {
    return [];
  }
}

// ─── Background prefetch ──────────────────────────────────────────────────
let prefetchStarted = false;

/**
 * Fire-and-forget catalog warm — cached in localStorage so the Video Games
 * tab renders instantly (no loading spinner) without an obvious network hit.
 * Deferred 4s after app load so it never competes with initial hydration.
 */
export function prefetchGameCatalogInBackground(): void {
  if (prefetchStarted) return;
  if (typeof window === "undefined") return;
  prefetchStarted = true;
  setTimeout(() => {
    fetchGameCatalog()
      .then(() => {})
      .catch(() => {});
  }, 4000);
}

/** @internal test helper to re-enable the singleton safe prefetch guard. */
export function resetGameCatalogPrefetchFlagForTests(): void {
  prefetchStarted = false;
}

/** Case-insensitive multi-field search (name + genre tags). */
export function searchGames(games: GameItem[], query: string): GameItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter(
    (g) =>
      g.name.toLowerCase().includes(q) ||
      g.genre.toLowerCase().includes(q) ||
      g.genres.some((t) => t.toLowerCase().includes(q)),
  );
}

/** Filter games by a canonical genre label (empty = all). */
export function filterGamesByGenre(
  games: GameItem[],
  genre: string,
): GameItem[] {
  if (!genre || genre === "All") return games;
  return games.filter((g) => g.genres.some((t) => t === genre));
}
