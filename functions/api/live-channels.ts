/**
 * Cloudflare Pages Function — Live Channels API
 *
 * Reverse-engineered proxy for the tvgarden.world live-channel JSON API.
 * Mirrors the Vercel handler in api/live-channels.ts. The reverse-engineered
 * contract (endpoint shape, double compression, full 218-country +
 * 27-TV-category + 22-radio-category catalog) is captured inline here because
 * Cloudflare Pages Functions bundle each file independently (no cross-file
 * imports from api/_lib). Keep this in sync with api/_lib/tvgarden.ts.
 *
 * Lives at functions/api/live-channels.ts → /api/live-channels
 *
 * GET /api/live-channels?mode=tv|radio&type=countries|categories&id=us|news
 *
 * Returns: { channels: TvgChannel[], count: number }
 */

interface TvgChannel {
  nanoid: string;
  name: string;
  stream_urls: string[];
  youtube_urls: string[];
  languages: string[];
  country: string;
  isGeoBlocked: boolean;
}

interface Env {}

// ── Reality sources (Pluto TV / DW / SomaFM) ────────────────────────────────
// Reverse-engineered from the Reezn TV APK (reezntvapp.com). Reezn is a
// player over the VAVOO/mHub addon platform; the live addons that serve a
// real, CORS-reachable stream from a datacenter IP are Pluto TV, DW and
// SomaFM. Inlined here (Cloudflare bundles each function independently) —
// keep in sync with src/server/vercel-api/_lib/reality-sources.ts.
const PLUTO_STITCHERS = [
  "https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv",
  "https://cfd-v4-service-channel-stitcher-use1-2.prd.pluto.tv",
];
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
function plutoStitchUrl(channelId: string, region = "US"): string {
  const rand = () =>
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  const q = new URLSearchParams({
    advertisingId: "",
    appName: "web",
    appVersion: "9",
    architecture: "",
    buildVersion: "",
    clientTime: new Date().toISOString(),
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
  return `${PLUTO_STITCHERS[0]}/stitch/hls/channel/${channelId}/master.m3u8?${q.toString()}`;
}

// Pluto geo-detects the caller and ignores ?country=, so read the real region
// from the slug (e.g. "pluto-tv-movies-gb-1") instead of the requested one.
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

async function fetchPlutoChannels(
  country: string,
  category: string,
): Promise<any[]> {
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
  let list: any[];
  try {
    const res = await fetch(
      `https://api.pluto.tv/v2/channels?country=${useRegion}`,
      { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return [];
    list = (await res.json()) as any[];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const wanted =
    category && PLUTO_CATEGORY_MAP[category]
      ? new Set(PLUTO_CATEGORY_MAP[category])
      : null;
  const out: any[] = [];
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
      name:
        String(c.name)
          .replace(/^\d+\.\s*/, "")
          .trim() || c.name,
      url: plutoStitchUrl(c._id, realRegion.toUpperCase()),
      logo:
        c.colorLogoPNG ||
        c.solidLogoPNG ||
        c.logo ||
        (c.featuredImage && c.featuredImage.path) ||
        "",
      country: realRegion,
      categories: [c.category || "", "movies", "entertainment"].filter(Boolean),
      audio: false,
      source: "pluto",
    });
  }
  return out;
}

const DW_CHANNELS = [
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
function fetchDwChannels(): any[] {
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

async function fetchSomaFmChannels(): Promise<any[]> {
  let chans: any[];
  try {
    const res = await fetch("https://somafm.com/channels.json", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    chans = data.channels || [];
  } catch {
    return [];
  }
  if (!Array.isArray(chans)) return [];
  const drafts = chans
    .filter((c) => c && c.id && c.title)
    .map((c) => {
      const mp3s = ((c.playlists as any[]) || [])
        .filter((p) => p && p.url && /pls$/i.test(p.url) && p.format === "mp3")
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
  const out: any[] = [];
  for (const d of resolved) {
    if (!d.stream) continue;
    out.push({
      id: `somafm-${d.c.id}`,
      name: d.c.title || d.c.id,
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

async function fetchRealityChannels(
  family: "video" | "audio",
  category: string,
  country: string,
): Promise<any[]> {
  if (family === "audio") return fetchSomaFmChannels();
  const [pluto, dw] = await Promise.all([
    fetchPlutoChannels(country, category),
    Promise.resolve(fetchDwChannels()),
  ]);
  const dwOk =
    !category || ["news", "entertainment", "business", "tv"].includes(category);
  return [...pluto, ...(dwOk ? dw : [])];
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300",
};

// The complete reverse-engineered catalog of countries (218, ISO-3166 alpha-2,
// lowercase). Derived from https://tvgarden.world/sitemap_countries.xml.
const TVGARDEN_COUNTRIES = new Set(
  (
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
  ).split(" "),
);

// All known category ids (TV + radio). tvgarden returns 200 for each.
const TVGARDEN_CATEGORIES = new Set([
  "news",
  "movies",
  "sports",
  "music",
  "entertainment",
  "kids",
  "documentary",
  "education",
  "religious",
  "business",
  "general",
  "family",
  "lifestyle",
  "culture",
  "classic",
  "weather",
  "travel",
  "auto",
  "animation",
  "comedy",
  "cooking",
  "legislative",
  "outdoor",
  "relax",
  "science",
  "series",
  "shop",
  "talk",
  "politics",
  "hits",
  "pop",
  "rock",
  "electronic",
  "indie",
  "metal",
  "jazz",
  "classical",
  "soul",
  "blues",
  "reggae",
  "folk",
  "country",
  "latin",
  "schlager",
  "oldies",
  "chill",
  "christmas",
]);

function isValidTvgRequest(mode: string, type: string, id: string): boolean {
  if (mode !== "tv" && mode !== "radio") return false;
  if (type !== "countries" && type !== "categories") return false;
  if (!id) return false;
  // Accept any 2-letter ISO-3166 country code. A code that upstream has no
  // catalog for (e.g. "gb" TV) must NOT hard-400 — it falls through to the
  // upstream fetch and returns 200 [] gracefully (no console error noise).
  return type === "countries"
    ? /^[a-z]{2}$/.test(id.toLowerCase())
    : TVGARDEN_CATEGORIES.has(id.toLowerCase());
}

/**
 * Decode the tvgarden response body to JSON.
 *
 * Compression (reverse-engineered): the origin serves gzip(json); Cloudflare
 * then adds brotli on top → wire bytes are br(gzip(json)). fetch() in Workers
 * auto-removes the outer brotli (via content-encoding), leaving gzip(json) in
 * the body. We gunzip the inner layer with DecompressionStream (Web Streams).
 * Falls back to plain-JSON parsing if not gzip (defensive).
 */
async function decodeTvgardenBody(buffer: ArrayBuffer): Promise<TvgChannel[]> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const text = await new Response(stream).text();
      const data = JSON.parse(text);
      return Array.isArray(data) ? (data as TvgChannel[]) : [];
    } catch {
      return [];
    }
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(data) ? (data as TvgChannel[]) : [];
  } catch {
    return [];
  }
}

/** Filter URL-less channels and explicit offline/error placeholders.
 * This metadata guard cannot prove playback; the player must handle runtime
 * stream failures and never treat an HTTP-success HTML page as video.
 */
function filterPlayable(channels: TvgChannel[]): TvgChannel[] {
  const explicitOffline =
    /(?:channel|stream|station)[\s\-_]+(?:is[\s\-_]+)?offline|offline[\s\-_]*[-–:]?[\s\-_]*(?:it[\s\-_]+will[\s\-_]+be[\s\-_]+back[\s\-_]+soon|back[\s\-_]+soon)|channel[\s\-_]+unavailable|stream[\s\-_]+unavailable|error[\s\-_]+page/i;
  return channels.filter((ch) => {
    const urls = [
      ...(Array.isArray(ch.stream_urls) ? ch.stream_urls : []),
      ...(Array.isArray(ch.youtube_urls) ? ch.youtube_urls : []),
    ].filter(
      (url) => typeof url === "string" && /^https?:\/\//i.test(url.trim()),
    );
    if (!urls.length) return false;
    return !explicitOffline.test([ch.name, ...urls].filter(Boolean).join(" "));
  });
}

// In-memory cache (per Worker isolate, 5-min TTL)
const cache = new Map<string, { data: TvgChannel[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  const mode = url.searchParams.get("mode") || "tv";
  const type = url.searchParams.get("type") || "countries";
  const id = (url.searchParams.get("id") || "us").toLowerCase();

  // Vavoo / mHub live-TV slice. Its stream URLs are IP-bound to the worker
  // that resolved them, and Vavoo 403s the Cloudflare egress — so the
  // catalogue + resolve MUST run on the Vercel edge. Relay the whole request
  // there and pass the response straight back. `vavoo=premium` (the named
  // premium brands) relays on the same path.
  const vavooParam = url.searchParams.get("vavoo") || "";
  if (vavooParam === "1" || vavooParam === "true" || vavooParam === "premium") {
    try {
      const target = new URL(
        "https://fuel-app-mobile.vercel.app/api/live-channels",
      );
      url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
      const upstream = await fetch(target.toString(), {
        headers: { Accept: "application/json" },
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch {
      return new Response(JSON.stringify({ channels: [], count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  // Reality-source slice (Pluto TV / DW / SomaFM) — reverse-engineered from
  // the Reezn TV APK. The `country=__reality` sentinel routes here.
  if (url.searchParams.get("country") === "__reality") {
    const family = (url.searchParams.get("family") || "video") as
      "video" | "audio";
    const realityCategory = (url.searchParams.get("category") || "")
      .toLowerCase()
      .trim();
    const region = (url.searchParams.get("region") || "").toLowerCase().trim();
    const key = `reality/${family}/${realityCategory}/${region}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return new Response(
        JSON.stringify({
          channels: hit.data,
          count: hit.data.length,
          source: "reality",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }
    const channels = await fetchRealityChannels(
      family,
      realityCategory,
      region,
    );
    cache.set(key, { data: channels, ts: Date.now() });
    return new Response(
      JSON.stringify({ channels, count: channels.length, source: "reality" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  // Validate against the reverse-engineered catalog (reject unknown ids early).
  if (!isValidTvgRequest(mode, type, id)) {
    return new Response(
      JSON.stringify({ error: "Invalid mode/type/id", channels: [], count: 0 }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  const cacheKey = `${mode}/${type}/${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return new Response(
      JSON.stringify({ channels: cached.data, count: cached.data.length }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  const upstreamUrl = `https://tvgarden.world/api/${mode}/${type}/${id}.json`;

  try {
    // Let fetch() auto-decompress the outer brotli (content-encoding).
    const upstreamRes = await fetch(upstreamUrl);

    if (!upstreamRes.ok) {
      return new Response(JSON.stringify({ channels: [], count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const channels = await decodeTvgardenBody(await upstreamRes.arrayBuffer());
    const playable = filterPlayable(channels);

    cache.set(cacheKey, { data: playable, ts: Date.now() });

    return new Response(
      JSON.stringify({ channels: playable, count: playable.length }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (err) {
    console.error("[live-channels] fetch error:", err);
    return new Response(JSON.stringify({ channels: [], count: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};
