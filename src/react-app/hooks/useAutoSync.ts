import { useState, useEffect, useCallback, useRef } from "react";
import {
  runFullSync,
  isSyncDue,
  getSyncedFuelPrice,
  getSyncedTaxRates,
  getSyncedExchangeRates,
  getRegulatoryUpdates,
  getPriceForLocation,
  arePricesStale,
  forceRefreshPrices,
  type SyncResult,
  type FuelPriceData,
  type TaxRateData,
  type ExchangeRateData,
  type RegulatoryUpdate,
} from "@/react-app/services/DataSyncService";

interface GeoCoords {
  latitude: number;
  longitude: number;
}

interface UseAutoSyncReturn {
  isSyncing: boolean;
  lastSync: string | null;
  error: string | null;
  fuelPrice: FuelPriceData | null;
  taxRates: TaxRateData | null;
  exchangeRates: ExchangeRateData | null;
  regulatoryUpdates: RegulatoryUpdate[];
  locationPrice: {
    petrolPrice: number;
    dieselPrice: number;
    kerosenePrice: number;
    cityName: string;
    isRegional: boolean;
    transportSurcharge: number;
  } | null;
  currentLocation: GeoCoords | null;
  syncNow: () => Promise<void>;
  dismissUpdate: (id: string) => void;
  markUpdateRead: (id: string) => void;
  refreshLocation: () => Promise<void>;
  refreshPrices: () => Promise<void>; // Force refresh fuel prices
  unreadCount: number;
  highPriorityCount: number;
  arePricesStale: boolean;
}

