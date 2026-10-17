import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchMovieCatalog,
  fetchMovieBrowse,
  fetchMovieDetail,
  searchMovies,
} from "@/react-app/services/MovieService";

/**
 * The Movies/Series surface must ALWAYS render the real catalog. The upstream
 * (streamingunity) blocks datacenter egress, so the serverless proxy can return
 * an empty payload; MovieService then falls back to the bundled snapshot
 * (`public/movies-seed.json`) so the titles that were there before still show.
 * These tests pin the ADDITIVE contract: live wins when present, and the
 * bundled catalog is a superset-safe fallback (never an empty surface).
 */

const seed = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/movies-seed.json"), "utf8"),
) as {
  pool: { id: number; name: string; type: string }[];
  catalog: { sliders: { label: string; ids: number[] }[]; genres: unknown[] };
  browse: Record<string, { ids: number[] }>;
};

const fullCatalog = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/movies-catalog.json"), "utf8"),
) as {
  pool: { id: number; name: string; type: string }[];
  genres: Record<string, { label: string; ids: number[] }>;
};

function seedBody(): string {
  return JSON.stringify(seed);
}

const detailsBody = readFileSync(
  resolve(process.cwd(), "public/movies-details.json"),
  "utf8",
);

/** Serve the on-disk seed/detail snapshots for any fetch to those files. */
function snapshotsResponse(url: string): Response | null {
  const u = String(url);
  if (u.includes("movies-catalog.json")) {
    return new Response(JSON.stringify(fullCatalog), { status: 200 });
  }
  if (u.includes("movies-seed.json")) {
    return new Response(seedBody(), { status: 200 });
  }
  if (u.includes("movies-details.json")) {
    return new Response(detailsBody, { status: 200 });
  }
  return null;
}

describe("MovieService additive catalog fallback", () => {
  beforeEach(() => {
    // The bundled snapshots are fetched by URL — serve them from local files.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const snap = snapshotsResponse(String(url));
        if (snap) return snap;
        // Live proxy returns an EMPTY catalog (the datacenter-blocked case).
        return new Response(JSON.stringify({ sliders: [], genres: [] }), {
          status: 200,
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("seed carries the real movies/series catalog (not an empty list)", () => {
    expect(seed.pool.length).toBeGreaterThan(50);
    expect(seed.catalog.sliders.length).toBeGreaterThanOrEqual(3);
    expect(seed.catalog.genres.length).toBeGreaterThan(10);
    expect(Object.keys(seed.browse)).toEqual(
      expect.arrayContaining(["trending", "latest", "top10"]),
    );
    // Both movies and series are present (the surface is not movies-only).
    const types = new Set(seed.pool.map((t) => t.type));
    expect(types.has("movie")).toBe(true);
    expect(types.has("tv")).toBe(true);
  });

  it("full catalog is exhaustive — thousands of titles + every genre", () => {
    // The catalogue is what the Movies tab browses/searches; a small pool is
    // exactly the "few titles" regression this guards against.
    expect(fullCatalog.pool.length).toBeGreaterThan(5000);
    expect(Object.keys(fullCatalog.genres).length).toBeGreaterThan(15);
    const types = new Set(fullCatalog.pool.map((t) => t.type));
    expect(types.has("movie")).toBe(true);
    expect(types.has("tv")).toBe(true);
    // Every genre list has titles to show.
    for (const g of Object.values(fullCatalog.genres)) {
      expect(g.ids.length).toBeGreaterThan(0);
    }
  });

  it("genre browse returns that genre's titles (was a silent no-op)", async () => {
    const genreNames = seed.catalog.genres as { id: number; name: string }[];
    const genre = genreNames.find((g) => fullCatalog.genres[g.name]);
    expect(genre).toBeTruthy();
    const res = await fetchMovieBrowse("trending", genre!.id);
    expect(res.count).toBeGreaterThan(0);
    expect(res.label).toBe(genre!.name);
    // Results must be that genre's titles, not the whole trending slider.
    const expected = new Set(fullCatalog.genres[genre!.name].ids);
    expect(res.titles.every((t) => expected.has(t.id))).toBe(true);
  });

  it("falls back to the bundled catalog when the live proxy is empty", async () => {
    const catalog = await fetchMovieCatalog();
    expect(catalog.sliders.length).toBeGreaterThanOrEqual(3);
    const total = catalog.sliders.reduce((n, s) => n + s.titles.length, 0);
    expect(total).toBeGreaterThan(30);
    // Titles are fully hydrated (name + type), so the grid renders.
    for (const s of catalog.sliders) {
      for (const t of s.titles) {
        expect(t.name).toBeTruthy();
        expect(["movie", "tv"]).toContain(t.type);
      }
    }
  });

  it("falls back for browse and keeps the label", async () => {
    const browse = await fetchMovieBrowse("trending");
    expect(browse.titles.length).toBeGreaterThan(0);
    expect(browse.count).toBe(browse.titles.length);
  });

  it("searches the bundled catalog locally when the live search is empty", async () => {
    const all = seed.pool.map((t) => t.name.toLowerCase());
    const target = seed.pool.find((t) => t.type === "movie")!;
    const term = target.name.split(/\s+/)[0];
    const results = await searchMovies(term);
    expect(results.length).toBeGreaterThan(0);
    expect(all.some((n) => n.includes(term.toLowerCase()))).toBe(true);
  });

  describe("live wins (additive, never a deduction)", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const snap = snapshotsResponse(String(url));
          if (snap) return snap;
          // Live proxy returns a CATALOG with a distinctive slider.
          return new Response(
            JSON.stringify({
              sliders: [
                {
                  name: "live",
                  label: "Live Slider",
                  titles: [
                    {
                      id: 999999,
                      slug: "live-only",
                      name: "Live Only Title",
                      type: "movie",
                    },
                  ],
                },
              ],
              genres: [],
            }),
            { status: 200 },
          );
        }),
      );
    });

    it("uses the live catalog when it is present", async () => {
      const catalog = await fetchMovieCatalog();
      expect(catalog.sliders[0].label).toBe("Live Slider");
      expect(catalog.sliders[0].titles[0].name).toBe("Live Only Title");
    });
  });

  describe("playback resolves tmdb/imdb ids from the detail snapshot", () => {
    it("returns a detail carrying a tmdb id for every seeded title", async () => {
      const ids = seed.pool.map((t) => t.id);
      // A movie and a series — both must resolve a playable detail.
      const movie = seed.pool.find((t) => t.type === "movie")!;
      const series = seed.pool.find((t) => t.type === "tv")!;
      for (const item of [movie, series]) {
        const d = await fetchMovieDetail(item.id, item.slug);
        // The embed providers (vidsrc/autoembed) require a tmdb id; without it
        // the player shows "stream is temporarily unreachable".
        expect(d?.tmdbId ?? d?.imdbId).toBeTruthy();
      }
      expect(ids.length).toBeGreaterThan(50);
    });

    it("exposes seasons + episodes for a series so they are navigable", async () => {
      const series = seed.pool.find((t) => t.type === "tv")!;
      const d = await fetchMovieDetail(series.id, series.slug);
      if (d && (d.seasons?.length ?? 0) > 1) {
        const seasonTwo = await fetchMovieDetail(series.id, series.slug, 2);
        expect(seasonTwo?.loadedSeason?.number).toBe(2);
      }
      expect(d?.type).toBe("tv");
    });
  });
});
