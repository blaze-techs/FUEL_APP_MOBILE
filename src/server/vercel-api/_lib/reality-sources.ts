/**
 * Reality live-TV / radio sources (Pluto TV, DW, SomaFM).
 *
 * These are the genuinely-working live providers reverse-engineered from the
 * Reezn TV APK (reezntvapp.com). Reezn is a player that aggregates the
 * VAVOO / mHub addon platform; the mHub catalog exposes IPTV-ORG, Pluto TV,
 * DW and SomaFM among its live addons. Of those, the ones that serve a real,
 * CORS-reachable stream from a datacenter IP are:
 *
 *   - Pluto TV   — 400+ stitched channels, direct HLS, no auth
 *   - DW         — Deutsche Welle live HLS (akamaized, CORS `*`)
 *   - SomaFM     — 51 curated radio streams (direct MP3)
 *
 * The client never sees these upstream hostnames; everything is served
 * through the same-origin /api/live-channels proxy. Keep this file in sync
 * with the inlined copy in functions/api/live-channels.ts (Cloudflare Pages
 * Functions bundle each file independently).
 */

export interface RealityChannel {
  id: string;
  /** Display name. */
  name: string;
  /** Direct HLS (.m3u8) or audio stream URL. */
  url: string;
  logo: string;
  /** ISO-2 country code (lowercase) where known. */
  country: string;
  /** FuelPro category buckets this channel belongs to. */
  categories: string[];
  /** true = audio-only (radio), false = video. */
  audio: boolean;
  /** Custom User-Agent the stream requires (SomaFM rejects browser UAs). */
  userAgent?: string;
  source: string;
}

/** Pluto stitcher hosts — rotate for resilience (all serve the same catalog). */
const PLUTO_STITCHERS = [
  "https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv",
  "https://cfd-v4-service-channel-stitcher-use1-2.prd.pluto.tv",
];

/** Map a FuelPro category id to Pluto TV category names. */
const PLUTO_CATEGORY_MAP: Record<string, string[]> = {
  news: ["News + Opinion", "Local News"],
  movies: ["Movies", "Westerns"],
  sports: ["Sports"],
  kids: ["Kids"],
  documentary: ["History + Science", "True Crime"],
  entertainment: [
    "Entertainment",
    "Reality",
    "Competition Reality",
    "Daytime + Game Shows",
    "Home + Food",
  ],
  music: ["Music Videos"],
  series: ["Drama", "Comedy", "Classic TV", "Sci-Fi"],
  anime: ["Anime"],
  comedy: ["Comedy"],
};

export interface PlutoChannel {
  _id?: string;
  name?: string;
  number?: number;
  category?: string;
  slug?: string;
  logo?: string;
  colorLogoPNG?: string;
  solidLogoPNG?: string;
  featuredImage?: { path?: string };
  visibility?: string;
  isStitched?: boolean;
}

/**
 * Build a Pluto stitch (HLS) URL for a channel id. The query string mirrors
 * what pluto.tv's own web player sends; the values are cosmetic (geo hints +
 * a session id) and are NOT validated server-side.
 */
function plutoStitchUrl(channelId: string, region = "US"): string {
  const now = new Date().toISOString();
  const rand = () =>
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  const q = new URLSearchParams({
    advertisingId: "",
    appName: "web",
    appVersion: "9",
    architecture: "",
    buildVersion: "",
    clientTime: now,
    deviceDNT: "0",
    deviceId: rand(),
    deviceLat: "0",
    deviceLon: "0",
    deviceMake: "chrome",
    deviceModel: "web",
    deviceType: "web",
    deviceVersion: "unknown",
    includeExtendedEvents: "false",
    marketingRegion: region,
    sid: rand(),
    userId: "",
  });
  const host = PLUTO_STITCHERS[0];
  return `${host}/stitch/hls/channel/${channelId}/master.m3u8?${q.toString()}`;
}

