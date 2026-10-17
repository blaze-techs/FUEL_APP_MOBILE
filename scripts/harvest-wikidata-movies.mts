/**
 * Harvest a GLOBAL movie/series catalogue from Wikidata into
 * `public/movies-global.json`.
 *
 * Why Wikidata: streamingunity (the playable upstream) only carries ~17k
 * titles, but the embed providers we fall back to (vidsrc.to / 2embed) key on
 * an **IMDb id** (and TMDB). Wikidata carries an IMDb id (P345) for every
 * notable film/series — hundreds of thousands — so it is the widest keyless
 * source we can add without an API key.
 *
 * Output entry: { imdb, tmdb?, name, year, type, poster? }
 *   - imdb  : tt-id, the playback key for the embed providers
 *   - tmdb  : not present on Wikidata; the player resolves imdb -> provider
 *   - poster: Wikidata image (P18, Wikimedia Commons) when present
 *
 * Resumable: rows already written are kept; pages continue from the last
 * offset recorded in the file itself.
 *
 * Usage:
 *   npx tsx scripts/harvest-wikidata-movies.mts --limit=200000
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ARGS = process.argv.slice(2);
const LIMIT = Number(
  (ARGS.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 200000,
);
const PAGE = 5000;
const OUT = resolve(process.cwd(), "public/movies-global.json");
const UA = "FuelPro/1.0 (catalogue harvest; contact@fuelpro.com)";

interface GlobalEntry {
  imdb: string;
  name: string;
  year: number | null;
  type: "movie" | "tv";
  poster?: string | null;
}

/**
 * Compact on-disk form: `[imdb, name, year, tmdb]` rows (year/tmdb null when
 * unknown). A 300k-title catalogue is ~10 MB this way vs ~20 MB as objects,
 * and it parses faster in the browser. `type` is implied by which array it is
 * in.
 *
 * The TMDB id is captured because it is the key MOST embed providers use;
 * ~280k Wikidata titles carry both an IMDb (P345) and a TMDB id (P4947 for
 * films, P4983 for series), which is what makes playback resolve instead of
 * falling through to "stream is temporarily unreachable".
 */
type GlobalRow = [string, string, number | null, number | null];

/**
 * IMDb id space is not dense, so we sweep fixed windows and recurse on any
 * window that fills the page limit (rather than OFFSET, which is
 * non-deterministic without ORDER BY — and ORDER BY times out on the public
 * endpoint). This gives complete, resumable coverage.
 */
const RANGE_STEP = 1000000;
const RANGE_MIN = 0;
const RANGE_MAX = 40000000;

function sparql(itemType: string, tmdbProp: string, lo: number, hi: number): string {
  const pad = (n: number) => String(n).padStart(7, "0");
  return `SELECT ?item ?itemLabel ?imdb ?year ?tmdb WHERE {
  ?item wdt:P31 wd:${itemType} .
  ?item wdt:P345 ?imdb .
  FILTER(?imdb >= "tt${pad(lo)}" && ?imdb < "tt${pad(hi)}")
  OPTIONAL { ?item wdt:${tmdbProp} ?tmdb }
  OPTIONAL { ?item wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT ${PAGE}`;
}

async function runQuery(query: string): Promise<any[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.results?.bindings ?? [];
    } catch (e) {
      console.log(`  retry ${attempt + 1}: ${String(e).slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return [];
}

function commonsImage(url?: string): string | null {
  if (!url) return null;
  // Commons FilePath serves the file; 320px thumb keeps the payload small.
  const file = url.split("/").pop();
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=320`;
}

async function main() {
  const state: {
    movies: GlobalRow[];
    tv: GlobalRow[];
    done: boolean;
    cursor: number;
    phase: "movies" | "tv" | "done";
    pending?: [number, number][];
  } = existsSync(OUT)
    ? (() => {
        try {
          const p = JSON.parse(readFileSync(OUT, "utf8"));
          return {
            movies: p.movies ?? [],
            tv: p.tv ?? [],
            done: p.done ?? false,
            cursor: p.cursor ?? RANGE_MIN,
            phase: p.phase ?? "movies",
            pending: p.pending,
          };
        } catch {
          return {
            movies: [],
            tv: [],
            done: false,
            cursor: RANGE_MIN,
            phase: "movies" as const,
          };
        }
      })()
    : { movies: [], tv: [], done: false, cursor: RANGE_MIN, phase: "movies" };

  const seen = new Set([...state.movies, ...state.tv].map((e) => e[0]));
  let sinceWrite = 0;
  const persist = () => writeFileSync(OUT, JSON.stringify(state));

  const add = (rows: any[], bucket: "movies" | "tv") => {
    let added = 0;
    for (const r of rows) {
      const imdb = r.imdb?.value;
      const name = r.itemLabel?.value;
      if (!imdb || !name || /^Q\d+$/.test(name) || seen.has(imdb)) continue;
      seen.add(imdb);
      state[bucket].push([
        imdb,
        name,
        r.year?.value ? Number(r.year.value) : null,
        r.tmdb?.value ? Number(r.tmdb.value) : null,
      ]);
      added++;
    }
    sinceWrite += added;
    if (sinceWrite >= 5000) {
      persist();
      sinceWrite = 0;
    }
    return added;
  };

  const harvest = async (
    bucket: "movies" | "tv",
    itemType: string,
    tmdbProp: string,
  ) => {
    // Adaptive windowing: start wide (1M) and split any window that fills the
    // page limit. Dense early-IMDb ranges subdivide automatically, sparse
    // modern ranges complete in one query each — complete coverage without
    // wasting a query per fixed step. The pending stack is persisted so a
    // restart resumes exactly where it stopped.
    const stack: [number, number][] =
      state.pending && state.pending.length
        ? state.pending
        : (() => {
            const s: [number, number][] = [];
            for (let lo = 0; lo < RANGE_MAX; lo += RANGE_STEP)
              s.push([lo, Math.min(lo + RANGE_STEP, RANGE_MAX)]);
            return s;
          })();
    let done = 0;
    while (stack.length) {
      const [lo, hi] = stack.pop()!;
      const rows = await runQuery(sparql(itemType, tmdbProp, lo, hi));
      add(rows, bucket);
      if (rows.length >= PAGE && hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        stack.push([lo, mid], [mid, hi]);
      } else {
        done++;
      }
      state.pending = stack;
      if (done % 20 === 0) {
        persist();
        console.log(
          `${bucket} @ tt${String(hi).padStart(7, "0")}: movies ${state.movies.length} / tv ${state.tv.length} (queue ${stack.length})`,
        );
      }
      if (state.movies.length + state.tv.length >= LIMIT) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    state.pending = [];
    persist();
  };

  if (state.phase === "movies") {
    await harvest("movies", "Q11424", "P4947");
    state.phase = "tv";
    state.cursor = RANGE_MIN;
    persist();
  }
  if (state.phase === "tv") {
    await harvest("tv", "Q5398426", "P4983");
    state.phase = "done";
    state.done = true;
    persist();
  }
  console.log(
    `✓ global: ${state.movies.length} movies + ${state.tv.length} tv = ${state.movies.length + state.tv.length}`,
  );
}

await main();
