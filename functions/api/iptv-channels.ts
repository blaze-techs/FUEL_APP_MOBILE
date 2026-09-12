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
  alt_names?: string[];
  /** Custom User-Agent required to fetch this stream (from index.m3u). */
  userAgent?: string;
  /** Custom Referrer required to fetch this stream (from index.m3u). */
  referrer?: string;
  quality?: string;
}

interface IptvM3uEntry {
  id: string;
  name: string;
  url: string;
  logo: string;
  country: string;
  category: string;
  categories: string[];
  alt_names: string[];
  userAgent?: string;
  referrer?: string;
  quality?: string;
}

/* ── index.m3u master-playlist parser (VLC-equivalent full catalog) ──────── */

/** Deterministic 12-char id from a URL (no Buffer in Workers). */
function m3uUrlHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  return `m3u-${h.toString(36).slice(0, 12)}`;
}

/** Map a country-code TLD to the ISO-3166 alpha-2 code iptv-org uses. */
function m3uTldToIso2(tld: string): string {
  const t = tld.toLowerCase();
  const map: Record<string, string> = { uk: "GB" };
  return map[t] || t.toUpperCase();
}

/** Index of the display-name separator comma (skips commas inside quotes). */
function m3uNameStart(line: string): number {
  let inQuote = false;
  let lastSep = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "," && !inQuote) lastSep = i;
  }
  return lastSep >= 0 ? lastSep + 1 : 0;
}

function m3uParseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)="([^"]*)"|([A-Za-z0-9_-]+)=([^\s",]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) attrs[m[1]] = m[2];
    else if (m[3]) attrs[m[3]] = m[4];
  }
  return attrs;
}

/** Parse raw index.m3u text into channel entries. */
function parseIptvM3u(raw: string): IptvM3uEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: IptvM3uEntry[] = [];
  const idCount = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;
    const extinf = line;
    const headers: { userAgent?: string; referrer?: string } = {};

    let j = i + 1;
    while (j < lines.length) {
      const h = lines[j].trim();
      if (h.startsWith("#EXTVLCOPT:http-user-agent=")) {
        headers.userAgent = h.slice("#EXTVLCOPT:http-user-agent=".length);
        j++;
        continue;
      }
      if (
        h.startsWith("#EXTVLCOPT:http-referrer=") ||
        h.startsWith("#EXTHTTP:referrer=") ||
        h.startsWith("#EXTHTTP:Referer=")
      ) {
        headers.referrer = h.split("=", 2)[1];
        j++;
        continue;
      }
      if (h.startsWith("#EXTVLCOPT:") || h.startsWith("#EXTHTTP:")) {
        j++;
        continue;
      }
      break;
    }

    let k = j;
    while (
      k < lines.length &&
      (lines[k].trim().startsWith("#") || !lines[k].trim())
    )
      k++;
    let url = "";
    if (k < lines.length) url = lines[k].trim();
    i = k;
    if (!url) continue;

    const attrs = m3uParseAttrs(extinf);
    const nameRaw = extinf.includes(",")
      ? extinf.slice(m3uNameStart(extinf)).trim()
      : attrs["tvg-name"] || "";

    let country = "";
    const tvgId = attrs["tvg-id"] || "";
    if (attrs["tvg-country"]) {
      country = attrs["tvg-country"].slice(0, 2).toUpperCase();
    } else {
      const tl = tvgId.match(/\.([A-Za-z]{2})(?:@|$)/);
      if (tl) country = m3uTldToIso2(tl[1]);
    }

    const categoryRaw = attrs["group-title"] || "";
    const categories = categoryRaw
      .split(/[;|,]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    let userAgent = headers.userAgent;
    let referrer = headers.referrer;
    const uaInUrl = url.match(/\|User-Agent=([^|]+)/);
    if (uaInUrl) {
      try {
        userAgent = decodeURIComponent(uaInUrl[1]);
      } catch {
        userAgent = uaInUrl[1];
      }
      url = url.replace(/\|User-Agent=[^|]*/, "");
    }
    const refInUrl = url.match(/\|Referer=([^|]+)/);
    if (refInUrl) {
      try {
        referrer = decodeURIComponent(refInUrl[1]);
      } catch {
        referrer = refInUrl[1];
      }
      url = url.replace(/\|Referer=[^|]*/, "");
    }
    url = url.replace(/\|$/, "");

    const qMatch = nameRaw.match(/\((\d{3,4}p)\)|\[(\d{3,4}p)\]/i);
    const quality = qMatch ? qMatch[1] || qMatch[2] : undefined;

    const channelId = tvgId.replace(/@.+$/, "") || m3uUrlHash(url);
    const seen = idCount.get(channelId) || 0;
    idCount.set(channelId, seen + 1);
    const id = seen > 0 ? `${channelId}-${seen + 1}` : channelId;

    entries.push({
      id,
      name: (nameRaw || attrs["tvg-name"] || "Unknown").trim(),
      url,
      logo: attrs["tvg-logo"] || "",
      country,
      category: categoryRaw,
      categories,
      alt_names: [],
      userAgent,
      referrer,
      quality,
    });
  }
  return entries;
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
const MAX_RESULTS = 13500;

interface IptvChannelRaw {
  id: string;
  name: string;
  alt_names?: string[];
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

  const fmt = url.searchParams.get("fmt") || "json";
  const country = (url.searchParams.get("country") || "").toLowerCase().trim();
  const category = (url.searchParams.get("category") || "")
    .toLowerCase()
    .trim();
  const limit = Math.min(
    MAX_RESULTS,
    parseInt(url.searchParams.get("limit") || String(MAX_RESULTS), 10) ||
      MAX_RESULTS,
  );

  const cacheKey = `iptv/${fmt}/${country || "all"}/${category || "all"}/${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return new Response(
      JSON.stringify({
        channels: cached.data,
        count: cached.data.length,
        source: fmt === "m3u" ? "iptv-org-m3u" : "iptv-org",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  if (fmt === "m3u") {
    const m3uCacheKey = `iptv/m3u/raw`;
    let rawM3u = "";
    const rawCached = cache.get(m3uCacheKey) as
      { data: string; ts: number } | undefined;
    if (rawCached && Date.now() - rawCached.ts < CACHE_TTL) {
      rawM3u = rawCached.data;
    } else {
      const res = await fetch("https://iptv-org.github.io/iptv/index.m3u", {
        headers: { Accept: "text/plain, */*" },
      });
      if (!res.ok) {
        return new Response(
          JSON.stringify({ channels: [], count: 0, source: "iptv-org-m3u" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }
      rawM3u = await res.text();
      cache.set(m3uCacheKey, { data: rawM3u, ts: Date.now() });
    }
    let entries = parseIptvM3u(rawM3u);
    if (country)
      entries = entries.filter((e) => e.country.toLowerCase() === country);
    if (category)
      entries = entries.filter((e) => e.categories.includes(category));
    const out: IptvChannel[] = entries.slice(0, limit).map((e) => {
      const base: IptvChannel = {
        id: e.id,
        name: e.name,
        url: e.url,
        logo: e.logo,
        country: e.country,
        language: "",
        category: e.categories.join(", "),
        alt_names: e.alt_names,
      };
      if (e.userAgent) base.userAgent = e.userAgent;
      if (e.referrer) base.referrer = e.referrer;
      if (e.quality) base.quality = e.quality;
      return base;
    });
    cache.set(cacheKey, { data: out, ts: Date.now() });
    return new Response(
      JSON.stringify({
        channels: out,
        count: out.length,
        source: "iptv-org-m3u",
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
        alt_names: Array.isArray(ch.alt_names) ? ch.alt_names : [],
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
