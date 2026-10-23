/**
 * Reverse-geocoding with a fail-safe provider chain.
 *
 * Nominatim (OpenStreetMap) stays the AUTHORITATIVE provider — it is the
 * most detailed and is what the EPRA town matching was tuned against. It is
 * also the provider that FAILS in production: it returns HTTP 403 to
 * datacenter egress (verified from Vercel/CI), and this module previously had
 * no fallback, so a 403 took the whole fuel lookup down.
 *
 * Chain (verified reachable, keyless):
 *   1. Nominatim            — authoritative, most detail, usage policy applies
 *   2. BigDataCloud         — keyless, returns a clean locality/city name
 *   3. Photon (Komoot)      — keyless OSM index, rich city/county/state
 *
 * Providers 2 and 3 exist so a geocoding failure degrades instead of
 * breaking, and so the resolved name can be cross-checked.
 */

import { withFailover, type ProviderAttempt } from "./provider-failover.js";

export interface ResolvedLocation {
  village: string | null;
  town: string | null;
  city: string | null;
  country: string;
  countryCode: string | null;
  /** Best single display name for caching — the FINEST local structure found. */
  displayName: string;
  /** Which provider produced this result (for diagnostics + trust). */
  provider?: string;
  /** True when a second provider returned the same locality name. */
  corroborated?: boolean;
}

const UA = "FuelAppMobile/1.0 (fuel-app-mobile.vercel.app)";

/** Fields we compare when cross-checking two geocoder answers. */
function localityKey(loc: ResolvedLocation | null): string {
  if (!loc) return "";
  return (loc.village || loc.town || loc.city || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** --- Provider 1: Nominatim (authoritative) ------------------------------- */

async function nominatimReverse(
  lat: number,
  lon: number,
  zoom: number,
): Promise<Record<string, unknown>> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function fromNominatim(data: Record<string, unknown>): ResolvedLocation {
  const addr = (data.address || {}) as Record<string, string>;
  const village = addr.village || addr.hamlet || addr.suburb || null;
  const town = addr.town || null;
  const city =
    addr.city ||
    addr.municipality ||
    addr.county ||
    addr.state_district ||
    null;
  const displayName = village || town || city || "Unknown Location";
  return {
    village,
    town,
    city,
    country: addr.country || "Unknown",
    countryCode: addr.country_code?.toUpperCase() || null,
    displayName,
  };
}

async function viaNominatim(
  lat: number,
  lon: number,
): Promise<ResolvedLocation | null> {
  // zoom=14 gives village/suburb detail in populated areas; when OSM lacks
  // admin detail there (common in remote areas) zoom=18 surfaces the town
  // name the coarser zoom missed (e.g. Kakuma Town only appears at zoom=18).
  const coarse = fromNominatim(await nominatimReverse(lat, lon, 14));
  if (coarse.displayName !== "Unknown Location") return coarse;

  const fine = fromNominatim(await nominatimReverse(lat, lon, 18));
  if (fine.displayName !== "Unknown Location") return fine;
  return coarse;
}

/** --- Provider 2: BigDataCloud (keyless) --------------------------------- */

async function viaBigDataCloud(
  lat: number,
  lon: number,
): Promise<ResolvedLocation | null> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`BigDataCloud ${res.status}`);
  const d = (await res.json()) as Record<string, string>;
  const locality = d.locality || null;
  const city = d.city || null;
  const sub = d.principalSubdivision || null;
  const displayName = locality || city || sub || null;
  if (!displayName) return null;
  return {
    village: locality,
    town: locality || city,
    city: city || sub,
    country: d.countryName || "Unknown",
    countryCode: d.countryCode?.toUpperCase() || null,
    displayName,
  };
}

/** --- Provider 3: Photon / Komoot (keyless OSM) -------------------------- */

async function viaPhoton(
  lat: number,
  lon: number,
): Promise<ResolvedLocation | null> {
  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const body = (await res.json()) as {
    features?: { properties?: Record<string, string> }[];
  };
  const p = body.features?.[0]?.properties;
  if (!p) return null;
  const village = p.village || p.hamlet || p.suburb || null;
  const town = p.town || null;
  const city = p.city || p.county || p.state || null;
  const displayName = p.name || village || town || city || null;
  if (!displayName) return null;
  return {
    village,
    town,
    city,
    country: p.country || "Unknown",
    countryCode: p.countrycode?.toUpperCase() || null,
    displayName,
  };
}

/**
 * Resolve a coordinate to a place name.
 *
 * Throws only when EVERY provider fails — a single provider outage is
 * absorbed by the chain.
 */
export async function getExactLocation(
  lat: number,
  lon: number,
): Promise<ResolvedLocation> {
  const attempts: ProviderAttempt<ResolvedLocation>[] = [
    { id: "nominatim", run: () => viaNominatim(lat, lon) },
    { id: "bigdatacloud", run: () => viaBigDataCloud(lat, lon) },
    { id: "photon", run: () => viaPhoton(lat, lon) },
  ];

  // confirmWith: 2 — the second provider is consulted purely to CORROBORATE
  // the first. Precedence is unchanged (Nominatim still wins when it answers);
  // agreement is reported so a caller can mark a name verified rather than
  // presenting an unconfirmed one as fact.
  const outcome = await withFailover(attempts, {
    timeoutMs: 9000,
    confirmWith: 2,
    agrees: (a, b) => localityKey(a) === localityKey(b),
  });

  if (!outcome) {
    throw new Error("Geocoding failed: all providers unavailable");
  }

  return {
    ...outcome.value,
    provider: outcome.servedBy,
    corroborated: outcome.corroborated,
  };
}
