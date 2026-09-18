/**
 * Live Channels API (Vercel serverless)
 *
 * Reverse-engineered proxy for the tvgarden.world live-channel JSON API.
 * The shared library `api/_lib/tvgarden.ts` captures the full
 * reverse-engineered contract (endpoint shape, double compression, the
 * 218-country + 27-TV-category + 22-radio-category catalog).
 *
 * Why a server-side proxy: the upstream API does NOT send CORS headers, so
 * browser-side fetches from fuel-app-mobile.pages.dev /
 * fuel-app-mobile.vercel.app are blocked. This function fetches server-side
 * (no CORS restriction), decodes the gzip(brotli) double-compression, filters
 * out dead streams, and returns JSON with permissive CORS headers.
 *
 * The client NEVER sees the upstream hostname — all requests go through
 * /api/live-channels, so there is zero upstream attribution in the UI.
 *
 * GET /api/live-channels?mode=tv|radio&type=countries|categories&id=us|news
 *
 * Returns: { channels: TvgChannel[], count: number }
 */
import type { IncomingMessage, ServerResponse } from "http";
import {
  decodeTvgardenBody,
  filterPlayable,
  isValidTvgRequest,
  tvgardenUrl,
  type TvgChannel,
  type TvgMode,
  type TvgType,
} from "./_lib/tvgarden.js";
import {
  parseIptvM3u,
  m3uEntryToIptvChannel,
  type IptvM3uEntry,
} from "./_lib/iptv-m3u.js";

/** Minimal Vercel-compatible request/response wrappers (no @vercel/node dep). */
interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

function wrapRes(res: ServerResponse): ApiResponse {
  const r = res as ApiResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  return r;
}

function parseQuery(req: IncomingMessage): Record<string, string | string[]> {
  const fullUrl = req.url || "";
  const searchIdx = fullUrl.indexOf("?");
  if (searchIdx < 0) return {};
  return Object.fromEntries(new URLSearchParams(fullUrl.slice(searchIdx + 1)));
}

