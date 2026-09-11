// packages/store/src/useGeo.ts
// Global Location Context — all 250+ countries, auto-detect, GPS

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { WORLD_PAYMENT_CONFIGS } from "@/react-app/config/worldPaymentConfigs";
import {
  ALL_COUNTRIES,
  getCountryPaymentMethods,
} from "@/react-app/lib/world-country-utils";
import { getEventBus, Events } from "@/react-app/lib/event-bus";

export interface GeoState {
  countryCode: string;
  countryName: string;
  currency: string;
  timezone: string;
  locale: string;
  flag: string;
  lat: number | null;
  lon: number | null;
  city: string | null;
  address: string | null;
  isLoading: boolean;
  detectedAt: string;
}

// Dynamic default — resolves from saved location or browser, never hardcodes a specific country
function resolveDefaultGeo(): GeoState {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const parsed = JSON.parse(saved);
      const cc = (parsed.currentCountry || parsed.country || "").toUpperCase();
      if (cc) {
        const config = WORLD_PAYMENT_CONFIGS[cc];
        if (config) {
          return {
            countryCode: cc,
            countryName: config.countryName,
            currency: config.defaultCurrency,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: `en-${cc}`,
            flag: config.flag || "🌍",
            lat: parsed.latitude || null,
            lon: parsed.longitude || null,
            city: parsed.city || null,
            address: parsed.address || null,
            isLoading: true,
            detectedAt: parsed.detectedAt || "",
          };
        }
      }
    }
  } catch {
    /* */
  }
  // Universal fallback — uses browser timezone, not any specific country
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    countryCode: "US",
    countryName: "United States",
    currency: "USD",
    timezone: browserTz,
    locale: "en-US",
    flag: "🇺🇸",
    lat: null,
    lon: null,
    city: null,
    address: null,
    isLoading: true,
    detectedAt: "",
  };
}

const DEFAULT_GEO: GeoState = resolveDefaultGeo();

interface GeoContextType {
  geo: GeoState;
  setCountry: (code: string) => void;
  refreshLocation: () => void;
  getPaymentMethods: () => {
    banks: string[];
    digitalWallets: string[];
    cards: string[];
    methods: any[];
  };
  getTaxRate: () => number;
  isLocationReady: boolean;
}

const GeoContext = createContext<GeoContextType>({
  geo: DEFAULT_GEO,
  setCountry: () => {},
  refreshLocation: () => {},
  getPaymentMethods: () => ({
    banks: [],
    digitalWallets: [],
    cards: [],
    methods: [],
  }),
  getTaxRate: () => 0.16,
  isLocationReady: false,
});

export function GeoProvider({ children }: { children: React.ReactNode }) {
  const [geo, setGeo] = useState<GeoState>(DEFAULT_GEO);
  const [isReady, setIsReady] = useState(false);

  // ─── Load saved location ───
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fuelpro_location_country");
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc = (
          parsed.currentCountry ||
          parsed.country ||
          "US"
        ).toUpperCase();
        const config = WORLD_PAYMENT_CONFIGS[cc];
        if (config) {
          setGeo((prev) => ({
            ...prev,
            countryCode: cc,
            countryName: config.countryName,
            currency: config.defaultCurrency,
            lat: parsed.latitude || null,
            lon: parsed.longitude || null,
            city: parsed.city || null,
            address: parsed.address || null,
            detectedAt: parsed.detectedAt || new Date().toISOString(),
          }));
          updateTimezoneLocale(cc, config.defaultCurrency);
        }
      }
    } catch {
      /* */
    }
    setIsReady(true);
  }, []);

  const updateTimezoneLocale = useCallback(
    (countryCode: string, currency: string) => {
      // Dynamic timezone/locale resolution — no hardcoded country maps
      const getLocale = (cc: string, curr: string): string => {
        try {
          return (
            Intl.NumberFormat.supportedLocalesOf([
              `${navigator.language.slice(0, 2)}-${cc}`,
            ])[0] || `en-${cc}`
          );
        } catch {
          return `en-${cc}`;
        }
      };
      setGeo((prev) => ({
        ...prev,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: getLocale(countryCode, currency),
      }));
    },
    [],
  );

  const setCountry = useCallback(
    (code: string) => {
      const upper = code.toUpperCase();
      const config = WORLD_PAYMENT_CONFIGS[upper];
      if (!config) return;

      const newGeo: GeoState = {
        ...geo,
        countryCode: upper,
        countryName: config.countryName,
        currency: config.defaultCurrency,
        isLoading: false,
      };
      setGeo(newGeo);
      updateTimezoneLocale(upper, config.defaultCurrency);

      // Persist
      localStorage.setItem(
        "fuelpro_location_country",
        JSON.stringify({
          currentCountry: upper,
          countryName: config.countryName,
          currency: config.defaultCurrency,
          latitude: newGeo.lat,
          longitude: newGeo.lon,
          detectedAt: new Date().toISOString(),
        }),
      );

      // Notify
      getEventBus().emit(Events.LOCATION_UPDATED, newGeo);
    },
    [geo, updateTimezoneLocale],
  );

  const refreshLocation = useCallback(() => {
    setGeo((prev) => ({ ...prev, isLoading: true }));

    if (!navigator.geolocation) {
      setGeo((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { "Accept-Language": "en" } },
          );
          const data = await res.json();
          const cc = data.address?.country_code?.toUpperCase();
          const config = cc ? WORLD_PAYMENT_CONFIGS[cc] : null;

          if (cc && config) {
            const newGeo: GeoState = {
              ...geo,
              countryCode: cc,
              countryName: config.countryName,
              currency: config.defaultCurrency,
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              city: data.address?.city || data.address?.town || null,
              address: data.display_name || null,
              isLoading: false,
              detectedAt: new Date().toISOString(),
            };
            setGeo(newGeo);
            updateTimezoneLocale(cc, config.defaultCurrency);

            localStorage.setItem(
              "fuelpro_location_country",
              JSON.stringify({
                currentCountry: cc,
                countryName: config.countryName,
                currency: config.defaultCurrency,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                city: newGeo.city,
                address: newGeo.address,
                detectedAt: newGeo.detectedAt,
              }),
            );

            getEventBus().emit(Events.LOCATION_UPDATED, newGeo);
          } else {
            setGeo((prev) => ({
              ...prev,
              isLoading: false,
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
            }));
          }
        } catch (err) {
          console.warn("[useGeo] Failed to fetch location details:", err);
          setGeo((prev) => ({
            ...prev,
            isLoading: false,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }));
        }
      },
      () => setGeo((prev) => ({ ...prev, isLoading: false })),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [geo, updateTimezoneLocale]);

  const getPaymentMethods = useCallback(() => {
    return getCountryPaymentMethods(geo.countryCode);
  }, [geo.countryCode]);

  const getTaxRate = useCallback(() => {
    const rates: Record<string, number> = {
      KE: 0.16,
      UG: 0.18,
      TZ: 0.18,
      NG: 0.075,
      ZA: 0.15,
      GH: 0.15,
      RW: 0.18,
      ET: 0.15,
    };
    return rates[geo.countryCode] || 0;
  }, [geo.countryCode]);

  return (
    <GeoContext.Provider
      value={{
        geo,
        setCountry,
        refreshLocation,
        getPaymentMethods,
        getTaxRate,
        isLocationReady: isReady,
      }}
    >
      {children}
    </GeoContext.Provider>
  );
}

export function useGeo() {
  return useContext(GeoContext);
}
