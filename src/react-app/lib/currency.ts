/**
 * Currency detection utility - resolves station currency from station context,
 * localStorage country detection, or timezone-based fallback.
 * Returns the correct currency code (KES, UGX, TZS, USD, etc.)
 *
 * Uses unified currency symbols from config/pricing.ts for consistency.
 */
import {
  getCountryByCode,
  getCountryFromLocation,
  normalizeCurrencyCode,
  getCountryByCurrency,
} from "./world-country-utils";
import { REGIONAL_PRICES } from "@/react-app/config/pricing";
import { getCountryById } from "@/react-app/config/countries";

// Build currency symbols from unified pricing config
const UNIFIED_SYMBOLS: Record<string, string> = {};
Object.entries(REGIONAL_PRICES).forEach(([code, config]) => {
  UNIFIED_SYMBOLS[code] = config.currencySymbol;
});

/**
 * Resolve the current station's localStorage JSON, checking the USER-SCOPED
 * key (`fuelpro_stations_v3_<userId>`, written by StationContext since the
 * cross-user isolation fix) first, then the legacy bare `fuelpro_stations_v3`
 * key. The bare key is empty for accounts created after the isolation fix, so
 * without checking the user-scoped key, country/currency detection silently
 * falls through to the (often inaccurate) timezone fallback. The user id is
 * read from `fuelpro_auth_identity` (written synchronously by AuthContext on
 * login — same source as cloudStorageService.currentUserIdSync).
 */
function readStationsJson(): string | null {
  try {
    const userId = localStorage.getItem("fuelpro_auth_identity");
    if (userId) {
      const scoped = localStorage.getItem(`fuelpro_stations_v3_${userId}`);
      if (scoped) return scoped;
    }
  } catch {
    /* */
  }
  return localStorage.getItem("fuelpro_stations_v3");
}

export function getDetectedCurrency(): string {
  // NOTE: the cache is intentionally keyed per-call-site (not a single global
  // "_default") so that a stale "USD" result from an early render (before
  // cloud data loaded) does NOT poison all subsequent calls. We only cache
  // NON-USD results; "USD" is the last-resort fallback and must be
  // re-evaluated every time so that late-arriving station/companyData can
  // upgrade the detection.

  // 1. Try station data (highest priority)
  try {
    const stationsJson = readStationsJson();
    // The current-station key is fuelpro_current_station_v3 (the older
    // fuelpro_current_station key is no longer written anywhere).
    const currentStationId =
      localStorage.getItem("fuelpro_current_station_v3") ||
      localStorage.getItem("fuelpro_current_station");
    if (stationsJson && currentStationId) {
      const parsed = JSON.parse(stationsJson);
      const stationList = Array.isArray(parsed) ? parsed : parsed?.stations;
      const current = stationList?.find((s: any) => s.id === currentStationId);
      // A station may carry either a country code (e.g. "KE") or a full
      // currency code (e.g. "KES"); resolve whichever is present.
      if (current) {
        if (current.currency) {
          const code =
            normalizeCurrencyCode(current.currency) || current.currency;
          return code;
        }
        const cc = current.country || current.countryCode;
        if (cc) {
          const country = getCountryByCode(cc);
          if (country?.currency) {
            return country.currency;
          }
        }
        // No explicit country/currency stored on the station. Try to derive
        // one from the free-text location string (e.g. "Nairobi, Kenya" →
        // Kenya → KES). This fixes the common case where a station is created
        // with a location but no country code, which otherwise falls through
        // to the (often server-IP-based, inaccurate) cached user location.
        if (current.location) {
          const country = getCountryFromLocation(current.location);
          if (country?.currency) {
            return country.currency;
          }
        }
      }
    }
  } catch {
    /* */
  }

  // 1b. Try FuelContext companyData (saved to localStorage as
  //     user_*_compactcompanyData or fuelpro_cloud_*companyData).
  //     This catches the common case where the station record has empty
  //     currency but the companyData (set via Edit Info) has "KSh" or "KES".
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.endsWith("companyData")) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const cd = JSON.parse(raw);
          if (cd?.currency) {
            const code = normalizeCurrencyCode(cd.currency) || cd.currency;
            return code;
          }
        }
      }
    }
  } catch {
    /* */
  }

  // 2. Try location country detection (fuelpro_user_location, written by
  //    FuelPriceService, or the legacy fuelpro_location_country key)
  try {
    for (const key of ["fuelpro_user_location", "fuelpro_location_country"]) {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc =
          parsed.countryCode || parsed.currentCountry || parsed.country;
        if (cc && cc.toUpperCase() !== "US") {
          const country = getCountryByCode(cc);
          if (country?.currency) {
            return country.currency;
          }
        }
      }
    }
  } catch {
    /* */
  }

  // 3. Fallback: detect from timezone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (
    tz.includes("Nairobi") ||
    tz.includes("Kampala") ||
    tz.includes("Dar") ||
    tz.includes("Kigali") ||
    tz.includes("Addis")
  ) {
    return "KES";
  }
  if (tz.includes("Lagos") || tz.includes("Accra")) {
    return "NGN";
  }
  if (tz.includes("Johannesburg")) {
    return "ZAR";
  }
  if (tz.includes("London")) {
    return "GBP";
  }
  if (
    tz.includes("Berlin") ||
    tz.includes("Paris") ||
    tz.includes("Rome") ||
    tz.includes("Madrid")
  ) {
    return "EUR";
  }

  return "USD";
}