// In-memory cache (per serverless instance, 5-min TTL)
const cache = new Map<string, { data: TvgChannel[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// ── iptv-org provider (merged from the former api/iptv-channels.ts to stay
// under the Vercel Hobby 12-function limit; routed here via the
// /api/iptv-channels -> /api/live-channels?source=iptv rewrite) ────────────
const IPTV_BASE = "https://iptv-org.github.io/api";
const iptvCache = new Map<string, { data: unknown[]; ts: number }>();
const IPTV_CACHE_TTL = 10 * 60 * 1000;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${IPTV_BASE}/${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

async function handleIptv(
  r: ApiResponse,
  query: Record<string, string | string[]>,
) {
  const fmt = (query.fmt as string) || "json";
  const country = ((query.country as string) || "").toLowerCase().trim();
  const category = ((query.category as string) || "").toLowerCase().trim();
  const limit = Math.min(
    13500,
    parseInt((query.limit as string) || "13500", 10) || 13500,
  );
  const cacheKey = `iptv/${fmt}/${country || "all"}/${category || "all"}/${limit}`;
  const cached = iptvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < IPTV_CACHE_TTL) {
    r.status(200).json({
      channels: cached.data,
      count: cached.data.length,
      source: "iptv-org",
    });
    return;
  }
  if (fmt === "m3u") {
    await handleIptvM3u(r, country, category, limit);
    return;
  }
  try {
    const [channelsRaw, streamsRaw] = await Promise.all([
      fetchJson<
        {
          id: string;
          name: string;
          alt_names?: string[];
          country: string;
          categories: string[];
          is_nsfw: boolean;
          closed?: string | null;
          replaced_by?: string | null;
          logo: string;
        }[]
      >("channels.json"),
      fetchJson<{ channel: string; url: string }[]>("streams.json"),
    ]);
    const streamMap = new Map<string, string>();
    for (const s of streamsRaw) {
      if (s.channel && s.url && !streamMap.has(s.channel)) {
        streamMap.set(s.channel, s.url);
      }
    }
    let merged: unknown[] = [];
    for (const ch of channelsRaw) {
      if (ch.closed || ch.replaced_by || ch.is_nsfw) continue;
      const url = streamMap.get(ch.id);
      if (!url) continue;
      if (country && ch.country.toLowerCase() !== country) continue;
      if (category) {
        const cats = (ch.categories || []).map((c) => c.toLowerCase());
        if (!cats.includes(category)) continue;
      }
      merged.push({
        id: ch.id,
        name: ch.name || ch.id,
        url,
        logo: ch.logo || "",
        country: ch.country || "",
        language: "",
        category: (ch.categories || []).join(", "),
        alt_names: Array.isArray(ch.alt_names) ? ch.alt_names : [],
      });
    }
    merged.sort((a, b) => {
      const x = a as { logo: string; name: string };
      const y = b as { logo: string; name: string };
      if (!!x.logo !== !!y.logo) return x.logo ? -1 : 1;
      return x.name.localeCompare(y.name);
    });
    if (merged.length > limit) merged = merged.slice(0, limit);
    iptvCache.set(cacheKey, { data: merged, ts: Date.now() });
    r.status(200).json({
      channels: merged,
      count: merged.length,
      source: "iptv-org",
    });
  } catch (err) {
    console.error("[live-channels] iptv fetch error:", err);
    r.status(200).json({ channels: [], count: 0, source: "iptv-org" });
  }
}

/**
 * Fetch + parse the iptv-org MASTER playlist (index.m3u) — the exact file VLC
 * opens. Returns the full ~12.9k catalog including quality/geo variants and
 * the custom HTTP headers (User-Agent / Referrer) many streams require to
 * avoid 403s. This is the "add ALL channels/streams from index.m3u" path.
 */
async function handleIptvM3u(
  r: ApiResponse,
  country: string,
  category: string,
  limit: number,
) {
  const cacheKey = `iptv/m3u/${country || "all"}/${category || "all"}/${limit}`;
  const cached = iptvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < IPTV_CACHE_TTL) {
    r.status(200).json({
      channels: cached.data,
      count: cached.data.length,
      source: "iptv-org-m3u",
    });
    return;
  }

  try {
    const entries = await getM3uMaster();

    let filtered = entries;
    if (country) {
      filtered = entries.filter((e) => e.country.toLowerCase() === country);
    }
    if (category) {
      filtered = filtered.filter((e) => e.categories.includes(category));
    }
    const out = filtered.slice(0, limit).map((e) => m3uEntryToIptvChannel(e));

    iptvCache.set(cacheKey, { data: out, ts: Date.now() });
    r.status(200).json({
      channels: out,
      count: out.length,
      source: "iptv-org-m3u",
    });
  } catch (err) {
    console.error("[live-channels] iptv m3u fetch error:", err);
    r.status(200).json({ channels: [], count: 0, source: "iptv-org-m3u" });
  }
}

/** The parsed index.m3u master list, cached globally (fetch once, filter many). */
const m3uMasterKey = "iptv/m3u/master";
async function getM3uMaster(): Promise<IptvM3uEntry[]> {
  const cached = iptvCache.get(m3uMasterKey);
  if (cached && Date.now() - cached.ts < IPTV_CACHE_TTL)
    return cached.data as IptvM3uEntry[];
  const res = await fetch("https://iptv-org.github.io/iptv/index.m3u", {
    headers: { Accept: "text/plain, */*" },
  });
  if (!res.ok) throw new Error(`index.m3u returned ${res.status}`);
  const raw = await res.text();
  const entries = parseIptvM3u(raw);
  iptvCache.set(m3uMasterKey, { data: entries, ts: Date.now() });
  return entries;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const r = wrapRes(res);
  const query = parseQuery(req);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=300");

  if (req.method === "OPTIONS") {
    r.status(204).end();
    return;
  }

  if ((query.source as string) === "iptv") {
    await handleIptv(r, query);
    return;
  }

  const mode = (query.mode as string) || "tv";
  const type = (query.type as string) || "countries";
  const id = ((query.id as string) || "us").toLowerCase();

  // Validate against the reverse-engineered catalog (reject unknown
  // country/category ids early — saves a round-trip to the upstream).
  if (!isValidTvgRequest(mode, type, id)) {
    r.status(400).json({
      error: "Invalid mode/type/id",
      channels: [],
      count: 0,
    });
    return;
  }

  const cacheKey = `${mode}/${type}/${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    r.status(200).json({ channels: cached.data, count: cached.data.length });
    return;
  }

  try {
    // Let fetch() auto-decompress the outer brotli layer (via content-encoding).
    // The response body is then the inner gzip(json) bytes; decodeTvgardenBody
    // gunzips that. Accept-Encoding omitted on purpose so fetch uses its
    // default (auto-decompress content-encoding).
    const upstreamRes = await fetch(
      tvgardenUrl(mode as TvgMode, type as TvgType, id),
    );

    if (!upstreamRes.ok) {
      r.status(200).json({ channels: [], count: 0 });
      return;
    }

    const channels = await decodeTvgardenBody(await upstreamRes.arrayBuffer());
    const playable = filterPlayable(channels);

    cache.set(cacheKey, { data: playable, ts: Date.now() });

    r.status(200).json({ channels: playable, count: playable.length });
  } catch (err) {
    console.error("[live-channels] fetch error:", err);
    r.status(200).json({ channels: [], count: 0 });
  }
}
