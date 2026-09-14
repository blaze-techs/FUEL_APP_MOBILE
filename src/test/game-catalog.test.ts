import { describe, it, expect } from "vitest";
import {
  parseGameCatalogHtml,
  searchGames,
  filterGamesByGenre,
  gameEmbedUrl,
  gameThumbUrl,
  gameGenreLabels,
  QUENQ_ARCADE_URL,
  QUENQ_GAME_EMBED_BASE,
  QUENQ_THUMB_BASE,
} from "@/react-app/services/GameCatalogService";

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
    expect(gameEmbedUrl(pool)).toBe(`${QUENQ_GAME_EMBED_BASE}8-ball-pool/`);
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
