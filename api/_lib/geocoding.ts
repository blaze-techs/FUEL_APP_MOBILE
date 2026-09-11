/**
 * Reverse-geocoding helper using OpenStreetMap Nominatim (free, no API key).
 *
 * Server-side only (called from serverless functions) to resolve a lat/lon
 * pair to a human-readable location name + country for the fuel-prices cache.
 * Nominatim's usage policy requires a descriptive User-Agent.
 */

export interface ResolvedLocation {
  village: string | null;
  town: string | null;
  city: string | null;
  country: string;
  countryCode: string | null;
  /** Best single display name for caching — the FINEST local structure found. */
  displayName: string;
}

export async function getExactLocation(
  lat: number,
  lon: number,
): Promise<ResolvedLocation> {
  // Resolve to the FINEST local structure (village / town / center), never
  // the state or county. zoom=14 returns village/suburb detail in populated
  // areas; when OSM lacks admin detail at that zoom (common in remote areas)
  // we fall back to zoom=18, which surfaces town/village names the coarser
  // zoom missed (e.g. Kakuma Town only appears at zoom=18). This guarantees we
  // resolve "Nawoitorong" / "Kakuma Town", not the parent state "Turkana".
  const ua = "FuelAppMobile/1.0 (fuel-app-mobile.vercel.app)";

  async function reverse(zoom: number): Promise<any> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`;
    const res = await fetch(url, { headers: { "User-Agent": ua } });
    if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
    return res.json();
  }

  let data: any = await reverse(14);
  let addr = data.address || {};

  const village = addr.village || addr.hamlet || addr.suburb || null;
  const town = addr.town || null;
  const city =
    addr.city ||
    addr.municipality ||
    addr.county ||
    addr.state_district ||
    null;
  const country = addr.country || "Unknown";
  const countryCode = addr.country_code?.toUpperCase() || null;

  // displayName prefers the most specific locality: village > town > city.
  // This is the cache key, so a village gets its own row rather than being
  // bucketed under the nearest city.
  let displayName = village || town || city || null;

  // If zoom=14 only yielded a state/county (no real locality), retry at
  // zoom=18 to catch town/village names OSM hides at coarser zoom.
  if (!displayName) {
    try {
      const fine = await reverse(18);
      const fa = fine.address || {};
      const fineVillage = fa.village || fa.hamlet || fa.suburb || null;
      const fineTown = fa.town || null;
      const fineCity =
        fa.city || fa.municipality || fa.county || fa.state_district || null;
      const fineName = fineVillage || fineTown || fineCity || null;
      if (fineName) {
        data = fine;
        addr = fa;
        displayName = fineName;
      }
    } catch {
      /* keep the zoom=14 result if zoom=18 fails */
    }
  }

  return {
    village: addr.village || addr.hamlet || addr.suburb || village,
    town: addr.town || town,
    city:
      addr.city ||
      addr.municipality ||
      addr.county ||
      addr.state_district ||
      city,
    country: addr.country || country,
    countryCode: (addr.country_code || "").toUpperCase() || countryCode,
    displayName: displayName || "Unknown Location",
  };
}
