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
import {
  KENYA_BASE_PRICES,
  KENYA_SPECIALTY_PRICES,
  REGIONAL_PRICES,
  getClosestKenyaCityPrice,
  getBasePrice,
  getWorldFuelPrices,
  formatPrice,
} from "@/react-app/config/pricing";
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
 * Resolve an OFFLINE price baseline (petrol/diesel/kerosene + currency/symbol
 * + specialty prices) for the given country code. A non-Kenya station NEVER
 * gets Kenyan prices: it receives its own country's regional/world prices,
 * or a neutral empty (0) baseline when no data exists. Kenya keeps the EPRA
 * regulated table (and its specialty fuels).
 */
function getCountryBaseline(countryCode: string): {
  petrol: number;
  diesel: number;
  kerosene: number;
  vPower?: number;
  premiumDiesel?: number;
  lpg?: number;
  cng?: number;
  currency: string;
  currencySymbol: string;
} {
  if (countryCode === "KE") {
    return {
      petrol: KENYA_BASE_PRICES.petrol,
      diesel: KENYA_BASE_PRICES.diesel,
      kerosene: KENYA_BASE_PRICES.kerosene,
      vPower: KENYA_SPECIALTY_PRICES.vPower,
      premiumDiesel: KENYA_SPECIALTY_PRICES.premiumDiesel,
      lpg: KENYA_SPECIALTY_PRICES.lpg,
      cng: KENYA_SPECIALTY_PRICES.cng,
      currency: "KES",
      currencySymbol: "KSh",
    };
  }

  const regional = REGIONAL_PRICES[countryCode];
  if (regional) {
    return {
      petrol: regional.petrol,
      diesel: regional.diesel,
      kerosene: regional.kerosene,
      currency: regional.currency,
      currencySymbol: regional.currencySymbol,
    };
  }

  const world = getWorldFuelPrices()[countryCode.toUpperCase()];
  if (world) {
    return {
      petrol: world.petrol,
      diesel: world.diesel,
      kerosene: world.kerosene,
      currency: world.currency,
      currencySymbol: world.currencySymbol,
    };
  }

  // Truly unknown country: return an empty/neutral baseline in USD instead
  // of fabricating Kenyan prices.
  return {
    petrol: 0,
    diesel: 0,
    kerosene: 0,
    currency: "USD",
    currencySymbol: "$",
  };
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
    // Try to load from cache first
    const cached = loadCachedPrices();
    if (cached) return cached;

    // Default to the detected country's own baseline (NOT Kenya's prices for
    // a non-Kenya station). When no country data exists, fall back to a
    // neutral empty USD baseline rather than Kenyan shillings.
    const detectedCountry = currentCountry?.id || getDetectedCountryCode();
    const baseline = getCountryBaseline(detectedCountry);
    return {
      petrol: baseline.petrol,
      diesel: baseline.diesel,
      kerosene: baseline.kerosene,
      vPower: baseline.vPower,
      premiumDiesel: baseline.premiumDiesel,
      lpg: baseline.lpg,
      cng: baseline.cng,
      currency: baseline.currency,
      currencySymbol: baseline.currencySymbol,
      source: "Default",
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
    const countryCode = currentCountry?.id || "";
    const currency = currentCountry?.currency?.code || getCurrencySymbol();
    const symbol = currentCountry?.currency?.symbol || getCurrencySymbol();

    // Check for manual override first
    const override = loadPriceOverride();
    if (override && override.enabled) {
      // An override with missing fields must fall back to the station's OWN
      // country baseline — never Kenya's prices for a non-Kenya station.
      const baseline = getCountryBaseline(countryCode || "");
      return {
        petrol: override.petrol ?? baseline.petrol,
        diesel: override.diesel ?? baseline.diesel,
        kerosene: override.kerosene ?? baseline.kerosene,
        currency,
        currencySymbol: symbol,
        source: "Manual Override",
        location: "Manual",
        lastUpdated: override.updatedAt,
        isOverride: true,
      };
    }

    // For Kenya with GPS location
    if (countryCode === "KE" && preciseLocation?.lat && preciseLocation?.lng) {
      const cityPrices = getClosestKenyaCityPrice(
        preciseLocation.lat,
        preciseLocation.lng,
      );

      return {
        petrol: cityPrices.petrolPrice,
        diesel: cityPrices.dieselPrice,
        kerosene: cityPrices.kerosenePrice,
        currency: getCurrencySymbol(),
        currencySymbol: getCurrencySymbol(),
        source: `EPRA - ${cityPrices.transportSurcharge >= 0 ? "+" : ""}${cityPrices.transportSurcharge.toFixed(2)} transport`,
        location: cityPrices.name,
        cityName: cityPrices.name,
        lastUpdated: new Date().toISOString(),
        isOverride: false,
      };
    }

    // For other countries
    const regional = REGIONAL_PRICES[countryCode];
    if (regional) {
      return {
        petrol: regional.petrol,
        diesel: regional.diesel,
        kerosene: regional.kerosene,
        currency: regional.currency,
        currencySymbol: regional.currencySymbol,
        source: "Regional Average",
        location: currentCountry?.name || countryCode,
        lastUpdated: new Date().toISOString(),
        isOverride: false,
      };
    }

    // Default fallback: the detected country's own baseline. A non-Kenya
    // station gets its own country's prices (or a neutral empty baseline for
    // an unknown country) — never Kenya's KSh prices.
    const baseline = getCountryBaseline(countryCode || "");
    return {
      ...baseline,
      source: "Default",
      location: "Unknown",
      lastUpdated: new Date().toISOString(),
      isOverride: false,
    };
  }, [currentCountry, preciseLocation]);

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
      petrol: formatPrice(prices.petrol, prices.currencySymbol),
      diesel: formatPrice(prices.diesel, prices.currencySymbol),
      kerosene: formatPrice(prices.kerosene, prices.currencySymbol),
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
    const cc = currentCountry?.id || getDetectedCountryCode();
    // Check if station has custom prices set
    if (state.pmsPrice && state.pmsPrice !== getBasePrice("petrol", cc)) {
      return {
        ...prices,
        petrol: state.pmsPrice,
        pmsPrice: state.pmsPrice,
      };
    }
    if (state.agoPrice && state.agoPrice !== getBasePrice("diesel", cc)) {
      return {
        ...prices,
        diesel: state.agoPrice,
        agoPrice: state.agoPrice,
      };
    }
    return {
      ...prices,
      petrol: state.pmsPrice || prices.petrol,
      diesel: state.agoPrice || prices.diesel,
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
