import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  CountryProfile,
  getCountryById,
  detectCountryFromTimezone,
  formatPhoneForCountry,
  formatCurrency,
  getFuelTaxBreakdown,
  COUNTRY_LIST,
} from "@/react-app/config/countries";
import {
  getCountryByCode,
  getCountryFromLocation,
  getCountryByCurrency,
} from "@/react-app/lib/world-country-utils";
import { getDetectedCurrency } from "@/react-app/lib/currency";

/** Get the first available country profile as universal fallback */
function getUniversalFallback(): CountryProfile {
  const fallback = getCountryById("US") || COUNTRY_LIST[0];
  if (fallback) return fallback;

  // Minimal fallback that satisfies the type
  return {
    id: "US",
    name: "United States",
    shortName: "USA",
    flag: "🇺🇸",
    region: "Americas",
    languages: ["en"],
    defaultLanguage: "en",
    currency: {
      code: "USD",
      symbol: "$",
      name: "US Dollar",
      isoCode: "USD",
      subunit: "cents",
      exchangeRateToUSD: 1,
    },
    timezone: "America/New_York",
    dateFormat: "MM/DD/YYYY",
    timeFormat: "12h",
    numberFormat: "1,000.00",
    phone: { prefix: "+1" },
    vatRate: 0,
    mobileMoney: [],
    revenueAuthority: {
      name: "IRS",
      shortName: "IRS",
      website: "https://irs.gov",
      vatRate: 0,
      vatName: "Tax",
      exciseDuty: 0,
      withholdingTax: 0,
      roadMaintenanceLevy: 0,
      petroleumDevelopmentLevy: 0,
      regulatoryLevy: 0,
      customsDuty: 0,
      supportPhone: "",
      supportEmail: "",
      etimsRequired: false,
      electronicInvoiceRequired: false,
      fiscalDeviceRequired: false,
      monthlyReturnDue: "15th",
      annualReturnDue: "April 15",
      eFilingPortal: "https://irs.gov",
    },
    payroll: {
      payeThreshold: 0,
      payeRates: [],
      nssfRequired: false,
      nssfLabel: "Social Security",
      nssfEmployeeRate: 0.062,
      nssfEmployerRate: 0.062,
      nhifRequired: false,
      nhifLabel: "Health Insurance",
      nhifRates: [],
      housingLevy: false,
      housingLevyRate: 0,
      pensionFund: false,
      pensionRate: 0,
      statutoryHolidays: [],
      minimumWage: 7.25,
      workingHoursPerWeek: 40,
      overtimeRate: 1.5,
      severancePayRequired: false,
      severanceFormula: "",
    },
    paymentMethods: [
      {
        id: "card",
        name: "Card",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
    communication: {
      smsGateway: "",
      smsShortcode: "",
      whatsappFormat: "",
      phoneFormat: "",
      countryCode: "US",
      emergencyNumbers: [],
      localCarriers: [],
    },
    units: {
      fuelVolume: "gallons",
      distance: "miles",
      weight: "lbs",
      tankCapacity: "gallons",
      fuelEfficiency: "mpg",
    },
    fuelRegulations: {
      priceSettingBody: "Department of Energy",
      licenseBody: "State Authority",
      priceReviewFrequency: "Monthly",
      requiresEfd: false,
      requiresEtr: false,
      requiresEtims: false,
      fuelTypes: ["Petrol", "Diesel"],
      requiresGhsCompliance: false,
      pumpCalibrationRequired: false,
    },
    newsSources: [],
    complianceDocuments: [],
  } as unknown as CountryProfile;
}

/** Map country codes by approximate geographic coordinates */
function detectCountryFromCoords(lat: number, lng: number): string | null {
  // Africa - more precise country boundaries
  if (lat >= -35 && lat <= 37 && lng >= -18 && lng <= 52) {
    // Kenya
    if (lat >= -4.9 && lat <= 5 && lng >= 33.9 && lng <= 42) {
      return "KE";
    }
    // Uganda
    if (lat >= -1.5 && lat <= 4.2 && lng >= 29.5 && lng <= 35) {
      return "UG";
    }
    // Tanzania
    if (lat >= -12 && lat <= -0.8 && lng >= 29 && lng <= 41) {
      return "TZ";
    }
    // Rwanda
    if (lat >= -2.9 && lat <= -1 && lng >= 28.9 && lng <= 30.9) {
      return "RW";
    }
    // Burundi
    if (lat >= -4.5 && lat <= -2.3 && lng >= 28.9 && lng <= 31) {
      return "BI";
    }
    // Ethiopia
    if (lat >= 3.5 && lat <= 15 && lng >= 33 && lng <= 48) {
      return "ET";
    }
    // South Sudan
    if (lat >= 3 && lat <= 13 && lng >= 24 && lng <= 36) {
      return "SS";
    }
    // Sudan
    if (lat >= 9 && lat <= 23 && lng >= 21 && lng <= 39) {
      return "SD";
    }
    // Somalia
    if (lat >= -1.7 && lat <= 12 && lng >= 40 && lng <= 52) {
      return "SO";
    }
    // Djibouti
    if (lat >= 10.9 && lat <= 12.7 && lng >= 41.5 && lng <= 44) {
      return "DJ";
    }
    // Eritrea
    if (lat >= 12.3 && lat <= 18 && lng >= 36.4 && lng <= 44) {
      return "ER";
    }
    // Ghana
    if (lat >= 4.7 && lat <= 11.2 && lng >= -3.3 && lng <= 1.2) {
      return "GH";
    }
    // Nigeria
    if (lat >= 4 && lat <= 14 && lng >= 2.6 && lng <= 15) {
      return "NG";
    }
    // South Africa
    if (lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33) {
      return "ZA";
    }
    // Mozambique
    if (lat >= -18.5 && lat <= -10.5 && lng >= 30 && lng <= 41) {
      return "MZ";
    }
    // Zambia
    if (lat >= -18.5 && lat <= -8 && lng >= 21.5 && lng <= 34) {
      return "ZM";
    }
    // Zimbabwe
    if (lat >= -22.5 && lat <= -15.5 && lng >= 25 && lng <= 34) {
      return "ZW";
    }
    // Malawi
    if (lat >= -17 && lat <= -9.3 && lng >= 32.5 && lng <= 36) {
      return "MW";
    }
    // Botswana
    if (lat >= -27 && lat <= -18.5 && lng >= 19.5 && lng <= 29) {
      return "BW";
    }
    // Namibia
    if (lat >= -29 && lat <= -17 && lng >= 11.5 && lng <= 26) {
      return "NA";
    }
    // Angola
    if (lat >= -18.5 && lat <= -4 && lng >= 11.5 && lng <= 24) {
      return "AO";
    }
    // DR Congo
    if (lat >= -13.5 && lat <= 5.5 && lng >= 12 && lng <= 31) {
      return "CD";
    }
    // Cameroon
    if (lat >= 1.5 && lat <= 13.5 && lng >= 8.5 && lng <= 16) {
      return "CM";
    }
    // Ivory Coast
    if (lat >= 4 && lat <= 10.8 && lng >= -8.6 && lng <= -2.5) {
      return "CI";
    }
    // Senegal
    if (lat >= 12 && lat <= 16.8 && lng >= -17.5 && lng <= -11.5) {
      return "SN";
    }
  }

  // Europe
  if (lng >= -25 && lng <= 40 && lat >= 35 && lat <= 72) {
    // UK
    if (lat >= 49.5 && lat <= 61 && lng >= -8.6 && lng <= 2) {
      return "GB";
    }
    // Germany
    if (lat >= 47 && lat <= 55 && lng >= 5.5 && lng <= 15.5) {
      return "DE";
    }
    // France
    if (lat >= 41 && lat <= 51.5 && lng >= -5 && lng <= 10) {
      return "FR";
    }
    // Spain
    if (lat >= 36 && lat <= 44 && lng >= -10 && lng <= 5) {
      return "ES";
    }
  }

  // Asia
  if (lat >= -10 && lat <= 55 && lng >= 60 && lng <= 180) {
    // India
    if (lat >= 6.5 && lat <= 36 && lng >= 68 && lng <= 98) {
      return "IN";
    }
    // China
    if (lat >= 18 && lat <= 54 && lng >= 73 && lng <= 135) {
      return "CN";
    }
  }

  // Americas
  if (lat >= -55 && lat <= 72 && lng >= -170 && lng <= -30) {
    // USA
    if (lat >= 24 && lat <= 72 && lng >= -180 && lng <= -65) {
      return "US";
    }
    // Brazil
    if (lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34) {
      return "BR";
    }
    // Mexico
    if (lat >= 14 && lat <= 33 && lng >= -118 && lng <= -86) {
      return "MX";
    }
  }

  // Oceania
  if (lat >= -50 && lat <= -10 && lng >= 110 && lng <= 180) {
    // Australia
    if (lat >= -44 && lat <= -10 && lng >= 112 && lng <= 155) {
      return "AU";
    }
  }

  return null;
}

/** Get user's detected country code from any source */
function resolveUserCountry(): string {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const parsed = JSON.parse(saved);
      const cc = parsed.currentCountry || parsed.country;
      if (cc) return cc.toUpperCase();
    }
  } catch {
    /* */
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz) {
    const fromTz = detectCountryFromTimezone();
    if (fromTz) return fromTz;
  }
  return "US";
}

