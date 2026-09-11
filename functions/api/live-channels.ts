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
  return type === "countries"
    ? TVGARDEN_COUNTRIES.has(id)
    : TVGARDEN_CATEGORIES.has(id);
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

/** Filter out channels with no playable URL (never surface dead streams). */
function filterPlayable(channels: TvgChannel[]): TvgChannel[] {
  return channels.filter(
    (ch) =>
      (Array.isArray(ch.stream_urls) && ch.stream_urls.length > 0) ||
      (Array.isArray(ch.youtube_urls) && ch.youtube_urls.length > 0),
  );
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
