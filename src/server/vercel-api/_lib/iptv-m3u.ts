/**
 * iptv-org master playlist (index.m3u) parser — VLC-equivalent catalog.
 *
 * The user asked to incorporate ALL channels/streams from
 * https://iptv-org.github.io/iptv/index.m3u (the exact file VLC opens) into
 * the News → Live TV tab. iptv-org's JSON API (channels.json + streams.json)
 * yields ~9.8k channels, but the master m3u has ~12.9k entries — it also
 * carries per-entry quality/geo variants (e.g. "Zee One", "Zee One Français",
 * "Zee One German"), group titles, logos, and the CUSTOM HTTP HEADERS
 * (User-Agent / Referrer) many streams require to avoid 403s.
 *
 * This module parses the raw m3u bytes into a compact JSON slice the proxy
 * can return with CORS headers. It is pure TS with no imports so it can be
 * bundled into BOTH the Vercel serverless function (api/) and the Cloudflare
 * Pages Function (functions/api) without dependency issues.
 */

export interface IptvM3uEntry {
  /** Stable unique id (tvg-id base + index suffix when duplicated). */
  id: string;
  /** Human channel name (the EXTINF display name). */
  name: string;
  /** Stream URL (direct; the HLS proxy will attach custom headers). */
  url: string;
  logo: string;
  /** ISO 2-letter country code derived from the tvg-id region suffix or
   *  matched from channels.json (empty when unknown). */
  country: string;
  /** group-title from the EXTINF (the channel's category/genre). */
  category: string;
  /** Lowercase category labels for the filter. */
  categories: string[];
  /** Alternate/transliterated names for search parity with VLC. */
  alt_names: string[];
  /** Custom User-Agent required to fetch this stream (if any). */
  userAgent?: string;
  /** Custom Referrer required to fetch this stream (if any). */
  referrer?: string;
  /** Quality label parsed from the display name (e.g. "720p"). */
  quality?: string;
}

/**
 * Parse the raw index.m3u text into channel entries.
 *
 * Handles:
 *  - EXTINF attribute lines (tvg-id, tvg-logo, group-title, ...)
 *  - EXTVLCOPT:http-user-agent / http-referrer header lines
 *  - EXTHTTP:... header lines
 *  - bare URL lines
 *  - URLs with |User-Agent=...|Referer=... query-appended params
 *  - quality suffixes in display names (" (720p)", "(1080p) [Geo-blocked]")
 *  - stable ids (tvg-id base; append a -N suffix on exact repeats)
 */
export function parseIptvM3u(raw: string): IptvM3uEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: IptvM3uEntry[] = [];
  const idCount = new Map<string, number>();

  const parseAttrs = (line: string) => {
    const attrs: Record<string, string> = {};
    // EXTINF attributes are `key="value"` pairs (or bare key=value)
    const re = /([A-Za-z0-9_-]+)="([^"]*)"|([A-Za-z0-9_-]+)=([^\s",]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[1] !== undefined) attrs[m[1]] = m[2];
      else if (m[3]) attrs[m[3]] = m[4];
    }
    return attrs;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXTINF")) {
      const extinf = line;
      const headers: { userAgent?: string; referrer?: string } = {};

      // Collect following EXTVLCOPT / EXTHTTP header lines
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

      // Find the URL (next non-comment, non-empty line)
      let k = j;
      while (
        k < lines.length &&
        (lines[k].trim().startsWith("#") || !lines[k].trim())
      ) {
        k++;
      }
      let url = "";
      if (k < lines.length) url = lines[k].trim();
      i = k; // skip consumed lines

      if (!url) continue;

      const attrs = parseAttrs(extinf);
      // The display name is the text after the LAST comma that is NOT inside
      // a quoted attribute value (user-agent strings can contain commas, e.g.
      // "(KHTML, like Gecko)").
      const nameRaw = extinf.includes(",")
        ? extinf.slice(findNameStart(extinf)).trim()
        : attrs["tvg-name"] || "";

      // Keep the raw display name (VLC shows it verbatim); don't strip the
      // quality/geo notes — those are useful search + display info.
      const name = nameRaw.trim();

      // Country: from tvg-id's TLD portion (ZeeOne.uk -> uk), else from
      // tvg-country attr. The @Suffix is a VARIANT label (SD/HD/UK/French/
      // German/APAC...) and is NOT a country — do not use it.
      let country = "";
      const tvgId = attrs["tvg-id"] || "";
      if (attrs["tvg-country"]) {
        country = attrs["tvg-country"].slice(0, 2).toUpperCase();
      } else {
        const tl = tvgId.match(/\.([A-Za-z]{2})(?:@|$)/);
        if (tl) country = tldToIso2(tl[1]);
      }

      const categoryRaw = attrs["group-title"] || "";
      const categories = categoryRaw
        .split(/[;|,]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      // Parse |User-Agent=...|Referer=... appended params in the URL
      let userAgent = headers.userAgent;
      let referrer = headers.referrer;
      const urlParamsMatch = url.match(/\|([^|]+)\|Referer=([^|]+)/);
      const uaInUrl = url.match(/\|User-Agent=([^|]+)/);
      if (uaInUrl) {
        userAgent = beUnescape(uaInUrl[1]);
        // strip the |User-Agent=...| segment from the URL
        url = url.replace(/\|User-Agent=[^|]*/, "");
      }
      if (urlParamsMatch) {
        referrer = beUnescape(urlParamsMatch[2]);
        url = url.replace(/\|Referer=[^|]*/, "");
      }
      // clean trailing | or query-ish leftovers
      url = url.replace(/\|$/, "");

      // Quality from name
      const qMatch = name.match(/\((\d{3,4}p)\)|\[(\d{3,4}p)\]/i);
      const quality = qMatch ? qMatch[1] || qMatch[2] : undefined;

      // Stable id: tvg-id base if present, else a URL-derived id, deduped.
      const channelId = tvgId.replace(/@.+$/, "") || urlHash(url);
      const seen = idCount.get(channelId) || 0;
      idCount.set(channelId, seen + 1);
      const id = seen > 0 ? `${channelId}-${seen + 1}` : channelId;

      entries.push({
        id,
        name: name || nameRaw || attrs["tvg-name"] || "Unknown",
        url,
        logo: attrs["tvg-logo"] || "",
        country,
        category: categoryRaw,
        categories,
        alt_names: [nameRaw, attrs["tvg-name"] || ""]
          .map((s) => s.trim())
          .filter((s) => s && s !== name),
        userAgent,
        referrer,
        quality,
      });
    }
  }

  return entries;
}

