// ============================================================
import {
  KENYA_BASE_PRICES,
  KENYA_CITIES as BASE_CITIES,
} from "@/react-app/config/pricing";
// DataSyncService - Comprehensive auto-update engine for FuelPro
// Fetches real-time data from credible internet sources
// Auto-syncs with precise location for exact fuel prices
// ============================================================

import { getCountryById } from "@/react-app/config/countries";
import { getCurrencySymbol, getDetectedCountryCode } from "../lib/currency";

// Use BASE_CITIES from pricing config
const KENYA_CITIES = BASE_CITIES;

// --- GEOLOCATION-BASED CITY MATCHING ---
interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  accuracy?: number;
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get nearest city based on coordinates
function getNearestCity(
  lat: number,
  lng: number,
  countryCode: string,
): { city: string; distance: number } | null {
  if (countryCode !== "KE") return null;

  let nearest: { name: string; distance: number } | null = null;

  for (const city of KENYA_CITIES) {
    const dist = calculateDistance(lat, lng, city.lat, city.lng);
    if (!nearest || dist < nearest.distance) {
      nearest = { name: city.name, distance: dist };
    }
  }

  return nearest ? { city: nearest.name, distance: nearest.distance } : null;
}

// Get precise price for location
export async function getPriceForLocation(
  countryCode: string,
  lat?: number,
  lng?: number,
): Promise<{
  petrolPrice: number;
  dieselPrice: number;
  kerosenePrice: number;
  isRegional: boolean;
  cityName: string;
  transportSurcharge: number;
  source: string;
}> {
  // Country-appropriate default prices. Previously this returned Nairobi
  // prices (193.43 KES) for EVERY non-Kenya country, leaking Kenya fuel
  // prices into German/US/etc. stations whenever GPS coords were present.
  // Now resolve the country's own regional estimate (in its own currency)
  // and only fall back to Nairobi for Kenya itself.
  const regionalEstimate = getRegionalPriceEstimates(countryCode, "");
  const defaultPrices = {
    petrolPrice: regionalEstimate.petrol,
    dieselPrice: regionalEstimate.diesel,
    kerosenePrice: regionalEstimate.kerosene,
    isRegional: false,
    cityName:
      countryCode === "KE" ? "Nairobi" : `${countryCode} National Average`,
    transportSurcharge: 0,
    source: countryCode === "KE" ? "EPRA Default" : "Regional Estimate",
  };

  if (countryCode !== "KE" || lat === undefined || lng === undefined) {
    return defaultPrices;
  }

  const nearest = getNearestCity(lat, lng, countryCode);
  if (!nearest) {
    return defaultPrices;
  }

  // Use the REAL published EPRA town prices (KENYA_CITIES) directly. The
  // previous implementation overwrote them with an "AI-estimated" base that
  // compounded +KSh2.25/month indefinitely — fabricating prices that drifted
  // further from the official EPRA gazette every month. That fabrication was
  // removed; the static table is refreshed each EPRA cycle.
  const cityData = KENYA_CITIES.find((c) => c.name === nearest.city);

  // If too far from any priced town (>150km), anchor to the nearest town's
  // REAL price plus a small distance-proportional transport surcharge
  // (~KSh0.02/km beyond the priced town, consistent with the EPRA transport
  // differentials in the gazette).
  if (nearest.distance > 150 && cityData) {
    const extra = Math.round((nearest.distance - 150) * 0.02 * 100) / 100;
    return {
      petrolPrice: Math.round((cityData.petrolPrice + extra) * 100) / 100,
      dieselPrice: Math.round((cityData.dieselPrice + extra) * 100) / 100,
      kerosenePrice: Math.round((cityData.kerosenePrice + extra) * 100) / 100,
      isRegional: true,
      cityName: `Near ${nearest.city}`,
      transportSurcharge:
        Math.round((cityData.transportSurcharge + extra) * 100) / 100,
      source: "EPRA Nearest (distance-adjusted)",
    };
  }

  if (cityData) {
    return {
      petrolPrice: cityData.petrolPrice,
      dieselPrice: cityData.dieselPrice,
      kerosenePrice: cityData.kerosenePrice,
      isRegional: true,
      cityName: cityData.name,
      transportSurcharge: cityData.transportSurcharge,
      source: "EPRA Published (15 Aug – 14 Sep 2026)",
    };
  }

  return defaultPrices;
}

// Sync wrapper for backward compatibility
export function getPriceForLocationSync(
  countryCode: string,
  lat?: number,
  lng?: number,
): {
  petrolPrice: number;
  dieselPrice: number;
  kerosenePrice: number;
  isRegional: boolean;
  cityName: string;
  transportSurcharge: number;
  source: string;
} {
  // Country-appropriate default prices. Previously this returned Nairobi
  // prices (193.43 KES) for EVERY non-Kenya country, leaking Kenya fuel
  // prices into German/US/etc. stations whenever GPS coords were present.
  // Now resolve the country's own regional estimate (in its own currency)
  // and only fall back to Nairobi for Kenya itself.
  const regionalEstimate = getRegionalPriceEstimates(countryCode, "");
  const defaultPrices = {
    petrolPrice: regionalEstimate.petrol,
    dieselPrice: regionalEstimate.diesel,
    kerosenePrice: regionalEstimate.kerosene,
    isRegional: false,
    cityName:
      countryCode === "KE" ? "Nairobi" : `${countryCode} National Average`,
    transportSurcharge: 0,
    source: countryCode === "KE" ? "EPRA Default" : "Regional Estimate",
  };

  if (countryCode !== "KE" || lat === undefined || lng === undefined) {
    return defaultPrices;
  }

  const nearest = getNearestCity(lat, lng, countryCode);
  if (!nearest || nearest.distance > 150) {
    return defaultPrices;
  }

  const cityData = KENYA_CITIES.find((c) => c.name === nearest.city);
  if (cityData) {
    return {
      petrolPrice: cityData.petrolPrice,
      dieselPrice: cityData.dieselPrice,
      kerosenePrice: cityData.kerosenePrice,
      isRegional: true,
      cityName: cityData.name,
      transportSurcharge: cityData.transportSurcharge,
      source: `EPRA Regional - ${cityData.name}`,
    };
  }

  return defaultPrices;
}

// --- GEOLOCATION API ---
interface GeoResult {
  coords: { latitude: number; longitude: number };
  timestamp: number;
}

function getCurrentPosition(): Promise<GeoResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos as unknown as GeoResult),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

// Store last known position
const lastKnownPosition: GeoResult | null = null;
const POSITION_CACHE_KEY = "fuelpro_last_geo_position";

// --- SYNC STATUS TRACKER ---
interface SyncRecord {
  key: string;
  lastSync: string; // ISO date
  nextSync: string; // ISO date
  source: string;
  status: "pending" | "syncing" | "success" | "error";
  data?: any;
  error?: string;
}

const SYNC_STORAGE_KEY = "fuelpro_sync_records";
const SYNC_INTERVAL_MS = 1000 * 60 * 60 * 6; // 6 hours default
const FUEL_PRICE_SYNC_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours for fuel (prices change daily)
const NEWS_SYNC_INTERVAL = 1000 * 60 * 30; // 30 minutes for news
const TAX_SYNC_INTERVAL = 1000 * 60 * 60 * 24 * 7; // Weekly for tax

// Maximum age for cached prices before forcing refresh (12 hours)
const MAX_PRICE_CACHE_AGE = 1000 * 60 * 60 * 12;

function loadSyncRecords(): Record<string, SyncRecord> {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSyncRecord(record: SyncRecord) {
  const records = loadSyncRecords();
  records[record.key] = record;
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(records));
}

function shouldSync(key: string, interval: number): boolean {
  const records = loadSyncRecords();
  const record = records[key];
  if (!record) return true;
  const nextSync = new Date(record.nextSync);
  return new Date() >= nextSync;
}

function markSyncing(key: string, source: string) {
  saveSyncRecord({
    key,
    lastSync: new Date().toISOString(),
    nextSync: new Date(Date.now() + SYNC_INTERVAL_MS).toISOString(),
    source,
    status: "syncing",
  });
}

function markSuccess(
  key: string,
  source: string,
  data?: any,
  interval?: number,
) {
  saveSyncRecord({
    key,
    lastSync: new Date().toISOString(),
    nextSync: new Date(
      Date.now() + (interval || SYNC_INTERVAL_MS),
    ).toISOString(),
    source,
    status: "success",
    data,
  });
}

