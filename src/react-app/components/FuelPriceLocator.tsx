import { useState, useCallback, useEffect, useRef } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useFuelPrices } from "@/react-app/hooks/useFuelPrices";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  CANONICAL_FUEL_TYPES,
} from "@/react-app/config/pricing";
import {
  MapPin,
  Navigation,
  Fuel,
  Gauge,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Droplet,
  LayoutDashboard,
  Settings,
  ClipboardList,
} from "lucide-react";
import {
  getCurrencySymbol,
  isKenyaStation,
  getDetectedCountryCode,
} from "../lib/currency";
import { getCountryById } from "@/react-app/config/countries";
import SubTabBar from "@/react-app/components/SubTabBar";
import FuelTracker from "@/react-app/components/FuelTracker";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

// ── API base URL ──
// Cloudflare Pages does NOT serve /api/* endpoints — only Vercel does.
// When the frontend is hosted on Cloudflare (or any non-Vercel origin), we
// must call the Vercel API directly with the absolute URL. On Vercel, we
// use a relative path so it stays same-origin (no CORS issues).
const VERCEL_API_ORIGIN = "https://fuel-app-mobile.vercel.app";
function fuelApiBase(): string {
  if (typeof window === "undefined") return VERCEL_API_ORIGIN;
  const host = window.location.hostname;
  // Same-origin on Vercel → relative path (avoids CORS + extra latency)
  if (host.includes("vercel.app")) return "";
  // Cloudflare Pages, local dev, or any other origin → absolute Vercel URL
  return VERCEL_API_ORIGIN;
}

// ── Types ──

interface NearbyPriceResult {
  success: boolean;
  mode?: string;
  timestamp?: string;
  coordinates?: { latitude: string; longitude: string };
  locationName?: string;
  location?: string;
  country?: string;
  country_code?: string;
  countryCode?: string;
  stationName?: string;
  currency?: string;
  currencySymbol?: string;
  unit?: string;
  prices?: {
    gasoline?: string | number;
    petrol?: string | number;
    super_petrol?: string | number;
    diesel?: string | number;
    premium?: string | number;
    kerosene?: string | number;
  };
  kerosenePrice?: number | null;
  source?: string;
  distance_km?: number;
  last_updated?: string;
  is_approximate?: boolean;
  no_real_data?: boolean;
  error?: string;
}

interface StationPriceInfo {
  stationName: string;
  gasoline: number | null;
  diesel: number | null;
  premium: number | null;
  kerosene: number | null;
  currency: string;
  currencySymbol: string;
  unit: string;
  source: string;
  location?: string;
}

const CLOUD_CACHE_KEY = "fuel_price_locator_cache";
const CACHE_TTL_MS = 3600_000; // 1 hour

// ── Component ──