/** Pluto logo preference order: colorLogoPNG > solidLogoPNG > logo > featuredImage. */
function plutoLogo(c: PlutoChannel): string {
  return (
    c.colorLogoPNG || c.solidLogoPNG || c.logo || c.featuredImage?.path || ""
  );
}

/**
 * Pluto's v2 API geo-detects the caller and IGNORES the `country` param, so
 * the same request returns the US catalog from one datacenter and the GB
 * catalog from another. The slug encodes the real region (e.g.
 * `pluto-tv-movies-gb-1`), so read the country from there rather than
 * labelling every channel with the requested region.
 */
const PLUTO_REGIONS = new Set([
  "us",
  "gb",
  "de",
  "fr",
  "es",
  "it",
  "br",
  "mx",
  "ca",
  "at",
  "se",
  "no",
  "dk",
  "nl",
  "be",
  "ch",
  "ie",
  "au",
  "ar",
  "cl",
  "co",
  "pe",
  "pt",
  "pl",
]);
function plutoRegionFromSlug(
  slug: string | undefined,
  fallback: string,
): string {
  if (slug) {
    const tokens = slug.split("-");
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (PLUTO_REGIONS.has(tokens[i])) return tokens[i];
    }
  }
  return fallback.toLowerCase();
}

/**
 * Fetch the Pluto TV channel catalog. `country` may be lowercase ISO-2;
 * Pluto's v2 API only serves a handful of regions, so anything unrecognised
 * falls back to US. `category` (FuelPro id) narrows the result when given.
 */
export async function fetchPlutoChannels(
  country = "",
  category = "",
): Promise<RealityChannel[]> {
  const region = (country || "us").toUpperCase();
  const supported = new Set([
    "US",
    "GB",
    "DE",
    "FR",
    "ES",
    "IT",
    "BR",
    "MX",
    "CA",
    "AT",
  ]);
  const useRegion = supported.has(region) ? region : "US";

  let list: PlutoChannel[];
  try {
    const res = await fetch(
      `https://api.pluto.tv/v2/channels?country=${useRegion}`,
      {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      },
    );
    if (!res.ok) return [];
    list = (await res.json()) as PlutoChannel[];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];

  const wanted =
    category && PLUTO_CATEGORY_MAP[category]
      ? new Set(PLUTO_CATEGORY_MAP[category])
      : null;

  const out: RealityChannel[] = [];
  for (const c of list) {
    if (!c || !c._id || !c.name) continue;
    // Pluto's API reports visibility values like "everyone" / "published";
    // only skip entries explicitly marked as hidden.
    if (c.visibility && c.visibility === "hidden") continue;
    if (c.isStitched === false) continue;
    if (wanted && !wanted.has(c.category || "")) continue;
    const realRegion = plutoRegionFromSlug(c.slug, useRegion);
    out.push({
      id: `pluto-${c._id}`,
      name: c.name.replace(/^\d+\.\s*/, "").trim() || c.name,
      url: plutoStitchUrl(c._id, realRegion.toUpperCase()),
      logo: plutoLogo(c),
      country: realRegion,
      categories: [c.category || "", "movies", "entertainment"].filter(Boolean),
      audio: false,
      source: "pluto",
    });
  }
  return out;
}

/** Deutsche Welle live channels (akamaized HLS, CORS `*`). */
const DW_CHANNELS: Array<{
  name: string;
  url: string;
  logo: string;
  lang: string;
}> = [
  {
    name: "DW English",
    url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8",
    logo: "https://static.dw.com/image/51698684_605.jpg",
    lang: "en",
  },
  {
    name: "DW Español",
    url: "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/master.m3u8",
    logo: "https://static.dw.com/image/48752981_605.jpg",
    lang: "es",
  },
  {
    name: "DW عربية",
    url: "https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/master.m3u8",
    logo: "https://static.dw.com/image/76507249_605.jpg",
    lang: "ar",
  },
  {
    name: "DW на русском",
    url: "https://dwamdstream110.akamaized.net/hls/live/2017971/dwstream110/master.m3u8",
    logo: "",
    lang: "ru",
  },
];

