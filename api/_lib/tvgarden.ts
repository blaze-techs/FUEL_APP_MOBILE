/**
 * tvgarden.world reverse-engineered backend library.
 *
 * Source: https://tvgarden.world/ — a free public live-TV / live-radio
 * directory. Its JSON API is undocumented, so this module captures the
 * reverse-engineered contract discovered by probing the endpoints +
 * sitemaps + decompression layers.
 *
 * API shape (all return JSON arrays of channels):
 *   GET https://tvgarden.world/api/{mode}/{type}/{id}.json
 *     mode = "tv" | "radio"
 *     type = "countries" | "categories"
 *     id   = lowercase ISO-3166 alpha-2 country code (e.g. "us")
 *            OR a category id (e.g. "news", "movies", "rock")
 *
 * Compression (the non-obvious part):
 *   The origin serves the JSON gzip-compressed. Cloudflare (the CDN in
 *   front of tvgarden) then applies brotli on top, so the wire bytes are
 *   brotli(gzip(json)). fetch() auto-decompresses the OUTER brotli layer
 *   (via the `content-encoding: br` header), leaving gzip(json) bytes in
 *   the response body. This module then gunzips the inner layer.
 *   - Cloudflare Workers: DecompressionStream("gzip") (Web Streams API).
 *   - Vercel Node: zlib.gunzipSync.
 *
 * This module is shared by:
 *   - api/live-channels.ts           (Vercel serverless)
 *   - functions/api/live-channels.ts (Cloudflare Pages Function)
 *   - api/tvgarden.ts                (Vercel catalog endpoint)
 *   - functions/api/tvgarden.ts      (Cloudflare catalog endpoint)
 *
 * No upstream hostname is ever exposed to the browser — every request goes
 * through our /api/* proxies, so there is zero upstream attribution in the UI.
 */

export type TvgMode = "tv" | "radio";
export type TvgType = "countries" | "categories";

/** A channel as returned by the tvgarden JSON API. */
export interface TvgChannel {
  nanoid: string;
  name: string;
  stream_urls: string[];
  youtube_urls: string[];
  languages: string[];
  country: string;
  isGeoBlocked: boolean;
}

/**
 * The complete reverse-engineered catalog of available countries (218,
 * ISO-3166 alpha-2 codes, lowercase). Derived from
 * https://tvgarden.world/sitemap_countries.xml — every code there has a
 * working /api/tv/countries/{cc}.json + /api/radio/countries/{cc}.json.
 */
export const TVGARDEN_COUNTRIES: string[] = (
  "ad ae af ag ai al am ao ar as at au aw ax az ba bb bd be bf bg bh bi bj " +
  "bm bn bo bq br bs bw by bz ca cc cd cf cg ch ci cl cn co cr cu cv cw cy " +
  "cz de dk dm do dz ec ee eg er es et fi fk fm fo fr ga gd ge gf gg gh gi " +
  "gl gn gp gr gt gu gw gy hk hn hr ht hu id ie il im in io iq ir is it jm " +
  "jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly " +
  "ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc " +
  "ne ng ni nl no np nz om pa pe pf ph pk pl pm pr ps pt pw py qa re ro rs " +
  "ru rw sa sd se sg sh si sk sl sm sn so sr sv sx sy td tf tg th tj tm tn " +
  "to tr tt tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws xk ye yt za " +
  "zm zw"
).split(" ");

