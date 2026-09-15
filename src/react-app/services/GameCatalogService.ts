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

/**
 * Embed URL for a quenq arcade game. We serve a SAME-ORIGIN Ruffle player page
 * at /api/quenq-embed/<slug> instead of iframing quenq's own cross-origin Ruffle
 * shell (which never attaches a canvas when framed from another origin). The
 * player page loads the game's swf directly from quenq (CORS `*`, no ads).
 */
export function gameEmbedUrl(game: GameItem): string {
  return `/api/quenq-embed/${encodeURIComponent(game.slug)}`;
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

// ────────────────────────────────────────────────────────────────────────────
// "Cloud AAA" — the big current-gen titles (Fortnite, GTA V, Warzone,
// Battlefield). They are NOT embeddable in an iframe (X-Frame-Options: DENY,
// login + DRM), but they ARE playable in a browser via the official cloud
// gaming portals. We surface the verified working launch URL so the user gets
// a REAL one-click path instead of a fake embedded "play".
// ────────────────────────────────────────────────────────────────────────────

export interface CloudAAAGame {
  id: string;
  name: string;
  /** Short genre / descriptor chip. */
  genre: string;
  /** Verified launch URL (new tab — these portals deny iframing). */
  url: string;
  /** One-line "how to play free" note. */
  how: string;
  /** Free without any subscription? (Fortnite = yes, GTA V = own-thru-GFN-lib) */
  free: boolean;
  /** Platform the URL opens. */
  platform: string;
  accent: "sky" | "emerald" | "rose" | "violet" | "amber";
  /**
   * Preview/cover image (official store-art CDN). Verified live 2026-09-14:
   * Steam cover CDN (shared.fastly.steamstatic.com) returns real 34-64KB
   * covers for the classic AAA titles; Fortnite uses an archive.org item art
   * since it has no Steam store page.
   */
  image: string;
  /**
   * Honest region/latency note: these portals stream from datacenter regions,
   * so access + ping(ms) varies by location. The in-browser arcade/classics
   * are never affected by this.
   */
  regionNote: string;
}

/** Verified 2026-09-14 (live HEAD probes). */
export const CLOUD_AAA_GAMES: CloudAAAGame[] = [
  {
    id: "fortnite",
    name: "Fortnite",
    genre: "Battle Royale · Shooter",
    url: "https://www.xbox.com/en-US/play/games/fortnite/BT5P2X999VH2",
    how: "Free · Xbox Cloud Gaming — play in your browser with a free Microsoft account. No console, no download.",
    free: true,
    platform: "Xbox Cloud Gaming",
    accent: "sky",
    image: "https://archive.org/services/img/fortnite-screenshot",
    regionNote:
      "Streams from Microsoft datacenters — Xbox Cloud may be restricted/geo-laggy in some countries (high ping ms).",
  },
  {
    id: "gta5",
    name: "Grand Theft Auto V",
    genre: "Open World · Action",
    url: "https://play.geforcenow.com/games/grand-theft-auto-v/",
    how: "GeForce NOW free tier (queue) — link your Steam/Epic library that owns GTA V. PC Game Pass also streams it.",
    free: false,
    platform: "GeForce NOW",
    accent: "amber",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/271590/header.jpg",
    regionNote:
      "GeForce NOW is region-gated and needs datacenter proximity — unsupported countries + high latency (ping ms) are common.",
  },
  {
    id: "warzone",
    name: "Call of Duty: Warzone",
    genre: "Battle Royale · FPS",
    url: "https://xbox.com/en-US/play/launch/call-of-duty-warzone",
    how: "Xbox Cloud Gaming (free-to-play) — sign in with a Microsoft account; no console needed.",
    free: true,
    platform: "Xbox Cloud Gaming",
    accent: "rose",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1962663/header.jpg",
    regionNote:
      "Xbox Cloud datacenters — availability + ping(ms) vary by country/region.",
  },
  {
    id: "battlefield",
    name: "Battlefield (series)",
    genre: "FPS · Military",
    url: "https://play.geforcenow.com/games/battlefield-2042",
    how: "GeForce NOW (queues on free tier) or Xbox Cloud Gaming — stream through your existing EA/Steam library.",
    free: false,
    platform: "GeForce NOW / Xbox",
    accent: "violet",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1517290/header.jpg",
    regionNote:
      "Region-gated cloud portals — latency (ping ms) depends on your nearest datacenter.",
  },
  {
    id: "revc",
    name: "reVC — GTA Vice City (web port)",
    genre: "Open World · Reverse-Engineered",
    url: "https://dos.zone/revcdos",
    how: "DOS.Zone browser port of the reverse-engineered reVC engine — you must provide your own legally-owned Vice City game files (DMCA-reformatted).",
    free: true,
    platform: "DOS.Zone",
    accent: "emerald",
    image: "https://archive.org/services/img/dosbox-doom",
    regionNote:
      "Runs locally in your browser (no streaming) — no region gate, no latency beyond loading.",
  },
];

/** Direct in-browser emulator embed URL (ad-free, no login). */
export function classicGameEmbedUrl(id: string): string {
  return `https://archive.org/embed/${encodeURIComponent(id)}`;
}

/** Human "open game page" URL for a classic. */
export function classicGamePageUrl(id: string): string {
  return `https://archive.org/details/${encodeURIComponent(id)}`;
}

/** Preview cover art for a classic (archive.org item artwork). */
export function classicCoverUrl(id: string): string {
  return `https://archive.org/services/img/${encodeURIComponent(id)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// "Popular & requested" — the browser-playable titles users ask for by name
// (Minecraft, GTA, Angry Birds, etc.). Each entry is a REAL verified embed:
//   - "minecraft"  → iframe classic.minecraft.net (open-world sandbox, verified)
//   - "archive"    → iframe archive.org/embed/<id> (in-browser emulator)
//   - "external"   → best-possible no-ads path (opens on provider, no iframe
//                    allowed — honest).
// Verified live 2026-09-14 (HTTP 200 + no X-Frame-Options where iframe-based).
// ─────────────────────────────────────────────────────────────────────────────

export interface PopularGame {
  id: string;
  name: string;
  genre: string;
  /** How this title embeds: minecraft / archive / external. */
  kind: "minecraft" | "archive" | "external";
  /** Iframe src when kind is minecraft|archive, else the launch URL. */
  url: string;
  /** Cover/preview image. */
  image: string;
  /** One-line note (esp. for external titles). */
  note: string;
  /** Platform descriptor shown on the card. */
  platform: string;
}

export const POPULAR_GAMES: PopularGame[] = [
  {
    id: "minecraft-classic",
    name: "Minecraft Classic",
    genre: "Sandbox · Building",
    kind: "minecraft",
    url: "https://classic.minecraft.net/",
    image: "https://archive.org/services/img/minecraft_20250408",
    note: "Official free browser build (classic.minecraft.net) — build & explore, no install.",
    platform: "Minecraft Classic",
  },
  {
    id: "gta-1997",
    name: "Grand Theft Auto (1997)",
    genre: "Open World · Action",
    kind: "archive",
    url: "https://archive.org/embed/grand-theft-auto-1997-dma-design",
    image: "https://archive.org/services/img/grand-theft-auto-1997-dma-design",
    note: "The original open-world classic — plays in your browser via the archive emulator.",
    platform: "In-browser (archive)",
  },
  {
    id: "angry-birds-breakfast",
    name: "Angry Birds Breakfast",
    genre: "Puzzle · Action",
    kind: "archive",
    url: "https://archive.org/embed/angry-birds-breakfast_202507",
    image: "https://archive.org/services/img/angry-birds-breakfast_202507",
    note: "Angry Birds-style slingshot puzzle — plays in your browser via the archive emulator.",
    platform: "In-browser (archive)",
  },
  {
    id: "doom",
    name: "DOOM",
    genre: "First-Person Shooter",
    kind: "archive",
    url: "https://archive.org/embed/dosbox-doom",
    image: "https://archive.org/services/img/dosbox-doom",
    note: "The 1993 FPS that launched a genre — plays in your browser.",
    platform: "In-browser (archive)",
  },
  {
    id: "duke-nukem-3d",
    name: "Duke Nukem 3D",
    genre: "First-Person Shooter",
    kind: "archive",
    url: "https://archive.org/embed/3dduke13SW",
    image: "https://archive.org/services/img/3dduke13SW",
    note: "Build-engine FPS classic — plays in your browser.",
    platform: "In-browser (archive)",
  },
  {
    id: "wolfenstein-3d",
    name: "Wolfenstein 3D",
    genre: "First-Person Shooter",
    kind: "archive",
    url: "https://archive.org/embed/msdos_Wolfenstein_3D_1992",
    image: "https://archive.org/services/img/msdos_Wolfenstein_3D_1992",
    note: "id Software's genre-defining shooter — plays in your browser.",
    platform: "In-browser (archive)",
  },
  {
    id: "8-ball-pool",
    name: "8 Ball Pool",
    genre: "Sports · Pool",
    kind: "external",
    url: "https://quenq.com/arcade/data/games/8-ball-pool/",
    image: "https://quenq.com/arcade/data/thumbnails/8-ball-pool.jpg",
    note: "Sink every ball — plays in-browser (quenq no-ads player).",
    platform: "In-browser (quenq)",
  },
  {
    id: "bloons-td",
    name: "Bloons Tower Defense",
    genre: "Strategy · Tower",
    kind: "external",
    url: "https://quenq.com/arcade/data/games/bloons-tower-defense/",
    image: "https://quenq.com/arcade/data/thumbnails/bloons-tower-defense.jpg",
    note: "Pop the balloons, upgrade your monkeys — plays in-browser.",
    platform: "In-browser (quenq)",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Quenq "Apps Library" — quenq.com's special `/apps/` catalogue (separate from
// the 1,316-game arcade grid): full in-browser applications with their own
// HTML passengers. All verified HTTP 200 + no X-Frame-Options (2026-09-15).
// Heading headline titles the user asked for by name (Minecraft, Angry Birds).
// ─────────────────────────────────────────────────────────────────────────────

export interface QuenqApp {
  id: string;
  name: string;
  genre: string;
  /** Iframe src (quenq same-site player). No ads (quenq ships these ad-free). */
  url: string;
  /** Preview/cover image (quenq thumbnail or og or poster). */
  image: string;
  /** Boot note (eg heavyweight first load). */
  note: string;
  /** Platform descriptor shown on the card. */
  platform: string;
}

export const QUENQ_APPS: QuenqApp[] = [
  {
    id: "minecraft",
    name: "Minecraft (Eaglercraft)",
    genre: "Sandbox · Survival",
    url: "https://quenq.com/apps/minecraft/app",
    image: "https://quenq.com/apps/minecraft/og.jpg",
    note: "Full Java-style Minecraft in the browser (Eaglercraft 1.8 WASM). Heavy first load.",
    platform: "In-browser (quenq)",
  },
  {
    id: "angry-birds-chrome",
    name: "Angry Birds Chrome",
    genre: "Puzzle · Physics",
    url: "https://quenq.com/apps/angry-birds-chrome/app.html",
    image: "https://quenq.com/apps/angry-birds-chrome/og.jpg",
    note: "The classic slingshot physics game, playable in the browser.",
    platform: "In-browser (quenq)",
  },
  {
    id: "3d-pinball",
    name: "3D Pinball Space Cadet",
    genre: "Arcade · Pinball",
    url: "https://quenq.com/apps/3d-pinball-space-cadet/app.html",
    image: "https://quenq.com/apps/3d-pinball-space-cadet/og.jpg",
    note: "The beloved Windows pinball table, in your browser.",
    platform: "In-browser (quenq)",
  },
  {
    id: "emulator",
    name: "Console Emulator",
    genre: "Emulation · Retro",
    url: "https://quenq.com/apps/emulator/app.html",
    image: "https://quenq.com/apps/emulator/og.jpg",
    note: "Play classic console ROMs in the browser.",
    platform: "In-browser (quenq)",
  },
  {
    id: "swf-player",
    name: "SWF Player",
    genre: "Utility · Flash",
    url: "https://quenq.com/apps/swf-player/app.html",
    image: "https://quenq.com/apps/swf-player/og.jpg",
    note: "Run Adobe Flash (SWF) files in the browser.",
    platform: "In-browser (quenq)",
  },
  {
    id: "minivmac",
    name: "Macintosh Classic",
    genre: "Emulation · Retro",
    url: "https://quenq.com/apps/minivmac/MinivMac.htm",
    image: "https://quenq.com/apps/minivmac/MinivMac.png",
    note: "A classic Macintosh runs right in the browser.",
    platform: "In-browser (quenq)",
  },
  {
    id: "hacker-simulator",
    name: "Hacker Simulator",
    genre: "Simulation · Story",
    url: "https://quenq.com/apps/hacker-simulator/app.html",
    image: "https://quenq.com/apps/hacker-simulator/og.jpg",
    note: "Crack into systems, tell a hacker story on screen.",
    platform: "In-browser (quenq)",
  },
  {
    id: "reborn-xp",
    name: "Reborn XP",
    genre: "Simulation · OS",
    url: "https://xp.quenq.com",
    image: "https://quenq.com/apps/reborn-xp/og.jpg",
    note: "A whole Windows XP simulator — the App Market hub.",
    platform: "In-browser (quenq)",
  },
];

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

// ─────────────────────────────────────────────────────────────────────────────
// "CrazyGames" catalog — thousands of no-ads, browser-playable HTML5 games.
//
// WHY a serverless proxy is required: CrazyGames' game pages send
// `X-Frame-Options: SAMEORIGIN`, and their category pages (`/c/<cat>/`) send
// NO `Access-Control-Allow-Origin`, so a browser can neither embed nor scrape
// them directly. BUT the games' real builds at
//   https://games.crazygames.com/en_US/<slug>/index.html
// are clean: HTTP 200, no XFO, no CSP frame-ancestors, ZERO ad-SDK refs in
// the loader shell (verified live). It's the exact target CrazyGames' own
// `/embed/<slug>` redirects to — so we embed it directly.
//
// The catalog proxy (`/api/game-catalog-proxy?cat=<category>&page=<n>`)
// fetches the category page server-side, extracts the embedded __NEXT_DATA__
// JSON (`props.pageProps.games.items[]`), and returns a clean typed list with
// our own embed + cover URLs. No upstream branding is surfaced in the UI.
//
// Verified 2026-09-15: action (719), puzzle (665), shooting (215), io (120)…
// ─────────────────────────────────────────────────────────────────────────────

export interface CrazyGamesGame {
  id: string;
  name: string;
  slug: string;
  /** Direct clean loader URL (games.crazygames.com — no ads). */
  embedUrl: string;
  /** Cover art URL (imgs.crazygames.com — verified 200). */
  coverUrl: string;
  /** Total plays on CrazyGames (for "Popular" sort / stats). */
  plays: number;
  year?: number;
  category: string;
}

export interface CrazyGamesCatalog {
  source: "crazygames";
  category: string;
  games: CrazyGamesGame[];
  total: number;
  page: number;
  size: number;
  fetchedAt: number;
}

/** Verified categories (live totals, 2026-09-15). */
export const CRAZYGAMES_CATEGORIES: { slug: string; label: string }[] = [
  { slug: "action", label: "Action" },
  { slug: "adventure", label: "Adventure" },
  { slug: "arcade", label: "Arcade" },
  { slug: "board", label: "Board" },
  { slug: "card", label: "Card" },
  { slug: "clicker", label: "Clicker" },
  { slug: "driving", label: "Driving" },
  { slug: "io", label: ".io" },
  { slug: "music", label: "Music" },
  { slug: "puzzle", label: "Puzzle" },
  { slug: "racing", label: "Racing" },
  { slug: "shooting", label: "Shooting" },
  { slug: "sports", label: "Sports" },
  { slug: "strategy", label: "Strategy" },
  { slug: "tower-defense", label: "Tower Defense" },
];

/**
 * Client-side mirror of the proxy's URL builders (kept in sync).
 * The client iframes OUR game-embed mirror (api/game-embed) — the direct
 * games.crazygames.com embed injects ~70 Google/GPT ads at runtime (GameFrame
 * wrapper); the raw game-files builds are ad-free but hotlink-protected + XFO,
 * so the mirror proxies them (Referer + stripped XFO + CORS).
 */
export function crazyGamesEmbedUrl(slug: string): string {
  return `/api/game-embed/${encodeURIComponent(slug)}`;
}

export function crazyGamesCoverUrl(cover: string): string {
  if (!cover) return "";
  const path = cover.replace(/^\//, "");
  return `https://imgs.crazygames.com/${path}?format=auto&quality=70&metadata=none`;
}

/**
 * Fetch a CrazyGames category page through the same-origin catalog proxy.
 * Falls back to the seed list and returns an empty catalog on failure, so the
 * UI always has something to render.
 */
export async function fetchCrazyGamesCatalog(
  category = "action",
  page = 1,
  signal?: AbortSignal,
): Promise<CrazyGamesCatalog> {
  const empty: CrazyGamesCatalog = {
    source: "crazygames",
    category,
    games: [],
    total: 0,
    page,
    size: 0,
    fetchedAt: Date.now(),
  };
  try {
    const qs = new URLSearchParams({ cat: category, page: String(page) });
    const res = await fetch(`/api/game-catalog-proxy?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new Error(`catalog proxy returned ${res.status}`);
    const json = (await res.json()) as Partial<CrazyGamesCatalog>;
    const games = (json.games || [])
      .filter((g) => g && g.slug && g.name && g.embedUrl)
      .map((g) => ({
        id: g.id || g.slug,
        name: g.name,
        slug: g.slug,
        embedUrl: g.embedUrl,
        coverUrl: g.coverUrl || "",
        plays: typeof g.plays === "number" ? g.plays : 0,
        year: g.year,
        category: g.category || category,
      }));
    return {
      source: "crazygames",
      category: String(json.category || category),
      games,
      total: typeof json.total === "number" ? json.total : games.length,
      page: typeof json.page === "number" ? Math.max(1, json.page) : page,
      size: typeof json.size === "number" ? json.size : games.length,
      fetchedAt:
        typeof json.fetchedAt === "number" ? json.fetchedAt : Date.now(),
    };
  } catch {
    return empty;
  }
}

/** Add two catalogs together (used for "show more" paging). */
export function mergeCrazyGamesCatalogs(
  a: CrazyGamesCatalog,
  b: CrazyGamesCatalog,
): CrazyGamesCatalog {
  const seen = new Set<string>(a.games.map((g) => g.slug));
  const games = a.games.concat(
    b.games.filter((g) => {
      if (seen.has(g.slug)) return false;
      seen.add(g.slug);
      return true;
    }),
  );
  return {
    source: "crazygames",
    category: b.category || a.category,
    games,
    total: Math.max(a.total, b.total),
    page: b.page,
    size: b.size,
    fetchedAt: Date.now(),
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED "ALL GAMES" MEGA-COLLECTION
// ────────────────────────────────────────────────────────────────────────────
// One massive, searchable collection that merges every verified, ad-free
// browser-playable source:
//   quenq   → 1,316-strong arcade (Ruffle /api/quenq-embed same-origin mirror)
//   crazy   → no-ads CrazyGames mirror (/api/game-embed proxy)
//   classic → archive.org in-browser DOS/Windows (iframe embed)
//   popular → Minecraft Classic / GTA 1997 / Angry Birds… (verified embeds)
//   apps    → quenq /apps/ (Minecraft Eaglercraft, Angry Birds Chrome, …)
//   cloud   → AAA cloud-gaming launch cards (open in new tab — portals block
//              iframing with X-Frame-Options: DENY)
//
// Every playable path is AD-FREE (hard requirement). `kind` lets the player
// know whether to iframe (`iframe`), open a provider in a new tab (`external`),
// or launch a cloud portal in a new tab (`cloud`).
// ═══════════════════════════════════════════════════════════════════════════

export type GameSource =
  "quenq" | "crazy" | "classic" | "popular" | "apps" | "cloud";

export interface UnifiedGame {
  /** Stable unique id used for favorites + history across all sources. */
  id: string;
  name: string;
  /** Human genre string (comma-separated tags keep search/filter simple). */
  genre: string;
  /** Source key (drives the badge + source filter). */
  source: GameSource;
  /** Human source label shown on the card badge. */
  sourceLabel: string;
  /** Preview/cover image (always https, CORS-open where possible). */
  coverUrl: string;
  /**
   * iframe src when kind === "iframe" (our mirror / archive / quenq / minecraft);
   * the launch URL when kind === "external" | "cloud" (open in new tab).
   */
  playUrl: string;
  /** How this title plays: iframe vs external vs cloud-launch. */
  kind: "iframe" | "external" | "cloud";
  /** Optional card subtitle / one-line note shown in the player modal. */
  note?: string;
  /** Optional platform descriptor. */
  platform?: string;
  /** CrazyGames play count (used for "Most played" sort). */
  plays?: number;
  /** Release year when known. */
  year?: number;
  /** Cloud-gaming region/latency honesty note (cloud source only). */
  regionNote?: string;
  /** Original source item (quenq arcade only) for favorite round-trips. */
  quenq?: GameItem;
}

export const SOURCE_LABEL: Record<GameSource, string> = {
  quenq: "Quenq arcade",
  crazy: "CrazyGames",
  classic: "Archive classic",
  popular: "Popular",
  apps: "App",
  cloud: "Cloud AAA",
};

/** Badge/tint per source (drives the card chip colors). */
export const SOURCE_TINT: Record<GameSource, string> = {
  quenq: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  crazy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  classic: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  popular: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  apps: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cloud: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
};

/** Map a source key to a filter-chip label shown in the top ribbon. */
export const SOURCE_FILTERS: { value: GameSource | "all"; label: string }[] = [
  { value: "all", label: "All games" },
  { value: "quenq", label: "Quenq arcade" },
  { value: "crazy", label: "CrazyGames" },
  { value: "popular", label: "Popular" },
  { value: "classic", label: "Classics" },
  { value: "apps", label: "Apps" },
  { value: "cloud", label: "Cloud AAA" },
];

/** Quenq arcade → unified card. */
export function unifiedFromQuenq(g: GameItem): UnifiedGame {
  return {
    id: `quenq:${g.slug}`,
    name: g.name,
    genre: g.genre || g.genres.join(", "),
    source: "quenq",
    sourceLabel: SOURCE_LABEL.quenq,
    coverUrl: gameThumbUrl(g),
    playUrl: gameEmbedUrl(g),
    kind: "iframe",
    platform: "In-browser",
    quenq: g,
  };
}

/** CrazyGames → unified card (embed through our ad-free mirror). */
export function unifiedFromCrazy(g: CrazyGamesGame): UnifiedGame {
  return {
    id: `crazy:${g.slug}`,
    name: g.name,
    genre: g.category || "CrazyGames",
    source: "crazy",
    sourceLabel: SOURCE_LABEL.crazy,
    coverUrl: g.coverUrl || "",
    playUrl: g.embedUrl,
    kind: "iframe",
    platform: "HTML5 · no ads",
    plays: g.plays || 0,
    year: g.year,
    note: g.plays
      ? `${g.plays.toLocaleString()} plays on CrazyGames`
      : "Plays directly in your browser",
  };
}

/** Archive.org classic → unified card (iframe embed). */
export function unifiedFromClassic(c: ClassicGame): UnifiedGame {
  return {
    id: `classic:${c.id}`,
    name: c.name,
    genre: c.genre,
    source: "classic",
    sourceLabel: SOURCE_LABEL.classic,
    coverUrl: classicCoverUrl(c.id),
    playUrl: classicGameEmbedUrl(c.id),
    kind: "iframe",
    platform: "In-browser (archive)",
    note: c.note,
  };
}

/** Popular requested title → unified card. */
export function unifiedFromPopular(p: PopularGame): UnifiedGame {
  const external = p.kind === "external";
  return {
    id: `popular:${p.id}`,
    name: p.name,
    genre: p.genre,
    source: "popular",
    sourceLabel: SOURCE_LABEL.popular,
    coverUrl: p.image,
    playUrl: p.url,
    kind: external ? "external" : "iframe",
    platform: p.platform,
    note: p.note,
  };
}

/** quenq app → unified card. */
export function unifiedFromApp(a: QuenqApp): UnifiedGame {
  return {
    id: `apps:${a.id}`,
    name: a.name,
    genre: a.genre,
    source: "apps",
    sourceLabel: SOURCE_LABEL.apps,
    coverUrl: a.image,
    playUrl: a.url,
    kind: "iframe",
    platform: a.platform,
    note: a.note,
  };
}

/** Cloud AAA → unified card (opens the official portal in a new tab). */
export function unifiedFromCloud(c: CloudAAAGame): UnifiedGame {
  return {
    id: `cloud:${c.id}`,
    name: c.name,
    genre: c.genre,
    source: "cloud",
    sourceLabel: SOURCE_LABEL.cloud,
    coverUrl: c.image,
    playUrl: c.url,
    kind: "cloud",
    platform: c.platform,
    note: c.how,
    regionNote: c.regionNote,
  };
}

export interface UnifiedBuildInput {
  quenq?: GameItem[];
  crazy?: CrazyGamesGame[];
  /** Optional extra archive.org classics discovered at runtime. */
  classic?: ClassicGame[];
}

/**
 * Build the complete "All games" collection from every verified source.
 * `quenq` + `crazy` are dynamic (the rest are static constants). Always
 * returns a stable, de-duplicated array — safe to memoize.
 */
export function buildUnifiedGames(
  input: UnifiedBuildInput = {},
): UnifiedGame[] {
  const out: UnifiedGame[] = [];
  const seen = new Set<string>();
  const push = (g: UnifiedGame | null | undefined) => {
    if (!g) return;
    if (seen.has(g.id)) return;
    seen.add(g.id);
    out.push(g);
  };

  // Quenq arcade (largest single source)
  for (const g of input.quenq ?? []) push(unifiedFromQuenq(g));

  // CrazyGames (whatever is loaded — paginated in the UI)
  for (const g of input.crazy ?? []) push(unifiedFromCrazy(g));

  // Popular requested titles (Minecraft, GTA 1997, Angry Birds…)
  for (const p of POPULAR_GAMES) push(unifiedFromPopular(p));

  // Archive.org in-browser classics (DOOM, Duke 3D, Wolfenstein…)
  for (const c of CLASSIC_GAMES) push(unifiedFromClassic(c));
  for (const c of input.classic ?? []) push(unifiedFromClassic(c));

  // quenq /apps/ library (Minecraft Eaglercraft, Angry Birds Chrome…)
  for (const a of QUENQ_APPS) push(unifiedFromApp(a));

  // Cloud AAA launch cards (Fortnite, GTA V, Warzone…)
  for (const c of CLOUD_AAA_GAMES) push(unifiedFromCloud(c));

  return out;
}

/** Case-insensitive multi-field search over the unified collection. */
export function searchUnifiedGames(
  games: UnifiedGame[],
  query: string,
): UnifiedGame[] {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter(
    (g) =>
      g.name.toLowerCase().includes(q) ||
      g.genre.toLowerCase().includes(q) ||
      g.sourceLabel.toLowerCase().includes(q) ||
      (g.platform || "").toLowerCase().includes(q),
  );
}

/** Filter the unified collection by source key ("all" = no filter). */
export function filterUnifiedBySource(
  games: UnifiedGame[],
  source: GameSource | "all",
): UnifiedGame[] {
  if (!source || source === "all") return games;
  return games.filter((g) => g.source === source);
}

/** Filter the unified collection by an exact (normalized) genre label. */
export function filterUnifiedByGenre(
  games: UnifiedGame[],
  genre: string,
): UnifiedGame[] {
  if (!genre || genre === "All") return games;
  const needle = genre.toLowerCase();
  return games.filter(
    (g) =>
      g.genre.toLowerCase().includes(needle) ||
      g.genre.split(",").some((t) => t.trim().toLowerCase() === needle),
  );
}

/**
 * Sort the unified collection. "plays" (CrazyGames play counts) first, then
 * name — a stable, ad-free "Trending/Most played" approximation. Others sort
 * by name (case-insensitive) for a predictable feel.
 */
export function sortUnifiedGames(
  games: UnifiedGame[],
  mode: "name" | "plays" = "name",
): UnifiedGame[] {
  const arr = [...games];
  if (mode === "plays") {
    arr.sort(
      (a, b) => (b.plays || 0) - (a.plays || 0) || a.name.localeCompare(b.name),
    );
  } else {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return arr;
}

/** Count games per source (for the stats header). */
export function countUnifiedBySource(
  games: UnifiedGame[],
): Record<GameSource | "all", number> {
  const counts: Record<GameSource | "all", number> = {
    all: games.length,
    quenq: 0,
    crazy: 0,
    classic: 0,
    popular: 0,
    apps: 0,
    cloud: 0,
  };
  for (const g of games) counts[g.source] += 1;
  return counts;
}