/** DW live news channels. Always tagged `news` (+ `entertainment`). */
export function fetchDwChannels(): RealityChannel[] {
  return DW_CHANNELS.map((c) => ({
    id: `dw-${c.lang}`,
    name: c.name,
    url: c.url,
    logo: c.logo,
    country: "de",
    categories: ["news", "entertainment"],
    audio: false,
    source: "dw",
  }));
}

interface SomaChannel {
  id?: string;
  title?: string;
  description?: string;
  listeners?: string;
  playlists?: Array<{ url?: string; format?: string; quality?: string }>;
}

/**
 * Resolve a SomaFM `.pls` playlist to a direct stream URL (the first `FileN=`
 * entry). The `.pls` hostnames rotate (ice2/ice5/ice6…), so resolving live is
 * more reliable than hard-coding one.
 */
async function somaPlsToStream(plsUrl: string): Promise<string> {
  try {
    const res = await fetch(plsUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    const m = text.match(/^\s*File\d+\s*=\s*(\S+)/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

/**
 * Fetch the SomaFM station directory (51 curated radio streams). Each station
 * is resolved through its `.pls` to the first direct stream URL so the player
 * needs no playlist handler.
 */
export async function fetchSomaFmChannels(): Promise<RealityChannel[]> {
  let chans: SomaChannel[];
  try {
    const res = await fetch("https://somafm.com/channels.json", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { channels?: SomaChannel[] };
    chans = data.channels || [];
  } catch {
    return [];
  }
  if (!Array.isArray(chans)) return [];

  // Prefer the highest-quality mp3 .pls for each station, then resolve the
  // direct stream in parallel across all stations.
  const drafts = chans
    .filter((c) => c?.id && c?.title)
    .map((c) => {
      const mp3s = (c.playlists || [])
        .filter((p) => p?.url && /pls$/i.test(p.url) && p.format === "mp3")
        .sort(
          (a, b) =>
            (parseInt(a.quality || "0", 10) || 0) -
            (parseInt(b.quality || "0", 10) || 0),
        );
      return { c, pls: mp3s[0]?.url || "" };
    })
    .filter((d) => d.pls);

  const resolved = await Promise.all(
    drafts.map(async (d) => ({ ...d, stream: await somaPlsToStream(d.pls) })),
  );

  const out: RealityChannel[] = [];
  for (const d of resolved) {
    if (!d.stream) continue;
    out.push({
      id: `somafm-${d.c.id}`,
      name: d.c.title || d.c.id || "SomaFM",
      url: d.stream,
      logo: `https://somafm.com/img3/${d.c.id}-400.jpg`,
      country: "us",
      categories: ["music", "relax", "entertainment"],
      audio: true,
      // SomaFM rejects browser User-Agents with 403 on the ice* hosts; a
      // media-player UA is required, so carry it to the same-origin proxy.
      userAgent: "VLC/3.0.20 LibVLC/3.0.20",
      source: "somafm",
    });
  }
  return out;
}

/**
 * Fetch every reality source applicable to a request. Video sources
 * (Pluto + DW) are returned for the video family; SomaFM for the audio
 * family. `category` narrows Pluto; DW is news-first but included broadly.
 */
export async function fetchRealityChannels(
  family: "video" | "audio",
  category = "",
  country = "",
): Promise<RealityChannel[]> {
  if (family === "audio") {
    return fetchSomaFmChannels();
  }
  const [pluto, dw] = await Promise.all([
    fetchPlutoChannels(country, category),
    Promise.resolve(fetchDwChannels()),
  ]);
  // DW only makes sense for news/general tabs; skip it for narrow genres.
  const dwOk =
    !category || ["news", "entertainment", "business", "tv"].includes(category);
  return [...pluto, ...(dwOk ? dw : [])];
}
