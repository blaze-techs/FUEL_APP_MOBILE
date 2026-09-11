/**
 * FuelPriceService - Auto-detects fuel prices based on location
 * Uses a hidden mini-browser approach to fetch real-time fuel prices
 * Runs once per day to avoid excessive API calls
 *
 * Now uses unified pricing from @/react-app/config/pricing
 */

// Use relative import since the path alias might not work in all contexts
import { detectCountryFromTimezone } from "../config/countries";
import {
  KENYA_BASE_PRICES,
  REGIONAL_PRICES,
  getWorldFuelPrices,
} from "../config/pricing";
import { getCountryFromLocation } from "../lib/world-country-utils";
import { getCurrencySymbol } from "../lib/currency";

// Storage keys
const PRICES_CACHE_KEY = "fuelpro_daily_prices";
const LAST_FETCH_KEY = "fuelpro_prices_fetch_date";
const LOCATION_CACHE_KEY = "fuelpro_user_location";

// Types
export interface FuelPrices {
  petrolPrice: number;
  dieselPrice: number;
  currency: string;
  currencySymbol: string;
  location: string;
  countryCode: string;
  fetchedAt: string;
  source: string;
}

export interface LocationData {
  country: string;
  countryCode: string;
  city: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
}

// Use unified pricing constants
const KENYA_PETROL_PRICE = KENYA_BASE_PRICES.petrol; // EPRA current cycle
const KENYA_DIESEL_PRICE = KENYA_BASE_PRICES.diesel; // EPRA current cycle

// Get today's date string for caching
function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

// Check if we should fetch new prices (only once per day)
export function shouldFetchPrices(): boolean {
  try {
    const lastFetch = localStorage.getItem(LAST_FETCH_KEY);
    if (!lastFetch) return true;
    return lastFetch !== getTodayString();
  } catch {
    return true;
  }
}

// Get cached prices
export function getCachedPrices(): FuelPrices | null {
  try {
    const cached = localStorage.getItem(PRICES_CACHE_KEY);
    if (!cached) return null;
    const prices: FuelPrices = JSON.parse(cached);
    // Check if cache is from today
    if (prices.fetchedAt?.startsWith(getTodayString())) {
      return prices;
    }
    return null;
  } catch {
    return null;
  }
}

// Save prices to cache
function savePricesToCache(prices: FuelPrices): void {
  try {
    localStorage.setItem(PRICES_CACHE_KEY, JSON.stringify(prices));
    localStorage.setItem(LAST_FETCH_KEY, getTodayString());
  } catch (e) {
    console.warn("[FuelPrice] Failed to cache prices:", e);
  }
}

// Currency lookup shared across detection paths.
const currencyMap: Record<string, { currency: string; symbol: string }> = {
  KE: { currency: "KES", symbol: "KSh" },
  UG: { currency: "UGX", symbol: "USh" },
  TZ: { currency: "TZS", symbol: "TSh" },
  NG: { currency: "NGN", symbol: "₦" },
  ZA: { currency: "ZAR", symbol: "R" },
  GH: { currency: "GHS", symbol: "GH₵" },
  RW: { currency: "RWF", symbol: "RF" },
  ET: { currency: "ETB", symbol: "Br" },
};

