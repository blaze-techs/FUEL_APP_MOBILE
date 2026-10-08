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

// ─────────────────────────────────────────────────────────────────────────────
// "PlayGTA5" (playgta5.com) — reverse-engineered 2026-10-07 from the Wayback
// Machine snapshot
// https://web.archive.org/web/20261006055917/https://playgta5.com/
//
// It was an UNOFFICIAL GTA V WebAssembly port: the full engine (Emscripten
// build, ~63 MB `game.wasm`) ran locally in the browser via WebGPU, fed by a
// multi-worker architecture (loader.js → wgpu_worker.js + io_worker.js) with
// the game data streamed from `/data/`. The page even re-implemented Rockstar's
// Scaleform loading screen in HTML/CSS.
//
// It CANNOT be integrated as a playable game here — verified, not assumed:
//   1. The origin is DEAD. https://playgta5.com/ returns Cloudflare 522
//      (origin unreachable); only the Wayback snapshot resolves. The project
//      was an IP-infringing build (it used leaked GTA V source, per press
//      coverage) and was taken down within hours of going live.
//   2. The Wayback replay is NOT playable: the engine files were never
//      archived (`game.wasm`, `game.js`, `prejs.js`, `wgpu_worker.js`,
//      `/data/` all 404 in the snapshot), and the port requires cross-origin
//      isolation (COOP/COEP: `SharedArrayBuffer`) which the archive does not
//      send — the snapshot's own loading screen reports
//      "not cross-origin isolated".
//   3. Even if it were live, `X-Frame-Options: SAMEORIGIN` forbids embedding.
//
// So the honest, legal integration is a launch card that opens the ONLY
// working artifact — the archived snapshot — in a new tab, with the verified
// findings + an archived preview image. No fake "play in-app" button.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayGta5Finding {
  /** Short label. */
  label: string;
  /** What was verified. */
  detail: string;
  /** ok = works, warn = caveat, block = impossible. */
  state: "ok" | "warn" | "block";
}

/** The only working artifact: the archived snapshot of the page. */
export const PLAYGTA5_SNAPSHOT_URL =
  "https://web.archive.org/web/20261006055917/https://playgta5.com/";

/** Archived title logo (512×512, verified live in the snapshot). */
export const PLAYGTA5_ARCHIVED_LOGO =
  "https://web.archive.org/web/20261006055917im_/https://playgta5.com/b/8b0b5899ed/title/logo.png";

/**
 * Genuine screenshot of the port's loading screen captured by the Wayback
 * Machine (1400×761). This is the real preview of what the page rendered —
 * used as the card artwork so the entry has an authentic image.
 */
export const PLAYGTA5_WAYBACK_SCREENSHOT =
  "https://web.archive.org/web/2026/http://web.archive.org/screenshot/https://playgta5.com/";