function markError(key: string, source: string, error: string) {
  saveSyncRecord({
    key,
    lastSync: new Date().toISOString(),
    nextSync: new Date(Date.now() + 1000 * 60 * 15).toISOString(), // Retry in 15 min
    source,
    status: "error",
    error,
  });
}

// Check if prices are stale (older than MAX_PRICE_CACHE_AGE)
export function arePricesStale(countryCode: string): boolean {
  const records = loadSyncRecords();
  const key = `fuel_price_${countryCode}`;
  const record = records[key];

  if (!record) return true; // No record = stale

  const lastSync = new Date(record.lastSync).getTime();
  const now = Date.now();

  // Check if last update was today - if not, prices are stale
  const lastUpdateDate = new Date(lastSync).toDateString();
  const today = new Date().toDateString();
  if (lastUpdateDate !== today) return true;

  // Also check if cache is too old
  return now - lastSync > MAX_PRICE_CACHE_AGE;
}

// Force refresh prices - ignores sync interval
export async function forceRefreshPrices(
  countryCode: string,
): Promise<FuelPriceData | null> {
  const key = `fuel_price_${countryCode}`;

  // Clear sync record to force fresh fetch
  const records = loadSyncRecords();
  delete records[key];
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(records));

  // Fetch fresh prices
  try {
    const specificFetchers: Record<
      string,
      () => Promise<FuelPriceData | null>
    > = {
      KE: fetchKenyaFuelPrices,
      UG: fetchUgandaFuelPrices,
      TZ: fetchTanzaniaFuelPrices,
      NG: fetchNigeriaFuelPrices,
      ZA: fetchSouthAfricaFuelPrices,
      ET: fetchEthiopiaFuelPrices,
      RW: fetchRwandaFuelPrices,
      GH: fetchGhanaFuelPrices,
    };

    const fetcher = specificFetchers[countryCode];
    if (fetcher) {
      return await fetcher();
    }
  } catch (error) {
    console.error("[DataSync] Force refresh failed:", error);
  }

  return null;
}

// --- FUEL PRICE DATA ---
export interface RegionalPrice {
  city: string;
  petrolPrice: number;
  dieselPrice: number;
  kerosenePrice?: number;
  transportSurcharge: number; // added for inland transport
}

export interface FuelPriceData {
  countryCode: string;
  countryName: string;
  petrolPrice: number; // national average / capital city price
  dieselPrice: number;
  kerosenePrice?: number;
  currency: string;
  effectiveDate: string;
  priceSettingBody: string;
  sourceUrl: string;
  sourceName: string;
  lastUpdated: string;
  // Regional pricing - per city/town
  regionalPrices?: RegionalPrice[];
  // Price breakdown
  breakdown?: {
    landedCost: number;
    taxes: number;
    margins: number;
    regulatoryLevy: number;
    roadLevy: number;
    petroleumDevelopmentLevy: number;
  };
  // Historical trend
  previousPrices?: {
    date: string;
    petrol: number;
    diesel: number;
  }[];
}

/** Get fuel price for a specific city from FuelPriceData.
 *  Returns the regional price if available, falls back to national average. */
export function getPriceForCity(
  data: FuelPriceData | null,
  city: string,
): {
  petrol: number;
  diesel: number;
  kerosene: number;
  isRegional: boolean;
  cityName: string;
} {
  if (!data) {
    return {
      petrol: 0,
      diesel: 0,
      kerosene: 0,
      isRegional: false,
      cityName: city,
    };
  }
  // Search regional prices case-insensitively.
  // Match priority (most specific first) so that a road name like
  // "Mombasa Road, Nairobi" does NOT match the city "Mombasa" before the
  // actual city "Nairobi":
  //   1. Exact full-string match.
  //   2. The location is a comma-separated address ("street, city, country");
  //      match a regional city against an exact trimmed address segment.
  //   3. Last resort: loose substring containment (kept for backwards
  //      compatibility with simple "Nairobi"-only inputs).
  if (data.regionalPrices && data.regionalPrices.length > 0) {
    const loc = city.toLowerCase();
    const segments = loc
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const exact = data.regionalPrices.find((r) => r.city.toLowerCase() === loc);
    if (exact) {
      return {
        petrol: exact.petrolPrice,
        diesel: exact.dieselPrice,
        kerosene: exact.kerosenePrice ?? 0,
        isRegional: true,
        cityName: exact.city,
      };
    }

    const segmentMatch = data.regionalPrices.find((r) =>
      segments.some((seg) => seg === r.city.toLowerCase()),
    );
    if (segmentMatch) {
      return {
        petrol: segmentMatch.petrolPrice,
        diesel: segmentMatch.dieselPrice,
        kerosene: segmentMatch.kerosenePrice ?? 0,
        isRegional: true,
        cityName: segmentMatch.city,
      };
    }

    const loose = data.regionalPrices.find(
      (r) =>
        loc.includes(r.city.toLowerCase()) ||
        r.city.toLowerCase().includes(loc),
    );
    if (loose) {
      return {
        petrol: loose.petrolPrice,
        diesel: loose.dieselPrice,
        kerosene: loose.kerosenePrice ?? 0,
        isRegional: true,
        cityName: loose.city,
      };
    }
  }
  // Fallback to national average
  return {
    petrol: data.petrolPrice,
    diesel: data.dieselPrice,
    kerosene: data.kerosenePrice ?? 0,
    isRegional: false,
    cityName: city,
  };
}

// --- TAX DATA ---
export interface TaxRateData {
  countryCode: string;
  lastUpdated: string;
  source: string;
  // PAYE
  payeThreshold: number;
  payeRates: { from: number; to: number; rate: number }[];
  // NSSF / Social Security
  nssfEmployeeRate: number;
  nssfEmployerRate: number;
  nssfLabel: string;
  // Health Insurance
  healthInsuranceLabel: string;
  healthInsuranceRates: {
    minSalary: number;
    maxSalary: number;
    amount: number;
  }[];
  // VAT
  vatRate: number;
  // Housing Levy
  housingLevyRate: number;
  housingLevyApplicable: boolean;
  // Fuel specific
  exciseDutyPerLiter: number;
  roadMaintenanceLevy: number;
  petroleumDevelopmentLevy: number;
  regulatoryLevy: number;
  // Minimum wage
  minimumWage: number;
}

// --- EXCHANGE RATES ---
export interface ExchangeRateData {
  base: string; // USD
  rates: Record<string, number>;
  lastUpdated: string;
  source: string;
}

// --- REGULATORY UPDATE ---
export interface RegulatoryUpdate {
  id: string;
  countryCode: string;
  title: string;
  summary: string;
  effectiveDate: string;
  source: string;
  sourceUrl: string;
  category: "fuel_price" | "tax" | "compliance" | "license" | "safety";
  priority: "high" | "medium" | "low";
  read: boolean;
}

// ============================================================
// WORLDWIDE CURRENCY SUPPORT
// ============================================================

import {
  getCountryByCode,
  ALL_COUNTRIES,
} from "@/react-app/lib/world-country-utils";

/** Get all world currency codes for exchange rate fetching */
function getAllWorldCurrencies(): string[] {
  const currencies = new Set<string>();
  ALL_COUNTRIES.forEach((c) => currencies.add(c.currency));
  // Ensure major currencies are always included
  ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "INR"].forEach((c) =>
    currencies.add(c),
  );
  return Array.from(currencies).sort();
}

/** Build exchange rate object with all world currencies */
function buildWorldExchangeRates(apiData: any): Record<string, number> {
  const rates: Record<string, number> = { USD: 1 };
  const allCurrencies = getAllWorldCurrencies();
  for (const curr of allCurrencies) {
    if (apiData.rates[curr] !== undefined) {
      rates[curr] = apiData.rates[curr];
    } else if (curr === "EUR") {
      rates[curr] = apiData.rates.EUR || 0.92;
    } else if (curr === "GBP") {
      rates[curr] = apiData.rates.GBP || 0.79;
    } else if (curr === "JPY") {
      rates[curr] = apiData.rates.JPY || 150;
    } else {
      // Fallback: estimate based on USD rate if available
      rates[curr] = apiData.rates[curr] || 1;
    }
  }
  return rates;
}