/**
 * Resolve the station/user's ISO country code (e.g. "KE", "DE", "US").
 * Mirrors getDetectedCurrency() but returns the country code so components
 * can gate country-specific features (e.g. KRA eTIMS for Kenya only).
 */
export function getDetectedCountryCode(): string {
  // 1. Station data
  try {
    const stationsJson = readStationsJson();
    const currentStationId =
      localStorage.getItem("fuelpro_current_station_v3") ||
      localStorage.getItem("fuelpro_current_station");
    if (stationsJson && currentStationId) {
      const parsed = JSON.parse(stationsJson);
      const stationList = Array.isArray(parsed) ? parsed : parsed?.stations;
      const current = stationList?.find((s: any) => s.id === currentStationId);
      if (current) {
        // RESPECT the station's explicit country setting — even if it's "US".
        // The old code skipped "US" and fell through to location/currency/timezone
        // detection, which caused a US station with a "Nairobi" location to be
        // misdetected as Kenya (16% VAT, KRA eTIMS). If the user explicitly set
        // country=US (or any other code), honour it.
        const cc = current.country || current.countryCode;
        if (cc) {
          return cc.toUpperCase();
        }
        // Only use currency to infer country when no explicit country is set.
        if (current.currency) {
          const code = normalizeCurrencyCode(current.currency);
          if (code) {
            const country = getCountryByCode(getCountryByCurrency(code) || "");
            if (country?.code) return country.code;
          }
        }
        // Location-based detection is a last resort when no country/currency.
        if (current.location) {
          const country = getCountryFromLocation(current.location);
          if (country?.code) {
            return country.code.toUpperCase();
          }
        }
      }
    }
  } catch {
    /* */
  }

  // 1b. FuelContext companyData
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.endsWith("companyData")) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const cd = JSON.parse(raw);
          if (cd?.currency) {
            const code = normalizeCurrencyCode(cd.currency);
            if (code) {
              const country = getCountryByCode(
                getCountryByCurrency(code) || "",
              );
              if (country?.code) return country.code;
            }
          }
        }
      }
    }
  } catch {
    /* */
  }

  // 2. Location country detection
  try {
    for (const key of ["fuelpro_user_location", "fuelpro_location_country"]) {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc =
          parsed.countryCode || parsed.currentCountry || parsed.country;
        if (cc) {
          return cc.toUpperCase();
        }
      }
    }
  } catch {
    /* */
  }

  // 3. Timezone fallback
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzMap: Record<string, string> = {
    Nairobi: "KE",
    Kampala: "UG",
    Dar_es_Salaam: "TZ",
    Kigali: "RW",
    Lagos: "NG",
    Accra: "GH",
    Johannesburg: "ZA",
    London: "GB",
    Berlin: "DE",
    Paris: "FR",
    Rome: "IT",
    Madrid: "ES",
    New_York: "US",
    Chicago: "US",
    Los_Angeles: "US",
    Tokyo: "JP",
    Shanghai: "CN",
    Kolkata: "IN",
    Mumbai: "IN",
    Sao_Paulo: "BR",
    Sydney: "AU",
  };
  for (const [frag, cc] of Object.entries(tzMap)) {
    if (tz.includes(frag)) {
      return cc;
    }
  }

  return "US";
}

/** Whether the current station/user is in Kenya (KRA eTIMS applies). */
export function isKenyaStation(): boolean {
  return getDetectedCountryCode() === "KE";
}