const LOCATION_STORAGE_KEY = "fuelpro_location_v1";
const STATION_COUNTRY_KEY = "fuelpro_station_countries";

export interface StationLocation {
  stationId: string;
  countryCode: string;
  city: string;
  timezone: string;
  coordinates: { lat: number; lng: number } | null;
  detected: boolean; // was auto-detected or manually set
  updatedAt: string;
  // Precise GPS location
  preciseCoords: { lat: number; lng: number; accuracy: number } | null;
  preciseAddress: string; // Reverse-geocoded address
  preciseTimestamp: string;
}

interface LocationContextType {
  // Current location
  currentCountry: CountryProfile;
  currentLocation: StationLocation | null;
  allCountries: CountryProfile[];

  // Getters
  getCountry: (countryCode: string) => CountryProfile;
  getStationLocation: (stationId: string) => StationLocation | null;
  getStationCountry: (stationId: string) => CountryProfile;

  // Formatters
  fmtCurrency: (amount: number) => string;
  fmtPhone: (phone: string) => string;
  fmtDate: (date: Date | string) => string;
  fmtNumber: (num: number) => string;

  // Tax & compliance
  getFuelTax: (pricePerLiter: number) => ReturnType<typeof getFuelTaxBreakdown>;

  // Setters
  setStationCountry: (stationId: string, countryCode: string) => void;
  setStationCity: (stationId: string, city: string) => void;
  detectLocation: (stationId: string) => Promise<StationLocation>;

