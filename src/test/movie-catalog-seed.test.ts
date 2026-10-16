import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchMovieCatalog,
  fetchMovieBrowse,
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

function seedBody(): string {
  return JSON.stringify(seed);
}

describe("MovieService additive catalog fallback", () => {
  beforeEach(() => {
    // The bundled seed is fetched by URL — serve it from the local file.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("movies-seed.json")) {
          return new Response(seedBody(), { status: 200 });
        }
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
          const u = String(url);
          if (u.includes("movies-seed.json")) {
            return new Response(seedBody(), { status: 200 });
          }
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
});