// Get location data using multiple methods.
// Timezone is the PRIMARY signal because IP geolocation often resolves to the
// CDN/edge node (e.g. a US IP on Vercel) rather than the user's real location.
// IP geolocation is only used to fill in the city/country display name and to
// CONFIRM the timezone-derived country; it never overrides a valid timezone
// detection with a conflicting CDN-derived country.
//
// `locationHint` is an optional free-text location string (e.g. "Nairobi, Kenya")
// — typically the station's configured location. When provided, the country
// parsed from it takes priority over timezone/IP detection so that a station
// in Kenya always resolves to Kenyan prices even when the app is served from a
// US CDN edge with a non-mapped browser timezone.
async function detectUserLocation(
  locationHint?: string,
): Promise<LocationData> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // If a location hint was supplied, derive the country from it FIRST. This is
  // the station's own configured location, so it is the most authoritative
  // signal and must not be overridden by CDN-derived IP/timezone detection.
  if (locationHint) {
    const derived = getCountryFromLocation(locationHint);
    if (derived) {
      const currencyInfo = currencyMap[derived.code] || {
        currency: "USD",
        symbol: "$",
      };
      // Pull the city portion (first non-country segment) for display.
      const city =
        locationHint
          .split(/[,;|]/)
          .map((s) => s.trim())
          .find(
            (s) => s && !s.toLowerCase().includes(derived.name.toLowerCase()),
          ) || derived.name;
      const locationData: LocationData = {
        country: derived.name,
        countryCode: derived.code,
        city,
        timezone,
        currency: currencyInfo.currency,
        currencySymbol: currencyInfo.symbol,
      };
      try {
        localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locationData));
      } catch {}
      return locationData;
    }
  }

  const tzCountry = detectCountryFromTimezone();

  // Method 1: Try to get from cached location — but only trust it if it still
  // agrees with the current timezone-derived country. A stale cache that
  // conflicts with the timezone (e.g. cached "US" while the browser reports
  // Africa/Nairobi) is discarded so a bad CDN-based detection can't persist.
  try {
    const cachedLoc = localStorage.getItem(LOCATION_CACHE_KEY);
    if (cachedLoc) {
      const loc: LocationData = JSON.parse(cachedLoc);
      if (loc.countryCode === tzCountry) {
        return loc;
      }
      // Mismatch: the cached value was likely a CDN-derived false positive.
      // Fall through to re-detect.
      console.log(
        "[FuelPrice] Discarding stale location cache (country mismatch with timezone)",
      );
    }
  } catch {}

  // Method 2: Timezone-derived country is our trusted baseline
  let countryCode = tzCountry;
  let city = "Unknown";
  let country = "Unknown";

  // Method 3: Try IP geolocation ONLY to fill in city/country display names,
  // and only adopt its country code if it agrees with the timezone country.
  // This keeps the CDN's IP from overriding the user's real locale.
  try {
    const response = await fetch(
      "https://ipwho.is/?fields=success,country,country_code,city,timezone",
    );
    if (response.ok) {
      const data = await response.json();
      if (data.success !== false) {
        city = data.city || city;
        country = data.country || country;
        // Only trust IP country code when it confirms the timezone detection,
        // OR when timezone detection was inconclusive (neutral "US" default
        // from a non-mapped timezone). This prevents a US CDN IP from
        // overriding an Africa/Nairobi timezone.
        if (data.country_code && data.country_code === tzCountry) {
          countryCode = data.country_code;
        }
      }
    }
  } catch {
    console.log("[FuelPrice] IP geolocation failed, using timezone detection");
  }

  const currencyInfo = currencyMap[countryCode] || {
    currency: "USD",
    symbol: "$",
  };

  const locationData: LocationData = {
    country,
    countryCode,
    city,
    timezone,
    currency: currencyInfo.currency,
    currencySymbol: currencyInfo.symbol,
  };

  // Cache the location
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locationData));
  } catch {}

  return locationData;
}

