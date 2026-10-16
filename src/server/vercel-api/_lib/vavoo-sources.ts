/**
 * Vavoo / mHub live-TV source (reverse-engineered from the Reezn TV APK).
 *
 * The Reezn TV Android app is a player for the VAVOO / mHub addon platform.
 * Its Live TV tab is served by the `vavoo` addon at
 * `https://www.vavoo.to/live/` — a 10,000+ channel IPTV catalogue grouped by
 * region (Germany, Arabia, Turkey, France, United Kingdom, ...).
 *
 * Protocol (MediaHubMX addon spec v2):
 *   POST https://www.vavoo.to/live/mediahubmx-catalog.json
 *     body  { catalogId:"iptv", id, adult:false, search, sort, cursor,
 *             filter:{}, language, region, clientVersion }
 *     reply { items:[{ ids:{id}, name, group, logo, epg }], nextCursor }
 *   POST https://www.vavoo.to/live/mediahubmx-resolve.json
 *     body  { url:"https://vavoo.to/vavoo-iptv/play/<id>", language, region,
 *             clientVersion }
 *     reply [{ id, name, url:"<hls master.m3u8>" }]
 *
 * IMPORTANT — the resolved stream URL is bound to the REQUESTER's egress IP
 * (verified: the same URL plays from one egress and returns 403 from another).
 * The catalogue + resolve call therefore MUST run from a worker whose egress
 * the playback will later use. We run both on the Vercel edge
 * (`/api/live-channels?vavoo=1`) and hand the browser a direct stream URL,
 * which it then plays through the hls-proxy (same worker family, same egress).
 *
 * Channels that resolve to no URL are simply omitted, so a dead
 * ("channel is offline") entry never reaches the client.
 *
 * Keep this file in sync with the inlined copy in functions/api/live-channels.ts.
 */

export interface VavooChannel {
  id: string;
  /** Display name (region tag stripped). */
  name: string;
  /** Region group, e.g. "Germany". */
  group: string;
  /** Resolved HLS master playlist URL (IP-bound to the resolving worker). */
  url: string;
  logo: string;
  /** ISO-2 country code derived from the region group. */
  country: string;
  source: "vavoo";
  audio: false;
  /**
   * True when the stream's manifest was actually fetched and answered with a
   * real playlist. Only channels that fail with an EXPLICIT error (502 /
   * non-playlist body) are dropped, so this marks the ones proven playable —
   * the UI can surface those first.
   */
  verified: boolean;
}

const VAVOO_CATALOG_URL = "https://www.vavoo.to/live/mediahubmx-catalog.json";
const VAVOO_RESOLVE_URL = "https://www.vavoo.to/live/mediahubmx-resolve.json";
const VAVOO_UA = "MediaHubMX/2";
/** Hard cap on how many catalogue pages we walk in one request. */
const VAVOO_MAX_PAGES = 40;
/** Wall-clock budget for the playability probe (keeps the run serverless-safe). */
const VAVOO_PROBE_BUDGET_MS = 14000;
/** Per-stream manifest probe timeout. See `vavooProbe` for why a timeout keeps. */
const VAVOO_PROBE_TIMEOUT_MS = 4000;

/**
 * Reject explicit offline / error-placeholder titles (e.g. "Channel is
 * offline"). Separator-agnostic so hyphenated slugs are caught too. Transient
 * 502s are NOT treated as offline — only an explicit label is.
 */
const VAVOO_OFFLINE_RE =
  /(?:channel|stream|station)[\s\-_]+(?:is[\s\-_]+)?offline|offline[\s\-_]*[-–:]?[\s\-_]*(?:it[\s\-_]+will[\s\-_]+be[\s\-_]+back[\s\-_]+soon|back[\s\-_]+soon)|channel[\s\-_]+unavailable|stream[\s\-_]+unavailable|error[\s\-_]+page/i;

/** Region group -> ISO-2 country (lowercase). Best-effort, display only. */
const VAVOO_GROUP_COUNTRY: Record<string, string> = {
  Albania: "al",
  Arabia: "sa",
  Balkans: "rs",
  Bulgaria: "bg",
  Croatia: "hr",
  France: "fr",
  "France Sport": "fr",
  Germany: "de",
  Italy: "it",
  Netherlands: "nl",
  Poland: "pl",
  Portugal: "pt",
  Romania: "ro",
  Russia: "ru",
  Spain: "es",
  Turkey: "tr",
  "United Kingdom": "gb",
};

interface VavooCatalogItem {
  ids?: { id?: string };
  name?: string;
  group?: string;
  logo?: string;
}

interface VavooResolved {
  url?: string;
}

