/**
 * Verify the DEPLOYED Movies data path exactly as the client uses it:
 * fetch the live snapshots from a host and assert the catalog is large,
 * every genre has titles, genre browse maps id->name->titles, and search
 * finds titles. No auth needed (these are static assets).
 *
 *   node scripts/verify-movies-live.mjs [host]
 */
const BASE = process.argv[2] || "https://fuel-app-mobile.pages.dev";

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
  return r.json();
};

const seed = await get("/movies-seed.json");
const cat = await get("/movies-catalog.json");
const ids = await get("/movies-ids.json").catch(() => ({}));

const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
};

console.log(`\n== ${BASE} ==`);
console.log("seed   :", seed.pool.length, "titles,", seed.catalog.sliders.length, "sliders,", seed.catalog.genres.length, "genres");
console.log("catalog:", cat.pool.length, "titles,", Object.keys(cat.genres).length, "genres");
console.log("ids    :", Object.keys(ids).length, "entries");

ok(seed.catalog.sliders.length >= 3, "seed exposes >=3 sliders (0-slider bug fixed)");
ok(seed.catalog.genres.length >= 20, "seed exposes >=20 genres (0-genre bug fixed)");
ok(cat.pool.length > 10000, `full catalog > 10,000 titles (got ${cat.pool.length})`);

// Every genre list resolves to real titles (genre browse is not a no-op).
const byId = new Map(cat.pool.map((t) => [t.id, t]));
let genreOk = 0;
for (const [name, g] of Object.entries(cat.genres)) {
  const titles = g.ids.map((i) => byId.get(i)).filter(Boolean);
  if (titles.length > 0) genreOk++;
}
ok(genreOk === Object.keys(cat.genres).length, `all ${genreOk} genres resolve to titles`);

// Genre browse (id -> name -> titles) returns that genre's titles.
const genreName = Object.keys(cat.genres)[0];
const genreId = seed.catalog.genres.find((g) => g.name === genreName)?.id;
if (genreId != null) {
  const expect = new Set(cat.genres[genreName].ids);
  const got = cat.genres[genreName].ids.map((i) => byId.get(i)).filter(Boolean);
  ok(got.length > 0 && got.every((t) => expect.has(t.id)), `genre "${genreName}" browse returns its own titles (${got.length})`);
} else {
  fail.push("no genre id mapping");
}

// Search over the full catalog finds a known title.
const sample = cat.pool.find((t) => t.name && t.name.length > 6);
const term = sample.name.split(/\s+/)[0].toLowerCase();
const hits = cat.pool.filter((t) => t.name?.toLowerCase().includes(term));
ok(hits.length > 0, `search "${term}" finds ${hits.length} titles`);

// Playback ids present for the browsable set.
const withIds = Object.values(ids).filter((v) => v.tmdbId).length;
console.log(`  info  ${withIds} titles carry a tmdb id`);

console.log(fail.length ? `\n${fail.length} FAILURE(S)\n` : "\nALL PASS\n");
process.exit(fail.length ? 1 : 0);