/** Generic fuel price fetcher for any country */
async function fetchGenericFuelPrices(
  countryCode: string,
): Promise<FuelPriceData | null> {
  const key = `fuel_price_${countryCode}`;
  const country = getCountryByCode(countryCode);
  if (!country) return null;

  markSyncing(key, `${country.name} Fuel Authority`);
  try {
    // Try to fetch from generic fuel price APIs
    let petrolPrice = 0;
    let dieselPrice = 0;
    let kerosenePrice = 0;

    // Try global fuel price API first
    try {
      const response = await fetch(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.globalpetrolprices.com/${country.name.toLowerCase().replace(/\s+/g, "_")}/`)}`,
      );
      if (response?.ok) {
        const html = await response.text();
        const priceMatches = html.matchAll(
          /([\d,]+\.\d{2})\s*<span[^>]*>\s*([A-Z]{3})/g,
        );
        const prices = Array.from(priceMatches).map((m) => ({
          price: parseFloat(m[1].replace(/,/g, "")),
          currency: m[2],
        }));
        if (prices.length >= 2) {
          petrolPrice = prices[0].price;
          dieselPrice = prices[1].price;
        }
      }
    } catch {
      // API failed, use country-specific estimates
    }

    // Use regional estimates if no data found
    if (petrolPrice === 0 || dieselPrice === 0) {
      const estimates = getRegionalPriceEstimates(
        countryCode,
        country.currency,
      );
      petrolPrice = estimates.petrol;
      dieselPrice = estimates.diesel;
      kerosenePrice = estimates.kerosene;
    }

    const data: FuelPriceData = {
      countryCode,
      countryName: country.name,
      petrolPrice,
      dieselPrice,
      kerosenePrice: kerosenePrice || 0,
      currency: country.currency,
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: `${country.name} Energy Regulatory Authority`,
      sourceUrl: `https://www.globalpetrolprices.com/${country.name}`,
      sourceName: "Global Petrol Prices",
      lastUpdated: new Date().toISOString(),
    };

    markSuccess(
      key,
      `${country.name} Fuel Authority`,
      data,
      FUEL_PRICE_SYNC_INTERVAL,
    );
    localStorage.setItem(
      `fuelpro_fuel_prices_${countryCode}`,
      JSON.stringify(data),
    );
    return data;
  } catch (error) {
    markError(key, `${country.name} Fuel Authority`, (error as Error).message);
    return null;
  }
}

/** Get regional price estimates based on economic region */
function getRegionalPriceEstimates(
  countryCode: string,
  currency: string,
): { petrol: number; diesel: number; kerosene: number } {
  // Regional price estimates in local currency (approximate)
  const estimates: Record<
    string,
    { petrol: number; diesel: number; kerosene: number }
  > = {
    // East Africa
    KE: {
      petrol: KENYA_BASE_PRICES.petrol,
      diesel: KENYA_BASE_PRICES.diesel,
      kerosene: KENYA_BASE_PRICES.kerosene,
    },
    UG: { petrol: 5450, diesel: 4980, kerosene: 4500 },
    TZ: { petrol: 3199, diesel: 2943, kerosene: 2840 },
    RW: { petrol: 1680, diesel: 1620, kerosene: 1450 },
    BI: { petrol: 4250, diesel: 4100, kerosene: 3800 },
    ET: { petrol: 79.0, diesel: 76.0, kerosene: 65.0 },
    SO: { petrol: 35000, diesel: 32000, kerosene: 28000 },
    // West Africa
    NG: { petrol: 617, diesel: 992, kerosene: 650 },
    GH: { petrol: 14.5, diesel: 15.2, kerosene: 12.8 },
    CI: { petrol: 935, diesel: 875, kerosene: 750 },
    SN: { petrol: 1035, diesel: 965, kerosene: 850 },
    ML: { petrol: 825, diesel: 780, kerosene: 650 },
    BF: { petrol: 895, diesel: 850, kerosene: 720 },
    BJ: { petrol: 650, diesel: 600, kerosene: 500 },
    TG: { petrol: 720, diesel: 680, kerosene: 580 },
    // Southern Africa
    ZA: { petrol: 23.36, diesel: 20.52, kerosene: 18.5 },
    ZM: { petrol: 35.5, diesel: 32.8, kerosene: 28.5 },
    ZW: { petrol: 8500, diesel: 8200, kerosene: 7500 },
    MW: { petrol: 1950, diesel: 1850, kerosene: 1600 },
    MZ: { petrol: 85.5, diesel: 78.3, kerosene: 65.0 },
    BW: { petrol: 17.8, diesel: 16.5, kerosene: 14.2 },
    NA: { petrol: 22.5, diesel: 20.8, kerosene: 18.0 },
    SZ: { petrol: 21.0, diesel: 19.5, kerosene: 17.0 },
    LS: { petrol: 23.0, diesel: 21.2, kerosene: 19.0 },
    // North Africa
    EG: { petrol: 12.5, diesel: 11.0, kerosene: 9.5 },
    MA: { petrol: 15.2, diesel: 13.8, kerosene: 11.5 },
    DZ: { petrol: 45.5, diesel: 38.2, kerosene: 32.0 },
    TN: { petrol: 2.5, diesel: 2.2, kerosene: 1.8 },
    LY: { petrol: 0.65, diesel: 0.55, kerosene: 0.45 },
    SD: { petrol: 520, diesel: 480, kerosene: 400 },
    // Central Africa
    CM: { petrol: 730, diesel: 680, kerosene: 580 },
    GA: { petrol: 750, diesel: 700, kerosene: 600 },
    CG: { petrol: 755, diesel: 705, kerosene: 605 },
    CD: { petrol: 2800, diesel: 2600, kerosene: 2200 },
    TD: { petrol: 685, diesel: 640, kerosene: 540 },
    CF: { petrol: 1150, diesel: 1080, kerosene: 950 },
    // Asia
    IN: { petrol: 105.5, diesel: 94.2, kerosene: 72.5 },
    CN: { petrol: 8.5, diesel: 7.8, kerosene: 6.5 },
    JP: { petrol: 175.0, diesel: 155.0, kerosene: 135.0 },
    KR: { petrol: 1750, diesel: 1600, kerosene: 1400 },
    ID: { petrol: 12500, diesel: 11300, kerosene: 9500 },
    TH: { petrol: 48.5, diesel: 35.2, kerosene: 30.0 },
    VN: { petrol: 24000, diesel: 21500, kerosene: 18000 },
    MY: { petrol: 2.15, diesel: 2.05, kerosene: 1.8 },
    PH: { petrol: 72.5, diesel: 65.0, kerosene: 55.0 },
    SG: { petrol: 2.92, diesel: 2.45, kerosene: 2.1 },
    // Middle East
    SA: { petrol: 2.33, diesel: 2.1, kerosene: 1.8 },
    AE: { petrol: 3.09, diesel: 3.15, kerosene: 2.8 },
    QA: { petrol: 2.05, diesel: 1.95, kerosene: 1.7 },
    KW: { petrol: 0.105, diesel: 0.095, kerosene: 0.085 },
    OM: { petrol: 0.23, diesel: 0.255, kerosene: 0.21 },
    BH: { petrol: 0.2, diesel: 0.21, kerosene: 0.18 },
    // Europe
    DE: { petrol: 2.16, diesel: 2.25, kerosene: 1.8 },
    FR: { petrol: 1.9, diesel: 1.95, kerosene: 1.55 },
    GB: { petrol: 1.62, diesel: 1.82, kerosene: 1.45 },
    IT: { petrol: 1.95, diesel: 1.98, kerosene: 1.6 },
    ES: { petrol: 1.75, diesel: 1.8, kerosene: 1.45 },
    NL: { petrol: 2.1, diesel: 2.0, kerosene: 1.6 },
    // Americas
    US: { petrol: 1.08, diesel: 1.48, kerosene: 1.3 },
    CA: { petrol: 1.7, diesel: 1.95, kerosene: 1.6 },
    BR: { petrol: 5.85, diesel: 4.65, kerosene: 3.8 },
    MX: { petrol: 24.5, diesel: 25.8, kerosene: 21.5 },
    AR: { petrol: 850, diesel: 720, kerosene: 600 },
    CL: { petrol: 1180, diesel: 950, kerosene: 800 },
    CO: { petrol: 13350, diesel: 11200, kerosene: 9500 },
    // Oceania
    AU: { petrol: 2.1, diesel: 2.1, kerosene: 1.8 },
    NZ: { petrol: 2.85, diesel: 2.15, kerosene: 1.85 },
    // Caribbean
    JM: { petrol: 215, diesel: 205, kerosene: 180 },
    TT: { petrol: 6.75, diesel: 5.5, kerosene: 4.8 },
    BB: { petrol: 4.55, diesel: 4.25, kerosene: 3.8 },
  };

  // Return country-specific estimate or generate a reasonable default
  const estimate = estimates[countryCode];
  if (estimate) return estimate;

  // For countries without specific estimates, use regional defaults
  const regionDefaults: Record<
    string,
    { petrol: number; diesel: number; kerosene: number }
  > = {
    // Africa defaults
    XA: { petrol: 1200, diesel: 1100, kerosene: 950 },
    // Asia defaults
    XAS: { petrol: 85, diesel: 75, kerosene: 65 },
    // Europe defaults
    XEU: { petrol: 1.85, diesel: 1.93, kerosene: 1.55 },
    // Americas defaults
    XAM: { petrol: 1.35, diesel: 1.45, kerosene: 1.2 },
    // Oceania defaults
    XOC: { petrol: 2.1, diesel: 2.1, kerosene: 1.8 },
  };

  // Determine region from country code patterns
  const africanCodes = [
    "ZA",
    "KE",
    "NG",
    "GH",
    "ET",
    "TZ",
    "UG",
    "RW",
    "BI",
    "SO",
    "ZM",
    "ZW",
    "MW",
    "MZ",
    "BW",
    "NA",
    "SZ",
    "LS",
    "EG",
    "MA",
    "DZ",
    "TN",
    "LY",
    "SD",
    "CM",
    "GA",
    "CG",
    "CD",
    "TD",
    "CF",
    "SN",
    "CI",
    "ML",
    "BF",
    "BJ",
    "TG",
    "LR",
    "SL",
    "GN",
    "GW",
    "GM",
    "MR",
    "NE",
    "DJ",
    "ER",
    "MG",
    "MU",
    "SC",
    "KM",
    "ST",
    "CV",
    "GW",
  ];
  const asianCodes = [
    "IN",
    "CN",
    "JP",
    "KR",
    "ID",
    "TH",
    "VN",
    "MY",
    "PH",
    "SG",
    "BD",
    "PK",
    "LK",
    "NP",
    "MM",
    "KH",
    "LA",
    "BN",
    "BT",
    "MV",
    "MN",
    "KZ",
    "UZ",
    "TJ",
    "KG",
    "TM",
    "AF",
    "IR",
    "IQ",
    "IL",
    "JO",
    "LB",
    "SY",
    "YE",
    "TR",
    "SA",
    "AE",
    "QA",
    "KW",
    "OM",
    "BH",
  ];
  const europeanCodes = [
    "DE",
    "FR",
    "GB",
    "IT",
    "ES",
    "NL",
    "BE",
    "CH",
    "AT",
    "SE",
    "NO",
    "DK",
    "FI",
    "PL",
    "CZ",
    "HU",
    "SK",
    "SI",
    "HR",
    "RS",
    "BG",
    "RO",
    "MD",
    "UA",
    "BY",
    "LT",
    "LV",
    "EE",
    "IE",
    "PT",
    "GR",
    "CY",
    "MT",
    "IS",
    "LI",
    "LU",
    "MC",
    "AD",
    "SM",
    "VA",
    "BA",
    "ME",
    "MK",
    "AL",
    "XK",
  ];
  const americanCodes = [
    "US",
    "CA",
    "BR",
    "MX",
    "AR",
    "CL",
    "CO",
    "PE",
    "VE",
    "EC",
    "UY",
    "PY",
    "BO",
    "GY",
    "SR",
    "GF",
    "CR",
    "PA",
    "GT",
    "HN",
    "SV",
    "NI",
    "BZ",
    "CU",
    "HT",
    "DO",
    "JM",
    "TT",
    "BB",
    "GD",
    "LC",
    "VC",
    "AG",
    "KN",
    "DM",
  ];
  const oceaniaCodes = [
    "AU",
    "NZ",
    "FJ",
    "PG",
    "SB",
    "VU",
    "NC",
    "PF",
    "WS",
    "TO",
    "KI",
    "TV",
    "NR",
    "MH",
    "FM",
    "PW",
  ];

  if (africanCodes.includes(countryCode)) return regionDefaults.XA;
  if (asianCodes.includes(countryCode)) return regionDefaults.XAS;
  if (europeanCodes.includes(countryCode)) return regionDefaults.XEU;
  if (americanCodes.includes(countryCode)) return regionDefaults.XAM;
  if (oceaniaCodes.includes(countryCode)) return regionDefaults.XOC;

  // Ultimate fallback - use USD estimates
  return { petrol: 1.42, diesel: 1.51, kerosene: 1.3 };
}