  // Precise location
  preciseLocation: {
    lat: number;
    lng: number;
    accuracy: number;
    address: string;
    city?: string;
    isImprecise?: boolean;
  } | null;
  preciseLocationLoading: boolean;
  detectPreciseLocation: () => Promise<void>;

  // Mobile money
  getActiveMobileMoney: () => CountryProfile["mobileMoney"];
  getMobileMoneyById: (
    id: string,
  ) => CountryProfile["mobileMoney"][0] | undefined;

  // Payment methods
  getActivePaymentMethods: () => CountryProfile["paymentMethods"];

  // Quick properties
  currencySymbol: string;
  currencyCode: string;
  language: string;
  revenueAuthority: CountryProfile["revenueAuthority"];
  payrollConfig: CountryProfile["payroll"];
  communication: CountryProfile["communication"];
  units: CountryProfile["units"];
  complianceDocs: CountryProfile["complianceDocuments"];
  fuelRegulations: CountryProfile["fuelRegulations"];
  newsSources: CountryProfile["newsSources"];
}

const LocationContext = createContext<LocationContextType | null>(null);

function loadStationCountries(): Record<string, StationLocation> {
  try {
    const raw = localStorage.getItem(STATION_COUNTRY_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, StationLocation>;
    // Migrate old data: add missing precise fields
    Object.values(data).forEach((loc) => {
      (loc as any).preciseCoords ??= null;
      (loc as any).preciseAddress ??= "";
      (loc as any).preciseTimestamp ??= "";
    });
    return data;
  } catch {
    return {};
  }
}

function saveStationCountries(data: Record<string, StationLocation>) {
  localStorage.setItem(STATION_COUNTRY_KEY, JSON.stringify(data));
}

export function LocationProvider({
  children,
  stationId,
  stationLocation,
  stationCountry,
  stationCurrency,
  companyCurrency,
}: {
  children: React.ReactNode;
  stationId?: string;
  stationLocation?: string;
  stationCountry?: string;
  stationCurrency?: string;
  // The FuelContext companyData.currency (e.g. "KSh" or "KES"). This is the
  // most reliable currency signal — it's set via Edit Info and loaded from
  // cloud sync. Passed as a prop so the useMemo re-evaluates when companyData
  // arrives (the station record may have empty currency, but companyData
  // always has one after cloud load).
  companyCurrency?: string;
}) {
  const [stationCountries, setStationCountries] =
    useState<Record<string, StationLocation>>(loadStationCountries);
  const [preciseLocation, setPreciseLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    address: string;
    city?: string;
    isImprecise?: boolean;
  } | null>(null);
  const [preciseLocationLoading, setPreciseLocationLoading] = useState(false);

  const currentLocation = stationId ? stationCountries[stationId] : null;

  const currentCountry = React.useMemo(() => {
    // The station's explicitly selected country (from the SetupWizard, persisted
    // on the Station record + Supabase) is the authoritative source. It must
    // take precedence over GPS/timezone so a German station stays German on
    // every device, a US station stays US, etc.
    if (stationCountry) {
      return getCountryById(stationCountry) || getUniversalFallback();
    }
    // Derive the country from the station's configured location string. The
    // station's own data (location, currency) is authoritative — it was set
    // by the user and synced via cloud — so it takes precedence over the
    // browser-local GPS cache, which frequently resolves to the CDN edge
    // country (e.g. US) rather than the user's real country.
    if (stationLocation) {
      const derived = getCountryFromLocation(stationLocation)?.code;
      if (derived) {
        return getCountryById(derived) || getUniversalFallback();
      }
    }
    // Derive the country from the station's currency code (e.g. "KES" → KE).
    if (stationCurrency) {
      const cc = getCountryByCurrency(stationCurrency);
      if (cc) {
        return getCountryById(cc) || getUniversalFallback();
      }
    }
    // Derive the country from the FuelContext companyData.currency. This is
    // passed as a prop from Home.tsx and updates reactively when companyData
    // loads from cloud sync. Handles both codes ("KES") and symbols ("KSh")
    // via normalizeCurrencyCode.
    if (companyCurrency) {
      const cc = getCountryByCurrency(companyCurrency);
      if (cc) {
        return getCountryById(cc) || getUniversalFallback();
      }
    }
    // Derive the country from the globally-detected currency BEFORE consulting
    // the browser-local GPS cache. getDetectedCurrency inspects station data,
    // location localStorage, and timezone — all more reliable than the
    // stationCountries cache, which frequently defaults to "US" (the CDN edge
    // country). E.g. Africa/Nairobi timezone → KES → Kenya, even when the
    // station record has empty location/currency/country fields.
    const detectedCurrency = getDetectedCurrency();
    if (detectedCurrency && detectedCurrency !== "USD") {
      const cc = getCountryByCurrency(detectedCurrency);
      if (cc) {
        return getCountryById(cc) || getUniversalFallback();
      }
    }
    // Fall back to the browser-local GPS-detected country code (stored in
    // localStorage). This is a browser-local cache and may be stale or
    // resolve to the CDN edge country, so it's a low-priority fallback.
    if (currentLocation?.countryCode) {
      return (
        getCountryById(currentLocation.countryCode) || getUniversalFallback()
      );
    }
    // Auto-detect from browser timezone or resolved country
    const resolved = resolveUserCountry();
    return getCountryById(resolved) || getUniversalFallback();
  }, [
    stationCountry,
    currentLocation,
    stationLocation,
    stationCurrency,
    companyCurrency,
  ]);

  // Persist changes
  useEffect(() => {
    saveStationCountries(stationCountries);
  }, [stationCountries]);

  const getCountry = useCallback((code: string): CountryProfile => {
    return (
      getCountryById(code) ||
      (getCountryByCode(code.toUpperCase()) as unknown as CountryProfile) ||
      getUniversalFallback()
    );
  }, []);

  const getStationLocation = useCallback(
    (sid: string) => {
      return stationCountries[sid] || null;
    },
    [stationCountries],
  );

  const getStationCountry = useCallback(
    (sid: string) => {
      // The station's explicitly selected country (persisted on the Station
      // record) is authoritative for the ACTIVE station — prefer it over the
      // localStorage stationCountries map so cross-device sync reflects the
      // user's wizard choice, not a stale browser-local entry.
      if (stationCountry && sid === stationId) {
        return getCountryById(stationCountry) || getUniversalFallback();
      }
      // Derive the country from the station's own data (location, currency)
      // BEFORE consulting the browser-local stationCountries cache. The
      // station's data is authoritative — the cache frequently defaults to
      // "US" (the CDN edge country) and would override the real country.
      if (sid === stationId) {
        if (stationLocation) {
          const derived = getCountryFromLocation(stationLocation)?.code;
          if (derived) {
            return getCountryById(derived) || getUniversalFallback();
          }
        }
        if (stationCurrency) {
          const cc = getCountryByCurrency(stationCurrency);
          if (cc) {
            return getCountryById(cc) || getUniversalFallback();
          }
        }
        // Station has no country/location/currency data. Fall through to
        // currentCountry (which checks getDetectedCurrency → timezone →
        // localStorage cache) INSTEAD of the stale stationCountries cache.
        // The latter frequently defaults to "US" (CDN edge country) and
        // would mask the correct country derived from timezone/currency.
        return currentCountry;
      }
      const loc = stationCountries[sid];
      if (loc?.countryCode)
        return getCountryById(loc.countryCode) || getUniversalFallback();
      return currentCountry;
    },
    [
      stationCountry,
      stationId,
      stationCountries,
      currentCountry,
      stationLocation,
      stationCurrency,
      companyCurrency,
    ],
  );

  const fmtCurrency = useCallback(
    (amount: number) => {
      return formatCurrency(amount, currentCountry.id);
    },
    [currentCountry],
  );

  const fmtPhone = useCallback(
    (phone: string) => {
      return formatPhoneForCountry(phone, currentCountry.id);
    },
    [currentCountry],
  );

  const fmtDate = useCallback(
    (date: Date | string) => {
      const d = typeof date === "string" ? new Date(date) : date;
      const locale =
        currentCountry.defaultLanguage === "en"
          ? `en-${currentCountry.id}`
          : `${currentCountry.defaultLanguage}-${currentCountry.id}`;
      try {
        return d.toLocaleDateString(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } catch {
        return d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    },
    [currentCountry],
  );

  const fmtNumber = useCallback((num: number) => {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, []);

  const getFuelTax = useCallback(
    (pricePerLiter: number) => {
      return getFuelTaxBreakdown(pricePerLiter, currentCountry.id);
    },
    [currentCountry],
  );

  const setStationCountry = useCallback((sid: string, countryCode: string) => {
    const upperCode = countryCode.toUpperCase();
    const country = getCountryById(upperCode) as CountryProfile | undefined;
    setStationCountries((prev) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {
          stationId: sid,
          city: "",
          timezone: "",
          coordinates: null,
          detected: false,
          updatedAt: "",
          preciseCoords: null,
          preciseAddress: "",
          preciseTimestamp: "",
        }),
        stationId: sid,
        countryCode: upperCode,
        timezone:
          country?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        detected: false,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  const setStationCity = useCallback((sid: string, city: string) => {
    const resolved = resolveUserCountry();
    setStationCountries((prev) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {
          stationId: sid,
          countryCode: resolved,
          timezone: "",
          coordinates: null,
          detected: false,
          updatedAt: "",
          preciseCoords: null,
          preciseAddress: "",
          preciseTimestamp: "",
        }),
        stationId: sid,
        city,
        countryCode: prev[sid]?.countryCode || resolved,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  const detectLocation = useCallback(
    async (sid: string): Promise<StationLocation> => {
      return new Promise((resolve) => {
        // Try geolocation API
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const coordCountry = detectCountryFromCoords(
                position.coords.latitude,
                position.coords.longitude,
              );
              const detected = coordCountry || detectCountryFromTimezone();
              const loc: StationLocation = {
                stationId: sid,
                countryCode: detected,
                city: "GPS-detected",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                coordinates: {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                },
                detected: true,
                updatedAt: new Date().toISOString(),
                preciseCoords: {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                  accuracy: position.coords.accuracy,
                },
                preciseAddress: "GPS-detected",
                preciseTimestamp: new Date().toISOString(),
              };
              setStationCountries((prev) => ({ ...prev, [sid]: loc }));
              resolve(loc);
            },
            () => {
              // Fallback to timezone detection
              const detected = detectCountryFromTimezone();
              const loc: StationLocation = {
                stationId: sid,
                countryCode: detected,
                city: "Timezone detected",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                coordinates: null,
                detected: true,
                updatedAt: new Date().toISOString(),
                preciseCoords: null,
                preciseAddress: "",
                preciseTimestamp: "",
              };
              setStationCountries((prev) => ({ ...prev, [sid]: loc }));
              resolve(loc);
            },
            { timeout: 10000, enableHighAccuracy: false },
          );
        } else {
          const detected = detectCountryFromTimezone();
          const loc: StationLocation = {
            stationId: sid,
            countryCode: detected,
            city: "Timezone detected",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            coordinates: null,
            detected: true,
            updatedAt: new Date().toISOString(),
            preciseCoords: null,
            preciseAddress: "",
            preciseTimestamp: "",
          };
          setStationCountries((prev) => ({ ...prev, [sid]: loc }));
          resolve(loc);
        }
      });
    },
    [],
  );

  const getActiveMobileMoney = useCallback(
    () => currentCountry.mobileMoney,
    [currentCountry],
  );
  const getMobileMoneyById = useCallback(
    (id: string) => currentCountry.mobileMoney.find((m) => m.id === id),
    [currentCountry],
  );
  const getActivePaymentMethods = useCallback(
    () => currentCountry.paymentMethods,
    [currentCountry],
  );

  // Precise GPS location detection with improved accuracy
  const detectPreciseLocation = useCallback(async () => {
    if (!navigator.geolocation) return;
    setPreciseLocationLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000, // Cache for 1 minute
        });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      // First: Use coordinate-based country detection for accuracy
      const detectedCountry = detectCountryFromCoords(lat, lng);

      // Reverse geocode using OpenStreetMap Nominatim
      let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      let city = "";
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
          { headers: { "User-Agent": "FuelPro/1.0 (contact@fuelpro.app)" } },
        );
        if (res.ok) {
          const data = await res.json();
          const a = data.address || {};
          city =
            a.city ||
            a.town ||
            a.village ||
            a.suburb ||
            a.district ||
            a.county ||
            "";
          address = city || a.state || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

          // If no country detected from coords, try from reverse geocode
          if (!detectedCountry && a.country_code) {
            // Update country based on actual location
            const countryCode = a.country_code.toUpperCase();
            console.log(
              `[Location] Detected country from geocode: ${countryCode}`,
            );
          }
        }
      } catch {
        /* fallback to coordinates */
      }

      // If location is imprecise (>1000m accuracy) and we detected Nairobi/Kenya incorrectly
      // it's likely a VPN or proxy issue - show warning
      const isImprecise = accuracy > 1000;

      setPreciseLocation({ lat, lng, accuracy, address, city, isImprecise });

      // Store coordinates for fuel price lookup
      if (lat && lng) {
        localStorage.setItem(
          "fuelpro_user_coords",
          JSON.stringify({ lat, lng }),
        );
      }
    } catch {
      // Fallback: try country detection with timezone only
      const resolved = detectCountryFromTimezone();
      const country =
        getCountryById(resolved) ||
        (getCountryByCode(resolved) as unknown as { name: string } | undefined);
      if (country) {
        setPreciseLocation({
          lat: 0,
          lng: 0,
          accuracy: 100000,
          address: country.name,
          city: "",
          isImprecise: true,
        });
      }
    } finally {
      setPreciseLocationLoading(false);
    }
  }, []);

  // Auto-detect precise location on mount — once only.
  // A ref guard prevents re-detection storms caused by provider re-mounts
  // (e.g. when StationContext syncs and currentStation gets a new identity).
  const hasAutoDetectedRef = useRef(false);
  useEffect(() => {
    if (hasAutoDetectedRef.current) return;
    hasAutoDetectedRef.current = true;
    detectPreciseLocation();
  }, [detectPreciseLocation]);

  // Memoize the context value so consumers don't re-render on every
  // LocationProvider render (which previously cascaded into infinite
  // re-render / max-update-depth crashes that triggered page reloads).
  const value = useMemo(
    () => ({
      currentCountry,
      currentLocation,
      allCountries: COUNTRY_LIST,
      getCountry,
      getStationLocation,
      getStationCountry,
      fmtCurrency,
      fmtPhone,
      fmtDate,
      fmtNumber,
      getFuelTax,
      setStationCountry,
      setStationCity,
      detectLocation,
      preciseLocation,
      preciseLocationLoading,
      detectPreciseLocation,
      getActiveMobileMoney,
      getMobileMoneyById,
      getActivePaymentMethods,
      currencySymbol: currentCountry.currency.symbol,
      currencyCode: currentCountry.currency.code,
      language: currentCountry.defaultLanguage,
      revenueAuthority: currentCountry.revenueAuthority,
      payrollConfig: currentCountry.payroll,
      communication: currentCountry.communication,
      units: currentCountry.units,
      complianceDocs: currentCountry.complianceDocuments,
      fuelRegulations: currentCountry.fuelRegulations,
      newsSources: currentCountry.newsSources,
    }),
    [
      currentCountry,
      currentLocation,
      getCountry,
      getStationLocation,
      getStationCountry,
      fmtCurrency,
      fmtPhone,
      fmtDate,
      fmtNumber,
      getFuelTax,
      setStationCountry,
      setStationCity,
      detectLocation,
      preciseLocation,
      preciseLocationLoading,
      detectPreciseLocation,
      getActiveMobileMoney,
      getMobileMoneyById,
      getActivePaymentMethods,
    ],
  );

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within LocationProvider");
  return ctx;
}
