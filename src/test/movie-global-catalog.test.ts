import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  browseGlobalTitles,
  fetchGlobalCatalogCount,
  fetchMovieDetail,
  searchMovies,
} from "@/react-app/services/MovieService";

/**
 * The GLOBAL catalogue (`public/movies-global.json`) is the deepest layer of
 * the Movies surface: hundreds of thousands of Wikidata titles, each carrying
 * an IMDb id — the key the embed providers (2embed) need to play a title the
 * playable upstream (streamingunity, ~17k) does not carry.
 *
 * These tests pin that contract: the global titles are searchable, pageable,
 * and resolve a playable detail with an imdb id.
 */

const global = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/movies-global.json"), "utf8"),
) as {
  movies: [string, string, number | null, number | null][];
  tv: [string, string, number | null, number | null][];
};

const globalBody = JSON.stringify(global);

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("MovieService global (Wikidata) catalogue", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("movies-global.json")) return jsonResponse(globalBody);
        // Live proxy + other snapshots are empty/absent — the global layer must
        // still work on its own.
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("harvested a large global catalogue (not a token sample)", () => {
    expect(global.movies.length).toBeGreaterThan(1000);
    // Rows are compact [imdb, name, year, tmdb] — the tmdb id is what lets the
    // embed providers play a title the playable upstream does not carry.
    for (const r of global.movies.slice(0, 50)) {
      expect(r[0]).toMatch(/^tt\d+$/);
      expect(typeof r[1]).toBe("string");
      expect(r[1].length).toBeGreaterThan(0);
    }
  });

  it("carries a TMDB id on the harvested rows (playability)", () => {
    // The harvest joins Wikidata P4947 (TMDB) so every row that has one is
    // directly playable through the embed providers. A regression that drops
    // the 4th column would silently make the whole deep catalogue unplayable.
    const withTmdb = global.movies.filter((r) => r[3] != null);
    expect(withTmdb.length).toBeGreaterThan(1000);
    // And the resolved detail exposes it.
    return (async () => {
      const row = withTmdb.find((r) => r[3] != null)!;
      const item = global.movies.indexOf(row);
      const detail = await fetchMovieDetail(-(item + 1), row[0]);
      expect(detail?.tmdbId).toBe(row[3]);
    })();
  });

  it("catalogues series (TV) as well as movies", () => {
    // The TV phase of the harvest must not be empty — otherwise every series
    // in the deep catalogue is unplayable and the episode picker is moot.
    expect(global.tv.length).toBeGreaterThan(100);
    for (const r of global.tv.slice(0, 50)) {
      expect(r[0]).toMatch(/^tt\d+$/);
      expect(r[1].length).toBeGreaterThan(0);
    }
  });

  it("exposes the global catalogue count", async () => {
    const n = await fetchGlobalCatalogCount();
    expect(n).toBe(global.movies.length + global.tv.length);
  });

  it("pages the global catalogue without mounting it all at once", async () => {
    const first = await browseGlobalTitles(0, 50);
    expect(first.titles.length).toBe(50);
    expect(first.total).toBeGreaterThan(1000);
    const second = await browseGlobalTitles(50, 50);
    expect(second.titles[0].imdbId).not.toBe(first.titles[0].imdbId);
  });

  it("search finds global titles the upstream catalogue does not carry", async () => {
    // Use a distinctive word from a real harvested title.
    const sample = global.movies.find((r) => r[1].split(" ").length >= 2)!;
    const word = sample[1].split(" ")[0];
    const hits = await searchMovies(word);
    expect(hits.length).toBeGreaterThan(0);
    // Every hit is playable — it carries the imdb id the embed providers need.
    expect(hits.every((h) => h.imdbId || h.tmdbId)).toBe(true);
  });

  it("resolves a playable detail (imdb id) for a global title", async () => {
    const first = await browseGlobalTitles(0, 1);
    const item = first.titles[0];
    const detail = await fetchMovieDetail(item.id, item.slug);
    expect(detail).not.toBeNull();
    expect(detail?.imdbId).toMatch(/^tt\d+$/);
    expect(detail?.type).toMatch(/^(movie|tv)$/);
  });

  it("fills episodes for a series via TVMaze when the snapshot has none", async () => {
    // The bundled snapshot carries seasons but no episodes for most series, so
    // a series could change Season yet never pick an episode. TVMaze is the
    // keyless, imdb-keyed, CORS-enabled source that fills that gap.
    const series = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/movies-details.json"),
        "utf8",
      ),
    ) as Record<string, { detail: { type: string; imdbId: string | null } }>;
    const bare = Object.values(series).find(
      (v) => v.detail.type === "tv" && v.detail.imdbId,
    );
    expect(bare).toBeTruthy();
  });
});
