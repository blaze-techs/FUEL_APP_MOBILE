/**
 * FuelTracker — hyper-local fuel price widget.
 *
 * Acquires the user's GPS, calls /api/fuel-local (the serverless fuel-engine),
 * and renders the parsed petrol/diesel/kerosene prices for the user's actual
 * village/town. When the engine fell back to a nearest-neighbour match it
 * shows an "Approximate (nearest town)" badge so the user knows the source.
 *
 * Also exposes a manual "refresh" button that re-acquires GPS and refetches,
 * and a graceful fallback to the app's existing useFuelPrices hook when GPS
 * permission is denied or the engine has no data for the region.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { MapPin, RefreshCw, Navigation, AlertTriangle } from "lucide-react";
import { useFuelPrices } from "@/react-app/hooks/useFuelPrices";
import { CANONICAL_FUEL_TYPES } from "@/react-app/config/pricing";
import { useFuel } from "@/react-app/context/FuelContext";

interface LocalFuelResponse {
  success: boolean;
  location?: string;
  country?: string;
  country_code?: string;
  lat?: number;
  lon?: number;
  prices?: {
    super_petrol?: number | null;
    diesel?: number | null;
    kerosene?: number | null;
  };
  currency?: string;
  source?: string;
  last_updated?: string;
  is_approximate?: boolean;
  nearest_town?: string;
  distance_km?: number;
  no_real_data?: boolean;
  error?: string;
}

type Status = "idle" | "locating" | "fetching" | "ready" | "error";

export default function FuelTracker() {
  const [data, setData] = useState<LocalFuelResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Existing app-wide price hook as a fallback display source.
  const fallback = useFuelPrices();

  const fetchPrices = useCallback(async () => {
    if (inFlight.current) return;
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser.");
      setStatus("error");
      return;
    }
    inFlight.current = true;
    setStatus("locating");
    setError(null);

    let pos: GeolocationPosition | null = null;
    try {
      pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        });
      });
    } catch (e) {
      const geoErr = e as GeolocationPositionError;
      setError(
        geoErr.code === geoErr.PERMISSION_DENIED
          ? "Location permission denied. Enable GPS to see local prices."
          : "Could not determine your location.",
      );
      setStatus("error");
      inFlight.current = false;
      return;
    }

    if (!pos) {
      inFlight.current = false;
      return;
    }

    try {
      setStatus("fetching");
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `/api/fuel-local?lat=${latitude}&lon=${longitude}`,
      );
      const json: LocalFuelResponse = await res.json();
      if (!res.ok || !json.success || !json.prices) {
        throw new Error(json.error || "No fuel data for this region yet.");
      }
      setData(json);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Auto-fetch on mount.
  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  const isLoading = status === "locating" || status === "fetching";

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 p-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Navigation className="w-5 h-5" /> Auto Fuel Prices
              </h2>
              <p className="text-sm text-orange-100 mt-0.5">
                Hyper-local, GPS-detected pump prices
              </p>
            </div>
            <button
              onClick={fetchPrices}
              disabled={isLoading}
              className="p-2 rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-50 transition"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5">
          {isLoading && (
            <div className="py-10 text-center text-gray-500">
              <MapPin className="w-8 h-8 mx-auto mb-2 animate-pulse text-orange-400" />
              {status === "locating"
                ? "Acquiring GPS location…"
                : "Fetching local fuel prices…"}
            </div>
          )}

          {!isLoading && status === "ready" && data && (
            <ReadyView data={data} />
          )}

          {!isLoading && status === "error" && (
            <ErrorView
              message={error}
              onRetry={fetchPrices}
              fallback={fallback}
            />
          )}

          {!isLoading && status === "idle" && (
            <div className="py-10 text-center text-gray-400">
              Press refresh to detect local prices.
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="mt-4 text-xs text-gray-500 bg-gray-50 rounded-lg p-4">
        <p className="font-medium text-gray-600 mb-1">How it works</p>
        <p>
          Your GPS is reverse-geocoded to the nearest village/town. The server
          searches for official local fuel prices, an AI extracts the numbers,
          and the result is cached in a PostGIS spatial index. When a remote
          village has no direct data, the nearest town's price (within 50 km) is
          shown with an “Approximate” badge. Prices refresh automatically on the
          1st of every month.
        </p>
      </div>
    </div>
  );
}

function ReadyView({ data }: { data: LocalFuelResponse }) {
  const prices = data.prices || {};
  const currency = data.currency || "";
  const isApprox = data.is_approximate;
  const { syncPriceToFuelTypes } = useFuel();
  const [appliedLabel, setAppliedLabel] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-orange-500" />
          <div>
            <div className="font-bold text-gray-800 text-lg">
              {data.location}
            </div>
            <div className="text-xs text-gray-500">{data.country}</div>
          </div>
        </div>
        {isApprox && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full font-medium flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Approx. · {data.nearest_town}
            {data.distance_km != null
              ? ` (${data.distance_km.toFixed(0)} km)`
              : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PriceCard
          label={CANONICAL_FUEL_TYPES.petrol.label}
          value={prices.super_petrol}
          currency={currency}
          color="from-green-500 to-emerald-600"
          onSet={
            prices.super_petrol != null
              ? () => {
                  syncPriceToFuelTypes(
                    CANONICAL_FUEL_TYPES.petrol.label,
                    prices.super_petrol as number,
                  );
                  setAppliedLabel(CANONICAL_FUEL_TYPES.petrol.label);
                  setTimeout(() => setAppliedLabel(null), 2000);
                }
              : undefined
          }
          applied={appliedLabel === CANONICAL_FUEL_TYPES.petrol.label}
        />
        <PriceCard
          label={CANONICAL_FUEL_TYPES.diesel.label}
          value={prices.diesel}
          currency={currency}
          color="from-blue-500 to-indigo-600"
          onSet={
            prices.diesel != null
              ? () => {
                  syncPriceToFuelTypes(
                    CANONICAL_FUEL_TYPES.diesel.label,
                    prices.diesel as number,
                  );
                  setAppliedLabel(CANONICAL_FUEL_TYPES.diesel.label);
                  setTimeout(() => setAppliedLabel(null), 2000);
                }
              : undefined
          }
          applied={appliedLabel === CANONICAL_FUEL_TYPES.diesel.label}
        />
        <PriceCard
          label={CANONICAL_FUEL_TYPES.kerosene.label}
          value={prices.kerosene}
          currency={currency}
          color="from-amber-500 to-orange-600"
          onSet={
            prices.kerosene != null
              ? () => {
                  syncPriceToFuelTypes(
                    CANONICAL_FUEL_TYPES.kerosene.label,
                    prices.kerosene as number,
                  );
                  setAppliedLabel(CANONICAL_FUEL_TYPES.kerosene.label);
                  setTimeout(() => setAppliedLabel(null), 2000);
                }
              : undefined
          }
          applied={appliedLabel === CANONICAL_FUEL_TYPES.kerosene.label}
        />
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
        <span>Source: {data.source}</span>
        {data.last_updated && (
          <span>
            Updated: {new Date(data.last_updated).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

function PriceCard({
  label,
  value,
  currency,
  color,
  onSet,
  applied,
}: {
  label: string;
  value?: number | null;
  currency: string;
  color: string;
  onSet?: () => void;
  applied?: boolean;
}) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-xl p-4 text-white`}>
      <div className="text-xs uppercase tracking-wide opacity-90">{label}</div>
      <div className="text-2xl font-bold mt-1">
        {value != null ? value.toFixed(2) : "N/A"}
      </div>
      <div className="text-xs opacity-90 mt-0.5">
        {currency}
        {value != null ? " / litre" : ""}
      </div>
      {onSet && (
        <button
          onClick={onSet}
          className="mt-2 text-[10px] px-2 py-1 rounded-lg bg-white/20 hover:bg-white/40 transition-colors"
          title={`Set ${label} market price as my station price`}
        >
          {applied ? "✓ Applied" : "Set as my price"}
        </button>
      )}
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
  fallback,
}: {
  message: string | null;
  onRetry: () => void;
  fallback: ReturnType<typeof useFuelPrices>;
}) {
  return (
    <div>
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm mb-4 flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't load local prices</div>
          <div className="text-red-600 text-xs mt-1">{message}</div>
        </div>
      </div>

      <button
        onClick={onRetry}
        className="mb-4 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition"
      >
        Try again
      </button>

      {/* Fallback to the app's existing detected prices. */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="text-xs text-gray-500 mb-2">
          Showing regional fallback prices for{" "}
          <span className="font-medium">{fallback.location}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex justify-between bg-white rounded-lg p-3">
            <span className="text-gray-600 text-sm">Petrol</span>
            <span className="font-bold text-gray-900">
              {fallback.formattedPrices.petrol}
            </span>
          </div>
          <div className="flex justify-between bg-white rounded-lg p-3">
            <span className="text-gray-600 text-sm">Diesel</span>
            <span className="font-bold text-gray-900">
              {fallback.formattedPrices.diesel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
