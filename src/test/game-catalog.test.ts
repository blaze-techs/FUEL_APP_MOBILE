import { describe, it, expect } from "vitest";
import {
  parseGameCatalogHtml,
  searchGames,
  filterGamesByGenre,
  gameEmbedUrl,
  gameThumbUrl,
  gameGenreLabels,
  QUENQ_ARCADE_URL,
  QUENQ_THUMB_BASE,
  CRAZYGAMES_CATEGORIES,
  crazyGamesEmbedUrl,
  crazyGamesCoverUrl,
  mergeCrazyGamesCatalogs,
  QUENQ_APPS,
  POPULAR_GAMES,
  CLASSIC_GAMES,
  CLOUD_AAA_GAMES,
  buildUnifiedGames,
  searchUnifiedGames,
  filterUnifiedBySource,
  filterUnifiedByGenre,
  sortUnifiedGames,
  countUnifiedBySource,
  unifiedFromCrazy,
  type CrazyGamesCatalog,
  type CrazyGamesGame,
  type GameItem,
} from "@/react-app/services/GameCatalogService";

const MOCK_QUENQ: GameItem[] = [
  {
    slug: "8-ball-pool",
    name: "8 Ball Pool",
    thumb: "8-ball-pool.jpg",
    genres: ["Sports", "Arcade"],
    genre: "sports,arcade",
    url: "8-ball-pool/",
  },
];

const MOCK_CRAZY: CrazyGamesGame[] = [
  {
    id: "x1",
    name: "Moto X3M",
    slug: "moto-x3m",
    category: "Action",
    coverUrl: "https://img.crazygames.com/covers/moto.jpg",
    embedUrl: "/api/game-embed/moto-x3m",
    year: 2019,
    plays: 1234567,
  },
];

const SAMPLE_CARD = `<a class="game-card"
  href="/arcade/8-ball-pool/"
  data-bg="thumbnails/8-ball-pool.jpg"
  data-game-id="8-ball-pool"
  data-game-name="8 ball pool"
  data-game-genre="sports,arcade">
  <h2>8 Ball Pool</h2>
</a>`;

const SAMPLE_HTML = `
<html><body>
  <a class="game-card" href="/arcade/?genre=action">genres</a>
  ${SAMPLE_CARD}
  <a class="game-card"
    href="/arcade/age-of-war/"
    data-bg="thumbnails/age-of-war.jpg"
    data-game-id="age-of-war"
    data-game-name="Age of War"
    data-game-genre="strategy,action">
    <h2>Age of War</h2>
  </a>
  <a class="game-card"
    href="/arcade/solo/"
    data-bg="thumbnails/solo.jpg"
    data-game-id="solo"
    data-game-name="Solo"
    data-game-genre="puzzle">
    <h2>Solo</h2>
  </a>
</body></html>`;

describe("GameCatalogService", () => {
  it("parses game cards from the arcade HTML", () => {
    const games = parseGameCatalogHtml(SAMPLE_HTML);
    expect(games.length).toBe(3);
    const pool = games.find((g) => g.slug === "8-ball-pool");
    expect(pool).toBeDefined();
    expect(pool!.name).toBe("8 ball pool");
    expect(pool!.thumb).toBe("8-ball-pool.jpg");
    expect(pool!.genres).toEqual(["Sports", "Arcade"]);
  });

  it("ignores non-card links (genre filters) and dedupes duplicates", () => {
    const dup = `${SAMPLE_HTML}<a class="game-card"
      href="/arcade/8-ball-pool/"
      data-bg="thumbnails/8-ball-pool.jpg"
      data-game-id="8-ball-pool"
      data-game-name="8 ball pool"
      data-game-genre="sports,arcade"><h2>8 Ball Pool</h2></a>`;
    const games = parseGameCatalogHtml(dup);
    expect(games.filter((g) => g.slug === "8-ball-pool").length).toBe(1);
    expect(games.map((g) => g.slug)).not.toContain("?genre=action");
  });

  it("normalizes multi-genre codes into canonical labels", () => {
    const games = parseGameCatalogHtml(SAMPLE_HTML);
    const age = games.find((g) => g.slug === "age-of-war");
    expect(age!.genres).toEqual(["Strategy", "Action"]);
    expect(age!.genre).toBe("strategy,action");
    const solo = games.find((g) => g.slug === "solo");
    expect(solo!.genres).toEqual(["Puzzle"]);
  });

  it("searchGames matches name + genre tags (case-insensitive)", () => {
    const games = parseGameCatalogHtml(SAMPLE_HTML);
    expect(searchGames(games, "POOL").map((g) => g.slug)).toEqual([
      "8-ball-pool",
    ]);
    expect(searchGames(games, "strategy").map((g) => g.slug)).toEqual([
      "age-of-war",
    ]);
    expect(searchGames(games, "xyz")).toEqual([]);
    expect(searchGames(games, "")).toHaveLength(3);
  });

  it("filterGamesByGenre filters by canonical genre label", () => {
    const games = parseGameCatalogHtml(SAMPLE_HTML);
    expect(filterGamesByGenre(games, "Action").map((g) => g.slug)).toEqual([
      "age-of-war",
    ]);
    expect(filterGamesByGenre(games, "All")).toHaveLength(3);
    expect(filterGamesByGenre(games, "")).toHaveLength(3);
  });

  it("builds the no-ads embed URL + thumbnail URL for a game", () => {
    const games = parseGameCatalogHtml(SAMPLE_HTML);
    const pool = games[0];
    expect(gameEmbedUrl(pool)).toBe("/api/quenq-embed/8-ball-pool");
    expect(gameThumbUrl(pool)).toBe(`${QUENQ_THUMB_BASE}8-ball-pool.jpg`);
    expect(QUENQ_ARCADE_URL).toBe("https://quenq.com/arcade/");
  });

  it("gameGenreLabels falls back to Other for empty genre tags", () => {
    const games = parseGameCatalogHtml(
      `<a class="game-card" href="/arcade/x/" data-bg="thumbnails/x.jpg" data-game-id="x" data-game-name="X" data-game-genre=""><h2>X</h2></a>`,
    );
    expect(games[0].genres).toEqual(["Other"]);
    expect(gameGenreLabels(games[0])).toEqual(["Other"]);
  });
});