/** Get currency symbol for display - uses unified symbols from pricing config */
export function getCurrencySymbol(currency?: string): string {
  const c = currency || getDetectedCurrency();
  // First try unified symbols from pricing config
  if (UNIFIED_SYMBOLS[c]) return UNIFIED_SYMBOLS[c];

  // If the input is already a symbol (e.g. "KSh", "$", "USh"), return it
  // as-is — it was likely stored incorrectly as a symbol instead of a code.
  // This prevents double-prefixing (e.g. "KSh" -> "KSh" is correct, not "KES").
  const KNOWN_SYMBOLS = new Set([
    "KSh",
    "USh",
    "TSh",
    "$",
    "R",
    "GH\u20B5",
    "RF",
    "FBu",
    "\u20A6",
    "SS\u00A3",
    "\u00A3",
    "\u20AC",
    "\u00A5",
    "\u20B9",
    "A$",
    "C$",
    "CHF",
    "R$",
    "Mex$",
    "AR$",
    "K",
    "P",
    "MT",
  ]);
  if (KNOWN_SYMBOLS.has(c)) return c;

  // Fallback to standard symbols
  const SYMBOLS: Record<string, string> = {
    KES: "KSh", // Unified format
    UGX: "USh",
    TZS: "TSh",
    NGN: "\u20A6",
    ZAR: "R",
    GHS: "GH\u20B5",
    RWF: "RF",
    BIF: "FBu",
    SSP: "SS\u00A3",
    USD: "$",
    GBP: "\u00A3",
    EUR: "\u20AC",
    JPY: "\u00A5",
    CNY: "\u00A5",
    INR: "\u20B9",
    AUD: "A$",
    CAD: "C$",
    CHF: "CHF",
    BRL: "R$",
    MXN: "Mex$",
    ARS: "AR$",
    ZMW: "K",
    BWP: "P",
    MZN: "MT",
  };
  return SYMBOLS[c] || c;
}

/**
 * Resolve the currency SYMBOL for display from multiple sources. Accepts the
 * companyData currency (which may be a stale symbol like "KSh" instead of a
 * code like "USD") and the station record's currency code. A valid currency
 * code is a 3-letter uppercase string (USD, KES, EUR); anything else is
 * treated as a symbol and we fall through to the station currency.
 *
 * Usage: `const currencySymbol = resolveCurrencySymbol(state.companyData?.currency, currentStation?.currency);`
 */
export function resolveCurrencySymbol(
  companyDataCurrency?: string,
  stationCurrency?: string,
): string {
  const isValidCode = (s?: string): s is string => !!s && /^[A-Z]{3}$/.test(s);
  const code = isValidCode(companyDataCurrency)
    ? companyDataCurrency
    : isValidCode(stationCurrency)
      ? stationCurrency
      : undefined;
  return getCurrencySymbol(code);
}

/** Format amount with detected currency */
export function formatMoney(amount: number, currency?: string): string {
  const c = currency || getDetectedCurrency();
  const sym = getCurrencySymbol(c);
  return `${sym} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Get currency from country code */
export function getCurrencyByCountry(countryCode: string): string {
  const country = getCountryByCode(countryCode);
  return country?.currency || "USD";
}

/**
 * Resolve a BCP-47 locale string (e.g. "en-KE", "en-US", "sw-KE") from the
 * detected country code. Uses the country's primary language + country code.
 * Falls back to the browser default locale, then "en-US".
 */
export function getLocaleForCountry(countryCode?: string): string {
  const cc = (countryCode || getDetectedCountryCode()).toUpperCase();
  const country = getCountryById(cc);
  const lang = country?.languages?.[0] || "en";
  return `${lang}-${cc}`;
}

/**
 * Country-aware money formatter. Replaces hardcoded `new Intl.NumberFormat("en-KE", ...)`.
 * Resolves the locale from the station's country so a US station shows
 * "$1,234.56" (en-US) while a Kenya station shows "KSh 1,234.56" (en-KE).
 */
export function formatCurrency(
  amount: number,
  currency?: string,
  opts?: Intl.NumberFormatOptions,
): string {
  const c = currency || getDetectedCurrency();
  const locale = getLocaleForCountry();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: c,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      ...opts,
    }).format(amount);
  } catch {
    return `${getCurrencySymbol(c)} ${amount.toLocaleString()}`;
  }
}