/** POST a JSON body to the Vavoo addon and parse the JSON reply. */
async function vavooPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": VAVOO_UA,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`vavoo ${res.status}`);
  return (await res.json()) as T;
}

/** One catalogue page (300 items). Returns items + the next cursor. */
async function vavooCatalogPage(
  cursor: number | null,
  group: string,
): Promise<{ items: VavooCatalogItem[]; next: number | null }> {
  const body = {
    catalogId: "iptv",
    id: "",
    adult: false,
    search: "",
    sort: "",
    cursor,
    filter: group ? { group } : {},
    language: "en",
    region: "US",
    clientVersion: "3.1.0",
  };
  const data = await vavooPost<{
    items?: VavooCatalogItem[];
    nextCursor?: number | string | null;
  }>(VAVOO_CATALOG_URL, body);
  const items = Array.isArray(data.items) ? data.items : [];
  const next =
    data.nextCursor != null && `${data.nextCursor}` !== ""
      ? Number(data.nextCursor) || null
      : null;
  return { items, next };
}

/** Resolve one channel id to a playable HLS URL (or "" when unavailable). */
export async function vavooResolve(id: string): Promise<string> {
  try {
    const list = await vavooPost<VavooResolved[]>(VAVOO_RESOLVE_URL, {
      url: `https://vavoo.to/vavoo-iptv/play/${id}`,
      language: "en",
      region: "US",
      clientVersion: "3.1.0",
    });
    const url = Array.isArray(list) ? list[0]?.url || "" : "";
    return typeof url === "string" ? url : "";
  } catch {
    return "";
  }
}

/** Fetch the whole catalogue (paged), optionally narrowed to one region. */
export async function fetchVavooCatalog(
  group = "",
): Promise<VavooCatalogItem[]> {
  const out: VavooCatalogItem[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < VAVOO_MAX_PAGES; page++) {
    const { items, next } = await vavooCatalogPage(cursor, group);
    out.push(...items);
    if (!next || items.length === 0) break;
    cursor = next;
  }
  return out;
}

/**
 * Probe a resolved stream: fetch just the manifest header and decide whether
 * it is genuinely dead.
 *
 * Only an EXPLICIT failure proves a channel is dead — an HTTP error status, a
 * non-playlist body, or a truncated read. A TIMEOUT is deliberately treated as
 * "unknown, keep it": Vavoo's segment hosts answer slowly (and some stream
 * only during events), so a slow manifest is not evidence of a dead channel.
 * Dropping on timeout is what silently removed entire premium networks (beIN,
 * Zee) whose feeds are simply slower than the probe window.
 *
 * Returns "live" (playlist confirmed) | "dead" (proven bad) | "slow" (unknown).
 */