/** Verified reverse-engineering findings (2026-10-07). */
export const PLAYGTA5_FINDINGS: PlayGta5Finding[] = [
  {
    label: "What it was",
    detail:
      "An unofficial GTA V WebAssembly port — the full game engine compiled to run locally in the browser (WebGPU), streaming its data as you played.",
    state: "ok",
  },
  {
    label: "Architecture",
    detail:
      "Multi-worker Emscripten build: loader.js spins up wgpu_worker.js (WebGPU renderer) + io_worker.js (asset/IndexedDB I/O); ~63 MB game.wasm; game data under /data/; savegames in IndexedDB.",
    state: "ok",
  },
  {
    label: "Live origin",
    detail:
      "DEAD — https://playgta5.com/ returns Cloudflare 522 (origin unreachable). The project was taken down shortly after launch (it used leaked GTA V source code).",
    state: "block",
  },
  {
    label: "Archived engine files",
    detail:
      "Not archived. game.wasm, game.js, prejs.js, wgpu_worker.js and /data/ all 404 in the snapshot — only the page shell, loader.js, io_worker.js and audio-worklet.js were captured.",
    state: "block",
  },
  {
    label: "Cross-origin isolation",
    detail:
      "The port needs SharedArrayBuffer (COOP/COEP). The archive does not send those headers, so the snapshot's own loading screen reports “not cross-origin isolated” and the engine never starts.",
    state: "block",
  },
  {
    label: "Embedding",
    detail:
      "Even if it were live it sends X-Frame-Options: SAMEORIGIN, so it can never be iframed into this app.",
    state: "block",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INXANITY Labs (inxanitylabs.com) — reverse-engineered 2026-10-07.
//
// Their /games page is a curated catalog of FREE browser games (web ports of
// PC classics + original .io-style games). Verified: every title's origin is
// LIVE (HTTP 200) and most send NO X-Frame-Options / frame-ancestors, so they
// run inside the player iframe. Two titles (Park Baron, Nacht der Untoten)
// forbid framing, and Counter-Strike quick-joins on the creator's site, so
// those open in a new tab (kind: "external").
//
// The one exception is their GTA V entry, which — exactly like our own honest
// PlayGTA5 card — is the archived playgta5.com snapshot and therefore NOT
// playable. We keep it as an external "archived" link so the catalog is a
// faithful 1:1 of theirs, without ever implying it plays.
//
// `isolated: "own"` (LEGO Island) means the game needs cross-origin isolation
// (SharedArrayBuffer); it is served from isle.pizza with COOP/COEP, so the
// browser isolates it on its own — an iframe still works.
// ─────────────────────────────────────────────────────────────────────────────

export interface InxanityGame {
  slug: string;
  name: string;
  /** Creator / host credit. */
  by: string;
  /** Play URL (embed or external). */
  url: string;
  /** Absolute cover image URL (mirrored from their assets). */
  coverUrl: string;
  /** Free-form genre tags (also used for search + genre filter). */
  tags: string[];
  /** One-line blurb. */
  blurb: string;
  /** Longer description shown in the player modal. */
  about: string;
  /** Legal/attribution note (fan project disclaimers). */
  note?: string;
  /**
   * iframe = runs in our player; external = opens in a new tab (framing
   * forbidden or the game quick-joins a live server).
   */
  mode: "iframe" | "external";
  /** Keyboard hints (shown in the player modal when present). */
  keys?: [string, string][];
  /** "Own isolation" games need SharedArrayBuffer — the origin provides it. */
  isolated?: "own" | true;
}

const INX_COVER = (file: string) =>
  `https://www.inxanitylabs.com/assets/games/${file}`;

/** Curated free browser-game catalog reverse-engineered from inxanitylabs.com. */
export const INXANITY_GAMES: InxanityGame[] = [
  {
    slug: "gta-v",
    name: "GTA V (archived)",
    by: "playgta5.com (archived)",
    url: "https://web.archive.org/web/20261006055917/https://playgta5.com/",
    coverUrl: INX_COVER("gta-v.jpg"),
    tags: ["Open world", "May not load"],
    blurb:
      "The browser port of Grand Theft Auto V that went viral, kept alive through the Internet Archive.",
    about:
      "An unofficial browser port of GTA V, loaded from the Internet Archive's copy of playgta5.com. It may not load: the original site was taken down and the archive can be missing files.",
    note: "Unofficial fan project, not affiliated with or endorsed by Rockstar Games. Archived snapshot — the engine was never archived, so it will not start.",
    mode: "external",
    isolated: true,
  },
  {
    slug: "counter-strike",
    name: "Counter-Strike 1.6",
    by: "Combat Skirmish",
    url: "https://combatskirmish.net/quickjoin",
    coverUrl: INX_COVER("counter-strike.png"),
    tags: ["Multiplayer", "FPS"],
    blurb:
      "Live CS 1.6 servers in your browser: Dust2, Inferno, Office, surf and zombie mod.",
    about:
      "Classic Counter-Strike 1.6 with live multiplayer servers. Quick join drops you straight into a match on Dust2, Inferno, Office, surf or zombie mod. No account needed.",
    note: "Fan-run site, not affiliated with Valve.",
    mode: "external",
    keys: [
      ["WASD", "Move"],
      ["Mouse", "Aim and shoot"],
      ["B", "Buy menu"],
      ["Esc", "Menu"],
    ],
  },
  {
    slug: "lego-island",
    name: "LEGO Island",
    by: "isle.pizza",
    url: "https://isle.pizza/",
    coverUrl: INX_COVER("lego-island.jpg"),
    tags: ["Classic", "1997"],
    blurb: "The 1997 PC classic, fully rebuilt to run in a modern browser.",
    about:
      "The original 1997 LEGO Island, ported in full to the web: drive around the island, build your own car, deliver pizzas and stop the Brickster. The project also adds multiplayer.",
    note: "Fan project. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this site.",
    mode: "iframe",
    isolated: "own",
  },
  {
    slug: "pokemon-redstone",
    name: "Pokémon Redstone",
    by: "Maximus Spritius (@MozeTech)",
    url: "https://pokemon-redstone.pages.dev/",
    coverUrl: INX_COVER("pokemon-redstone.webp"),
    tags: ["Mashup", "Saves"],
    blurb:
      "Play Pokémon as Minecraft's Steve: mine, craft, go to the Nether and catch the Ender Dragon.",
    about:
      "A Pokémon game where you are Steve. Explore Kanto with a Minecraft hotbar, mine and craft, light a Nether portal, raid the fortress, follow an Eye of Ender to the stronghold and catch the Ender Dragon in an Ultra Ball. Your save stays in this browser.",
    note: "Free, unofficial fan project, not affiliated with Nintendo, Game Freak, The Pokémon Company, Mojang or Microsoft.",
    mode: "iframe",
    keys: [
      ["Arrows / WASD", "Move"],
      ["Z", "Mine, attack, talk"],
      ["X", "Use and place"],
      ["Space", "Jump"],
      ["E", "Inventory"],
    ],
  },
  {
    slug: "taipei-rush",
    name: "Taipei Rush",
    by: "taipei-rush.app",
    url: "https://www.taipei-rush.app/",
    coverUrl: INX_COVER("taipei-rush.jpg"),
    tags: ["Open world"],
    blurb:
      "An open-world Taipei: ride scooters, drive cars, take missions and outrun the police.",
    about:
      "Walk the streets of Taipei, hop on a scooter or into a car, take on missions, and deal with the police when you break the law. A full open world running in the browser.",
    mode: "iframe",
  },
  {
    slug: "redcoats",
    name: "Redcoats",
    by: "redcoats.io",
    url: "https://redcoats.io/app/",
    coverUrl: INX_COVER("redcoats.jpg"),
    tags: ["Multiplayer", "FPS"],
    blurb:
      "Massive line-battle FPS: ride horses, fire cannons, sail warships and capture forts.",
    about:
      "A huge multiplayer musket shooter. Fight as infantry, ride horses, man cannons, sail warships and capture forts, with up to 1,000 players in one battle.",
    mode: "iframe",
  },
  {
    slug: "salty-seas",
    name: "Salty Seas",
    by: "saltyseas.io",
    url: "https://saltyseas.io/app/",
    coverUrl: INX_COVER("salty-seas.jpg"),
    tags: ["Multiplayer", "Pirates"],
    blurb:
      "Open-world pirate MMO: crew a warship, fire broadsides and board enemy ships.",
    about:
      "An open-world pirate MMO. Crew a warship, fire broadsides, board enemy ships and fight on deck with muskets, pistols and sabres.",
    mode: "iframe",
  },
  {
    slug: "park-baron",
    name: "Park Baron",
    by: "parkbaron.com",
    url: "https://parkbaron.com/play",
    coverUrl: INX_COVER("park-baron.jpg"),
    tags: ["Tycoon"],
    blurb:
      "Theme park tycoon: build roller coasters piece by piece and keep thousands of guests happy.",
    about:
      "Design roller coasters track piece by track piece, build rides and shops, hire staff and manage thousands of guests across six themes.",
    mode: "external",
  },
  {
    slug: "sandstorm",
    name: "SandStorm",
    by: "sandstorm.ink",
    url: "https://sandstorm.ink/play.html",
    coverUrl: INX_COVER("sandstorm.jpg"),
    tags: ["Shooter", "Destructible"],
    blurb:
      "A falling-sand shooter where every grain of the world is simulated and destructible.",
    about:
      "Every grain of this world is simulated. Dig through the terrain, build on it, burn it, flood it or blow it apart while you fight.",
    mode: "iframe",
  },
  {
    slug: "nacht-der-untoten",
    name: "Nacht der Untoten",
    by: "zombies.bitcoinsapi.com",
    url: "https://zombies.bitcoinsapi.com/",
    coverUrl: INX_COVER("nacht-der-untoten.jpg"),
    tags: ["Co-op", "Zombies"],
    blurb:
      "The original World at War zombies map, remade for the browser. Solo or 2 to 4 player co-op.",
    about:
      "A fan-made browser remake of Nacht der Untoten from Call of Duty: World at War. Board up the windows, buy guns off the wall and survive the waves, solo or in 2 to 4 player co-op.",
    note: "Fan remake, not affiliated with Activision or Treyarch.",
    mode: "external",
  },
  {
    slug: "seedbed",
    name: "Seedbed",
    by: "playseedbed.com",
    url: "https://www.playseedbed.com/",
    coverUrl: INX_COVER("seedbed.jpg"),
    tags: ["Strategy"],
    blurb:
      "A solarpunk governor game: build rail and clean energy for a century of self-governing towns.",
    about:
      "Guide a region from 2027 to 2127, building rail and clean energy while each town decides for itself how to live with AI and a warming climate.",
    mode: "iframe",
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
  | "quenq"
  | "crazy"
  | "gameflare"
  | "classic"
  | "popular"
  | "apps"
  | "cloud"
  | "inxanity"
  | "velgg";

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
  /**
   * Isolation hint for the player. "sandboxed" (default) frames the game with
   * `allow-scripts allow-same-origin` (no popups / no top-navigation). A
   * cross-origin-isolated build (vel.gg's SharedArrayBuffer engine) needs
   * `isolated` instead: our proxy route already serves COOP/COEP, so the iframe
   * just needs the `cross-origin-isolated` permission + autoplay.
   */
  frame?: "sandboxed" | "isolated";
  /** Original source item (quenq arcade only) for favorite round-trips. */
  quenq?: GameItem;
}

export const SOURCE_LABEL: Record<GameSource, string> = {
  quenq: "Quenq arcade",
  crazy: "CrazyGames",
  gameflare: "Gameflare",
  classic: "Archive classic",
  popular: "Popular",
  apps: "App",
  cloud: "Cloud AAA",
  inxanity: "INXANITY Labs",
  velgg: "BO1 Zombies",
};

/** Badge/tint per source (drives the card chip colors). */
export const SOURCE_TINT: Record<GameSource, string> = {
  quenq: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  crazy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  gameflare: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  classic: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  popular: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  apps: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cloud: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  inxanity: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  velgg: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Map a source key to a filter-chip label shown in the top ribbon. */
export const SOURCE_FILTERS: { value: GameSource | "all"; label: string }[] = [
  { value: "all", label: "All games" },
  { value: "quenq", label: "Quenq arcade" },
  { value: "crazy", label: "CrazyGames" },
  { value: "popular", label: "Popular" },
  { value: "classic", label: "Classics" },
  { value: "gameflare", label: "Gameflare" },
  { value: "inxanity", label: "INXANITY Labs" },
  { value: "velgg", label: "BO1 Zombies" },
  { value: "apps", label: "Apps" },
  { value: "cloud", label: "Cloud AAA" },
];

// ─── vel.gg — Black Ops Zombies (real WebAssembly port) ─────────────────────
// vel.gg ships a full Call of Duty: Black Ops Zombies engine compiled to
// WebAssembly (SharedArrayBuffer / OPFS asset packs), ad-free and free to
// play. It cannot be framed directly: every vel.gg response carries
// `Cross-Origin-Resource-Policy: same-origin`, and the ~0.9 GB pack origin
// only sends `Access-Control-Allow-Origin: https://vel.gg`. We re-serve the
// whole app through our own SAME-ORIGIN route `/api/velgg/` (Vercel handler +
// Cloudflare Pages Function), which also keeps every asset request inside our
// no-ads boundary. The proxy makes the document cross-origin isolated
// (COOP/COEP), so the iframe embeds it in-app — no redirect, no new tab.
//
// vel.gg serves TEN maps (each its own pack + OPFS namespace); we surface the
// pair the task named (`Five` and `Kino der Toten`) plus the rest of the
// classic Zombies lineup, each with its real loadscreen art.

/** One playable vel.gg map. `zone` is vel.gg's internal zone/devmap id. */
export interface VelGgGame {
  /** Page slug under our proxy: /api/velgg/bo1z/<slug>. */
  slug: string;
  name: string;
  /** vel.gg zone id — used for the loadscreen art path. */
  zone: string;
  /** Short title shown on the loading frame card. */
  blurb: string;
}

/**
 * The maps vel.gg plays. Order is the official release order; `five` and
 * `kino` lead because they are the two the task called out.
 */
export const VELGG_GAMES: VelGgGame[] = [
  {
    slug: "five",
    name: "Zombies — Five",
    zone: "zombie_pentagon",
    blurb: "The Pentagon outbreak. Survive the undead in the war room.",
  },
  {
    slug: "kino",
    name: "Zombies — Kino der Toten",
    zone: "zombie_theater",
    blurb: "The abandoned theater. Classic round-based survival.",
  },
  {
    slug: "riese",
    name: "Zombies — Der Riese",
    zone: "zombie_cod5_factory",
    blurb: "The Waffenfabrik. Pack-a-Punch and the teleporters.",
  },
  {
    slug: "nacht",
    name: "Zombies — Nacht der Untoten",
    zone: "zombie_cod5_prototype",
    blurb: "Where it all began. Barricade and hold the bunker.",
  },
  {
    slug: "verruckt",
    name: "Zombies — Verrückt",
    zone: "zombie_cod5_asylum",
    blurb: "The asylum. Power on, then run the loop.",
  },
  {
    slug: "shinonuma",
    name: "Zombies — Shi No Numa",
    zone: "zombie_cod5_sumpf",
    blurb: "The swamp. Swamp zombies and the Wunderwaffe.",
  },
  {
    slug: "ascension",
    name: "Zombies — Ascension",
    zone: "zombie_cosmodrome",
    blurb: "The cosmodrome. Space monkeys and the lunar lander.",
  },
  {
    slug: "cotd",
    name: "Zombies — Call of the Dead",
    zone: "zombie_coast",
    blurb: "The frozen coast. George Romero lurks the shoreline.",
  },
  {
    slug: "shangrila",
    name: "Zombies — Shangri-La",
    zone: "zombie_temple",
    blurb: "The temple. Water slides, traps and the eclipse.",
  },
  {
    slug: "moon",
    name: "Zombies — Moon",
    zone: "zombie_moon",
    blurb: "The lunar base. Low gravity and the excavators.",
  },
];

/**
 * Same-origin proxy URL for a vel.gg map page. The iframe loads THIS, so the
 * whole engine runs from our origin in a sandboxed frame — never a redirect.
 */
export function velggEmbedUrl(slug: string): string {
  return `/api/velgg/bo1z/${slug}`;
}

/** vel.gg's real loadscreen art for a map (served through the proxy). */
export function velggCoverUrl(zone: string): string {
  return `/api/velgg/bo1z/art/loadscreen_${zone}.webp`;
}

/** vel.gg map → unified card. */
export function unifiedFromVelgg(g: VelGgGame): UnifiedGame {
  return {
    id: `velgg:${g.slug}`,
    name: g.name,
    genre: "FPS, Zombies, Survival",
    source: "velgg",
    sourceLabel: SOURCE_LABEL.velgg,
    coverUrl: velggCoverUrl(g.zone),
    playUrl: velggEmbedUrl(g.slug),
    kind: "iframe",
    frame: "isolated",
    note: g.blurb,
    platform: "vel.gg (WebAssembly)",
    year: 2010,
  };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// "Gameflare" catalog — a curated set of GameDistribution-hosted games that
// gameflare.com embeds (also a large standalone HTML5 catalog). Served AD-FREE
// through our same-origin mirror /api/game-embed/gd/<id>/ (see api/_lib/
// gamedistribution-embed.ts), which resolves the inner game shell, strips the
// ad SDK scripts (ima3.js + main.min.js), and injects an ad-free SDK shim — no
// ads, no external network calls, verified live (Moto X3M boots in-iframe).
//
// Gameflare discovery note: gameflare.com/embed/<slug>/ exposes
// `data-src="https://html5.gamedistribution.com/<gameId>/"` for GD-hosted
// games. GD has no public catalog API (cloudfront 403), so the entries below
// are curated + each verified to boot ad-free through the GD mirror.
// ─────────────────────────────────────────────────────────────────────────────

export interface GameflareGame {
  /** gameflare slug (kebab). */
  slug: string;
  name: string;
  /** gameflare-friendly genre label. */
  genre: string;
  /** GameDistribution gameId (32-hex). */
  gameId: string;
  /** Cover art URL (data.gameflare.com — verified 200). */
  coverUrl: string;
  /** HTML5 iframe size ratio hint (width/height) for the player. */
  width?: number;
  height?: number;
}

/** Mirror entry for a Gameflare (GD) game. The server discovers the inner
 * prefix at request time and shims the build ad-free. */
export function gameflareEmbedUrl(gameId: string): string {
  return `/api/game-embed/gd/${gameId}/`;
}

/**
 * Curated Gameflare → GameDistribution games, each confirmed to resolve on
 * html5.gamedistribution.com/<gameId>/index.html (HTTP 200 outer loader).
 */
export const GAMEFLARE_GAMES: GameflareGame[] = [
  {
    slug: "moto-x3m",
    name: "Moto X3M",
    genre: "Racing,Skill",
    gameId: "5b0abd4c0faa4f5eb190a9a16d5a1b4c",
    coverUrl:
      "https://data.gameflare.com/games/6238/frGk7uNVKxGtKD-400-300.jpeg",
    width: 720,
    height: 515,
  },
];

/** Gameflare → unified card (embed through our ad-free GD mirror). */
export function unifiedFromGameflare(g: GameflareGame): UnifiedGame {
  return {
    id: `gameflare:${g.slug}`,
    name: g.name,
    genre: g.genre,
    source: "gameflare" as GameSource,
    sourceLabel: SOURCE_LABEL.gameflare,
    coverUrl: g.coverUrl,
    playUrl: gameflareEmbedUrl(g.gameId),
    kind: "iframe",
    platform: "HTML5 · no ads (GD)",
    note: "No ads — the game runs ad-free via our mirror.",
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

/** INXANITY Labs → unified card (iframe embed or external launch). */
export function unifiedFromInxanity(g: InxanityGame): UnifiedGame {
  const external = g.mode === "external";
  const keys = g.keys ? g.keys.map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
  return {
    id: `inxanity:${g.slug}`,
    name: g.name,
    genre: g.tags.join(", "),
    source: "inxanity",
    sourceLabel: SOURCE_LABEL.inxanity,
    coverUrl: g.coverUrl,
    playUrl: g.url,
    kind: external ? "external" : "iframe",
    platform: external ? `By ${g.by} · opens in new tab` : `By ${g.by}`,
    note: [g.about, keys && `Controls — ${keys}`, g.note]
      .filter(Boolean)
      .join(" "),
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

  // Gameflare (GameDistribution-hosted, served ad-free via the GD mirror)
  for (const g of GAMEFLARE_GAMES) push(unifiedFromGameflare(g));

  // Popular requested titles (Minecraft, GTA 1997, Angry Birds…)
  for (const p of POPULAR_GAMES) push(unifiedFromPopular(p));

  // Archive.org in-browser classics (DOOM, Duke 3D, Wolfenstein…)
  for (const c of CLASSIC_GAMES) push(unifiedFromClassic(c));
  for (const c of input.classic ?? []) push(unifiedFromClassic(c));

  // quenq /apps/ library (Minecraft Eaglercraft, Angry Birds Chrome…)
  for (const a of QUENQ_APPS) push(unifiedFromApp(a));

  // INXANITY Labs curated free browser games (reverse-engineered catalog)
  for (const g of INXANITY_GAMES) push(unifiedFromInxanity(g));

  // vel.gg — Black Ops Zombies WebAssembly maps (same-origin /api/velgg mirror)
  for (const g of VELGG_GAMES) push(unifiedFromVelgg(g));

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
    gameflare: 0,
    classic: 0,
    popular: 0,
    apps: 0,
    cloud: 0,
    inxanity: 0,
    velgg: 0,
  };
  for (const g of games) counts[g.source] += 1;
  return counts;
}