// Scrape fuel prices using hidden iframe approach
async function scrapeFuelPrices(location: LocationData): Promise<FuelPrices> {
  // For Kenya, try live EPRA-sourced prices first (via serverless /api/fuel-prices,
  // which keeps the oilpriceapi.com key server-side). Falls back to the static
  // regulated baseline below if the endpoint isn't configured or fails.
  if (location.countryCode === "KE") {
    try {
      const res = await fetch("/api/fuel-prices");
      if (res.ok) {
        const live = await res.json();
        if (live.success && live.petrolPrice && live.dieselPrice) {
          return {
            petrolPrice: live.petrolPrice,
            dieselPrice: live.dieselPrice,
            currency: getCurrencySymbol(),
            currencySymbol: getCurrencySymbol(),
            location: `${location.city}, ${location.country}`,
            countryCode: "KE",
            fetchedAt: live.fetchedAt || new Date().toISOString(),
            source: live.source || "EPRA (live)",
          };
        }
      }
    } catch {
      // Fall through to static baseline below
    }

    return {
      petrolPrice: KENYA_PETROL_PRICE,
      dieselPrice: KENYA_DIESEL_PRICE,
      currency: getCurrencySymbol(),
      currencySymbol: getCurrencySymbol(),
      location: `${location.city}, ${location.country}`,
      countryCode: "KE",
      fetchedAt: new Date().toISOString(),
      source:
        "EPRA Regulated Prices (static baseline — set OILPRICE_API_KEY for live updates)",
    };
  }

  // For other supported countries, use approximate prices based on region
  const regionalPrices: Record<string, { petrol: number; diesel: number }> = {
    UG: { petrol: 4100, diesel: 3900 }, // UGX per litre
    TZ: { petrol: 2750, diesel: 2650 }, // TZS per litre
    NG: { petrol: 850, diesel: 950 }, // NGN per litre
    ZA: { petrol: 25.0, diesel: 24.5 }, // ZAR per litre
    GH: { petrol: 14.5, diesel: 13.5 }, // GHS per litre
    RW: { petrol: 1450, diesel: 1400 }, // RWF per litre
    ET: { petrol: 55, diesel: 52 }, // ETB per litre
  };

  // Use unified regional prices
  const regional = REGIONAL_PRICES[location.countryCode];
  // WORLD-WIDE: countries not in REGIONAL_PRICES get prices derived from the
  // USD baseline × their own currency exchange rate — never Kenya defaults.
  const world = getWorldFuelPrices()[location.countryCode.toUpperCase()];
  // If no price data exists for this country, return a NEUTRAL empty (0)
  // baseline in USD rather than fabricating Kenyan KSh prices for a
  // non-Kenya station.
  const prices = regional ||
    world || {
      petrol: 0,
      diesel: 0,
      currencySymbol: "$",
      currency: "USD",
    };
  const currencySymbols: Record<string, string> = {
    KE: "KSh",
    UG: "USh",
    TZ: "TSh",
    NG: "₦",
    ZA: "R",
    GH: "GH₵",
    RW: "RF",
    ET: "Br",
    US: "$",
    GB: "£",
    EU: "€",
  };

  return {
    petrolPrice: prices.petrol,
    dieselPrice: prices.diesel,
    currency: regional?.currency || world?.currency || location.currency,
    currencySymbol:
      currencySymbols[location.countryCode] ||
      regional?.currencySymbol ||
      world?.currencySymbol ||
      location.currencySymbol ||
      "$",
    location: `${location.city}, ${location.country}`,
    countryCode: location.countryCode,
    fetchedAt: new Date().toISOString(),
    source: regional
      ? "Regional Average Prices"
      : world
        ? "World-Wide Estimated Prices"
        : "No price data (enter manually)",
  };
}

