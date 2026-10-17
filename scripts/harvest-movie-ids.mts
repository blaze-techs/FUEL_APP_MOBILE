/**
 * Harvest a COMPACT per-title id map for the whole catalogue into
 * `public/movies-ids.json`: { [id]: { tmdbId, imdbId, type, seasonsCount } }.
 *
 * Playback needs a tmdb (or imdb) id, and only the upstream detail page
 * carries it. The rich `movies-details.json` (plot/actors/seasons) is kept for
 * the browsable first-paint set; this compact map covers EVERY title at a
 * fraction of the size (~200 bytes each vs ~3 KB), so opening any title from
 * search/genre browse still resolves a playable id.
 *
 * Resumable: titles already present are skipped.
 *
 * Usage:
 *   npx tsx scripts/harvest-movie-ids.mts
 *   npx tsx scripts/harvest-movie-ids.mts --limit=500
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchSuPage,
  suTitlePath,
} from "../src/server/vercel-api/_lib/streamingunity.js";

const ARGS = process.argv.slice(2);
const LIMIT = Number(
  (ARGS.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0,
);
const CONCURRENCY = Number(
  (ARGS.find((a) => a.startsWith("--concurrency=")) || "").split("=")[1] || 10,
);
const IDS_PATH = resolve(process.cwd(), "public/movies-ids.json");
const CATALOG_PATH = resolve(process.cwd(), "public/movies-catalog.json");

interface IdEntry {
  tmdbId: number | null;
  imdbId: string | null;
  type: "movie" | "tv";
  seasonsCount: number;
}

async function main() {
  const src = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as {
    pool: { id: number; slug: string; type: string }[];
  };
  let map: Record<string, IdEntry> = {};
  if (existsSync(IDS_PATH)) {
    try {
      map = JSON.parse(readFileSync(IDS_PATH, "utf8"));
    } catch {
      map = {};
    }
  }
  let todo = src.pool.filter((t) => !map[String(t.id)]);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  console.log(
    `→ ${src.pool.length} titles, ${Object.keys(map).length} cached, ${todo.length} to fetch`,
  );

  let done = 0;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, todo.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= todo.length) return;
        const item = todo[i];
        try {
          const d = await fetchSuPage(suTitlePath(item.id, item.slug));
          const t = d?.props?.title;
          if (t) {
            map[String(item.id)] = {
              tmdbId: t.tmdb_id ?? null,
              imdbId: t.imdb_id ?? null,
              type: t.type === "tv" ? "tv" : "movie",
              seasonsCount: t.seasons_count ?? 0,
            };
          }
        } catch {
          /* best-effort */
        } finally {
          done++;
          if (done % 200 === 0) {
            console.log(`  ${done}/${todo.length}`);
            writeFileSync(IDS_PATH, JSON.stringify(map));
          }
        }
      }
    },
  );
  await Promise.all(workers);
  writeFileSync(IDS_PATH, JSON.stringify(map));
  const withTmdb = Object.values(map).filter((e) => e.tmdbId).length;
  console.log(
    `✓ ids: ${Object.keys(map).length} titles (${withTmdb} with tmdb)`,
  );
}

await main();