describe("CrazyGames catalog helpers", () => {
  it("builds the ad-free mirror embed URL from a slug", () => {
    expect(crazyGamesEmbedUrl("moto-x3m")).toBe("/api/game-embed/moto-x3m");
    expect(crazyGamesEmbedUrl("geometry-dash-online")).toBe(
      "/api/game-embed/geometry-dash-online",
    );
  });

  it("builds a cover URL from the crazygames cover path", () => {
    expect(
      crazyGamesCoverUrl(
        "war-the-knights_16x9/20251104084824/war-the-knights_16x9-cover",
      ),
    ).toBe(
      "https://imgs.crazygames.com/war-the-knights_16x9/20251104084824/war-the-knights_16x9-cover?format=auto&quality=70&metadata=none",
    );
    expect(crazyGamesCoverUrl("")).toBe("");
    expect(crazyGamesCoverUrl("/leading-slash/cover")).toBe(
      "https://imgs.crazygames.com/leading-slash/cover?format=auto&quality=70&metadata=none",
    );
  });

  it("exposes curated categories", () => {
    expect(CRAZYGAMES_CATEGORIES.length).toBeGreaterThan(10);
    expect(CRAZYGAMES_CATEGORIES[0]).toEqual({
      slug: "action",
      label: "Action",
    });
    expect(CRAZYGAMES_CATEGORIES.some((c) => c.slug === "io")).toBe(true);
  });

  it("mergeCrazyGamesCatalogs concatenates pages and dedupes slugs", () => {
    const pageA: CrazyGamesCatalog = {
      source: "crazygames",
      category: "action",
      games: [
        {
          id: "1",
          name: "A",
          slug: "a",
          embedUrl: "e",
          coverUrl: "c",
          plays: 0,
          category: "Action",
        },
        {
          id: "2",
          name: "B",
          slug: "b",
          embedUrl: "e",
          coverUrl: "c",
          plays: 0,
          category: "Action",
        },
      ],
      total: 2,
      page: 1,
      size: 2,
      fetchedAt: 0,
    };
    const pageB: CrazyGamesCatalog = {
      source: "crazygames",
      category: "action",
      games: [
        {
          id: "2",
          name: "B",
          slug: "b",
          embedUrl: "e",
          coverUrl: "c",
          plays: 0,
          category: "Action",
        },
        {
          id: "3",
          name: "C",
          slug: "c",
          embedUrl: "e",
          coverUrl: "c",
          plays: 0,
          category: "Action",
        },
      ],
      total: 3,
      page: 2,
      size: 2,
      fetchedAt: 0,
    };
    const merged = mergeCrazyGamesCatalogs(pageA, pageB);
    expect(merged.games.map((g) => g.slug)).toEqual(["a", "b", "c"]);
    expect(merged.total).toBe(3);
    expect(merged.page).toBe(2);
  });
});

describe("Quenq /apps/ library (QUENQ_APPS)", () => {
  it("includes Minecraft, Angry Birds Chrome and the other special apps", () => {
    const ids = QUENQ_APPS.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "minecraft",
        "angry-birds-chrome",
        "3d-pinball",
        "emulator",
        "swf-player",
        "minivmac",
        "hacker-simulator",
        "reborn-xp",
      ]),
    );
  });

  it("every app has a valid https embed URL + image + note", () => {
    for (const app of QUENQ_APPS) {
      expect(app.url.startsWith("https://")).toBe(true);
      expect(app.image.startsWith("https://")).toBe(true);
      expect(app.note.length).toBeGreaterThan(0);
      expect(app.genre.length).toBeGreaterThan(0);
    }
  });
});

