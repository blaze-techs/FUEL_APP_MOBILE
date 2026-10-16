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
}

const VAVOO_CATALOG_URL = "https://www.vavoo.to/live/mediahubmx-catalog.json";
const VAVOO_RESOLVE_URL = "https://www.vavoo.to/live/mediahubmx-resolve.json";
const VAVOO_UA = "MediaHubMX/2";
/** Hard cap on how many catalogue pages we walk in one request. */
const VAVOO_MAX_PAGES = 40;

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
 * Fetch + resolve Vavoo live channels. Resolution runs in small concurrent
 * batches; any channel that does not resolve to a stream URL is dropped, so
 * the caller only ever receives channels that actually play.
 *
 * @param group     optional region filter (e.g. "Germany")
 * @param limit     max channels to return (0 = no cap)
 * @param maxResolve hard cap on resolve attempts (keeps latency bounded)
 */
export async function fetchVavooChannels(
  group = "",
  limit = 300,
  maxResolve = 300,
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
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const resolved = await Promise.all(
      slice.map(async (c) => ({ c, url: await vavooResolve(c.ids?.id || "") })),
    );
    for (const { c, url } of resolved) {
      const id = c.ids?.id || "";
      if (!id || !url) continue;
      const name = (c.name || "").replace(/\s*\.\w+$/, "").trim() || c.name;
      const grp = c.group || group || "";
      out.push({
        id: `vavoo-${id}`,
        name: `${name}${grp ? ` (${grp})` : ""}`,
        group: grp,
        url,
        logo: c.logo || "",
        country: VAVOO_GROUP_COUNTRY[grp] || "",
        source: "vavoo",
        audio: false,
      });
    }
  }
  return out;
}

/** The region groups the Vavoo catalogue exposes (for a UI filter). */
export const VAVOO_GROUPS = Object.keys(VAVOO_GROUP_COUNTRY);
