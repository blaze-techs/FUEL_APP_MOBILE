/**
 * Harvest the full streamingunity catalogue into the bundled snapshots
 * (`public/movies-seed.json` + `public/movies-details.json`).
 *
 * Why: the serverless proxies run on datacenter IPs that streamingunity
 * blocks, so at runtime the live catalogue can come back empty. The app then
 * falls back to these snapshots, and that fallback is what the Movies tab
 * shows. Keeping the snapshots as large as the real catalogue is therefore
 * the whole ballgame — a 128-title seed is why the tab looked "few".
 *
 * The harvester walks every slider and every genre to the end of its
 * pagination, so the pool grows to the full catalogue and stays ADDITIVE
 * (existing entries are never dropped).
 *
 * Usage:
 *   npx tsx scripts/harvest-movies.mts            # full (list + details)
 *   npx tsx scripts/harvest-movies.mts --no-details
 *   npx tsx scripts/harvest-movies.mts --max-pages=40
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchSuPage,
  suSliderPath,
  suTitlePath,
  SU_LOCALE,
  pickImage,
  type SuTitle,
} from "../src/server/vercel-api/_lib/streamingunity.js";

const ARGS = process.argv.slice(2);
const NO_DETAILS = ARGS.includes("--no-details");
const MAX_PAGES = Number(
  (ARGS.find((a) => a.startsWith("--max-pages=")) || "").split("=")[1] || 60,
);
const CONCURRENCY = Number(
  (ARGS.find((a) => a.startsWith("--concurrency=")) || "").split("=")[1] || 8,
);
const SEED_PATH = resolve(process.cwd(), "public/movies-seed.json");
const DETAILS_PATH = resolve(process.cwd(), "public/movies-details.json");

type SeedItem = {
  id: number;
  slug: string;
  name: string;
  type: "movie" | "tv";
  score?: string;
  age?: number;
  seasonsCount?: number;
  year?: string;
  poster?: string | null;
  cover?: string | null;
  background?: string | null;
  logo?: string | null;
  tmdbId?: number | null;
  imdbId?: string | null;
};

/** Map an upstream title to the compact shape the client renders. */
function toItem(t: SuTitle): SeedItem | null {
  if (!t?.id || !t?.slug || !t?.name) return null;
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
  };
}

/** Run `fn` over `items` with a bounded number of in-flight promises. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Walk a paginated browse route until it stops returning rows. */
async function walk(
  pathFor: (page: number) => string,
  onPage: (titles: SuTitle[], page: number) => void,
  label: string,
): Promise<void> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await fetchSuPage(pathFor(page));
    const titles: SuTitle[] = p?.props?.titles || [];
    if (titles.length === 0) break;
    onPage(titles, page);
    if (titles.length < 60) break; // last page
    if (page % 5 === 0)
      console.log(`  ${label} page ${page} (${titles.length})`);
  }
}

async function main() {
  const poolMap = new Map<number, SeedItem>();
  const sliderIds: Record<string, number[]> = {};

  console.log("→ home catalog");
  const home = await fetchSuPage(`/${SU_LOCALE}`);
  const sliders: any[] = home?.props?.sliders || [];
  const genres: any[] = (home?.props?.genres || []).map((g: any) => ({
    id: g.id,
    name: g.name,
    type: g.type,
  }));
  console.log(`  ${sliders.length} sliders, ${genres.length} genres`);

  const addTitles = (titles: SuTitle[]) => {
    for (const t of titles) {
      const item = toItem(t);
      if (item && !poolMap.has(item.id)) poolMap.set(item.id, item);
    }
  };

  // Seed every slider to the end of its pagination.
  for (const s of sliders) {
    const ids: number[] = [];
    console.log(`→ slider ${s.name}`);
    await walk(
      (pg) => `${suSliderPath(s.name)}?page=${pg}`,
      (titles) => {
        addTitles(titles);
        for (const t of titles) ids.push(t.id);
      },
      `slider ${s.name}`,
    );
    sliderIds[s.name] = ids;
    console.log(`  ${s.name}: ${ids.length} rows`);
  }

  // Walk every genre (this is what actually spans the catalogue).
  const genreIds: Record<string, number[]> = {};
  for (const g of genres) {
    const ids: number[] = [];
    await walk(
      (pg) =>
        `/${SU_LOCALE}/browse/genre?g=${encodeURIComponent(g.name)}&page=${pg}`,
      (titles) => {
        addTitles(titles);
        for (const t of titles) ids.push(t.id);
      },
      `genre ${g.name}`,
    );
    genreIds[g.name] = ids;
    console.log(`  genre ${g.name}: ${ids.length} rows`);
  }

  // Merge with any existing seed so the snapshot is ADDITIVE.
  let prev: any = null;
  if (existsSync(SEED_PATH)) {
    try {
      prev = JSON.parse(readFileSync(SEED_PATH, "utf8"));
      for (const t of prev.pool || [])
        if (!poolMap.has(t.id)) poolMap.set(t.id, t);
    } catch {
      /* ignore a corrupt previous seed */
    }
  }

  const poolArr = [...poolMap.values()].sort((a, b) => b.id - a.id);
  const seed = {
    pool: poolArr,
    catalog: {
      sliders: sliders.map((s) => ({
        name: s.name,
        label: s.label,
        ids: sliderIds[s.name] || [],
      })),
      genres,
    },
    browse: Object.fromEntries(
      sliders.map((s) => [
        s.name,
        { label: s.label, ids: sliderIds[s.name] || [] },
      ]),
    ),
    genres: Object.fromEntries(
      Object.entries(genreIds).map(([name, ids]) => [
        name,
        { label: name, ids },
      ]),
    ),
  };
  writeFileSync(SEED_PATH, JSON.stringify(seed));
  console.log(`✓ seed: ${poolArr.length} unique titles → ${SEED_PATH}`);

  if (NO_DETAILS) return;

  // ---- details (needed for playback ids + seasons) ----
  let details: Record<string, any> = {};
  if (existsSync(DETAILS_PATH)) {
    try {
      details = JSON.parse(readFileSync(DETAILS_PATH, "utf8"));
    } catch {
      details = {};
    }
  }
  const missing = poolArr.filter((t) => !details[String(t.id)]);
  console.log(
    `→ details: ${poolArr.length - missing.length} cached, ${missing.length} to fetch`,
  );

  let done = 0;
  await pool(missing, CONCURRENCY, async (item) => {
    try {
      const d = await fetchSuPage(suTitlePath(item.id, item.slug));
      const t = d?.props?.title;
      if (!t) return;
      const seasons: any[] = t.seasons || [];
      const seasonsData: Record<string, any> = {};
      for (const s of seasons) {
        const sp = await fetchSuPage(
          suTitlePath(item.id, item.slug) + `/season-${s.number}`,
        );
        const st = sp?.props?.title;
        if (st)
          seasonsData[String(s.number)] = {
            ...normalizeDetail(st),
            seasons: [],
          };
      }
      details[String(item.id)] = {
        detail: normalizeDetail(t),
        ...(Object.keys(seasonsData).length ? { seasonsData } : {}),
      };
    } catch {
      /* best-effort */
    } finally {
      done++;
      if (done % 100 === 0) console.log(`  details ${done}/${missing.length}`);
    }
  });
  writeFileSync(DETAILS_PATH, JSON.stringify(details));
  console.log(
    `✓ details: ${Object.keys(details).length} titles → ${DETAILS_PATH}`,
  );
}

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

await main();