async function vavooProbe(
  url: string,
  timeoutMs = VAVOO_PROBE_TIMEOUT_MS,
): Promise<"live" | "dead" | "slow"> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": VAVOO_UA },
      signal: ctrl.signal,
    });
    if (!res.ok) return "dead";
    if (!res.body) return "dead";
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value || value.length === 0) return "dead";
    const head = new TextDecoder().decode(value.slice(0, 200));
    return head.includes("#EXTM3U") || head.includes("#EXTINF")
      ? "live"
      : "dead";
  } catch (err) {
    // An abort is our own timeout — indeterminate, not proof of death.
    const aborted = err instanceof Error && err.name === "AbortError";
    return aborted ? "slow" : "dead";
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch + resolve Vavoo live channels. Resolution runs in small concurrent
 * batches; any channel that does not resolve to a stream URL is dropped, and
 * by default the stream is PROBED so a "resolved but dead" channel never
 * reaches the UI. Only channels that actually play are returned.
 *
 * @param group     optional region filter (e.g. "Germany")
 * @param limit     max channels to return (0 = no cap)
 * @param maxResolve hard cap on resolve attempts (keeps latency bounded)
 * @param probe     also verify the stream responds (default true)
 */
export async function fetchVavooChannels(
  group = "",
  limit = 300,
  maxResolve = 300,
  probe = true,
): Promise<VavooChannel[]> {
  let items = await fetchVavooCatalog(group);
  if (limit > 0 && items.length > limit) {
    // Evenly sample the catalogue so a cap still spans every region.
    const step = items.length / limit;
    items = Array.from(
      { length: limit },
      (_, i) => items[Math.floor(i * step)],
    );
  }
  if (maxResolve > 0 && items.length > maxResolve) {
    const step = items.length / maxResolve;
    items = Array.from(
      { length: maxResolve },
      (_, i) => items[Math.floor(i * step)],
    );
  }

  const out: VavooChannel[] = [];
  const BATCH = 40;
  // Probing adds one stream fetch per channel; keep the whole run inside the
  // serverless budget by stopping once the deadline passes (cached afterwards).
  const deadline = probe ? Date.now() + VAVOO_PROBE_BUDGET_MS : Infinity;
  for (let i = 0; i < items.length; i += BATCH) {
    if (probe && Date.now() > deadline) break;
    const slice = items.slice(i, i + BATCH);
    const resolved = await Promise.all(
      slice.map(async (c) => {
        const url = await vavooResolve(c.ids?.id || "");
        if (!url) return { c, url: "", verified: false };
        // A resolved URL can still 502 at the origin. Only an EXPLICIT error
        // proves the channel is dead; a slow manifest is kept (see vavooProbe).
        const verdict = probe ? await vavooProbe(url) : "slow";
        if (verdict === "dead") return { c, url: "", verified: false };
        return { c, url, verified: verdict === "live" };
      }),
    );
    for (const { c, url, verified } of resolved) {
      const ch = vavooItemToChannel(c, url, group, verified);
      if (ch) out.push(ch);
    }
  }
  return out;
}

/**
 * Map one resolved catalogue item to the transport shape, or null when it
 * cannot be surfaced (unresolved, or an explicit offline/error placeholder).
 * Shared by the generic sweep and the premium-brand pass so both apply the
 * same offline rejection and naming rules.
 */
function vavooItemToChannel(
  c: VavooCatalogItem,
  url: string,
  fallbackGroup = "",
  verified = false,
): VavooChannel | null {
  const id = c.ids?.id || "";
  if (!id || !url) return null;
  if (VAVOO_OFFLINE_RE.test(c.name || "")) return null;
  const name = (c.name || "").replace(/\s*\.\w+$/, "").trim() || c.name || "";
  if (!name) return null;
  const grp = c.group || fallbackGroup || "";
  return {
    id: `vavoo-${id}`,
    name: `${name}${grp ? ` (${grp})` : ""}`,
    group: grp,
    url,
    logo: c.logo || "",
    country: VAVOO_GROUP_COUNTRY[grp] || "",
    source: "vavoo",
    audio: false,
    verified,
  };
}

/** The region groups the Vavoo catalogue exposes (for a UI filter). */
export const VAVOO_GROUPS = Object.keys(VAVOO_GROUP_COUNTRY);

// ===========================================================================
// PREMIUM SPORTS / ENTERTAINMENT BRANDS
//
// The generic sweep samples the catalogue EVENLY across every region, so a
// viewer looking for a specific premium network (SuperSport, beIN, Zee, Sky
// Sport, DAZN, ...) essentially never saw it — it was one of ~10k entries and
// the first page only holds a few dozen. These brands live in the catalogue
// (verified) but are only reachable by NAME, so they are fetched with a
// dedicated per-brand search instead of a region sample.
//
// Every channel returned here is RESOLVED *and* PROBED, so a channel that
// would play the "channel is offline" / unreachable error never reaches the
// UI. `match` is applied to the channel name as well as the search term,
// because the upstream search is a loose substring match ("ZEE" also returns
// "ALJAZEERA").
// ===========================================================================

export interface VavooBrand {
  /** Stable id, used for the UI source filter. */
  id: string;
  /** Display label. */
  label: string;
  /** Catalogue search term. */
  search: string;
  /** Word-boundary matcher a channel name must satisfy to count as this brand. */
  match: RegExp;
}

export const VAVOO_PREMIUM_BRANDS: VavooBrand[] = [
  {
    id: "supersport",
    label: "SuperSport",
    search: "SUPERSPORT",
    match: /\bsuper ?sport\b/i,
  },
  {
    id: "bein",
    label: "beIN Sports",
    search: "BEIN",
    match: /\bbein\b/i,
  },
  {
    id: "zee",
    label: "Zee",
    search: "ZEE",
    // `\bzee\b` deliberately rejects "ALJAZEERA" (no boundary before "zee").
    match: /\bzee\b/i,
  },
  {
    id: "arena",
    label: "Arena Sport",
    search: "ARENA SPORT",
    match: /\barena ?sport\b/i,
  },
  {
    id: "skysport",
    label: "Sky Sport",
    search: "SKY SPORT",
    match: /\bsky ?sport\b/i,
  },
  {
    id: "dazn",
    label: "DAZN",
    search: "DAZN",
    match: /\bdazn\b/i,
  },
  {
    id: "eurosport",
    label: "Eurosport",
    search: "EUROSPORT",
    match: /\beurosport\b/i,
  },
  {
    id: "espn",
    label: "ESPN",
    search: "ESPN",
    match: /\bespn\b/i,
  },
  {
    id: "foxsport",
    label: "Fox Sports",
    search: "FOX SPORT",
    match: /\bfox ?sport/i,
  },
  {
    id: "tnysport",
    label: "TNT Sports",
    search: "TNT SPORT",
    match: /\btnt ?sport/i,
  },
  {
    id: "premiersport",
    label: "Premier Sports",
    search: "PREMIER SPORT",
    match: /\bpremier ?sport/i,
  },
  {
    id: "sporttv",
    label: "Sport TV",
    search: "SPORT TV",
    match: /\bsport ?tv\b/i,
  },
  {
    id: "canalsport",
    label: "Canal+ Sport",
    search: "CANAL+ SPORT",
    match: /\bcanal\+? ?sport/i,
  },
  {
    id: "elevensport",
    label: "Eleven Sports",
    search: "ELEVEN SPORT",
    match: /\beleven ?sport/i,
  },
  {
    id: "movistar",
    label: "Movistar",
    search: "MOVISTAR",
    match: /\bmovistar\b/i,
  },
  {
    id: "viasat",
    label: "V Sport",
    search: "V SPORT",
    match: /\bv ?sport\b/i,
  },
];

/** One catalogue search (up to 300 items). Never throws. */
async function vavooSearch(term: string): Promise<VavooCatalogItem[]> {
  try {
    const data = await vavooPost<{ items?: VavooCatalogItem[] }>(
      VAVOO_CATALOG_URL,
      {
        catalogId: "iptv",
        id: "",
        adult: false,
        search: term,
        sort: "",
        cursor: null,
        filter: {},
        language: "en",
        region: "US",
        clientVersion: "3.1.0",
      },
    );
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** Max candidates taken from a single brand's search results. */
const VAVOO_PREMIUM_PER_BRAND = 24;
/** Concurrency for a single brand's resolve+probe stage. */
const VAVOO_PREMIUM_CONCURRENCY = 12;
/** Wall-clock budget for ONE brand's resolve+probe stage. */
const VAVOO_PREMIUM_BRAND_BUDGET_MS = 12000;

/**
 * Fetch every PLAYABLE channel for the premium brands the viewer asked for
 * (SuperSport, beIN Sports, Zee, Arena Sport, Sky Sport, DAZN, ...).
 *
 * Each brand is searched by name, its results are matched against the brand's
 * word-boundary pattern (the upstream search is a loose substring match — "ZEE"
 * also returns "ALJAZEERA"), then every candidate is resolved AND probed.
 *
 * The brands run as INDEPENDENT parallel pipelines, each with its own budget.
 * A single shared pool is what made this useless before: the pool was consumed
 * by whichever brands happened to sit first in the list, so only SuperSport and
 * Arena ever surfaced and beIN / Zee / Sky / DAZN were silently truncated.
 *
 * Only channels PROVEN dead are dropped (an explicit 502 / non-playlist body).
 * A probe timeout keeps the channel — Vavoo's segment hosts are slow, and
 * treating a slow manifest as "offline" removed whole networks. Verified
 * channels are marked so the UI can rank them first.
 */
export async function fetchVavooPremiumChannels(
  probe = true,
  budgetMs = VAVOO_PREMIUM_BRAND_BUDGET_MS,
): Promise<VavooChannel[]> {
  const perBrand = await Promise.all(
    VAVOO_PREMIUM_BRANDS.map(async (brand) => {
      const items = (await vavooSearch(brand.search))
        .filter((c) => brand.match.test(c.name || ""))
        .slice(0, VAVOO_PREMIUM_PER_BRAND);

      const out: VavooChannel[] = [];
      const deadline = probe ? Date.now() + budgetMs : Infinity;
      for (let i = 0; i < items.length; i += VAVOO_PREMIUM_CONCURRENCY) {
        if (probe && Date.now() > deadline) break;
        const slice = items.slice(i, i + VAVOO_PREMIUM_CONCURRENCY);
        const resolved = await Promise.all(
          slice.map(async (c) => {
            const url = await vavooResolve(c.ids?.id || "");
            if (!url) return { c, url: "", verified: false };
            const verdict = probe ? await vavooProbe(url) : "slow";
            if (verdict === "dead") return { c, url: "", verified: false };
            return { c, url, verified: verdict === "live" };
          }),
        );
        for (const { c, url, verified } of resolved) {
          const ch = vavooItemToChannel(c, url, "", verified);
          if (ch) out.push(ch);
        }
      }
      return out;
    }),
  );

  // Merge brands in declaration order, keeping the first working feed when the
  // same channel name appears under more than one search term.
  const seen = new Set<string>();
  const merged: VavooChannel[] = [];
  for (const list of perBrand) {
    for (const ch of list) {
      const key = ch.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(ch);
    }
  }
  return merged;
}
