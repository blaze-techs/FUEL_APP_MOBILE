/**
 * Harvest per-title details (plot, tmdb/imdb ids, seasons + episodes) into
 * `public/movies-details.json`.
 *
 * Playback needs the tmdb/imdb id that only the detail page carries, and the
 * serverless proxy is datacenter-blocked upstream, so the bundled detail
 * snapshot is what makes a title playable at runtime.
 *
 * Additive + resumable: titles already present in the snapshot are skipped, so
 * re-running only fetches what is new.
 *
 * Usage:
 *   npx tsx scripts/harvest-movie-details.mts                # first-paint pool
 *   npx tsx scripts/harvest-movie-details.mts --all          # whole catalog
 *   npx tsx scripts/harvest-movie-details.mts --limit=500
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchSuPage,
  suTitlePath,
  pickImage,
} from "../src/server/vercel-api/_lib/streamingunity.js";

const ARGS = process.argv.slice(2);
const ALL = ARGS.includes("--all");
const LIMIT = Number(
  (ARGS.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0,
);
const CONCURRENCY = Number(
  (ARGS.find((a) => a.startsWith("--concurrency=")) || "").split("=")[1] || 8,
);
const DETAILS_PATH = resolve(process.cwd(), "public/movies-details.json");
const SEED_PATH = resolve(process.cwd(), "public/movies-seed.json");
const CATALOG_PATH = resolve(process.cwd(), "public/movies-catalog.json");

function normalizeDetail(t: any) {
  const year =
    (t.release_date || t.last_air_date || "").slice(0, 4) || undefined;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    type: t.type === "tv" ? "tv" : "movie",
    score: t.score || undefined,
    age: t.age ?? undefined,
    seasonsCount: t.seasons_count ?? undefined,
    year,
    poster: pickImage(t.images, "poster"),
    cover: pickImage(t.images, "cover") ?? pickImage(t.images, "background"),
    background: pickImage(t.images, "background"),
    logo: pickImage(t.images, "logo"),
    tmdbId: t.tmdb_id ?? null,
    imdbId: t.imdb_id ?? null,
    plot: t.plot ?? null,
    runtime: t.runtime ?? null,
    releaseDate: t.release_date ?? null,
    scwsId: t.scws_id ?? null,
    quality: t.quality ?? null,
    genres: (t.genres || []).map((g: any) => ({ id: g.id, name: g.name })),
    actors: (t.main_actors || []).map((a: any) => a.name),
    directors: (t.main_directors || []).map((d: any) => d.name),
    trailers: [],
    seasons: (t.seasons || []).map((s: any) => ({
      id: s.id,
      number: s.number,
      name: s.name ?? null,
    })),
    loadedSeason: null,
  };
}

async function poolRun<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
}

async function main() {
  const source = ALL && existsSync(CATALOG_PATH) ? CATALOG_PATH : SEED_PATH;
  const src = JSON.parse(readFileSync(source, "utf8")) as {
    pool: { id: number; slug: string; name: string; type: string }[];
  };
  let details: Record<string, any> = {};
  if (existsSync(DETAILS_PATH)) {
    try {
      details = JSON.parse(readFileSync(DETAILS_PATH, "utf8"));
    } catch {
      details = {};
    }
  }
  let todo = src.pool.filter((t) => !details[String(t.id)]);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  console.log(
    `→ ${src.pool.length} titles in ${source.split("/").pop()}, ${Object.keys(details).length} cached, ${todo.length} to fetch`,
  );

  let done = 0;
  await poolRun(todo, CONCURRENCY, async (item) => {
    try {
      const d = await fetchSuPage(suTitlePath(item.id, item.slug));
      const t = d?.props?.title;
      if (!t) return;
      const seasonsData: Record<string, any> = {};
      for (const s of t.seasons || []) {
        const sp = await fetchSuPage(
          `${suTitlePath(item.id, item.slug)}/season-${s.number}`,
        );
        const st = sp?.props?.title;
        if (st) seasonsData[String(s.number)] = normalizeDetail(st);
      }
      details[String(item.id)] = {
        detail: normalizeDetail(t),
        ...(Object.keys(seasonsData).length ? { seasonsData } : {}),
      };
    } catch {
      /* best-effort */
    } finally {
      done++;
      if (done % 50 === 0) {
        console.log(`  ${done}/${todo.length}`);
        writeFileSync(DETAILS_PATH, JSON.stringify(details));
      }
    }
  });
  writeFileSync(DETAILS_PATH, JSON.stringify(details));
  console.log(`✓ details: ${Object.keys(details).length} titles`);
}

await main();