export function useAutoSync(
  countryCode: string,
  initialCoords?: GeoCoords,
): UseAutoSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(
    localStorage.getItem("fuelpro_last_full_sync"),
  );
  const [error, setError] = useState<string | null>(null);
  const [fuelPrice, setFuelPrice] = useState<FuelPriceData | null>(() =>
    getSyncedFuelPrice(countryCode),
  );
  const [currentLocation, setCurrentLocation] = useState<GeoCoords | null>(
    initialCoords || null,
  );
  const [locationPrice, setLocationPrice] = useState<{
    petrolPrice: number;
    dieselPrice: number;
    kerosenePrice: number;
    cityName: string;
    isRegional: boolean;
    transportSurcharge: number;
  } | null>(null);
  const [taxRates, setTaxRates] = useState<TaxRateData | null>(() =>
    getSyncedTaxRates(countryCode),
  );
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateData | null>(
    () => getSyncedExchangeRates(),
  );
  const [regulatoryUpdates, setRegulatoryUpdates] = useState<
    RegulatoryUpdate[]
  >(() => getRegulatoryUpdates(countryCode));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateLocationPrice = useCallback(async () => {
    if (currentLocation) {
      // Use async version for dynamic price updates
      const price = await getPriceForLocation(
        countryCode,
        currentLocation.latitude,
        currentLocation.longitude,
      );
      setLocationPrice({
        petrolPrice: price.petrolPrice,
        dieselPrice: price.dieselPrice,
        kerosenePrice: price.kerosenePrice,
        cityName: price.cityName,
        isRegional: price.isRegional,
        transportSurcharge: price.transportSurcharge,
      });
    }
  }, [countryCode, currentLocation]);

  const refreshLocation = useCallback(async () => {
    if (!navigator.geolocation) return;
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          });
        },
      );
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCurrentLocation(coords);
      localStorage.setItem("fuelpro_last_geo_position", JSON.stringify(coords));
    } catch (err) {
      console.warn("Could not get location:", err);
    }
  }, []);

  const doSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      const result = await runFullSync(countryCode);
      setFuelPrice(result.fuelPrices[0] || null);
      setTaxRates(result.taxRates);
      setExchangeRates(result.exchangeRates);
      setRegulatoryUpdates(result.regulatoryUpdates);
      setLastSync(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSyncing(false);
    }
  }, [countryCode, isSyncing]);

  // Force refresh fuel prices (ignores cache age)
  const refreshPrices = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await forceRefreshPrices(countryCode);
      if (result) {
        setFuelPrice(result);
        setLastSync(new Date().toISOString());
      }
    } catch (err) {
      console.error("[useAutoSync] Price refresh failed:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [countryCode, isSyncing]);

  // Use refs to avoid stale closures in interval callbacks
  const doSyncRef = useRef(doSync);
  const refreshLocationRef = useRef(refreshLocation);
  const countryCodeRef = useRef(countryCode);

  useEffect(() => {
    doSyncRef.current = doSync;
    refreshLocationRef.current = refreshLocation;
    countryCodeRef.current = countryCode;
  }, [doSync, refreshLocation, countryCode]);

  useEffect(() => {
    const cachedFuel = getSyncedFuelPrice(countryCode);
    const cachedTax = getSyncedTaxRates(countryCode);
    const cachedEx = getSyncedExchangeRates();
    const cachedReg = getRegulatoryUpdates(countryCode);
    if (cachedFuel) setFuelPrice(cachedFuel);
    if (cachedTax) setTaxRates(cachedTax);
    if (cachedEx) setExchangeRates(cachedEx);
    if (cachedReg.length > 0) setRegulatoryUpdates(cachedReg);
    try {
      const cachedPos = localStorage.getItem("fuelpro_last_geo_position");
      if (cachedPos) setCurrentLocation(JSON.parse(cachedPos));
    } catch {}

    // Check if prices are stale (from previous day) - if so, force refresh
    // Use refs to avoid stale closures and dependency issues
    const cc = countryCode;
    if (arePricesStale(cc)) {
      console.log("[useAutoSync] Prices are stale, forcing refresh...");
      doSyncRef.current();
    } else if (isSyncDue(cc)) {
      doSyncRef.current();
    }

    refreshLocationRef.current();

    // Clear any existing interval before setting new one
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(
      () => {
        const currentCc = countryCodeRef.current;
        // Always check if prices are stale on each interval
        if (arePricesStale(currentCc)) {
          console.log(
            "[useAutoSync] Interval check: prices stale, refreshing...",
          );
          doSyncRef.current();
        } else if (isSyncDue(currentCc)) {
          doSyncRef.current();
        }
        refreshLocationRef.current();
      },
      1000 * 60 * 15,
    ); // Check every 15 minutes
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [countryCode]); // Only re-run when countryCode changes

  useEffect(() => {
    updateLocationPrice();
  }, [updateLocationPrice]);

  useEffect(() => {
    const handleSyncEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.countryCode === countryCode || !detail?.countryCode) {
        setFuelPrice(getSyncedFuelPrice(countryCode));
        setTaxRates(getSyncedTaxRates(countryCode));
        setExchangeRates(getSyncedExchangeRates());
        setRegulatoryUpdates(getRegulatoryUpdates(countryCode));
        setLastSync(localStorage.getItem("fuelpro_last_full_sync"));
      }
    };
    window.addEventListener("fuelpro-sync-complete", handleSyncEvent);
    return () =>
      window.removeEventListener("fuelpro-sync-complete", handleSyncEvent);
  }, [countryCode]);

  const dismissUpdate = useCallback(
    (id: string) => {
      setRegulatoryUpdates((prev) => {
        const updated = prev.filter((u) => u.id !== id);
        localStorage.setItem(
          `fuelpro_regulatory_${countryCode}`,
          JSON.stringify(updated),
        );
        return updated;
      });
    },
    [countryCode],
  );

  const markUpdateRead = useCallback(
    (id: string) => {
      setRegulatoryUpdates((prev) => {
        const updated = prev.map((u) =>
          u.id === id ? { ...u, read: true } : u,
        );
        localStorage.setItem(
          `fuelpro_regulatory_${countryCode}`,
          JSON.stringify(updated),
        );
        return updated;
      });
    },
    [countryCode],
  );

  const unreadCount = regulatoryUpdates.filter((u) => !u.read).length;
  const highPriorityCount = regulatoryUpdates.filter(
    (u) => !u.read && u.priority === "high",
  ).length;
  const pricesStale = arePricesStale(countryCode);

  return {
    isSyncing,
    lastSync,
    error,
    fuelPrice,
    taxRates,
    exchangeRates,
    regulatoryUpdates,
    locationPrice,
    currentLocation,
    syncNow: doSync,
    dismissUpdate,
    markUpdateRead,
    refreshLocation,
    refreshPrices,
    unreadCount,
    highPriorityCount,
    arePricesStale: pricesStale,
  };
}
