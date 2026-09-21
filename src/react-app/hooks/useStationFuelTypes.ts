/**
 * useStationFuelTypes — the unified read API for "this station's fuel types
 * and their current prices".
 *
 * It is backed by the EXISTING `fuel_types_config` cloud key (edited by
 * FuelTypesManager, which remains the source of truth / editor). The hook
 * loads it on mount, subscribes to real-time cloud updates, and also listens
 * to the in-device fuel-interlink bus so edits in other tabs reflect
 * instantly. Operational prices are station-configured only: this hook never
 * substitutes a regulator/static price when a station price is missing.
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
   * configured fuel_types_config entry only (matched via canonical
   * normalization so "Petrol", "PMS", "Super Petrol" all hit the same row).
   * Returns null when the station has no configured operational price.
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
 * @param fallbackToStatic retained for API compatibility. It is intentionally
 *   ignored for operational prices: static/regulator baselines must never
 *   masquerade as the station's current pump price.
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
      // Never fall back to an owner/global row here. Current pump prices are
      // station-scoped; a global row can belong to another station or an old
      // session and silently reintroduce the wrong price after logout/login.
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
      if (!entry || typeof entry.price !== "number" || !Number.isFinite(entry.price) || entry.price <= 0) {
        return null;
      }
      // Operational truth is the station's configured price. Do not replace
      // it with EPRA/regulator/static data based on country detection.
      return entry.price;
    },
    [findFuelType],
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
