/**
 * Cloudflare Pages Function — IPTV-Org Channels API
 *
 * Same purpose as /api/iptv-channels.ts (Vercel): fetches iptv-org channels.json
 * (10MB) + streams.json server-side, merges them, filters by country/category,
 * returns a compact slice with CORS headers. The browser never downloads the
 * full 10MB file.
 *
 * Lives at functions/api/iptv-channels.ts → /api/iptv-channels
 *
 * GET /api/iptv-channels?country=us&category=news
 */

export interface IptvChannel {
  id: string;
  name: string;
  url: string;
  logo: string;
  country: string;
  language: string;
  category: string;
}

interface Env {}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=600",
};

const cache = new Map<string, { data: IptvChannel[]; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000;
const IPTV_BASE = "https://iptv-org.github.io/api";
const MAX_RESULTS = 12000;

interface IptvChannelRaw {
  id: string;
  name: string;
  country: string;
  categories: string[];
  is_nsfw: boolean;
  closed?: string | null;
  replaced_by?: string | null;
  logo: string;
}

interface IptvStreamRaw {
  channel: string;
  url: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${IPTV_BASE}/${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  const country = (url.searchParams.get("country") || "").toLowerCase().trim();
  const category = (url.searchParams.get("category") || "")
    .toLowerCase()
    .trim();
  const limit = Math.min(
    MAX_RESULTS,
    parseInt(url.searchParams.get("limit") || String(MAX_RESULTS), 10) ||
      MAX_RESULTS,
  );

  const cacheKey = `iptv/${country || "all"}/${category || "all"}/${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return new Response(
      JSON.stringify({
        channels: cached.data,
        count: cached.data.length,
        source: "iptv-org",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  try {
    const [channelsRaw, streamsRaw] = await Promise.all([
      fetchJson<IptvChannelRaw[]>("channels.json"),
      fetchJson<IptvStreamRaw[]>("streams.json"),
    ]);

    const streamMap = new Map<string, string>();
    for (const s of streamsRaw) {
      if (s.channel && s.url && !streamMap.has(s.channel)) {
        streamMap.set(s.channel, s.url);
      }
    }

    let merged: IptvChannel[] = [];
    for (const ch of channelsRaw) {
      if (ch.closed || ch.replaced_by || ch.is_nsfw) continue;
      const streamUrl = streamMap.get(ch.id);
      if (!streamUrl) continue;

      if (country && ch.country.toLowerCase() !== country) continue;

      if (category) {
        const cats = (ch.categories || []).map((c) => c.toLowerCase());
        if (!cats.includes(category)) continue;
      }

      merged.push({
        id: ch.id,
        name: ch.name || ch.id,
        url: streamUrl,
        logo: ch.logo || "",
        country: ch.country || "",
        language: "",
        category: (ch.categories || []).join(", "),
      });
    }

    merged.sort((a, b) => {
      if (!!a.logo !== !!b.logo) return a.logo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (merged.length > limit) {
      merged = merged.slice(0, limit);
    }

    cache.set(cacheKey, { data: merged, ts: Date.now() });

    return new Response(
      JSON.stringify({
        channels: merged,
        count: merged.length,
        source: "iptv-org",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (err) {
    console.error("[iptv-channels] fetch error:", err);
    return new Response(
      JSON.stringify({ channels: [], count: 0, source: "iptv-org" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