/**
 * Index of the character that begins the display name in an EXTINF line.
 * The name is everything after the LAST comma outside any quoted attribute
 * value. We scan left-to-right tracking quote state; when a comma appears
 * while NOT inside quotes, that is a candidate separator — the LAST such
 * candidate wins (attribute values with commas, e.g. user-agent strings,
 * are inside quotes so their commas are skipped).
 */
function findNameStart(line: string): number {
  let inQuote = false;
  let lastSep = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "," && !inQuote) lastSep = i;
  }
  return lastSep >= 0 ? lastSep + 1 : 0;
}

/** Map a country-code TLD (lowercase) to the ISO-3166 alpha-2 code iptv-org
 *  uses (e.g. "uk" -> GB). Falls back to uppercased TLD otherwise. */
function tldToIso2(tld: string): string {
  const t = tld.toLowerCase();
  const map: Record<string, string> = {
    uk: "GB",
  };
  return map[t] || t.toUpperCase();
}

/** Deterministic 12-char id from a URL (CF-safe, no Buffer). */
function urlHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h * 31 + url.charCodeAt(i)) >>> 0;
  }
  return `m3u-${h.toString(36).slice(0, 12)}`;
}

/** Decode %-escapes in the querystring-appended header params. */
function beUnescape(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Merge the parsed m3u entries with the (optional) channels.json metadata to
 * enrich country + alt names for entries whose tvg-id lacks a clear suffix.
 *
 * @param entries entries from parseIptvM3u
 * @param channelById map of channel id -> {country, alt_names, name} from
 *   iptv-org channels.json (only ids that map cleanly)
 */
export function enrichM3uWithChannelsJson(
  entries: IptvM3uEntry[],
  channelById: Map<
    string,
    { country?: string; alt_names?: string[]; name?: string }
  >,
): IptvM3uEntry[] {
  return entries.map((e) => {
    const meta = channelById.get(e.id);
    if (!meta) return e;
    return {
      ...e,
      country: e.country || (meta.country || "").toUpperCase() || "",
      alt_names:
        e.alt_names.length > 0
          ? e.alt_names
          : Array.isArray(meta.alt_names) && meta.alt_names.length
            ? meta.alt_names!
            : [],
      name: e.name === "Unknown" && meta.name ? meta.name : e.name,
    };
  });
}

/**
 * Convert a parsed m3u entry to the IptvChannel wire shape used by the
 * existing client code.
 */
export function m3uEntryToIptvChannel(e: IptvM3uEntry): {
  id: string;
  name: string;
  url: string;
  logo: string;
  country: string;
  language: string;
  category: string;
  alt_names: string[];
  userAgent?: string;
  referrer?: string;
  quality?: string;
} {
  const out: {
    id: string;
    name: string;
    url: string;
    logo: string;
    country: string;
    language: string;
    category: string;
    alt_names: string[];
    userAgent?: string;
    referrer?: string;
    quality?: string;
  } = {
    id: e.id,
    name: e.name,
    url: e.url,
    logo: e.logo || "",
    country: e.country || "",
    language: "",
    category: e.categories.join(", "),
    alt_names: e.alt_names,
  };
  if (e.userAgent) out.userAgent = e.userAgent;
  if (e.referrer) out.referrer = e.referrer;
  if (e.quality) out.quality = e.quality;
  return out;
}