/** A category id -> human label map (TV). 27 categories (all return 200). */
export const TVGARDEN_TV_CATEGORIES: { id: string; label: string }[] = [
  { id: "news", label: "News" },
  { id: "movies", label: "Movies" },
  { id: "sports", label: "Sports" },
  { id: "music", label: "Music" },
  { id: "entertainment", label: "Entertainment" },
  { id: "kids", label: "Kids" },
  { id: "documentary", label: "Documentary" },
  { id: "education", label: "Education" },
  { id: "religious", label: "Religious" },
  { id: "business", label: "Business" },
  { id: "general", label: "General" },
  { id: "family", label: "Family" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "culture", label: "Culture" },
  { id: "classic", label: "Classic" },
  { id: "weather", label: "Weather" },
  { id: "travel", label: "Travel" },
  { id: "auto", label: "Auto" },
  { id: "animation", label: "Animation" },
  { id: "comedy", label: "Comedy" },
  { id: "cooking", label: "Cooking" },
  { id: "legislative", label: "Legislative" },
  { id: "outdoor", label: "Outdoor" },
  { id: "relax", label: "Relax" },
  { id: "science", label: "Science" },
  { id: "series", label: "Series" },
  { id: "shop", label: "Shop" },
];

/** A category id -> human label map (Radio). 22 categories (all return 200). */
export const TVGARDEN_RADIO_CATEGORIES: { id: string; label: string }[] = [
  { id: "news", label: "News" },
  { id: "talk", label: "Talk" },
  { id: "sports", label: "Sports" },
  { id: "politics", label: "Politics" },
  { id: "hits", label: "Hits" },
  { id: "pop", label: "Pop" },
  { id: "rock", label: "Rock" },
  { id: "electronic", label: "Electronic" },
  { id: "indie", label: "Indie" },
  { id: "metal", label: "Metal" },
  { id: "jazz", label: "Jazz" },
  { id: "classical", label: "Classical" },
  { id: "soul", label: "Soul" },
  { id: "blues", label: "Blues" },
  { id: "reggae", label: "Reggae" },
  { id: "folk", label: "Folk" },
  { id: "country", label: "Country" },
  { id: "latin", label: "Latin" },
  { id: "schlager", label: "Schlager" },
  { id: "oldies", label: "Oldies" },
  { id: "chill", label: "Chill" },
  { id: "christmas", label: "Christmas" },
  { id: "religious", label: "Religious" },
];