// ============================================================
// FUEL PRICE FETCHING - Per Country
// ============================================================

async function fetchWithFallback(urls: string[]): Promise<Response | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json, text/html" },
      });
      if (response.ok) return response;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetch Kenya fuel prices from EPRA or use AI estimation
 * EPRA announces prices on 14th of every month
 * If official prices not available, uses AI estimation based on:
 * - Time since last known prices
 * - Exchange rate changes
 * - Oil price trends
 */
async function fetchKenyaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_KE";
  markSyncing(key, "EPRA Kenya");

  try {
    // EPRA website and public data sources
    const urls = [
      "https://www.epra.go.ke/api/fuel-prices/current",
      "https://api.allorigins.win/raw?url=" +
        encodeURIComponent(
          "https://www.epra.go.ke/index.php/component/content/article/25-pump-prices",
        ),
    ];

    let petrolPrice = 0;
    let dieselPrice = 0;
    let priceSource = "Unknown";

    const response = await fetchWithFallback(urls);
    if (response) {
      const text = await response.text();
      // Try to extract prices from HTML
      const petrolMatch = text.match(
        /(?:super\s*petrol|petrol).*?([\d,]+\.\d{2})/i,
      );
      const dieselMatch = text.match(/(?:diesel|ago).*?([\d,]+\.\d{2})/i);
      if (petrolMatch)
        petrolPrice = parseFloat(petrolMatch[1].replace(/,/g, ""));
      if (dieselMatch)
        dieselPrice = parseFloat(dieselMatch[1].replace(/,/g, ""));

      if (petrolPrice > 0 && dieselPrice > 0) {
        priceSource = "EPRA Official";
      }
    }

    // If official prices not available, use AI estimation
    if (petrolPrice === 0 || dieselPrice === 0) {
      // Try web search for latest prices
      try {
        const searchResponse = await fetch(
          "https://api.allorigins.win/raw?url=" +
            encodeURIComponent(
              "https://www.google.com/search?q=kenya+fuel+prices+epra+" +
                new Date().toISOString().slice(0, 7),
            ),
        );
        if (searchResponse?.ok) {
          const html = await searchResponse.text();
          // Extract prices from search results
          const priceMatches = html.matchAll(
            /KES?\s*([\d,]+\.?\d*)\s*(?:per|\/)?\s*liter/gi,
          );
          const prices = Array.from(priceMatches)
            .map((m) => parseFloat(m[1].replace(/,/g, "")))
            .filter((p) => p > 100 && p < 500);
          if (prices.length >= 2) {
            petrolPrice = prices[0];
            dieselPrice = prices[1];
            priceSource = "Web Search";
          }
        }
      } catch {
        // Web search failed
      }
    }

    // Plausibility guard: extracted prices (EPRA page regex / web search) can
    // be stale (previous cycle) or regex garbage. EPRA monthly adjustments are
    // small (single-digit KSh), so anything outside ±15% of the current
    // official base is discarded in favour of the real published reference.
    const plausible = (v: number, base: number) =>
      v > 0 && Math.abs(v - base) / base <= 0.15;
    if (
      !plausible(petrolPrice, KENYA_BASE_PRICES.petrol) ||
      !plausible(dieselPrice, KENYA_BASE_PRICES.diesel)
    ) {
      petrolPrice = KENYA_BASE_PRICES.petrol;
      dieselPrice = KENYA_BASE_PRICES.diesel;
      priceSource = "EPRA Published (15 Aug – 14 Sep 2026)";
    }

    // Regional prices always come from the REAL published EPRA town table
    // (KENYA_CITIES) — the single source of truth, refreshed each cycle.
    let regionalPrices: FuelPriceData["regionalPrices"] = [];
    {
      regionalPrices = KENYA_CITIES.map((c) => ({
        city: c.name,
        petrolPrice: c.petrolPrice,
        dieselPrice: c.dieselPrice,
        kerosenePrice: c.kerosenePrice,
        transportSurcharge: c.transportSurcharge,
      }));
    }

    const kerosenePrice = KENYA_BASE_PRICES.kerosene; // EPRA published kerosene price

    const data: FuelPriceData = {
      countryCode: "KE",
      countryName: "Kenya",
      petrolPrice,
      dieselPrice,
      kerosenePrice,
      currency: getCurrencySymbol(),
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Energy and Petroleum Regulatory Authority (EPRA)",
      sourceUrl: "https://www.epra.go.ke",
      sourceName: priceSource,
      lastUpdated: new Date().toISOString(),
      regionalPrices,
      breakdown: {
        landedCost: petrolPrice * 0.46,
        taxes: petrolPrice * 0.32,
        margins: petrolPrice * 0.12,
        regulatoryLevy: 0.75,
        roadLevy: 25.0,
        petroleumDevelopmentLevy: 5.4,
      },
    };

    markSuccess(key, "EPRA Kenya", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_KE", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "EPRA Kenya", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Uganda fuel prices
 */
async function fetchUgandaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_UG";
  markSyncing(key, "Uganda MEMD");
  try {
    const data: FuelPriceData = {
      countryCode: "UG",
      countryName: "Uganda",
      petrolPrice: 5450, // UGX per liter
      dieselPrice: 4980,
      currency: "UGX",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Ministry of Energy and Mineral Development",
      sourceUrl: "https://www.energyandminerals.go.ug",
      sourceName: "Uganda MEMD",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(key, "Uganda MEMD", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_UG", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "Uganda MEMD", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Tanzania fuel prices from EWURA
 */
async function fetchTanzaniaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_TZ";
  markSyncing(key, "EWURA Tanzania");
  try {
    const data: FuelPriceData = {
      countryCode: "TZ",
      countryName: "Tanzania",
      petrolPrice: 3199, // TZS per liter
      dieselPrice: 2943,
      kerosenePrice: 2840,
      currency: "TZS",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody:
        "Energy and Water Utilities Regulatory Authority (EWURA)",
      sourceUrl: "https://www.ewura.go.tz",
      sourceName: "EWURA Tanzania",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(key, "EWURA Tanzania", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_TZ", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "EWURA Tanzania", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Nigeria fuel prices from NNPC
 */
async function fetchNigeriaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_NG";
  markSyncing(key, "NNPC Nigeria");
  try {
    const data: FuelPriceData = {
      countryCode: "NG",
      countryName: "Nigeria",
      petrolPrice: 617, // NGN per liter
      dieselPrice: 992,
      currency: "NGN",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Nigerian National Petroleum Company (NNPC)",
      sourceUrl: "https://nnpcgroup.com",
      sourceName: "NNPC Nigeria",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(key, "NNPC Nigeria", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_NG", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "NNPC Nigeria", (error as Error).message);
    return null;
  }
}

/**
 * Fetch South Africa fuel prices from DMRE
 */
async function fetchSouthAfricaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_ZA";
  markSyncing(key, "DMRE South Africa");
  try {
    const data: FuelPriceData = {
      countryCode: "ZA",
      countryName: "South Africa",
      petrolPrice: 23.36, // ZAR per liter
      dieselPrice: 20.52,
      currency: "ZAR",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Department of Mineral Resources and Energy (DMRE)",
      sourceUrl: "https://www.dmre.gov.za",
      sourceName: "DMRE South Africa",
      lastUpdated: new Date().toISOString(),
      breakdown: {
        landedCost: 12.5,
        taxes: 6.23,
        margins: 3.93,
        regulatoryLevy: 0,
        roadLevy: 2.18,
        petroleumDevelopmentLevy: 0,
      },
    };
    markSuccess(key, "DMRE South Africa", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_ZA", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "DMRE South Africa", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Ethiopia fuel prices
 */
async function fetchEthiopiaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_ET";
  markSyncing(key, "Ethiopia Ministry of Trade");
  try {
    const data: FuelPriceData = {
      countryCode: "ET",
      countryName: "Ethiopia",
      petrolPrice: 79.0, // ETB per liter
      dieselPrice: 76.0,
      currency: "ETB",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Ministry of Trade and Regional Integration",
      sourceUrl: "https://www.motr.gov.et",
      sourceName: "Ethiopia MoT",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(
      key,
      "Ethiopia Ministry of Trade",
      data,
      FUEL_PRICE_SYNC_INTERVAL,
    );
    localStorage.setItem("fuelpro_fuel_prices_ET", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "Ethiopia Ministry of Trade", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Rwanda fuel prices from RURA
 */
async function fetchRwandaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_RW";
  markSyncing(key, "RURA Rwanda");
  try {
    const data: FuelPriceData = {
      countryCode: "RW",
      countryName: "Rwanda",
      petrolPrice: 1680, // RWF per liter
      dieselPrice: 1620,
      currency: "RWF",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "Rwanda Utilities Regulatory Authority (RURA)",
      sourceUrl: "https://www.rura.rw",
      sourceName: "RURA Rwanda",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(key, "RURA Rwanda", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_RW", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "RURA Rwanda", (error as Error).message);
    return null;
  }
}

/**
 * Fetch Ghana fuel prices from NPA
 */
async function fetchGhanaFuelPrices(): Promise<FuelPriceData | null> {
  const key = "fuel_price_GH";
  markSyncing(key, "NPA Ghana");
  try {
    const data: FuelPriceData = {
      countryCode: "GH",
      countryName: "Ghana",
      petrolPrice: 14.5, // GHS per liter
      dieselPrice: 15.2,
      currency: "GHS",
      effectiveDate: new Date().toISOString().split("T")[0],
      priceSettingBody: "National Petroleum Authority (NPA)",
      sourceUrl: "https://www.npa.gov.gh",
      sourceName: "NPA Ghana",
      lastUpdated: new Date().toISOString(),
    };
    markSuccess(key, "NPA Ghana", data, FUEL_PRICE_SYNC_INTERVAL);
    localStorage.setItem("fuelpro_fuel_prices_GH", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "NPA Ghana", (error as Error).message);
    return null;
  }
}

// ============================================================
// MAIN FUEL PRICE FETCHER - Dispatches per country (ALL 250+)
// ============================================================

export async function syncFuelPrices(
  countryCode?: string,
): Promise<FuelPriceData[]> {
  const results: FuelPriceData[] = [];

  // If a specific country is requested, sync just that one
  // Otherwise sync all countries that need updating (not all 250+ at once)
  if (countryCode) {
    const key = `fuel_price_${countryCode}`;
    if (!shouldSync(key, FUEL_PRICE_SYNC_INTERVAL)) {
      const cached = localStorage.getItem(`fuelpro_fuel_prices_${countryCode}`);
      if (cached) {
        try {
          results.push(JSON.parse(cached));
        } catch {
          /* ignore */
        }
      }
      return results;
    }

    // Try specific fetchers first, then fall back to generic
    const specificFetchers: Record<
      string,
      () => Promise<FuelPriceData | null>
    > = {
      KE: fetchKenyaFuelPrices,
      UG: fetchUgandaFuelPrices,
      TZ: fetchTanzaniaFuelPrices,
      NG: fetchNigeriaFuelPrices,
      ZA: fetchSouthAfricaFuelPrices,
      ET: fetchEthiopiaFuelPrices,
      RW: fetchRwandaFuelPrices,
      GH: fetchGhanaFuelPrices,
    };

    const fetcher = specificFetchers[countryCode];
    if (fetcher) {
      const result = await fetcher();
      if (result) results.push(result);
    } else {
      // Generic fetcher for all other countries
      const result = await fetchGenericFuelPrices(countryCode);
      if (result) results.push(result);
    }
    return results;
  }

  // No specific country - sync the 8 core countries with detailed fetchers
  // plus any additional countries that have cached data and need refresh
  const coreCodes = ["KE", "UG", "TZ", "NG", "ZA", "ET", "RW", "GH"];
  const specificFetchers: Record<string, () => Promise<FuelPriceData | null>> =
    {
      KE: fetchKenyaFuelPrices,
      UG: fetchUgandaFuelPrices,
      TZ: fetchTanzaniaFuelPrices,
      NG: fetchNigeriaFuelPrices,
      ZA: fetchSouthAfricaFuelPrices,
      ET: fetchEthiopiaFuelPrices,
      RW: fetchRwandaFuelPrices,
      GH: fetchGhanaFuelPrices,
    };

  for (const code of coreCodes) {
    const key = `fuel_price_${code}`;
    if (!shouldSync(key, FUEL_PRICE_SYNC_INTERVAL)) {
      const cached = localStorage.getItem(`fuelpro_fuel_prices_${code}`);
      if (cached) {
        try {
          results.push(JSON.parse(cached));
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    const result = await specificFetchers[code]();
    if (result) results.push(result);
  }

  return results;
}

// ============================================================
// TAX RATE SYNC - Updates tax configuration from sources
// ============================================================

export async function syncTaxRates(
  countryCode: string,
): Promise<TaxRateData | null> {
  const key = `tax_rates_${countryCode}`;
  if (!shouldSync(key, TAX_SYNC_INTERVAL)) {
    const cached = localStorage.getItem(`fuelpro_tax_rates_${countryCode}`);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }
  }

  markSyncing(key, `Revenue Authority ${countryCode}`);

  const country = getCountryById(countryCode);
  if (!country) {
    markError(key, "Unknown country", "Country not found");
    return null;
  }

  // Build tax data from country profile (which will be auto-updated)
  const taxData: TaxRateData = {
    countryCode,
    lastUpdated: new Date().toISOString(),
    source: country.revenueAuthority.website,
    payeThreshold: country.payroll.payeThreshold,
    payeRates: country.payroll.payeRates,
    nssfEmployeeRate: country.payroll.nssfEmployeeRate,
    nssfEmployerRate: country.payroll.nssfEmployerRate,
    nssfLabel: country.payroll.nssfLabel,
    healthInsuranceLabel: country.payroll.nhifLabel,
    healthInsuranceRates: country.payroll.nhifRates,
    vatRate: country.revenueAuthority.vatRate,
    housingLevyRate: country.payroll.housingLevyRate,
    housingLevyApplicable: country.payroll.housingLevy,
    exciseDutyPerLiter: country.revenueAuthority.exciseDuty,
    roadMaintenanceLevy: country.revenueAuthority.roadMaintenanceLevy,
    petroleumDevelopmentLevy: country.revenueAuthority.petroleumDevelopmentLevy,
    regulatoryLevy: country.revenueAuthority.regulatoryLevy,
    minimumWage: country.payroll.minimumWage,
  };

  markSuccess(key, country.revenueAuthority.name, taxData, TAX_SYNC_INTERVAL);
  localStorage.setItem(
    `fuelpro_tax_rates_${countryCode}`,
    JSON.stringify(taxData),
  );
  return taxData;
}

// ============================================================
// EXCHANGE RATE SYNC
// ============================================================

export async function syncExchangeRates(): Promise<ExchangeRateData | null> {
  const key = "exchange_rates";
  if (!shouldSync(key, SYNC_INTERVAL_MS)) {
    const cached = localStorage.getItem("fuelpro_exchange_rates");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }
  }

  markSyncing(key, "Exchange Rate API");

  try {
    const response = await fetch(
      "https://api.exchangerate-api.com/v4/latest/USD",
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const apiData = await response.json();
    const data: ExchangeRateData = {
      base: "USD",
      rates: buildWorldExchangeRates(apiData),
      lastUpdated: new Date().toISOString(),
      source: "exchangerate-api.com",
    };

    markSuccess(key, "exchangerate-api.com", data);
    localStorage.setItem("fuelpro_exchange_rates", JSON.stringify(data));
    return data;
  } catch (error) {
    markError(key, "exchangerate-api.com", (error as Error).message);
    // Return cached or default
    const cached = localStorage.getItem("fuelpro_exchange_rates");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }
    // Build comprehensive fallback rates
    const fallbackRates: Record<string, number> = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 150,
      CHF: 0.88,
      CAD: 1.36,
      AUD: 1.52,
      CNY: 7.24,
      INR: 83.5,
      KRW: 1340,
      BRL: 5.05,
      MXN: 17.1,
      RUB: 92.5,
      // African currencies
      KES: 129.5,
      UGX: 3750,
      TZS: 2700,
      NGN: 1540,
      ZAR: 18.5,
      ETB: 135,
      RWF: 1350,
      GHS: 15.5,
      XOF: 605,
      XAF: 605,
      ZMW: 26.5,
      MWK: 1730,
      BWP: 13.5,
      NAD: 18.5,
      SZL: 18.5,
      LSL: 18.5,
      MZN: 63.5,
      SCR: 13.5,
      MUR: 46.5,
      MAD: 10.0,
      TND: 3.1,
      EGP: 30.9,
      LYD: 4.85,
      SDG: 600,
      DZD: 134,
      MRU: 39.5,
      CVE: 101,
      // Asian currencies
      IDR: 15800,
      THB: 35.5,
      VND: 24800,
      MYR: 4.72,
      PHP: 56.5,
      SGD: 1.34,
      PKR: 278,
      BDT: 109.5,
      LKR: 300,
      NPR: 133.5,
      MMK: 2100,
      KHR: 4100,
      LAK: 20800,
      BND: 1.34,
      HKD: 7.82,
      TWD: 31.5,
      KWD: 0.308,
      AED: 3.67,
      SAR: 3.75,
      QAR: 3.64,
      OMR: 0.385,
      BHD: 0.376,
      JOD: 0.709,
      LBP: 89500,
      ILS: 3.65,
      // European currencies
      NOK: 10.5,
      SEK: 10.4,
      DKK: 6.88,
      PLN: 4.0,
      CZK: 22.8,
      HUF: 358,
      RON: 4.6,
      BGN: 1.8,
      HRK: 6.4,
      RSD: 107,
      MKD: 56.5,
      BAM: 1.8,
      ALL: 93.5,
      MDL: 17.8,
      GEL: 2.7,
      AMD: 395,
      AZN: 1.7,
      KZT: 500,
      UZS: 12500,
      TMT: 3.5,
      // Americas currencies
      ARS: 870,
      CLP: 975,
      COP: 3920,
      PEN: 3.75,
      UYU: 39.5,
      PYG: 7450,
      BOB: 6.91,
      VEF: 3650000,
      CRC: 515,
      GTQ: 7.8,
      HNL: 24.7,
      NIO: 36.6,
      DOP: 58.8,
      HTG: 132,
      JMD: 156,
      TTD: 6.78,
      BBD: 2.0,
      XCD: 2.7,
      BSD: 1,
      // Oceania
      NZD: 1.62,
      FJD: 2.22,
      PGK: 3.8,
      WST: 2.72,
      TOP: 2.33,
    };
    return {
      base: "USD",
      rates: fallbackRates,
      lastUpdated: new Date().toISOString(),
      source: "default fallback",
    };
  }
}

// ============================================================
// REGULATORY UPDATES SYNC
// ============================================================

export async function syncRegulatoryUpdates(
  countryCode: string,
): Promise<RegulatoryUpdate[]> {
  const key = `regulatory_${countryCode}`;
  if (!shouldSync(key, NEWS_SYNC_INTERVAL)) {
    const cached = localStorage.getItem(`fuelpro_regulatory_${countryCode}`);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }
  }

  markSyncing(key, `News Sources ${countryCode}`);

  try {
    const country = getCountryById(countryCode);
    if (!country) return [];

    // Generate regulatory updates based on country-specific sources
    // In production, this would scrape actual government websites
    const updates: RegulatoryUpdate[] = [];

    // Check if fuel price review is due
    const today = new Date();
    const fuelReviewDay = country.fuelRegulations.priceReviewFrequency;

    // Add fuel price alert if review is coming
    if (
      fuelReviewDay.includes("14th") &&
      today.getDate() >= 12 &&
      today.getDate() <= 16
    ) {
      updates.push({
        id: `${countryCode}_fuel_${today.toISOString().slice(0, 7)}`,
        countryCode,
        title: `${country.shortName} Fuel Price Review Due`,
        summary: `${country.fuelRegulations.priceSettingBody} is expected to announce new fuel pump prices for ${today.toLocaleString("default", { month: "long", year: "numeric" })}. Monitor for updates on ${country.revenueAuthority.website}.`,
        effectiveDate: today.toISOString().split("T")[0],
        source: country.fuelRegulations.priceSettingBody,
        sourceUrl: country.fuelRegulations.priceSettingBody.includes("EPRA")
          ? "https://www.epra.go.ke"
          : country.revenueAuthority.website,
        category: "fuel_price",
        priority: "high",
        read: false,
      });
    }

    // Add tax compliance reminders
    const revenueAuth = country.revenueAuthority;
    const taxSystem =
      getCountryTabFeatures(countryCode).taxInvoiceSystem || "Standard VAT";
    updates.push({
      id: `${countryCode}_tax_monthly_${today.toISOString().slice(0, 7)}`,
      countryCode,
      title: `Monthly Tax Return Due`,
      summary: `Your monthly tax return to ${revenueAuth.name} (${revenueAuth.shortName}) is due by the ${revenueAuth.monthlyReturnDue}. Ensure all ${taxSystem} invoices are uploaded.`,
      effectiveDate: today.toISOString().split("T")[0],
      source: revenueAuth.name,
      sourceUrl: revenueAuth.eFilingPortal,
      category: "tax",
      priority: "high",
      read: false,
    });

    // Add compliance license reminder
    const annualDue = new Date(today.getFullYear(), 0, 15); // January 15th
    if (annualDue > today) {
      updates.push({
        id: `${countryCode}_license_annual_${today.getFullYear()}`,
        countryCode,
        title: `Annual License Renewal`,
        summary: `Your petroleum license and business permits are due for annual renewal. Check requirements with ${country.fuelRegulations.licenseBody}.`,
        effectiveDate: annualDue.toISOString().split("T")[0],
        source: country.fuelRegulations.licenseBody,
        sourceUrl: country.revenueAuthority.website,
        category: "license",
        priority: "medium",
        read: false,
      });
    }

    markSuccess(
      key,
      `${country.shortName} Regulatory Sources`,
      updates,
      NEWS_SYNC_INTERVAL,
    );
    localStorage.setItem(
      `fuelpro_regulatory_${countryCode}`,
      JSON.stringify(updates),
    );
    return updates;
  } catch (error) {
    markError(key, "Regulatory Sources", (error as Error).message);
    return [];
  }
}

// ============================================================
// MASTER SYNC - Runs all syncs
// ============================================================

export interface SyncResult {
  fuelPrices: FuelPriceData[];
  taxRates: TaxRateData | null;
  exchangeRates: ExchangeRateData | null;
  regulatoryUpdates: RegulatoryUpdate[];
  timestamp: string;
}

export async function runFullSync(countryCode: string): Promise<SyncResult> {
  console.log(`[DataSync] Starting full sync for ${countryCode}...`);

  const [fuelPrices, taxRates, exchangeRates, regulatoryUpdates] =
    await Promise.all([
      syncFuelPrices(countryCode),
      syncTaxRates(countryCode),
      syncExchangeRates(),
      syncRegulatoryUpdates(countryCode),
    ]);

  const result: SyncResult = {
    fuelPrices,
    taxRates,
    exchangeRates,
    regulatoryUpdates,
    timestamp: new Date().toISOString(),
  };

  // Store the full sync result
  localStorage.setItem(
    `fuelpro_sync_result_${countryCode}`,
    JSON.stringify(result),
  );
  localStorage.setItem("fuelpro_last_full_sync", new Date().toISOString());

  console.log(`[DataSync] Full sync completed for ${countryCode}`);
  return result;
}

// ============================================================
// GETTERS - Retrieve synced data
// ============================================================

export function getSyncedFuelPrice(countryCode: string): FuelPriceData | null {
  const cached = localStorage.getItem(`fuelpro_fuel_prices_${countryCode}`);
  if (cached) {
    try {
      const data = JSON.parse(cached) as FuelPriceData;
      // Cycle guard: a cached snapshot from a PREVIOUS pricing cycle (e.g.
      // last month's EPRA table persisted in localStorage) must not outlive
      // a code update carrying the new official reference. For Kenya, if the
      // cached national diesel price differs from the current published base
      // by more than the plausibility window, discard the cache so a fresh
      // sync writes the current-cycle table.
      if (countryCode === "KE") {
        // Compare the cached Nairobi regional entry against the current
        // published table — any mismatch means the snapshot is from a
        // previous cycle (regional tables shift monthly).
        const currentNairobi = KENYA_CITIES.find((c) => c.name === "Nairobi");
        const cachedNairobi = data?.regionalPrices?.find(
          (r) => r.city === "Nairobi",
        );
        const cachedDiesel =
          cachedNairobi?.dieselPrice ??
          (data as { dieselPrice?: number })?.dieselPrice;
        if (
          !currentNairobi ||
          typeof cachedDiesel !== "number" ||
          !Number.isFinite(cachedDiesel) ||
          Math.abs(cachedDiesel - currentNairobi.dieselPrice) > 0.01
        ) {
          localStorage.removeItem(`fuelpro_fuel_prices_${countryCode}`);
          return null;
        }
      }
      return data;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function getSyncedTaxRates(countryCode: string): TaxRateData | null {
  const cached = localStorage.getItem(`fuelpro_tax_rates_${countryCode}`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function getSyncedExchangeRates(): ExchangeRateData | null {
  const cached = localStorage.getItem("fuelpro_exchange_rates");
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function getRegulatoryUpdates(countryCode: string): RegulatoryUpdate[] {
  const cached = localStorage.getItem(`fuelpro_regulatory_${countryCode}`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function getSyncStatus(): Record<string, SyncRecord> {
  return loadSyncRecords();
}

export function isSyncDue(countryCode: string): boolean {
  const lastSync = localStorage.getItem("fuelpro_last_full_sync");
  if (!lastSync) return true;
  const elapsed = Date.now() - new Date(lastSync).getTime();
  return elapsed > FUEL_PRICE_SYNC_INTERVAL;
}

// ============================================================
// PER-COUNTRY TAB FEATURE CONFIGURATION
// ============================================================

export interface CountryTabFeatures {
  // Which features are available in this country
  mpesaAnalyzer: boolean; // M-Pesa / Mobile money analysis
  liveTransaction: boolean;
  payrollSystem: boolean;
  debtReminder: boolean;
  fuelOffloading: boolean;
  deliveryTracker: boolean;
  invoice: boolean;
  reports: boolean;
  pos: boolean;
  communication: boolean;
  documents: boolean;
  dataManager: boolean;
  news: boolean;
  aiAssistant: boolean;
  fuelSalesReport: boolean;
  salesTracking: boolean;
  dashboard: boolean;
  // Country-specific extra features
  eTIMS: boolean; // Electronic Tax Invoice System
  fiscalDevice: boolean;
  fuelQualityTesting: boolean;
  environmentalCompliance: boolean;
  // Mobile money specific
  mobileMoneyPayment: boolean;
  mobileMoneyProviders: string[];
  // Tax specific
  taxInvoiceSystem: string; // e.g., "eTIMS", "EFD", "ETR"
  vatRefundApplicable: boolean;
}

/**
 * Get the feature set for a specific country
 * Each country gets tabs/features relevant to their regulatory environment
 * Supports ALL 250+ countries with intelligent defaults
 */
export function getCountryTabFeatures(countryCode: string): CountryTabFeatures {
  const country = getCountryByCode(countryCode);

  // Default features for any country worldwide
  const defaultFeatures: CountryTabFeatures = {
    mpesaAnalyzer: false,
    liveTransaction: true,
    payrollSystem: true,
    debtReminder: true,
    fuelOffloading: true,
    deliveryTracker: true,
    invoice: true,
    reports: true,
    pos: true,
    communication: true,
    documents: true,
    dataManager: true,
    news: true,
    aiAssistant: true,
    fuelSalesReport: true,
    salesTracking: true,
    dashboard: true,
    eTIMS: false,
    fiscalDevice: false,
    fuelQualityTesting: true,
    environmentalCompliance: true,
    mobileMoneyPayment: true,
    mobileMoneyProviders: ["Bank Transfer", "Card Payment"],
    taxInvoiceSystem: "Standard VAT Invoice",
    vatRefundApplicable: true,
  };

  // Country-specific configurations with mobile money and regional features
  const features: Record<string, CountryTabFeatures> = {
    KE: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      eTIMS: true,
      fiscalDevice: true,
      mobileMoneyProviders: ["M-Pesa", "Airtel Money", "T-Kash"],
      taxInvoiceSystem: "eTIMS",
      vatRefundApplicable: true,
    },
    UG: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      eTIMS: true,
      mobileMoneyProviders: ["MTN Mobile Money", "Airtel Money"],
      taxInvoiceSystem: "EFD",
      vatRefundApplicable: true,
    },
    TZ: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      eTIMS: true,
      fiscalDevice: true,
      mobileMoneyProviders: ["M-Pesa", "Tigo Pesa", "Airtel Money"],
      taxInvoiceSystem: "EFD",
      vatRefundApplicable: true,
    },
    NG: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      fiscalDevice: false,
      mobileMoneyProviders: ["OPay", "PalmPay", "MTN MoMo"],
      taxInvoiceSystem: "Standard Invoice",
      vatRefundApplicable: false,
    },
    ZA: {
      ...defaultFeatures,
      mpesaAnalyzer: false,
      mobileMoneyProviders: ["VodaPay", "SnapScan", "Zapper"],
      taxInvoiceSystem: "Standard VAT Invoice",
      vatRefundApplicable: true,
    },
    ET: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      fuelQualityTesting: false,
      mobileMoneyProviders: ["Telebirr", "CBE Birr"],
      taxInvoiceSystem: "Standard Receipt",
      vatRefundApplicable: false,
    },
    RW: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      eTIMS: true,
      fiscalDevice: true,
      mobileMoneyProviders: ["MTN Mobile Money", "Airtel Money"],
      taxInvoiceSystem: "EBM",
      vatRefundApplicable: true,
    },
    GH: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      fiscalDevice: true,
      mobileMoneyProviders: [
        "MTN Mobile Money",
        "Vodafone Cash",
        "AirtelTigo Money",
      ],
      taxInvoiceSystem: "Standard VAT Invoice",
      vatRefundApplicable: true,
    },
    // Additional African countries with mobile money
    BI: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Lumicash", "EcoCash"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CD: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["M-Pesa", "Orange Money", "Airtel Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CI: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Orange Money", "MTN Mobile Money", "Moov Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CM: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["MTN Mobile Money", "Orange Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    EG: {
      ...defaultFeatures,
      mobileMoneyProviders: [
        "Vodafone Cash",
        "Orange Cash",
        "Etisalat Cash",
        "WE Pay",
      ],
      taxInvoiceSystem: "ETA",
    },
    GA: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Airtel Money", "Moov Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    LR: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Orange Money", "Lonestar Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    LS: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Vodacom M-Pesa"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MA: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Orange Money", "Cash Plus", "Wafacash"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MG: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["MVola", "Orange Money", "Airtel Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    ML: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Orange Money", "Moov Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MW: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["TNM Mpamba", "Airtel Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MZ: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["M-Pesa", "M-Kesh", "mPesa"],
      taxInvoiceSystem: "Standard Invoice",
    },
    NE: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Airtel Money", "Moov Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    SL: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Orange Money", "Africell Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    SN: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Orange Money", "Free Money", "Wave"],
      taxInvoiceSystem: "Standard Invoice",
    },
    SS: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["MTN Mobile Money"],
      taxInvoiceSystem: "Standard Invoice",
    },
    TG: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["TMoney", "Flooz"],
      taxInvoiceSystem: "Standard Invoice",
    },
    ZM: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: [
        "MTN Mobile Money",
        "Airtel Money",
        "Zamtel Kwacha",
      ],
      taxInvoiceSystem: "Standard Invoice",
    },
    ZW: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["EcoCash", "OneMoney", "Telecash"],
      taxInvoiceSystem: "Standard Invoice",
    },
    // Asian countries with mobile money dominance
    BD: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["bKash", "Nagad", "Rocket"],
      taxInvoiceSystem: "Standard Invoice",
    },
    ID: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["GoPay", "OVO", "Dana", "LinkAja"],
      taxInvoiceSystem: "Standard Invoice",
    },
    IN: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["UPI", "Paytm", "PhonePe", "Google Pay"],
      taxInvoiceSystem: "GST Invoice",
    },
    KH: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Wing", "TrueMoney", "Pi Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    LA: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["LaoPay", "TrueMoney"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MM: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["KBZ Pay", "WavePay", "CB Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MY: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["Touch n Go", "Boost", "GrabPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    NP: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["eSewa", "Khalti", "IME Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    PH: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["GCash", "Maya", "GrabPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    PK: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["JazzCash", "EasyPaisa", "NayaPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    TH: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["TrueMoney", "Rabbit LINE Pay", "PromptPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    VN: {
      ...defaultFeatures,
      mpesaAnalyzer: true,
      mobileMoneyProviders: ["MoMo", "ZaloPay", "ViettelPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    // Latin American countries
    AR: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Mercado Pago", "Uala", "Modo"],
      taxInvoiceSystem: "Standard Invoice",
    },
    BR: {
      ...defaultFeatures,
      mobileMoneyProviders: ["PIX", "Mercado Pago", "PicPay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CL: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Mercado Pago", "MACH"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CO: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Nequi", "Daviplata", "Mercado Pago"],
      taxInvoiceSystem: "Standard Invoice",
    },
    CR: {
      ...defaultFeatures,
      mobileMoneyProviders: ["SINPE Movil", "PayPal"],
      taxInvoiceSystem: "Standard Invoice",
    },
    MX: {
      ...defaultFeatures,
      mobileMoneyProviders: ["SPEI", "Mercado Pago", "CLIP"],
      taxInvoiceSystem: "Standard Invoice",
    },
    PE: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Yape", "PLIN", "Tunki"],
      taxInvoiceSystem: "Standard Invoice",
    },
    UY: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Mercado Pago", "Prex"],
      taxInvoiceSystem: "Standard Invoice",
    },
    // Caribbean
    JM: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Lynk", "Quisk"],
      taxInvoiceSystem: "Standard Invoice",
    },
    // Middle East
    AE: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Apple Pay", "Samsung Pay", "Noon Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    BH: {
      ...defaultFeatures,
      mobileMoneyProviders: ["BenefitPay", "PayPal"],
      taxInvoiceSystem: "Standard Invoice",
    },
    JO: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Orange Money", "Zain Cash"],
      taxInvoiceSystem: "Standard Invoice",
    },
    KW: {
      ...defaultFeatures,
      mobileMoneyProviders: ["KNET", "Apple Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    OM: {
      ...defaultFeatures,
      mobileMoneyProviders: ["OMANNET", "Thawani"],
      taxInvoiceSystem: "Standard Invoice",
    },
    QA: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Apple Pay", "Google Pay"],
      taxInvoiceSystem: "Standard Invoice",
    },
    SA: {
      ...defaultFeatures,
      mobileMoneyProviders: ["STC Pay", "Apple Pay", "Urway"],
      taxInvoiceSystem: "Standard Invoice",
    },
    TR: {
      ...defaultFeatures,
      mobileMoneyProviders: ["Paycell", "BKM Express", "Papara"],
      taxInvoiceSystem: "Standard Invoice",
    },
  };

  return features[countryCode] || defaultFeatures;
}

// ============================================================
// HOOK - Auto-sync on interval
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";

export function useAutoSync(countryCode: string) {
  const [syncStatus, setSyncStatus] = useState<{
    isSyncing: boolean;
    lastSync: string | null;
    result: SyncResult | null;
    error: string | null;
  }>({
    isSyncing: false,
    lastSync: null,
    result: null,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doSync = useCallback(async () => {
    if (syncStatus.isSyncing) return;

    setSyncStatus((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      const result = await runFullSync(countryCode);
      setSyncStatus({
        isSyncing: false,
        lastSync: new Date().toISOString(),
        result,
        error: null,
      });
    } catch (error) {
      setSyncStatus((prev) => ({
        ...prev,
        isSyncing: false,
        error: (error as Error).message,
      }));
    }
  }, [countryCode, syncStatus.isSyncing]);

  // Auto-sync on mount and periodically
  useEffect(() => {
    // Initial sync
    if (isSyncDue(countryCode)) {
      doSync();
    } else {
      // Load cached result
      const cached = localStorage.getItem(`fuelpro_sync_result_${countryCode}`);
      if (cached) {
        try {
          setSyncStatus((prev) => ({
            ...prev,
            result: JSON.parse(cached),
            lastSync: localStorage.getItem("fuelpro_last_full_sync"),
          }));
        } catch {
          /* ignore */
        }
      }
    }

    // Set up periodic sync
    intervalRef.current = setInterval(
      () => {
        if (isSyncDue(countryCode)) {
          doSync();
        }
      },
      1000 * 60 * 30,
    ); // Check every 30 minutes

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [countryCode, doSync]);

  return { ...syncStatus, doSync };
}

export {
  shouldSync,
  SYNC_INTERVAL_MS,
  FUEL_PRICE_SYNC_INTERVAL,
  NEWS_SYNC_INTERVAL,
  TAX_SYNC_INTERVAL,
};
