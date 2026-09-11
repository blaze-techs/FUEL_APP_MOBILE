/**
 * useStationFuelTypes — the unified read API for "this station's fuel types
 * and their current prices".
 *
 * It is backed by the EXISTING `fuel_types_config` cloud key (edited by
 * FuelTypesManager, which remains the source of truth / editor). The hook
 * loads it on mount, subscribes to real-time cloud updates, and also listens
 * to the in-device fuel-interlink bus so edits in other tabs reflect
 * instantly.
 *
 * Consumers use this instead of each maintaining their own disconnected
 * price/fuel-type state, so a price change in FuelTypesManager (or a "Set as
 * my price" action from FuelPriceLocator/FuelTracker) propagates to
 * Dashboard, PriceBoard, POS, Invoice, Reports, etc. automatically.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  normalizeFuelType,
  getBasePrice,
  getFuelLabel,
  type CanonicalFuelType,
} from "@/react-app/config/pricing";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import {
  onFuelPriceChange,
  onFuelTypeChange,
} from "@/react-app/lib/fuel-interlink-bus";
import type { CustomFuelType } from "@/react-app/components/FuelTypesManager";

const CLOUD_KEY = "fuel_types_config";

export interface StationFuelTypesApi {
  /** The station's configured fuel types (from fuel_types_config). */
  fuelTypes: CustomFuelType[];
  /** Only active fuel types (for dropdowns / quick-sale). */
  activeFuelTypes: CustomFuelType[];
  /** Loading indicator for the initial cloud fetch. */
  loading: boolean;
  /** Force a fresh fetch from cloud. */
  refresh: () => Promise<void>;
  /**
   * Resolve the per-litre price for a raw fuel name. Tries the station's
   * configured fuel_types_config entry first (matched via canonical
   * normalization so "Petrol", "PMS", "Super Petrol" all hit the same row),
   * then falls back to the static pricing.ts baseline. Returns null only if
   * neither has a price.
   */
  getPriceFor: (raw: string) => number | null;
  /** Find the station's configured fuel-type entry for a raw name. */
  findFuelType: (raw: string) => CustomFuelType | undefined;
  /** Resolve the canonical key for a raw name (convenience). */
  canonicalOf: (raw: string) => CanonicalFuelType | null;
  /** Uniform display label for a raw name (convenience). */
  labelOf: (raw: string) => string;
}

/**
 * @param stationId optional station scope (passed to cloudStorageService).
 * @param fallbackToStatic whether to fall back to pricing.ts baseline when the
 *   station has no configured entry for a fuel. Default true.
 */
export function useStationFuelTypes(
  stationId?: string,
  fallbackToStatic = true,
): StationFuelTypesApi {
  const [fuelTypes, setFuelTypes] = useState<CustomFuelType[]>([]);
  const [loading, setLoading] = useState(true);
  const fuelTypesRef = useRef<CustomFuelType[]>([]);
  fuelTypesRef.current = fuelTypes;

  const load = useCallback(async () => {
    try {
      let data = await cloudStorageService.get<CustomFuelType[]>(
        CLOUD_KEY,
        stationId,
      );
      // Fallback: if the per-station row is empty (e.g. the station predates
      // fuel_types_config, or stationId resolved to a legacy sentinel like
      // "default_station"), try the owner-scoped (no-station) row so a
      // station's configured fuel types still load.
      if (!data && stationId) {
        data = await cloudStorageService.get<CustomFuelType[]>(CLOUD_KEY);
      }
      if (data && Array.isArray(data)) setFuelTypes(data);
    } catch {
      /* ignore — components keep their own state as a secondary source */
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    load();
    // Real-time cloud subscription: other devices / tabs editing
    // fuel_types_config reflect here instantly.
    const unsub = cloudStorageService.subscribe<CustomFuelType[]>(
      CLOUD_KEY,
      stationId,
      (val) => {
        if (val && Array.isArray(val)) setFuelTypes(val);
      },
    );
    // In-device bus: a price edit in another component on this page echoes
    // optimistically before the cloud round-trip completes.
    const unsubBus = onFuelPriceChange((p) => {
      const list = fuelTypesRef.current;
      if (!list.length) return;
      const canonical = p.canonical ?? normalizeFuelType(p.fuelType);
      if (!canonical) return;
      const idx = list.findIndex(
        (ft) => normalizeFuelType(ft.name) === canonical,
      );
      if (idx >= 0 && list[idx].price !== p.price) {
        const next = list.slice();
        next[idx] = { ...next[idx], price: p.price };
        setFuelTypes(next);
      }
    });
    // In-device bus: a fuel-type add/edit/delete/activate in another
    // component refreshes the list immediately (the cloud real-time echo
    // confirms shortly after).
    const unsubTypeBus = onFuelTypeChange(() => load());
    return () => {
      unsub?.();
      unsubBus();
      unsubTypeBus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

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
      if (entry && typeof entry.price === "number" && entry.price > 0) {
        // Sanity guard: if the station is NOT in Kenya and the stored price
        // looks like a Kenya KSh price (>= 100 per litre — absurd in USD/EUR/
        // etc.), the stored value is a stale Kenya default. Use the
        // country-appropriate fallback instead so a US station doesn't show
        // "$214.03/L" for petrol.
        const cc = getDetectedCountryCode();
        if (cc && cc !== "KE" && entry.price >= 100) {
          const base = getBasePrice(raw, cc);
          if (base > 0 && base < 100) return base;
        }
        return entry.price;
      }
      if (fallbackToStatic) {
        const cc = getDetectedCountryCode();
        const base = getBasePrice(raw, cc);
        return typeof base === "number" && base > 0 ? base : null;
      }
      return null;
    },
    [findFuelType, fallbackToStatic],
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