export default function FuelPriceLocator() {
  const { user } = useAuth();
  const {
    preciseLocation,
    preciseLocationLoading,
    detectPreciseLocation,
    currentCountry,
  } = useLocation();
  const { stations, currentStation } = useStations();
  const { syncPriceToFuelTypes } = useFuel();
  const {
    prices: unifiedPrices,
    refreshPrices,
    source: unifiedSource,
    cityName,
  } = useFuelPrices();

  // Component-scoped station currency so render helpers + JSX can resolve the
  // correct symbol without depending on the fetchNearbyPrices closure.
  const stationCurrency =
    (
      currentStation as
        { companyCurrency?: string; currency?: string } | undefined
    )?.companyCurrency ||
    (currentStation as { currency?: string } | undefined)?.currency;

  const [loading, setLoading] = useState(false);
  const [appliedLabel, setAppliedLabel] = useState<string | null>(null);
  const [nearbyResult, setNearbyResult] = useState<StationPriceInfo | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const echoSkipRef = useRef(false);
  // Inner sub-tab: "Price Finder" (this component) vs "Auto Fuel Price"
  // (the formerly-standalone FuelTracker GPS engine, now hosted here).
  const [activeView, setActiveView] = useState<"finder" | "auto">("finder");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("price-finder", setActiveView);

  const countryProfile = getCountryById(getDetectedCountryCode());
  const regulatorFullName =
    countryProfile?.fuelRegulations?.priceSettingBody ?? "Fuel Price Regulator";
  const regulatorShortName = isKenyaStation() ? "EPRA" : "Regulator";

  // Load cached result from cloud on mount
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const cached = await cloudStorageService.get<{
        data: StationPriceInfo;
        ts: number;
      } | null>(CLOUD_CACHE_KEY);
      if (!cancelled && cached?.data) {
        const age = Date.now() - (cached.ts || 0);
        if (age < CACHE_TTL_MS) {
          setNearbyResult(cached.data);
          setLastFetchAt(new Date(cached.ts).toISOString());
        }
      }
    })();

    // Subscribe to real-time cache updates from other devices
    const unsub = cloudStorageService.subscribe<{
      data: StationPriceInfo;
      ts: number;
    } | null>(CLOUD_CACHE_KEY, undefined, (val) => {
      if (echoSkipRef.current) {
        echoSkipRef.current = false;
        return;
      }
      if (val?.data) {
        setNearbyResult(val.data);
        setLastFetchAt(new Date(val.ts).toISOString());
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  // Auto-detect location on first mount if not already available.
  // Guarded by a ref to prevent re-detect storms: preciseLocation is a new
  // object every set, so depending on it caused the effect to re-fire
  // repeatedly (the "location logo keeps appearing" + refresh-loop bug).
  const hasDetectedRef = useRef(false);
  useEffect(() => {
    if (hasDetectedRef.current) return;
    if (!preciseLocation && !preciseLocationLoading && user) {
      hasDetectedRef.current = true;
      detectPreciseLocation().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, preciseLocationLoading]);

  const saveToCloud = useCallback(
    (data: StationPriceInfo) => {
      if (!user) return;
      echoSkipRef.current = true;
      cloudStorageService
        .set(CLOUD_CACHE_KEY, { data, ts: Date.now() })
        .catch(() => {});
    },
    [user],
  );

  /**
   * Fetch nearby fuel prices from the serverless API using GPS coordinates.
   * If the live API is unavailable or returns no verified data, the result is
   * explicitly unknown. Static/regulator/reference prices are never substituted.
   */
  const fetchNearbyPrices = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    // Use precise GPS if available, otherwise prompt for it
    const lat = preciseLocation?.lat;
    const lng = preciseLocation?.lng;

    if (!lat || !lng) {
      try {
        await detectPreciseLocation();
      } catch {
        // detectPreciseLocation handles its own errors; fall through
      }
      // State updates are asynchronous; do not substitute unrelated/static
      // prices in this cycle.
    }

    // Try the serverless API with coordinates.
    // Use /api/fuel-local (the deterministic EPRA engine deployed on Vercel)
    // which returns hyper-local prices for the exact GPS location.
    const locName =
      preciseLocation?.city || preciseLocation?.address || cityName || "";
    if (lat && lng) {
      try {
        const apiBase = fuelApiBase();
        const apiPath = `/api/fuel-local?lat=${lat}&lon=${lng}&cb=${Date.now()}`;
        let response: Response | null = null;

        if (apiBase) {
          // Cross-origin (Cloudflare → Vercel): the deployed Vercel API may
          // not have CORS headers yet. Try direct first, then fall back to a
          // CORS proxy if the browser blocks the cross-origin response.
          try {
            response = await fetch(`${apiBase}${apiPath}`);
          } catch {
            // Network/CORS error — try via CORS proxy
          }
          if (!response || !response.ok) {
            try {
              const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(`${apiBase}${apiPath}`)}`;
              response = await fetch(proxied);
            } catch {
              // Proxy also failed — verified live data is unavailable.
            }
          }
        } else {
          // Same-origin on Vercel — direct fetch, no CORS issues
          response = await fetch(apiPath);
        }

        if (response && response.ok) {
          const data: NearbyPriceResult = await response.json();
          // no_real_data = the engine found NO real price for this exact
          // location (no EPRA match, AI extraction rejected as implausible,
          // no nearby cached real price). Show "N/A" — do NOT fall back to
          // a client-side estimate, which would violate the "real prices
          // only" requirement.
          if (data.no_real_data) {
            // Resolve the currency symbol for the user's country so we never
            // show "KSh" to a US/Germany/India user with no published price.
            const result: StationPriceInfo = {
              stationName:
                data.locationName ||
                data.location ||
                locName ||
                "Your Location",
              gasoline: null,
              diesel: null,
              premium: null,
              kerosene: null,
              currency:
                data.currency ||
                currentCountry?.currency?.code ||
                stationCurrency ||
                "",
              currencySymbol:
                data.currencySymbol ||
                currentCountry?.currency?.symbol ||
                (stationCurrency ? getCurrencySymbol(stationCurrency) : ""),
              unit: "litre",
              source: "No published price",
              location: data.locationName || data.location || locName || "",
            };
            setNearbyResult(result);
            setLastFetchAt(new Date().toISOString());
            setLoading(false);
            return;
          }
          if (data.success && data.prices) {
            // /api/fuel-local returns super_petrol/diesel/kerosene as numbers.
            const toNum = (v: string | number | undefined): number | null => {
              if (v === undefined || v === null) return null;
              const n = typeof v === "number" ? v : parseFloat(v);
              return isNaN(n) ? null : n;
            };

            const result: StationPriceInfo = {
              stationName:
                data.stationName ||
                data.locationName ||
                data.location ||
                "Nearby Station",
              gasoline: toNum(
                data.prices.petrol ??
                  data.prices.super_petrol ??
                  data.prices.gasoline,
              ),
              diesel: toNum(data.prices.diesel),
              premium: toNum(data.prices.premium),
              kerosene:
                toNum(data.prices.kerosene) ?? data.kerosenePrice ?? null,
              currency: data.currency || getCurrencySymbol(stationCurrency),
              currencySymbol:
                data.currencySymbol || getCurrencySymbol(stationCurrency),
              unit: data.unit || "litre",
              source: data.source || "Live API",
              location:
                data.distance_km != null && data.distance_km !== undefined
                  ? `${data.locationName || locName} (${(data.distance_km ?? 0).toFixed(1)} km away)`
                  : data.locationName ||
                    data.location ||
                    locName ||
                    `${(lat ?? 0).toFixed(4)}, ${(lng ?? 0).toFixed(4)}`,
            };
            setNearbyResult(result);
            setLastFetchAt(new Date().toISOString());
            saveToCloud(result);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Network/CORS error — verified live data is unavailable.
      }
    }

    // No live/verified nearby price was returned. Do NOT substitute a
    // regulator baseline, regional average, world estimate, cached default, or
    // another station's price. The correct value is "unknown".
    const result: StationPriceInfo = {
      stationName: locName || "Your Location",
      gasoline: null,
      diesel: null,
      premium: null,
      kerosene: null,
      currency:
        currentCountry?.currency?.code ||
        stationCurrency ||
        "",
      currencySymbol:
        currentCountry?.currency?.symbol ||
        (stationCurrency ? getCurrencySymbol(stationCurrency) : ""),
      unit: "litre",
      source: "No verified live price data",
      location: locName || "",
    };

    setNearbyResult(result);
    setLastFetchAt(new Date().toISOString());
    setErrorMessage("No verified live fuel price data is available for this location.");
    setLoading(false);