describe("Unified All-games collection", () => {
  it("merges quenq + crazy + all static sources into one list", () => {
    const all = buildUnifiedGames({ quenq: MOCK_QUENQ, crazy: MOCK_CRAZY });
    expect(all.length).toBeGreaterThanOrEqual(
      MOCK_QUENQ.length +
        MOCK_CRAZY.length +
        POPULAR_GAMES.length +
        CLASSIC_GAMES.length +
        QUENQ_APPS.length +
        CLOUD_AAA_GAMES.length,
    );
    // every source is present
    for (const s of ["quenq", "crazy", "classic", "popular", "apps", "cloud"]) {
      expect(
        all.some((g) => g.source === s),
        `has ${s}`,
      ).toBe(true);
    }
    // no duplicate ids across sources
    const ids = new Set(all.map((g) => g.id));
    expect(ids.size).toBe(all.length);
  });

  it("prefixes ids by source (no collisions) and routes quenq to our mirror", () => {
    const all = buildUnifiedGames({ quenq: MOCK_QUENQ, crazy: MOCK_CRAZY });
    const quenq = all.find((g) => g.source === "quenq");
    expect(quenq).toBeDefined();
    expect(quenq!.id).toBe("quenq:8-ball-pool");
    expect(quenq!.playUrl).toBe("/api/quenq-embed/8-ball-pool");
    const crazy = all.find((g) => g.source === "crazy");
    expect(crazy!.id).toBe("crazy:moto-x3m");
    expect(crazy!.playUrl).toBe("/api/game-embed/moto-x3m");
    const minecraft = all.find((g) => g.name.includes("Minecraft Classic"));
    expect(minecraft).toBeDefined();
    expect(minecraft!.kind).toBe("iframe");
    expect(minecraft!.playUrl).toContain("classic.minecraft.net");
  });

  it("searchUnifiedGames matches name, genre, source and platform", () => {
    const all = buildUnifiedGames({ quenq: MOCK_QUENQ, crazy: MOCK_CRAZY });
    expect(searchUnifiedGames(all, "moto").map((g) => g.id)).toContain(
      "crazy:moto-x3m",
    );
    expect(searchUnifiedGames(all, "8 ball").map((g) => g.id)).toContain(
      "quenq:8-ball-pool",
    );
    expect(searchUnifiedGames(all, "crazygames").length).toBeGreaterThan(0);
    expect(searchUnifiedGames(all, "zzz-missing")).toEqual([]);
    expect(searchUnifiedGames(all, "")).toHaveLength(all.length);
  });

  it("filterUnifiedBySource returns only that source; genre filter works", () => {
    const all = buildUnifiedGames({ quenq: MOCK_QUENQ, crazy: MOCK_CRAZY });
    expect(filterUnifiedBySource(all, "all")).toHaveLength(all.length);
    const crazyOnly = filterUnifiedBySource(all, "crazy");
    expect(crazyOnly.every((g) => g.source === "crazy")).toBe(true);
    const action = filterUnifiedByGenre(all, "Action");
    expect(action.length).toBeGreaterThan(0);
    expect(action.every((g) => /action/i.test(g.genre))).toBe(true);
  });

  it("sortUnifiedGames: plays-first puts the most-played title on top", () => {
    const onlyCrazy = [unifiedFromCrazy(MOCK_CRAZY[0])];
    const sorted = sortUnifiedGames(
      [
        ...onlyCrazy,
        // quenq has no plays → treated as 0
        ...buildUnifiedGames({ quenq: MOCK_QUENQ }).filter(
          (g) => g.source === "quenq",
        ),
      ],
      "plays",
    );
    expect(sorted[0].id).toBe("crazy:moto-x3m");
    const byName = sortUnifiedGames([...onlyCrazy], "name");
    expect(byName).toHaveLength(1);
  });

  it("countUnifiedBySource sums per-source totals", () => {
    const all = buildUnifiedGames({ quenq: MOCK_QUENQ, crazy: MOCK_CRAZY });
    const c = countUnifiedBySource(all);
    expect(c.all).toBe(all.length);
    expect(c.quenq).toBeGreaterThanOrEqual(MOCK_QUENQ.length);
    expect(c.crazy).toBeGreaterThanOrEqual(MOCK_CRAZY.length);
    expect(c.classic).toBe(CLASSIC_GAMES.length);
    expect(c.popular).toBe(POPULAR_GAMES.length);
    expect(c.apps).toBe(QUENQ_APPS.length);
    expect(c.cloud).toBe(CLOUD_AAA_GAMES.length);
    // sum of parts equals the whole
    expect(c.quenq + c.crazy + c.classic + c.popular + c.apps + c.cloud).toBe(
      c.all,
    );
  });
});
