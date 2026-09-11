/**
 * Dashboard Data Hook
 * Fetches dashboard statistics from backend and provides fallback to local data
 */

import { useState, useEffect, useCallback } from "react";
import { dashboardApi } from "@/react-app/config/api";

export interface DashboardStats {
  totalRevenue: number;
  netProfit: number;
  fuelSold: number;
  balanceDue: number;
  todaySales: number;
  timestamp: string;
}

export interface SalesTrendItem {
  date: string;
  revenue: number;
  fuelSold: number;
}

export interface FuelDistribution {
  petrol: number;
  diesel: number;
  kerosene: number;
}

export interface CurrentPrices {
  petrol: number;
  diesel: number;
  kerosene: number;
}

export interface UseDashboardDataReturn {
  stats: DashboardStats | null;
  salesTrend: SalesTrendItem[];
  fuelDistribution: FuelDistribution | null;
  currentPrices: CurrentPrices | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  hasBackendData: boolean;
}

export function useDashboardData(): UseDashboardDataReturn {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [salesTrend, setSalesTrend] = useState<SalesTrendItem[]>([]);
  const [fuelDistribution, setFuelDistribution] =
    useState<FuelDistribution | null>(null);
  const [currentPrices, setCurrentPrices] = useState<CurrentPrices | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [hasBackendData, setHasBackendData] = useState(false);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all dashboard data in parallel
      const [statsResult, trendResult, distributionResult, pricesResult] =
        await Promise.all([
          dashboardApi.getStats(),
          dashboardApi.getSalesTrend(),
          dashboardApi.getFuelDistribution(),
          dashboardApi.getCurrentPrices(),
        ]);

      // Process stats
      if (statsResult.success && statsResult.data) {
        setStats(statsResult.data);
        setLastUpdated(statsResult.data.timestamp);
        setHasBackendData(true);
      }

      // Process trend
      if (trendResult.success && trendResult.data) {
        setSalesTrend(trendResult.data);
      }

      // Process distribution
      if (distributionResult.success && distributionResult.data) {
        setFuelDistribution(distributionResult.data);
      }

      // Process prices
      if (pricesResult.success && pricesResult.data) {
        setCurrentPrices(pricesResult.data);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard data",
      );
      setHasBackendData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchAllData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  return {
    stats,
    salesTrend,
    fuelDistribution,
    currentPrices,
    loading,
    error,
    lastUpdated,
    refresh: fetchAllData,
    hasBackendData,
  };
}

// Fallback hook that uses local data only (for when backend is unavailable)
export function useLocalDashboardData(
  salesHistory: Record<string, any>,
  deliveryData: any,
) {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const history = Object.values(salesHistory);
    let revenue = 0;
    let fuel = 0;
    let expenses = 0;

    history.forEach((entry: any) => {
      // DYNAMIC: sum revenue + litres across ALL fuel types (was hardcoded
      // PMS/AGO only, silently dropping Kerosene/LPG/V-Power sales).
      const pmsTotal = (entry.pmsPumps || []).reduce(
        (s: number, p: any) => s + (p.salesKsh || 0),
        0,
      );
      const agoTotal = (entry.agoPumps || []).reduce(
        (s: number, p: any) => s + (p.salesKsh || 0),
        0,
      );
      revenue += pmsTotal + agoTotal;
      fuel += (entry.pmsPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      fuel += (entry.agoPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      // Dynamic fuel types (Kerosene, V-Power, LPG, …)
      if (entry.fuelPumpsByType && typeof entry.fuelPumpsByType === "object") {
        for (const pumps of Object.values(entry.fuelPumpsByType)) {
          revenue += (pumps as any[]).reduce(
            (s: number, p: any) => s + (p.salesKsh || 0),
            0,
          );
          fuel += (pumps as any[]).reduce(
            (s: number, p: any) => s + (p.salesL || 0),
            0,
          );
        }
      }
      expenses += (entry.expenses || []).reduce(
        (s: number, e: any) => s + (e.amount || 0),
        0,
      );
    });

    const debt = deliveryData?.totals?.balanceDue || 0;

    setStats({
      totalRevenue: Math.round(revenue * 100) / 100,
      netProfit: Math.round((revenue - expenses) * 100) / 100,
      fuelSold: Math.round(fuel * 100) / 100,
      balanceDue: Math.round(debt * 100) / 100,
      todaySales: 0,
      timestamp: new Date().toISOString(),
    });
  }, [salesHistory, deliveryData]);

  return stats;
}

export default useDashboardData;
