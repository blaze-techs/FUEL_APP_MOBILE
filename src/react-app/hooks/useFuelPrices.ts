/**
 * useFuelPrices - Unified hook for fuel pricing across the application
 *
 * This hook provides a SINGLE INTERFACE for accessing fuel prices
 * throughout the application, ensuring consistency.
 *
 * Features:
 * - Location-aware pricing (GPS-based city detection for Kenya)
 * - Fallback to regional/national prices
 * - Manual price override capability
 * - Real-time sync with EPRA/regulatory sources
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatPrice } from "@/react-app/config/pricing";
import { useFuel } from "@/react-app/context/FuelContext";
import { useLocation } from "@/react-app/context/LocationContext";
import { getCurrencySymbol, getDetectedCountryCode } from "../lib/currency";

// Storage keys
const PRICE_CACHE_KEY = "fuelpro_unified_prices";
const PRICE_OVERRIDE_KEY = "fuelpro_price_override";
const LAST_PRICE_UPDATE_KEY = "fuelpro_price_update_date";

// Types
export interface FuelPrices {
  petrol: number;
  diesel: number;
  kerosene: number;
  vPower?: number;
  premiumDiesel?: number;
  lpg?: number;
  cng?: number;
}

export interface FuelPricesWithMeta extends FuelPrices {
  currency: string;
  currencySymbol: string;
  source: string;
  location: string;
  cityName?: string;
  lastUpdated: string;
  isOverride: boolean;
}

export interface PriceOverride {
  petrol?: number;
  diesel?: number;
  kerosene?: number;
  enabled: boolean;
  updatedAt: string;
}

// Get today's date string
function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

// Check if cached prices are from today
function isCacheValid(): boolean {
  try {
    const lastUpdate = localStorage.getItem(LAST_PRICE_UPDATE_KEY);
    if (!lastUpdate) return false;
    return lastUpdate === getTodayString();
  } catch {
    return false;
  }
}

// Load cached prices
function loadCachedPrices(): FuelPricesWithMeta | null {
  try {
    const cached = localStorage.getItem(PRICE_CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

// Save prices to cache
function savePricesToCache(prices: FuelPricesWithMeta): void {
  try {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(prices));
    localStorage.setItem(LAST_PRICE_UPDATE_KEY, getTodayString());
  } catch (e) {
    console.warn("[useFuelPrices] Failed to cache prices:", e);
  }
}

// Load price override
export function loadPriceOverride(): PriceOverride | null {
  try {
    const stored = localStorage.getItem(PRICE_OVERRIDE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Save price override
export function savePriceOverride(override: PriceOverride): void {
  try {
    localStorage.setItem(PRICE_OVERRIDE_KEY, JSON.stringify(override));
  } catch (e) {
    console.warn("[useFuelPrices] Failed to save price override:", e);
  }
}

// Clear price override
export function clearPriceOverride(): void {
  try {
    localStorage.removeItem(PRICE_OVERRIDE_KEY);
  } catch (e) {
    console.warn("[useFuelPrices] Failed to clear price override:", e);
  }
}


/**
 * Main hook for accessing unified fuel prices
 */
