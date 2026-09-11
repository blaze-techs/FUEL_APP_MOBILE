import { useState, useCallback, useEffect, useRef } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useFuelPrices } from "@/react-app/hooks/useFuelPrices";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  getClosestKenyaCityPrice,
  CANONICAL_FUEL_TYPES,
  getWorldFuelPrices,
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
   * Falls back to the unified pricing system (location-aware static prices)
   * if the API is unavailable or returns no data.
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
      // Re-read from context after detection — but since state updates are
      // async, we'll use the unified prices as fallback in this cycle
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
              // Proxy also failed — fall through to offline fallback
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
            const cc = (data.country_code || "").toUpperCase();
            const worldPrice = getWorldFuelPrices()[cc];
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
              currency: data.currency || worldPrice?.currency || "USD",
              currencySymbol:
                data.currencySymbol || worldPrice?.currencySymbol || "$",
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
        // Network error — fall through to unified pricing
      }
    }

    // Fallback: use the unified pricing system (location-aware static prices)
    // This integrates with the existing LocationContext + pricing.ts config.
    // Only reached when the Vercel API is unreachable (e.g. offline).
    const countryCode =
      currentCountry?.id || (currentStation as any)?.country || "US";
    const currency = currentCountry?.currency?.code || stationCurrency || "USD";
    const symbol =
      currentCountry?.currency?.symbol ||
      getCurrencySymbol(stationCurrency) ||
      "$";

    let petrol = unifiedPrices.petrol;
    let diesel = unifiedPrices.diesel;
    let kerosene = unifiedPrices.kerosene;
    // Use the GPS-detected town name (not the closest pricing-table city) so
    // the UI shows the user's actual location, not "Nairobi" as a fallback.
    const gpsTownName = locName || cityName || "Your Location";
    let stationName = gpsTownName;
    let location = gpsTownName;

    // If in Kenya with GPS, use city-specific prices with transport surcharge
    if (countryCode === "KE" && lat && lng) {
      const cityPrice = getClosestKenyaCityPrice(lat, lng);
      petrol = cityPrice.petrolPrice;
      diesel = cityPrice.dieselPrice;
      kerosene = cityPrice.kerosenePrice;
      stationName = gpsTownName;
      location = gpsTownName;
    }
    // For unknown countries NOT in REGIONAL_PRICES, keep unifiedPrices (already
    // country-aware from useFuelPrices). Do NOT force Kenya KSh prices on a
    // US/EU station — that was the old broken behaviour.

    const result: StationPriceInfo = {
      stationName,
      gasoline: petrol,
      diesel,
      premium: unifiedPrices.vPower ?? null,
      kerosene,
      currency,
      currencySymbol: symbol,
      unit: "litre",
      source: preciseLocation
        ? `${regulatorShortName} Estimate (offline)`
        : unifiedSource,
      location,
    };

    setNearbyResult(result);
    setLastFetchAt(new Date().toISOString());
    saveToCloud(result);
    setLoading(false);
  }, [
    preciseLocation,
    detectPreciseLocation,
    currentCountry,
    currentStation,
    stationCurrency,
    regulatorShortName,
    unifiedPrices,
    unifiedSource,
    cityName,
    saveToCloud,
  ]);

  // ── Render helpers ──

  // EPRA-style cost breakdown: landed cost ~48%, taxes ~32%, margins ~12%,
  // with the remainder (~8%) accounting for freight and other levies. These
  // ratios approximate the official EPRA price build-up for Kenya.
  const costBreakdown = (pumpPrice: number | null) => {
    if (pumpPrice === null || isNaN(pumpPrice)) return null;
    return {
      landed: pumpPrice * 0.48,
      taxes: pumpPrice * 0.32,
      margins: pumpPrice * 0.12,
    };
  };

  const priceCard = (
    label: string,
    val: number | null,
    icon: React.ReactNode,
    colorClass: string,
  ) => {
    const symbol =
      nearbyResult?.currencySymbol || getCurrencySymbol(stationCurrency);
    return (
      <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors">
        <div className="flex items-center gap-2 mb-1">
          <span className={colorClass}>{icon}</span>
          <span className="text-xs text-slate-400 uppercase font-semibold">
            {label}
          </span>
        </div>
        {val !== null ? (
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              {symbol}{" "}
              {val.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-xs text-slate-500">per litre</div>
            <button
              onClick={() => {
                syncPriceToFuelTypes(label, val);
                setAppliedLabel(label);
                setTimeout(() => setAppliedLabel(null), 2000);
              }}
              className="mt-2 text-[10px] px-2 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 transition-colors"
              title={`Set ${label} market price as my station price`}
            >
              {appliedLabel === label ? "✓ Applied" : "Set as my price"}
            </button>
          </div>
        ) : (
          <span className="text-lg font-bold text-slate-600">N/A</span>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-600/20 rounded-xl">
          <Navigation className="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Fuel Price Finder
          </h2>
          <p className="text-sm text-slate-400">
            Find real-time fuel prices near your location using GPS coordinates
          </p>
        </div>
      </div>

      {/* Cross-tab interlinks — quick navigation to related tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => switchToTab("dashboard")}
          className="bg-slate-800/60 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-700"
        >
          <LayoutDashboard size={14} />
          Dashboard
        </button>
        <button
          onClick={() => switchToTab("fueltypes")}
          className="bg-slate-800/60 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-700"
        >
          <Settings size={14} />
          Edit Fuel Prices
        </button>
        <button
          onClick={() => switchToTab("sales")}
          className="bg-slate-800/60 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-700"
        >
          <ClipboardList size={14} />
          Sales Tracking
        </button>
      </div>

      {/* Sub-tab switcher: Price Finder vs Auto Fuel Price engine */}
      <SubTabBar
        tabs={[
          { id: "finder", label: "Price Finder", icon: Navigation },
          { id: "auto", label: "Auto Fuel Price", icon: Gauge },
        ]}
        active={activeView}
        onChange={(id) => setActiveView(id as "finder" | "auto")}
      />

      {activeView === "auto" ? (
        <FuelTracker />
      ) : (
        <>
          {/* Location status bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800/30 rounded-xl border border-slate-700/50">
            <div className="flex items-center gap-2 text-sm">
              <MapPin
                className={`w-4 h-4 ${preciseLocation ? "text-emerald-400" : "text-slate-500"}`}
              />
              {preciseLocationLoading ? (
                <span className="text-amber-400">Detecting location...</span>
              ) : preciseLocation ? (
                <span className="text-slate-300">
                  {preciseLocation.city || preciseLocation.address} (
                  {preciseLocation.lat.toFixed(4)},{" "}
                  {preciseLocation.lng.toFixed(4)})
                </span>
              ) : (
                <span className="text-slate-500">Location not detected</span>
              )}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => detectPreciseLocation()}
              disabled={preciseLocationLoading}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Update Location
            </button>
          </div>

          {/* Action button */}
          <button
            onClick={fetchNearbyPrices}
            disabled={loading || preciseLocationLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white py-3.5 px-4 rounded-xl font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2 fp-icon-only"
            title="Fuel"
            aria-label="Fuel"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Finding Nearby Prices...
              </>
            ) : (
              <>
                <Fuel className="w-5 h-5" />
                Scan Local Fuel Rates
              </>
            )}
          </button>

          {/* Error message */}
          {errorMessage && (
            <div className="p-3 bg-red-950/50 border border-red-800 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <span className="text-xs text-red-400">{errorMessage}</span>
            </div>
          )}

          {/* Results */}
          {nearbyResult && (
            <div className="space-y-4">
              {/* EPRA-style header */}
              <div className="p-4 bg-gradient-to-r from-orange-600/20 to-red-600/20 rounded-xl border border-orange-700/40">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Fuel className="w-5 h-5 text-orange-400" />
                  Current Pump Prices
                </h3>
                <p className="text-sm text-orange-200 mt-0.5">
                  {regulatorFullName}
                </p>
                {preciseLocation && (
                  <div className="mt-2 space-y-0.5">
                    <p className="text-xs text-slate-300 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-orange-400" />
                      📍 {preciseLocation.lat.toFixed(4)},{" "}
                      {preciseLocation.lng.toFixed(4)}
                    </p>
                    <p className="text-xs text-slate-300 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-orange-400" />
                      📍 GPS: {nearbyResult.stationName}
                    </p>
                  </div>
                )}
              </div>

              {/* Price grid — EPRA format: SUPER PETROL / DIESEL / KEROSENE */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {priceCard(
                  "Super Petrol",
                  nearbyResult.gasoline,
                  <Fuel className="w-4 h-4" />,
                  "text-emerald-400",
                )}
                {priceCard(
                  "Diesel",
                  nearbyResult.diesel,
                  <Droplet className="w-4 h-4" />,
                  "text-amber-400",
                )}
                {priceCard(
                  "Kerosene",
                  nearbyResult.kerosene,
                  <Gauge className="w-4 h-4" />,
                  "text-blue-400",
                )}
              </div>

              {/* EPRA cost breakdown */}
              {(() => {
                const breakdown = costBreakdown(nearbyResult.gasoline);
                if (!breakdown) return null;
                const symbol =
                  nearbyResult?.currencySymbol ||
                  getCurrencySymbol(stationCurrency);
                const fmt = (n: number) =>
                  `${symbol} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return (
                  <div className="p-4 bg-slate-800/40 rounded-xl border border-slate-700/50">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-xs text-slate-500 uppercase font-semibold mb-1">
                          Landed Cost
                        </div>
                        <div className="text-sm font-medium text-slate-200">
                          {fmt(breakdown.landed)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 uppercase font-semibold mb-1">
                          Taxes
                        </div>
                        <div className="text-sm font-medium text-slate-200">
                          {fmt(breakdown.taxes)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 uppercase font-semibold mb-1">
                          Margins
                        </div>
                        <div className="text-sm font-medium text-slate-200">
                          {fmt(breakdown.margins)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Source + timestamp */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Source: {nearbyResult.source} (FuelPro)
                </div>
                {lastFetchAt && (
                  <div className="text-xs text-slate-500">
                    {new Date(lastFetchAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Your stations comparison */}
          {stations.length > 0 && (
            <div className="pt-4 border-t border-slate-800">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Fuel className="w-4 h-4 text-blue-400" />
                Your Station Prices
              </h3>
              <div className="space-y-2">
                {stations.slice(0, 5).map((station) => {
                  const stationPetrol =
                    station.data?.pmsPrice || station.data?.petrolPrice;
                  const stationDiesel =
                    station.data?.agoPrice || station.data?.dieselPrice;
                  return (
                    <div
                      key={station.id}
                      className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-700/30"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {station.name}
                        </p>
                        {station.location && (
                          <p className="text-xs text-slate-500">
                            {station.location}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-4 text-xs">
                        {stationPetrol && (
                          <div className="text-right">
                            <span className="block text-slate-500">
                              {CANONICAL_FUEL_TYPES.petrol.label}
                            </span>
                            <span className="font-medium text-emerald-400">
                              {unifiedPrices.currencySymbol ||
                                getCurrencySymbol(stationCurrency)}{" "}
                              {stationPetrol.toLocaleString()}
                            </span>
                          </div>
                        )}
                        {stationDiesel && (
                          <div className="text-right">
                            <span className="block text-slate-500">
                              {CANONICAL_FUEL_TYPES.diesel.label}
                            </span>
                            <span className="font-medium text-amber-400">
                              {unifiedPrices.currencySymbol ||
                                getCurrencySymbol(stationCurrency)}{" "}
                              {stationDiesel.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unified prices refresh */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Unified prices from:{" "}
              <span className="text-slate-400">{unifiedSource}</span>
              {cityName && (
                <span className="text-slate-400"> ({cityName})</span>
              )}
            </div>
            <button
              onClick={refreshPrices}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh Prices
            </button>
          </div>
        </>
      )}
    </div>
  );
}
