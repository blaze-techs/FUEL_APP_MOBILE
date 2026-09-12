/**
 * useBackendSync - Hook for syncing data with Firebase Firestore
 * Primary cloud storage is now Firebase Firestore
 * Backend sync is optional and gracefully degrades when unavailable
 */

import { useCallback, useEffect, useState } from "react";
import { FirebaseService } from "@/react-app/services/FirebaseService";

// Check if backend API is configured (for optional backend sync)
function getApiBase(): string {
  return import.meta.env.VITE_BACKEND_URL || "";
}

// Check if Firebase cloud sync is enabled
function isCloudSyncEnabled(): boolean {
  return FirebaseService.isEnabled();
}

// Token storage keys to try
const TOKEN_KEYS = [
  "fuelpro_token",
  "fuelpro_auth_token",
  "fuelpro_founder_session",
  "clerk_token",
  "auth_token",
];

function getAuthToken(): string | null {
  for (const key of TOKEN_KEYS) {
    let val: string | null = null;
    try {
      val = localStorage.getItem(key);
      if (!val) continue;

      // Try parsing as JSON
      const parsed = JSON.parse(val);
      if (parsed.token) return parsed.token;
      if (parsed.accessToken) return parsed.accessToken;
      if (parsed.active && parsed.token) return parsed.token;

      // Try as plain string
      if (typeof val === "string" && val.length > 20) {
        return val;
      }
    } catch {
      // If JSON parse fails, might be a plain token
      if ((key === "fuelpro_token" || key === "auth_token") && val) {
        return val;
      }
    }
  }
  return null;
}

function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

export interface BackendStation {
  id: number;
  name: string;
  code: string;
  location?: string;
  phone?: string;
  managerName?: string;
  taxRate?: string;
  country?: string;
  countryCode?: string;
  latitude?: string;
  longitude?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  userRole?: string;
}

export interface BackendSale {
  id: number;
  stationId: number;
  userId: number;
  fuelType: string;
  quantityLiters: string;
  pricePerLiter: string;
  subtotal: string;
  taxAmount?: string;
  total: string;
  paymentMethod: string;
  pumpNumber?: string;
  receiptNumber?: string;
  notes?: string;
  latitude?: string;
  longitude?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface BackendInventory {
  id: number;
  stationId: number;
  fuelType: string;
  tankCapacity: string;
  currentLevel: string;
  minLevel: string;
  lastUpdated?: string;
  createdAt: string;
}

export interface BackendSyncData {
  success: boolean;
  timestamp: number;
  user?: {
    id: number;
    email: string;
    name: string;
    createdAt: string;
  };
  stations: BackendStation[];
  stationCount: number;
  sales: BackendSale[];
  salesCount: number;
  inventory: BackendInventory[];
  stats: {
    totalRevenue: string;
    totalSales: number;
    totalLiters: string;
  };
}

interface UseBackendSyncResult {
  syncData: BackendSyncData | null;
  isLoading: boolean;
  error: Error | null;
  lastSyncTime: number | null;
  syncFromServer: () => Promise<BackendSyncData | null>;
  hasServerData: boolean;
  stationCount: number;
  salesCount: number;
  isAuthenticated: boolean;
}

/**
 * Hook to sync data from the backend server
 * This ensures data is consistent across all devices
 */
export function useBackendSync(): UseBackendSyncResult {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [syncData, setSyncData] = useState<BackendSyncData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  // Check auth status periodically
  useEffect(() => {
    const checkAuth = () => {
      const newAuth = isAuthenticated();
      setAuthenticated(newAuth);
      if (!newAuth) {
        setSyncData(null);
      }
    };

    checkAuth();
    const interval = setInterval(checkAuth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch data from backend (Firebase or optional REST backend)
  const syncFromServer =
    useCallback(async (): Promise<BackendSyncData | null> => {
      if (!authenticated) {
        setSyncData(null);
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Try Firebase cloud sync first
        const stationId = localStorage.getItem("fuelpro_current_station_id");
        if (stationId && isCloudSyncEnabled()) {
          const success = await FirebaseService.syncToCloud(stationId);
          if (success) {
            console.log("[useBackendSync] Firebase sync successful");
          }
        }

        // Try optional REST backend if configured
        const apiBase = getApiBase();
        if (apiBase) {
          const token = getAuthToken();
          if (!token) {
            setAuthenticated(false);
            throw new Error("No authentication token available");
          }

          const response = await fetch(`${apiBase}/api/trpc/sync.fullSync`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            throw new Error(
              `Failed to sync: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          // tRPC returns data in nested format
          const data = result.result?.data?.json || result.data;

          if (data && data.success) {
            setSyncData(data);
            setLastSyncTime(Date.now());
            return data;
          }
        }

        // If no backend is configured, use Firebase-only mode
        // Return placeholder data - actual data is in localStorage
        setLastSyncTime(Date.now());
        return {
          success: true,
          timestamp: Date.now(),
          stations: [],
          stationCount: 0,
          sales: [],
          salesCount: 0,
          inventory: [],
          stats: { totalRevenue: "0", totalSales: 0, totalLiters: "0" },
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        console.error("[useBackendSync] Sync failed:", error);
        // Don't fail completely - we can still work with local data
        setLastSyncTime(Date.now());
        return {
          success: true,
          timestamp: Date.now(),
          stations: [],
          stationCount: 0,
          sales: [],
          salesCount: 0,
          inventory: [],
          stats: { totalRevenue: "0", totalSales: 0, totalLiters: "0" },
        };
      } finally {
        setIsLoading(false);
      }
    }, [authenticated]);

  // Auto-sync on mount and periodically
  useEffect(() => {
    if (authenticated) {
      syncFromServer();

      // Periodic sync every 30 seconds
      const interval = setInterval(() => {
        syncFromServer();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [authenticated, syncFromServer]);

  return {
    syncData,
    isLoading,
    error,
    lastSyncTime,
    syncFromServer,
    hasServerData: syncData !== null && syncData.stations.length > 0,
    stationCount: syncData?.stationCount || 0,
    salesCount: syncData?.salesCount || 0,
    isAuthenticated: authenticated,
  };
}

/**
 * Hook to get stations from the backend
 * Use this instead of relying solely on localStorage
 */
export function useBackendStations(): {
  stations: BackendStation[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<BackendSyncData | null>;
} {
  const { syncData, isLoading, error, syncFromServer } = useBackendSync();

  return {
    stations: syncData?.stations || [],
    isLoading,
    error,
    refresh: syncFromServer,
  };
}

/**
 * Hook to get sales from the backend
 */
export function useBackendSales(): {
  sales: BackendSale[];
  stats: { totalRevenue: string; totalSales: number; totalLiters: string };
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<BackendSyncData | null>;
} {
  const { syncData, isLoading, error, syncFromServer } = useBackendSync();

  return {
    sales: syncData?.sales || [],
    stats: syncData?.stats || {
      totalRevenue: "0",
      totalSales: 0,
      totalLiters: "0",
    },
    isLoading,
    error,
    refresh: syncFromServer,
  };
}

export default useBackendSync;