// Main function: Get fuel prices (uses cache if available)
export async function getFuelPrices(
  locationHint?: string,
): Promise<FuelPrices> {
  // When a location hint is provided, bypass the daily cache so the prices
  // always reflect the (possibly changed) station location rather than a
  // stale CDN-derived detection from earlier in the day.
  if (!locationHint) {
    const cached = getCachedPrices();
    if (cached) {
      console.log("[FuelPrice] Using cached prices from", cached.fetchedAt);
      return cached;
    }
  }

  // GPS-first path: when precise coordinates are available (written by
  // LocationContext.detectPreciseLocation), call the hyper-local fuel-engine
  // (/api/fuel-local → reverse-geocode → web search → AI parse → PostGIS
  // nearest-neighbour). This gives village-level prices; the legacy detection
  // below remains the fallback when GPS is unavailable or the engine has no
  // data for the region.
  try {
    const coordsRaw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("fuelpro_user_coords")
        : null;
    if (coordsRaw) {
      const { lat, lng } = JSON.parse(coordsRaw) as {
        lat: number;
        lng: number;
      };
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
        const res = await fetch(`/api/fuel-local?lat=${lat}&lon=${lng}`);
        if (res.ok) {
          const local = await res.json();
          if (
            local.success &&
            local.prices &&
            (local.prices.super_petrol != null || local.prices.diesel != null)
          ) {
            const countryCode = local.country_code || "KE";
            const cur = currencyMap[countryCode] || {
              currency: local.currency || getCurrencySymbol(),
              symbol: getCurrencySymbol(),
            };
            const prices: FuelPrices = {
              petrolPrice: local.prices.super_petrol ?? KENYA_PETROL_PRICE,
              dieselPrice: local.prices.diesel ?? KENYA_DIESEL_PRICE,
              currency: cur.currency,
              currencySymbol: cur.symbol,
              location: `${local.location}, ${local.country}`,
              countryCode,
              fetchedAt: local.last_updated || new Date().toISOString(),
              source: local.is_approximate
                ? `Approx. (nearest: ${local.nearest_town})`
                : local.source || "AI-Verified",
            };
            savePricesToCache(prices);
            console.log(
              "[FuelPrice] Hyper-local engine prices:",
              prices.location,
            );
            return prices;
          }
        }
      }
    }
  } catch (e) {
    console.warn(
      "[FuelPrice] Hyper-local engine unavailable, falling back:",
      e,
    );
  }

  // Need to fetch new prices
  console.log("[FuelPrice] Fetching fresh fuel prices...");

  try {
    // Step 1: Detect user location
    const location = await detectUserLocation(locationHint);
    console.log("[FuelPrice] Detected location:", location);

    // Step 2: Scrape/fetch fuel prices
    const prices = await scrapeFuelPrices(location);

    // Step 3: Cache the results
    savePricesToCache(prices);

    console.log("[FuelPrice] New prices fetched:", prices);
    return prices;
  } catch (error) {
    console.error("[FuelPrice] Failed to fetch prices:", error);

    // Return fallback prices based on timezone detection
    const countryCode = detectCountryFromTimezone();
    // Use unified pricing for fallback
    const regional = REGIONAL_PRICES[countryCode];
    const world = getWorldFuelPrices()[countryCode.toUpperCase()];
    // A non-Kenya country with no regional/world data gets a NEUTRAL empty
    // (0) USD baseline — never Kenya's KSh prices.
    const petrolPrice =
      countryCode === "KE"
        ? KENYA_PETROL_PRICE
        : regional?.petrol || world?.petrol || 0;
    const dieselPrice =
      countryCode === "KE"
        ? KENYA_DIESEL_PRICE
        : regional?.diesel || world?.diesel || 0;
    const fallbackPrices: FuelPrices = {
      petrolPrice,
      dieselPrice,
      currency: regional?.currency || world?.currency || "USD",
      currencySymbol: regional?.currencySymbol || world?.currencySymbol || "$",
      location: "Auto-detected",
      countryCode,
      fetchedAt: new Date().toISOString(),
      source: "Fallback Prices",
    };

    return fallbackPrices;
  }
}

// Background fetch with hidden iframe approach
export async function fetchPricesInBackground(): Promise<FuelPrices | null> {
  if (!shouldFetchPrices()) {
    const cached = getCachedPrices();
    return cached;
  }

  try {
    // Create a hidden iframe to fetch prices in the background
    // This runs completely invisible to the user
    const prices = await getFuelPrices();
    return prices;
  } catch (error) {
    console.error("[FuelPrice] Background fetch failed:", error);
    return null;
  }
}

// Reset the cache to force a fresh fetch (for testing)
export function resetPriceCache(): void {
  localStorage.removeItem(PRICES_CACHE_KEY);
  localStorage.removeItem(LAST_FETCH_KEY);
}

// Get prices with fallback for UI display
export function getDisplayPrices(): {
  pmsPrice: number;
  agoPrice: number;
  currencySymbol: string;
} {
  const cached = getCachedPrices();
  if (cached) {
    return {
      pmsPrice: cached.petrolPrice,
      agoPrice: cached.dieselPrice,
      currencySymbol: cached.currencySymbol,
    };
  }

  // Default fallback prices using unified pricing
  const countryCode = detectCountryFromTimezone();
  const regional = REGIONAL_PRICES[countryCode];
  const world = getWorldFuelPrices()[countryCode.toUpperCase()];
  // A non-Kenya country with no regional/world data gets a NEUTRAL empty
  // (0) USD baseline — never Kenya's KSh prices.
  return {
    pmsPrice:
      countryCode === "KE"
        ? KENYA_PETROL_PRICE
        : regional?.petrol || world?.petrol || 0,
    agoPrice:
      countryCode === "KE"
        ? KENYA_DIESEL_PRICE
        : regional?.diesel || world?.diesel || 0,
    currencySymbol: regional?.currencySymbol || world?.currencySymbol || "$",
  };
}