/** ISO-2 -> human country name (subset; the rest fall back to uppercase code). */
export const TVGARDEN_COUNTRY_NAMES: Record<string, string> = {
  ad: "Andorra",
  ae: "United Arab Emirates",
  af: "Afghanistan",
  ag: "Antigua & Barbuda",
  ai: "Anguilla",
  al: "Albania",
  am: "Armenia",
  ao: "Angola",
  ar: "Argentina",
  as: "American Samoa",
  at: "Austria",
  au: "Australia",
  aw: "Aruba",
  ax: "Åland Islands",
  az: "Azerbaijan",
  ba: "Bosnia & Herzegovina",
  bb: "Barbados",
  bd: "Bangladesh",
  be: "Belgium",
  bf: "Burkina Faso",
  bg: "Bulgaria",
  bh: "Bahrain",
  bi: "Burundi",
  bj: "Benin",
  bm: "Bermuda",
  bn: "Brunei Darussalam",
  bo: "Bolivia",
  bq: "Bonaire",
  br: "Brazil",
  bs: "Bahamas",
  bw: "Botswana",
  by: "Belarus",
  bz: "Belize",
  ca: "Canada",
  cc: "Cocos Islands",
  cd: "DR Congo",
  cf: "Central African Rep.",
  cg: "Congo",
  ch: "Switzerland",
  ci: "Côte d'Ivoire",
  cl: "Chile",
  cn: "China",
  co: "Colombia",
  cr: "Costa Rica",
  cu: "Cuba",
  cv: "Cape Verde",
  cw: "Curaçao",
  cy: "Cyprus",
  cz: "Czechia",
  de: "Germany",
  dk: "Denmark",
  dm: "Dominica",
  do: "Dominican Rep.",
  dz: "Algeria",
  ec: "Ecuador",
  ee: "Estonia",
  eg: "Egypt",
  er: "Eritrea",
  es: "Spain",
  et: "Ethiopia",
  fi: "Finland",
  fk: "Falkland Islands",
  fm: "Micronesia",
  fo: "Faroe Islands",
  fr: "France",
  ga: "Gabon",
  gd: "Grenada",
  ge: "Georgia",
  gf: "French Guiana",
  gg: "Guernsey",
  gh: "Ghana",
  gi: "Gibraltar",
  gl: "Greenland",
  gn: "Guinea",
  gp: "Guadeloupe",
  gr: "Greece",
  gt: "Guatemala",
  gu: "Guam",
  gw: "Guinea-Bissau",
  gy: "Guyana",
  hk: "Hong Kong",
  hn: "Honduras",
  hr: "Croatia",
  ht: "Haiti",
  hu: "Hungary",
  id: "Indonesia",
  ie: "Ireland",
  il: "Israel",
  im: "Isle of Man",
  in: "India",
  io: "British Indian Ocean",
  iq: "Iraq",
  ir: "Iran",
  is: "Iceland",
  it: "Italy",
  jm: "Jamaica",
  jo: "Jordan",
  jp: "Japan",
  ke: "Kenya",
  kg: "Kyrgyzstan",
  kh: "Cambodia",
  ki: "Kiribati",
  km: "Comoros",
  kn: "St. Kitts & Nevis",
  kp: "North Korea",
  kr: "South Korea",
  kw: "Kuwait",
  ky: "Cayman Islands",
  kz: "Kazakhstan",
  la: "Laos",
  lb: "Lebanon",
  lc: "St. Lucia",
  li: "Liechtenstein",
  lk: "Sri Lanka",
  lr: "Liberia",
  ls: "Lesotho",
  lt: "Lithuania",
  lu: "Luxembourg",
  lv: "Latvia",
  ly: "Libya",
  ma: "Morocco",
  mc: "Monaco",
  md: "Moldova",
  me: "Montenegro",
  mg: "Madagascar",
  mh: "Marshall Islands",
  mk: "North Macedonia",
  ml: "Mali",
  mm: "Myanmar",
  mn: "Mongolia",
  mo: "Macao",
  mp: "Northern Mariana Islands",
  mq: "Martinique",
  mr: "Mauritania",
  ms: "Montserrat",
  mt: "Malta",
  mu: "Mauritius",
  mv: "Maldives",
  mw: "Malawi",
  mx: "Mexico",
  my: "Malaysia",
  mz: "Mozambique",
  na: "Namibia",
  nc: "New Caledonia",
  ne: "Niger",
  ng: "Nigeria",
  ni: "Nicaragua",
  nl: "Netherlands",
  no: "Norway",
  np: "Nepal",
  nz: "New Zealand",
  om: "Oman",
  pa: "Panama",
  pe: "Peru",
  pf: "French Polynesia",
  ph: "Philippines",
  pk: "Pakistan",
  pl: "Poland",
  pm: "St. Pierre & Miquelon",
  pr: "Puerto Rico",
  ps: "Palestine",
  pt: "Portugal",
  pw: "Palau",
  py: "Paraguay",
  qa: "Qatar",
  re: "Réunion",
  ro: "Romania",
  rs: "Serbia",
  ru: "Russia",
  rw: "Rwanda",
  sa: "Saudi Arabia",
  sd: "Sudan",
  se: "Sweden",
  sg: "Singapore",
  sh: "St. Helena",
  si: "Slovenia",
  sk: "Slovakia",
  sl: "Sierra Leone",
  sm: "San Marino",
  sn: "Senegal",
  so: "Somalia",
  sr: "Suriname",
  sv: "El Salvador",
  sx: "Sint Maarten",
  sy: "Syria",
  td: "Chad",
  tf: "French Southern",
  tg: "Togo",
  th: "Thailand",
  tj: "Tajikistan",
  tm: "Turkmenistan",
  tn: "Tunisia",
  to: "Tonga",
  tr: "Turkey",
  tt: "Trinidad & Tobago",
  tw: "Taiwan",
  tz: "Tanzania",
  ua: "Ukraine",
  ug: "Uganda",
  uk: "United Kingdom",
  us: "United States",
  uy: "Uruguay",
  uz: "Uzbekistan",
  va: "Vatican City",
  vc: "St. Vincent",
  ve: "Venezuela",
  vg: "British Virgin Islands",
  vi: "U.S. Virgin Islands",
  vn: "Vietnam",
  vu: "Vanuatu",
  wf: "Wallis & Futuna",
  ws: "Samoa",
  xk: "Kosovo",
  ye: "Yemen",
  yt: "Mayotte",
  za: "South Africa",
  zm: "Zambia",
  zw: "Zimbabwe",
};