export function useFuelPrices() {
  const { state } = useFuel();
  const { currentCountry, preciseLocation, preciseLocationLoading } =
    useLocation();

  // State for prices and metadata
  const [prices, setPrices] = useState<FuelPricesWithMeta>(() => {
    // No cached/reference price is treated as the current station price.
    // Until authoritative station data or an explicit manual override is
    // available, prices are unknown and represented as zero sentinels.
    const currency = currentCountry?.currency?.code || "";
    const currencySymbol = currentCountry?.currency?.symbol || "";
    return {
      petrol: 0,
      diesel: 0,
      kerosene: 0,
      currency,
      currencySymbol,
      source: "No verified station price",
      location: "",
      lastUpdated: new Date().toISOString(),
      isOverride: false,
    };
  });

  // State for loading and manual override
  const [isLoading, setIsLoading] = useState(false);
  const [priceOverride, setPriceOverride] = useState<PriceOverride | null>(() =>
    loadPriceOverride(),
  );

  // Get location-based prices for Kenya
  const getLocationBasedPrices = useCallback((): FuelPricesWithMeta => {
    const currency = currentCountry?.currency?.code || "";
    const symbol = currentCountry?.currency?.symbol || "";

    const override = loadPriceOverride();
    if (override?.enabled) {
      const petrol =
        typeof override.petrol === "number" && Number.isFinite(override.petrol) && override.petrol > 0
          ? override.petrol
          : 0;
      const diesel =
        typeof override.diesel === "number" && Number.isFinite(override.diesel) && override.diesel > 0
          ? override.diesel
          : 0;
      const kerosene =
        typeof override.kerosene === "number" && Number.isFinite(override.kerosene) && override.kerosene > 0
          ? override.kerosene
          : 0;
      return {
        petrol,
        diesel,
        kerosene,
        currency,
        currencySymbol: symbol,
        source: "Manual Override",
        location: "Manual",
        lastUpdated: override.updatedAt,
        isOverride: true,
      };
    }

    const petrol =
      typeof state.pmsPrice === "number" && Number.isFinite(state.pmsPrice) && state.pmsPrice > 0
        ? state.pmsPrice
        : 0;
    const diesel =
      typeof state.agoPrice === "number" && Number.isFinite(state.agoPrice) && state.agoPrice > 0
        ? state.agoPrice
        : 0;
    const kerosene =
      typeof state.fuelPricesByType?.kerosene === "number" &&
      Number.isFinite(state.fuelPricesByType.kerosene) &&
      state.fuelPricesByType.kerosene > 0
        ? state.fuelPricesByType.kerosene
        : 0;

    return {
      petrol,
      diesel,
      kerosene,
      currency,
      currencySymbol: symbol,
      source:
        petrol > 0 || diesel > 0 || kerosene > 0
          ? "Station configured"
          : "No verified station price",
      location: state.companyData?.town || "",
      lastUpdated: new Date().toISOString(),
      isOverride: false,
    };
  }, [
    currentCountry,
    state.pmsPrice,
    state.agoPrice,
    state.fuelPricesByType,
    state.companyData?.town,
  ]);

  // Update prices when location changes
  useEffect(() => {
    if (!isLoading) {
      const locationPrices = getLocationBasedPrices();
      setPrices(locationPrices);
      savePricesToCache(locationPrices);
    }
  }, [currentCountry, preciseLocation, isLoading, getLocationBasedPrices]);

  // Refresh prices (force reload)
  const refreshPrices = useCallback(async () => {
    setIsLoading(true);
    try {
      // Prices are computed locally — no artificial delay
      const locationPrices = getLocationBasedPrices();
      setPrices(locationPrices);
      savePricesToCache(locationPrices);
    } finally {
      setIsLoading(false);
    }
  }, [getLocationBasedPrices]);

  // Set manual price override
  const setPriceOverrideValues = useCallback(
    (
      newPrices: Partial<Pick<FuelPrices, "petrol" | "diesel" | "kerosene">>,
    ) => {
      const override: PriceOverride = {
        ...loadPriceOverride(),
        ...newPrices,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };

      setPriceOverride(override);
      savePriceOverride(override);

      // Immediately update displayed prices
      setPrices((prev) => ({
        ...prev,
        petrol: override.petrol || prev.petrol,
        diesel: override.diesel || prev.diesel,
        kerosene: override.kerosene || prev.kerosene,
        source: "Manual Override",
        isOverride: true,
        lastUpdated: override.updatedAt,
      }));
    },
    [],
  );

  // Clear manual override
  const clearOverride = useCallback(() => {
    clearPriceOverride();
    setPriceOverride(null);
    // Refresh to get location-based prices
    refreshPrices();
  }, [refreshPrices]);

  // Derived values
  const displayPrices = useMemo(
    () => ({
      pmsPrice: prices.petrol,
      agoPrice: prices.diesel,
      petrolPrice: prices.petrol,
      dieselPrice: prices.diesel,
      kerosenePrice: prices.kerosene,
      vPowerPrice: prices.vPower,
      premiumDieselPrice: prices.premiumDiesel,
    }),
    [prices],
  );

  const formattedPrices = useMemo(
    () => ({
      petrol:
        prices.petrol > 0
          ? formatPrice(prices.petrol, prices.currencySymbol)
          : "N/A",
      diesel:
        prices.diesel > 0
          ? formatPrice(prices.diesel, prices.currencySymbol)
          : "N/A",
      kerosene:
        prices.kerosene > 0
          ? formatPrice(prices.kerosene, prices.currencySymbol)
          : "N/A",
      vPower: prices.vPower
        ? formatPrice(prices.vPower, prices.currencySymbol)
        : undefined,
      premiumDiesel: prices.premiumDiesel
        ? formatPrice(prices.premiumDiesel, prices.currencySymbol)
        : undefined,
    }),
    [prices],
  );

  // Use station-specific prices if available (from FuelContext)
  // These take precedence over detected prices (for custom station pricing)
  const effectivePrices = useMemo(() => {
    // A configured station price is authoritative even when it happens to
    // equal a regulator/reference value. Comparing against a reference table
    // is not a valid way to decide whether a real station price exists.
    return {
      ...prices,
      petrol:
        typeof state.pmsPrice === "number" && Number.isFinite(state.pmsPrice) && state.pmsPrice > 0
          ? state.pmsPrice
          : prices.petrol,
      diesel:
        typeof state.agoPrice === "number" && Number.isFinite(state.agoPrice) && state.agoPrice > 0
          ? state.agoPrice
          : prices.diesel,
    };
  }, [state.pmsPrice, state.agoPrice, prices]);

  return {
    // Raw prices
    prices,
    effectivePrices,
    displayPrices,
    formattedPrices,

    // Metadata
    currency: prices.currency,
    currencySymbol: prices.currencySymbol,
    location: prices.location,
    cityName: prices.cityName,
    source: prices.source,
    lastUpdated: prices.lastUpdated,
    isOverride: prices.isOverride,

    // State
    isLoading,
    hasOverride: !!priceOverride?.enabled,

    // Actions
    refreshPrices,
    setPriceOverride: setPriceOverrideValues,
    clearOverride,

    // Shortcuts
    petrolPrice: effectivePrices.petrol,
    dieselPrice: effectivePrices.diesel,
    kerosenePrice: effectivePrices.kerosene,
    pmsPrice: effectivePrices.petrol,
    agoPrice: effectivePrices.diesel,
  };
}

export default useFuelPrices;
