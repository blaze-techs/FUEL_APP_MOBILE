/**
 * useStationFuelTypes — authoritative station-scoped read API for the
 * station's configured fuel types and current operational prices.
 *
 * IMPORTANT: this module never substitutes regulator, regional, world-average,
 * device-locale, legacy-owner, or hard-coded prices for station data.
 * Missing station data is represented as missing data. This prevents a
 * plausible-looking number from being mistaken for an actual pump price.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  normalizeFuelType,
  getFuelLabel,
  isPlausibleStationPrice,
  type CanonicalFuelType,
} from "@/react-app/config/pricing";
import {
  onFuelPriceChange,
  onFuelTypeChange,
} from "@/react-app/lib/fuel-interlink-bus";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import type { CustomFuelType } from "@/react-app/components/FuelTypesManager";

const CLOUD_KEY = "fuel_types_config";

/**
 * Reject a configured price that cannot be right for the station's country.
 *
 * A station switched away from Kenya can still hold an EPRA figure (diesel
 * 217.86) in its config. Rendering that as "$217.86/L" is worse than showing
 * nothing, so an implausible value is reported as unknown rather than
 * substituted. The country lookup is memoised per station id (not globally) so
 * switching stations re-resolves it, and because `getPriceFor` runs during
 * render for every fuel row.
 */
const countryCodeCache = new Map<string, string>();
function stationCountryForValidation(stationId?: string): string {
  const cacheKey = stationId || "__detected__";
  const cached = countryCodeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let resolved = "";
  try {
    resolved = getDetectedCountryCode() || "";
  } catch {
    resolved = "";
  }
  countryCodeCache.set(cacheKey, resolved);
  return resolved;
}

function isUsableStationPrice(
  raw: string,
  price: number,
  stationId?: string,
): boolean {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return false;
  }
  const country = stationCountryForValidation(stationId);
  if (!country) return true;
  return isPlausibleStationPrice(price, country, raw);
}

export interface StationFuelTypesApi {
  /** The station's configured fuel types from the authoritative cloud row. */
  fuelTypes: CustomFuelType[];
  /** Only active station-configured fuel types. */
  activeFuelTypes: CustomFuelType[];
  /** True until the current station's authoritative row has been resolved. */
  loading: boolean;
  /** Force a fresh authoritative station-scoped fetch. */
  refresh: () => Promise<void>;
  /**
   * Resolve the operational per-litre price for a raw fuel name.
   * Returns null when the station has no valid configured price.
   */
  getPriceFor: (raw: string) => number | null;
  /** Find the station's configured fuel-type entry for a raw name. */
  findFuelType: (raw: string) => CustomFuelType | undefined;
  /** Resolve the canonical key for a raw name. */
  canonicalOf: (raw: string) => CanonicalFuelType | null;
  /** Uniform display label for a raw name. */
  labelOf: (raw: string) => string;
}

/**
 * The second parameter is retained only for source compatibility with older
 * callers. It is deliberately ignored: operational station prices MUST NOT
 * fall back to static/regulator/market data.
 */
export function useStationFuelTypes(
  stationId?: string,
  _legacyFallbackToStatic = false,
): StationFuelTypesApi {
  const [fuelTypes, setFuelTypes] = useState<CustomFuelType[]>([]);
  const [loading, setLoading] = useState(true);
  const fuelTypesRef = useRef<CustomFuelType[]>([]);
  fuelTypesRef.current = fuelTypes;

  const load = useCallback(async () => {
    setLoading(true);

    // No station = no station data. Never use an owner/global row as a
    // substitute because that can leak another station's prices.
    if (!stationId) {
      setFuelTypes([]);
      setLoading(false);
      return;
    }

    try {
      const data = await cloudStorageService.getStationAuthoritative<
        CustomFuelType[]
      >(CLOUD_KEY, stationId);

      // A missing row is a real "not configured/unknown" state, not an
      // invitation to substitute a global/default price.
      setFuelTypes(data && Array.isArray(data) ? data : []);
    } catch (error) {
      // On read failure, expose an empty authoritative result rather than
      // leaving stale prices on screen or silently switching to another source.
      console.warn(
        "[useStationFuelTypes] authoritative station read failed:",
        error,
      );
      setFuelTypes([]);
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    // Clear the previous station immediately so prices cannot cross a logout
    // or station switch while the new authoritative row is loading.
    setFuelTypes([]);
    setLoading(true);
    void load();

    if (!stationId) {
      return;
    }

    const unsub = cloudStorageService.subscribe<CustomFuelType[]>(
      CLOUD_KEY,
      stationId,
      (val) => {
        // Null means the authoritative row was deleted/removed.
        setFuelTypes(val && Array.isArray(val) ? val : []);
      },
    );

    const unsubBus = onFuelPriceChange((p) => {
      const list = fuelTypesRef.current;
      if (!list.length) return;
      const canonical = p.canonical ?? normalizeFuelType(p.fuelType);
      if (
        !canonical ||
        typeof p.price !== "number" ||
        !Number.isFinite(p.price)
      ) {
        return;
      }
      const idx = list.findIndex(
        (ft) => normalizeFuelType(ft.name) === canonical,
      );
      if (idx >= 0 && list[idx].price !== p.price) {
        const next = list.slice();
        next[idx] = { ...next[idx], price: p.price };
        setFuelTypes(next);
      }
    });

    const unsubTypeBus = onFuelTypeChange(() => {
      void load();
    });

    return () => {
      unsub?.();
      unsubBus();
      unsubTypeBus();
    };
  }, [stationId, load]);

  const findFuelType = useCallback(
    (raw: string): CustomFuelType | undefined => {
      const canonical = normalizeFuelType(raw);
      if (!canonical) return undefined;
      return fuelTypes.find((ft) => normalizeFuelType(ft.name) === canonical);
    },
    [fuelTypes],
  );

  const getPriceFor = useCallback(
    (raw: string): number | null => {
      if (!raw || !raw.trim()) return null;

      const entry = findFuelType(raw);
      if (
        entry &&
        typeof entry.price === "number" &&
        Number.isFinite(entry.price) &&
        entry.price > 0 &&
        isUsableStationPrice(raw, entry.price, stationId)
      ) {
        return entry.price;
      }

      // No configured station price is an unknown value. Do not manufacture
      // one from EPRA, world averages, location, currency, or a legacy cache.
      // A price that is implausible for the station's country is treated the
      // same way: unknown, never silently replaced.
      return null;
    },
    [findFuelType, stationId],
  );

  const canonicalOf = useCallback((raw: string) => normalizeFuelType(raw), []);
  const labelOf = useCallback((raw: string) => getFuelLabel(raw), []);
  const activeFuelTypes = fuelTypes.filter((ft) => ft.active);

  return {
    fuelTypes,
    activeFuelTypes,
    loading,
    refresh: load,
    getPriceFor,
    findFuelType,
    canonicalOf,
    labelOf,
  };
}