/** Resolve a country code to a human name (falls back to uppercase code). */
export function countryName(code: string): string {
  return TVGARDEN_COUNTRY_NAMES[code.toLowerCase()] || code.toUpperCase();
}

/** The full catalog (countries + TV + radio categories) for the index endpoint. */
export function tvgardenCatalog() {
  return {
    countries: TVGARDEN_COUNTRIES.map((c) => ({
      code: c,
      name: countryName(c),
    })),
    tvCategories: TVGARDEN_TV_CATEGORIES,
    radioCategories: TVGARDEN_RADIO_CATEGORIES,
    sourceCount: {
      countries: TVGARDEN_COUNTRIES.length,
      tvCategories: TVGARDEN_TV_CATEGORIES.length,
      radioCategories: TVGARDEN_RADIO_CATEGORIES.length,
    },
  };
}

/** Validate a mode/type/id combination against the reverse-engineered catalog. */
export function isValidTvgRequest(
  mode: string,
  type: string,
  id: string,
): boolean {
  if (mode !== "tv" && mode !== "radio") return false;
  if (type !== "countries" && type !== "categories") return false;
  if (!id) return false;
  if (type === "countries") {
    return TVGARDEN_COUNTRIES.includes(id.toLowerCase());
  }
  // categories: accept any known category id (tv or radio). We don't strictly
  // enforce mode-specific category lists because tvgarden returns 200 for
  // cross-mode category requests too (e.g. /api/tv/categories/news.json).
  const all = new Set<string>();
  TVGARDEN_TV_CATEGORIES.forEach((c) => all.add(c.id));
  TVGARDEN_RADIO_CATEGORIES.forEach((c) => all.add(c.id));
  return all.has(id.toLowerCase());
}

/** Build the upstream URL for a given request. */
export function tvgardenUrl(mode: TvgMode, type: TvgType, id: string): string {
  return `https://tvgarden.world/api/${mode}/${type}/${id.toLowerCase()}.json`;
}

/**
 * Decode the tvgarden response body to JSON.
 *
 * The body is gzip-compressed JSON (the origin gzip-compresses, then the CDN
 * may add brotli on top — fetch() auto-removes the brotli layer via the
 * `content-encoding` header, leaving gzip bytes). This handles BOTH the
 * double-compressed case and the plain-JSON case (defensive).
 *
 * Works in both Node (Vercel) and Workers (Cloudflare) because it uses
 * DecompressionStream (Web Streams API) — available in both runtimes since
 * Node 18+ and the Workers runtime.
 */
export async function decodeTvgardenBody(
  buffer: ArrayBuffer,
): Promise<TvgChannel[]> {
  const bytes = new Uint8Array(buffer);

  // gzip magic bytes 0x1f 0x8b -> decompress the inner gzip layer
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as TvgChannel[]) : [];
  }

  // Otherwise it's already plain JSON (defensive fallback)
  const text = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as TvgChannel[]) : [];
  } catch {
    return [];
  }
}

/**
 * Filter out channels with no playable URL (never surface dead streams).
 * Keeps channels that have either an HLS stream_url OR a youtube_url.
 */
export function filterPlayable(channels: TvgChannel[]): TvgChannel[] {
  return channels.filter(
    (ch) =>
      (Array.isArray(ch.stream_urls) && ch.stream_urls.length > 0) ||
      (Array.isArray(ch.youtube_urls) && ch.youtube_urls.length > 0),
  );
}
