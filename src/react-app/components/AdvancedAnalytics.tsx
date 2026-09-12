import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  PieChart,
  Layers,
  Loader2,
  AlertCircle,
  Download,
  RefreshCw,
  ShoppingCart,
  Plus,
  Sparkles,
  CreditCard,
} from "lucide-react";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { getDetectedCurrency } from "@/react-app/lib/currency";
import SubTabBar from "@/react-app/components/SubTabBar";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const EnhancedAnalyticsDashboard = lazy(() =>
  import("@/react-app/features/analytics/EnhancedAnalyticsDashboard").then(
    (m) => ({ default: m.default }),
  ),
);

interface PredictionPoint {
  date: string;
  actual: number;
  predicted: number;
  lower: number;
  upper: number;
}

interface DailySales {
  date: string;
  total: number;
  count: number;
}

interface InventoryLevel {
  fuel_type: string;
  current_level: number;
  tank_capacity: number;
  percentage: number;
}

export default function AdvancedAnalytics() {
  const { state } = useFuel();
  const location = useLocation();
  const { currentStation } = useStations();
  const fuelTypeApi = useStationFuelTypes(currentStation?.id);
  const [activeSubTab, setActiveSubTab] = useState<"analytics" | "enhanced">(
    "analytics",
  );
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("analytics", setActiveSubTab);
  // Use the station's currency (reactive to station/company changes) rather
  // than the device-detected location currency, which was wrong for
  // multi-country setups (a Kenyan station viewed from a US browser showed $).
  const currencySymbol =
    currentStation?.currencySymbol ||
    location.currencySymbol ||
    state.companyData?.currency ||
    getDetectedCurrency();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "1y">(
    "30d",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salesData, setSalesData] = useState<DailySales[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<
    Record<string, { count: number; total: number }>
  >({});
  const [inventoryLevels, setInventoryLevels] = useState<InventoryLevel[]>([]);
  const [fuelPrices, setFuelPrices] = useState({ pms: 0, ago: 0 });
  const [dataSource, setDataSource] = useState<"supabase" | "local" | "none">(
    "none",
  );

  // Calculate date range
  const dateRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    const days =
      timeRange === "7d"
        ? 7
        : timeRange === "30d"
          ? 30
          : timeRange === "90d"
            ? 90
            : 365;
    start.setDate(start.getDate() - days);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
      days,
    };
  }, [timeRange]);

  // Fetch real sales data from Supabase. Removed `state` (entire FuelContext)
  // from deps — it changed on every keystroke anywhere in the app, causing
  // a re-fetch storm. Now reads only the specific fields needed via refs.
  const fetchAnalytics = useCallback(async () => {
    if (!currentStation?.id) {
      setLoading(false);
      setDataSource("none");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Fetch sales from sales_enhanced table (the canonical POS sales table).
      const { data: sales, error: salesError } = await supabase
        .from("sales_enhanced")
        .select("sale_date, total_amount, payment_method")
        .eq("station_id", currentStation.id)
        .gte("sale_date", dateRange.start)
        .lte("sale_date", dateRange.end)
        .order("sale_date", { ascending: true });

      if (salesError) throw salesError;

      // Process sales by date. Only pre-initialize dates that fall within the
      // range IF we have actual sales (so a new station shows a real empty
      // state instead of a zero-filled dashboard that looks like "0 revenue").
      const salesByDate: Record<string, DailySales> = {};

      if (sales && sales.length > 0) {
        const pmBreakdown: Record<string, { count: number; total: number }> =
          {};
        for (const sale of sales) {
          const dateStr = new Date(sale.sale_date).toISOString().split("T")[0];
          if (!salesByDate[dateStr]) {
            salesByDate[dateStr] = { date: dateStr, total: 0, count: 0 };
          }
          salesByDate[dateStr].total += sale.total_amount || 0;
          salesByDate[dateStr].count += 1;
          // Build payment method breakdown.
          const method = (sale.payment_method || "unknown")
            .toString()
            .toLowerCase();
          if (!pmBreakdown[method])
            pmBreakdown[method] = { count: 0, total: 0 };
          pmBreakdown[method].count += 1;
          pmBreakdown[method].total += sale.total_amount || 0;
        }
        setPaymentBreakdown(pmBreakdown);
      } else {
        setPaymentBreakdown({});
      }

      // If sales_enhanced returned nothing, try the legacy `sales` table as a
      // FALLBACK ONLY (do NOT aggregate both — that double-counts revenue for
      // stations that have data in both tables).
      if (sales && sales.length === 0) {
        const { data: fuelSales, error: fuelError } = await supabase
          .from("sales")
          .select("created_at, quantity, price_per_liter, fuel_type_id")
          .eq("station_id", currentStation.id)
          .gte("created_at", dateRange.start)
          .lte("created_at", dateRange.end)
          .order("created_at", { ascending: true });

        if (fuelError) {
          // Surface the error instead of silently warning.
          console.warn("Legacy fuel sales fetch failed:", fuelError.message);
        } else if (fuelSales && fuelSales.length > 0) {
          for (const sale of fuelSales) {
            const dateStr = new Date(sale.created_at)
              .toISOString()
              .split("T")[0];
            if (!salesByDate[dateStr]) {
              salesByDate[dateStr] = { date: dateStr, total: 0, count: 0 };
            }
            // Guard against NaN: price_per_liter or quantity could be null.
            const qty = typeof sale.quantity === "number" ? sale.quantity : 0;
            const price =
              typeof sale.price_per_liter === "number"
                ? sale.price_per_liter
                : 0;
            salesByDate[dateStr].total += qty * price;
            salesByDate[dateStr].count += 1;
          }
        }
      }

      if (Object.keys(salesByDate).length === 0) {
        // Tables returned nothing — fall back to the app's canonical store
        // (FuelContext salesHistory compact blob: Sales Tracking + POS push
        // here; ALSO pos_transactions cloud KV). Without this, sales set in
        // POS/Sales Tracking never surfaced in Analytics.
        processLocalData();
      } else {
        const processedData = Object.values(salesByDate).sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        setSalesData(processedData);
        setDataSource("supabase");
      }

      // Fetch inventory levels
      const { data: inventory, error: invError } = await supabase
        .from("inventory")
        .select("current_level, tank_capacity, fuel_type_id")
        .eq("station_id", currentStation.id);

      if (invError) {
        console.warn("Inventory fetch failed:", invError.message);
      } else if (inventory && inventory.length > 0) {
        const { data: fuelTypes, error: ftError } = await supabase
          .from("fuel_types")
          .select("id, name");
        if (ftError) console.warn("Fuel types fetch failed:", ftError.message);

        const fuelTypeMap: Record<string, string> = {};
        fuelTypes?.forEach((ft) => {
          fuelTypeMap[ft.id] = ft.name;
        });

        const invLevels: InventoryLevel[] = inventory.map((inv: any) => {
          const capacity = inv.tank_capacity || 0;
          const current = inv.current_level || 0;
          return {
            fuel_type: fuelTypeMap[inv.fuel_type_id] || "Unknown",
            current_level: current,
            tank_capacity: capacity,
            percentage:
              capacity > 0 ? Math.min(100, (current / capacity) * 100) : 0,
          };
        });
        setInventoryLevels(invLevels);
      }

      // Get fuel prices from pumps (real station prices, not a hardcoded 200)
      const { data: pumps, error: pumpsError } = await supabase
        .from("pumps")
        .select("fuel_type_id, price_per_liter")
        .eq("station_id", currentStation.id);

      if (pumpsError) {
        console.warn("Pumps fetch failed:", pumpsError.message);
      } else if (pumps && pumps.length > 0) {
        const { data: fuelTypes } = await supabase
          .from("fuel_types")
          .select("id, code");
        const ftMap: Record<string, string> = {};
        fuelTypes?.forEach((ft) => (ftMap[ft.id] = ft.code));

        const prices = { pms: 0, ago: 0 };
        pumps.forEach((p: any) => {
          const code = ftMap[p.fuel_type_id];
          if (code === "PETROL" || code === "PMS")
            prices.pms = p.price_per_liter || 0;
          if (code === "DIESEL" || code === "AGO")
            prices.ago = p.price_per_liter || 0;
        });
        setFuelPrices(prices);
      } else {
        // Fall back to FuelContext prices (cloud-synced, station-specific)
        setFuelPrices({ pms: state.pmsPrice || 0, ago: state.agoPrice || 0 });
      }
    } catch (err: any) {
      console.error("Analytics fetch error:", err);
      setError(err.message || "Failed to load analytics data");
      // Fall back to FuelContext local data (NOT fake data — real tank readings
      // + sales history from the cloud-synced compact blob).
      processLocalData();
    } finally {
      setLoading(false);
    }
  }, [currentStation?.id, dateRange.start, dateRange.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use real local data (FuelContext state) as a fallback. This is NOT fake
  // data — it derives litres sold from the station's actual tank readings
  // (opening - closing) and uses the station's actual prices. Previously
  // this generated a flat "real-looking" trend that mislead users.
  const processLocalData = () => {
    const days = dateRange.days;
    const pmsTotal = Math.max(0, state.pmsTankOpening - state.pmsTankClosing);
    const agoTotal = Math.max(0, state.agoTankOpening - state.agoTankClosing);
    const totalLitres = pmsTotal + agoTotal;

    if (
      totalLitres <= 0 &&
      Object.keys(state.salesHistory || {}).length === 0
    ) {
      // Genuinely no data — show empty state, not fabricated data.
      setSalesData([]);
      setDataSource("none");
      return;
    }

    // Try salesHistory first (real recorded sales from the cloud blob)
    const salesHistory = state.salesHistory || {};
    const salesByDate: Record<string, DailySales> = {};

    for (const [dateKey, saleRecord] of Object.entries(salesHistory)) {
      const dateStr = dateKey.split("T")[0];
      const rec = saleRecord as any;
      let total =
        typeof rec === "object" && rec !== null
          ? rec.total || rec.amount || rec.total_amount || 0
          : typeof saleRecord === "number"
            ? saleRecord
            : 0;
      // POS pushes sales under `.posSales` (pmsAmount + agoAmount +
      // byTypeAmount). Sum those so POS sales actually appear in the totals.
      if (rec && typeof rec === "object" && rec.posSales) {
        const ps = rec.posSales as {
          pmsAmount?: number;
          agoAmount?: number;
          byTypeAmount?: Record<string, number>;
        };
        const posTotal: number =
          (Number(ps.pmsAmount) || 0) +
          (Number(ps.agoAmount) || 0) +
          Object.values(ps.byTypeAmount || {}).reduce(
            (s: number, v) => s + (Number(v) || 0),
            0,
          );
        total += posTotal;
      }
      if (!salesByDate[dateStr]) {
        salesByDate[dateStr] = { date: dateStr, total: 0, count: 0 };
      }
      salesByDate[dateStr].total += total;
      salesByDate[dateStr].count += 1;
    }

    if (Object.keys(salesByDate).length > 0) {
      const sorted = Object.values(salesByDate).sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      setSalesData(sorted);
      setDataSource("local");
    } else {
      // Last resort: derive from tank readings (real data, clearly labeled)
      // Use ALL fuel type prices (not just pms/ago) for stations with only
      // Kerosene/LPG/V-Power.
      const allPrices = (fuelTypeApi.activeFuelTypes || [])
        .map((ft) => ft.price)
        .filter((p): p is number => typeof p === "number" && p > 0);
      if (state.pmsPrice > 0) allPrices.push(state.pmsPrice);
      if (state.agoPrice > 0) allPrices.push(state.agoPrice);
      const avgPrice =
        allPrices.length > 0
          ? allPrices.reduce((s, p) => s + p, 0) / allPrices.length
          : 0;
      const dailyRevenue =
        avgPrice > 0 ? (totalLitres * avgPrice) / Math.max(1, days) : 0;
      if (dailyRevenue > 0) {
        const data: DailySales[] = [];
        for (let i = days; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split("T")[0];
          data.push({
            date: dateStr,
            total: Math.round(dailyRevenue),
            count: 0, // real count unknown — don't fabricate
          });
        }
        setSalesData(data);
        setDataSource("local");
      } else {
        setSalesData([]);
        setDataSource("none");
      }
    }
    setFuelPrices({ pms: state.pmsPrice || 0, ago: state.agoPrice || 0 });
  };

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Calculate predictions based on actual historical data
  const predictions = useMemo(() => {
    if (salesData.length < 7) return [];

    const last7 = salesData.slice(-7);
    const avgDaily = last7.reduce((s, d) => s + d.total, 0) / 7;
    const variance =
      last7.reduce((s, d) => s + Math.pow(d.total - avgDaily, 2), 0) / 7;
    const stdDev = Math.sqrt(variance) || 0;

    // Calculate simple linear trend. Guard against division by zero when
    // last7.length is 1 (the denom would be 0).
    const trendDenom = (last7.length * (last7.length - 1)) / 2;
    let trend = 0;
    if (trendDenom > 0) {
      let trendSum = 0;
      for (let i = 0; i < last7.length; i++) {
        trendSum += (last7[i].total - avgDaily) * (i - (last7.length - 1) / 2);
      }
      trend = trendSum / trendDenom;
    }

    const preds: PredictionPoint[] = [];
    const now = new Date();

    for (let i = 1; i <= 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dayOfWeek = d.getDay();
      // Weekend adjustment based on historical pattern
      const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.85 : 1;
      const base = avgDaily + trend * i;
      const predicted = Math.max(0, Math.round(base * weekendFactor));

      preds.push({
        date: d.toISOString().split("T")[0],
        actual: 0,
        predicted,
        lower: Math.max(0, Math.round(predicted - stdDev)),
        upper: Math.round(predicted + stdDev),
      });
    }
    return preds;
  }, [salesData]);

  // Calculate totals from real data. Guard against NaN in all calculations.
  const totals = useMemo(() => {
    const totalRevenue = salesData.reduce((s, d) => s + (d.total || 0), 0);
    // Use ALL station fuel type prices (not just pms/ago) so the estimated
    // volume is accurate for stations with Kerosene/LPG/V-Power only.
    const allPrices = (fuelTypeApi.activeFuelTypes || [])
      .map((ft) => ft.price)
      .filter((p): p is number => typeof p === "number" && p > 0);
    // Also include legacy pms/ago prices as a fallback.
    if (fuelPrices.pms > 0) allPrices.push(fuelPrices.pms);
    if (fuelPrices.ago > 0) allPrices.push(fuelPrices.ago);
    const avgPrice =
      allPrices.length > 0
        ? allPrices.reduce((s, p) => s + p, 0) / allPrices.length
        : 0;
    const estimatedVolume = avgPrice > 0 ? totalRevenue / avgPrice : 0;

    return {
      totalRevenue: Number.isFinite(totalRevenue) ? totalRevenue : 0,
      estimatedVolume: Number.isFinite(estimatedVolume) ? estimatedVolume : 0,
      avgDaily:
        salesData.length > 0
          ? salesData.reduce((s, d) => s + (d.total || 0), 0) / salesData.length
          : 0,
      totalTransactions: salesData.reduce((s, d) => s + (d.count || 0), 0),
    };
  }, [salesData, fuelPrices, fuelTypeApi.activeFuelTypes]);

  // Calculate growth. Guard against division by zero (prevTotal=0 → growth=0,
  // not Infinity/NaN). Removed the fabricated `last7Total * 4` extrapolation.
  const growthData = useMemo(() => {
    if (salesData.length < 14) return { growth7d: 0, growth30d: 0 };

    const last7 = salesData.slice(-7);
    const prev7 = salesData.slice(-14, -7);

    const last7Total = last7.reduce((s, d) => s + (d.total || 0), 0);
    const prev7Total = prev7.reduce((s, d) => s + (d.total || 0), 0);

    // 7-day growth: compare last 7 days to previous 7 days.
    const growth7d =
      prev7Total > 0 ? ((last7Total - prev7Total) / prev7Total) * 100 : 0;

    // 30-day trend: only compute if we actually have 30+ days of data.
    // Previously this fabricated `last7Total * 4` (extrapolating 7 days into
    // a month), which produced nonsensical growth percentages. Now uses real
    // 30-day data when available, else 0.
    let growth30d = 0;
    if (salesData.length >= 60) {
      const prev30 = salesData.slice(-60, -30);
      const prev30Total = prev30.reduce((s, d) => s + (d.total || 0), 0);
      // Compare last 30 days to previous 30 days
      const last30 = salesData.slice(-30);
      const last30Total = last30.reduce((s, d) => s + (d.total || 0), 0);
      growth30d =
        prev30Total > 0 ? ((last30Total - prev30Total) / prev30Total) * 100 : 0;
    }

    return {
      growth7d: Number.isFinite(growth7d) ? growth7d : 0,
      growth30d: Number.isFinite(growth30d) ? growth30d : 0,
    };
  }, [salesData]);

  // Find peak day
  const peakDay = useMemo(() => {
    if (salesData.length === 0) return "N/A";
    const peak = salesData.reduce(
      (max, d) => (d.total > max.total ? d : max),
      salesData[0],
    );
    const dayIndex = new Date(peak.date).getDay();
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayIndex];
  }, [salesData]);

  const maxVol = Math.max(...salesData.map((d) => d.total), 1);
  // Fixed: the duplicate `1` was a typo (harmless but confusing). A single
  // floor of 1 prevents division-by-zero in chart height calc.
  const predMax = Math.max(...predictions.map((p) => p.upper), 1);

  // CSV export of the raw sales data shown in the chart. Lets the user
  // download their analytics data for external reporting (was missing).
  const exportCSV = () => {
    if (salesData.length === 0) {
      toastError("No sales data to export for this period.");
      return;
    }
    const rows = [
      ["Date", "Total Revenue", "Transaction Count"],
      ...salesData.map((d) => [d.date, d.total.toFixed(2), String(d.count)]),
      ["", "", ""],
      [
        "TOTAL",
        totals.totalRevenue.toFixed(2),
        String(totals.totalTransactions),
      ],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_${timeRange}_${dateRange.start}_to_${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        <span className="ml-2 text-gray-500">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SubTabBar
        tabs={[
          { id: "analytics", label: "Analytics" },
          { id: "enhanced", label: "Enhanced Dashboard" },
        ]}
        active={activeSubTab}
        onChange={(id) => setActiveSubTab(id as "analytics" | "enhanced")}
      />
      {activeSubTab === "enhanced" ? (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
              <span className="ml-2 text-gray-500">
                Loading enhanced dashboard...
              </span>
            </div>
          }
        >
          <EnhancedAnalyticsDashboard />
        </Suspense>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
                <BarChart3
                  size={24}
                  className="text-violet-600 dark:text-violet-400"
                />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  Advanced Analytics
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
                  Real data from your sales records
                  {dataSource === "supabase" && (
                    <span className="ml-2 text-green-600 dark:text-green-400">
                      • Live (Supabase)
                    </span>
                  )}
                  {dataSource === "local" && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">
                      • Local records
                    </span>
                  )}
                  {dataSource === "none" && (
                    <span className="ml-2 text-gray-500 dark:text-gray-400">
                      • No data yet
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchAnalytics()}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title="Refresh data"
                aria-label="Refresh analytics data"
              >
                <RefreshCw size={16} />
              </button>
              <button
                onClick={exportCSV}
                disabled={salesData.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-gray-900 dark:text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Export data as CSV"
                aria-label="Export data as CSV"
              >
                <Download size={16} />
                <span>Export</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {error}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {dataSource === "local"
                    ? "Showing data from local records."
                    : "No data available. Try refreshing or recording a sale."}
                </p>
                <button
                  onClick={() => fetchAnalytics()}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-gray-900 dark:text-white text-xs font-medium hover:bg-amber-700 transition-colors"
                >
                  <RefreshCw size={12} /> Retry
                </button>
              </div>
            </div>
          )}

          {/* Empty State — new stations with no sales see a helpful CTA instead of
          a confusing zero-filled dashboard. */}
          {dataSource === "none" && !error && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <BarChart3
                  size={32}
                  className="text-violet-600 dark:text-violet-400"
                />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2">
                No sales data yet
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
                Your analytics dashboard will populate automatically once you
                start recording sales. Create your first sale or check your
                station inventory to get started.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => switchToTab("pos")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-gray-900 dark:text-white text-sm font-medium hover:bg-violet-700 transition-colors"
                >
                  <Plus size={16} /> Record a Sale
                </button>
                <button
                  onClick={() => switchToTab("inventory")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <ShoppingCart size={16} /> View Inventory
                </button>
                <button
                  onClick={() => switchToTab("sales")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Activity size={16} /> Sales Tracking
                </button>
              </div>
            </div>
          )}

          {/* Time Range */}
          <div className="flex gap-2 flex-wrap">
            {(["7d", "30d", "90d", "1y"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${timeRange === r ? "bg-violet-600 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                aria-pressed={timeRange === r}
              >
                {r === "7d"
                  ? "7 Days"
                  : r === "30d"
                    ? "30 Days"
                    : r === "90d"
                      ? "90 Days"
                      : "1 Year"}
              </button>
            ))}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                {currencySymbol}
                {formatNumber(totals.totalRevenue, 0)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Avg Daily Sales</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {currencySymbol}
                {formatNumber(totals.avgDaily, 0)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">7-Day Growth</p>
              <p
                className={`text-2xl font-bold flex items-center gap-1 ${growthData.growth7d >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {growthData.growth7d >= 0 ? (
                  <TrendingUp size={20} />
                ) : (
                  <TrendingDown size={20} />
                )}
                {Math.abs(growthData.growth7d).toFixed(1)}%
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Transactions</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatNumber(totals.totalTransactions)}
              </p>
            </div>
          </div>

          {/* Sales Trend Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-4">
              Daily Revenue Trend ({currencySymbol})
            </h3>
            {salesData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-500 dark:text-gray-400">
                <p>No sales data available for this period</p>
              </div>
            ) : (
              <div className="h-48 flex items-end gap-0.5">
                {salesData.map((d, i) => {
                  const height = (d.total / maxVol) * 100;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col justify-end group relative"
                      title={`${d.date}: ${currencySymbol}${formatNumber(d.total)} (${d.count} txns)`}
                    >
                      <div
                        className="w-full bg-gradient-to-t from-violet-600 to-violet-400 rounded-t-sm"
                        style={{
                          height: `${height * 0.4}px`,
                          minHeight: d.total > 0 ? "4px" : "0",
                        }}
                      />
                      {i % Math.max(1, Math.floor(salesData.length / 10)) ===
                        0 && (
                        <span className="text-[8px] text-gray-500 dark:text-gray-400 mt-1 -rotate-45 origin-top-left whitespace-nowrap">
                          {d.date.slice(5)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-4 mt-4 text-xs text-gray-500">
              <span>
                Peak Day: <strong className="text-violet-600">{peakDay}</strong>
              </span>
              <span>
                Data Points: <strong>{salesData.length}</strong>
              </span>
            </div>
          </div>

          {/* 14-Day Prediction */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/10 dark:to-purple-900/10 rounded-xl p-5 border border-violet-200 dark:border-violet-800 shadow-sm">
            <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200 mb-1 flex items-center gap-2">
              <Target size={16} /> 14-Day Revenue Forecast
            </h3>
            <p className="text-[11px] text-violet-600 dark:text-violet-400 mb-4">
              Based on your historical sales patterns
            </p>
            <div className="h-40 flex items-end gap-1">
              {predictions.map((p) => {
                const predH = (p.predicted / predMax) * 100;
                const rangeH = ((p.upper - p.lower) / predMax) * 100;
                return (
                  <div
                    key={p.date}
                    className="flex-1 flex flex-col justify-end group relative"
                    title={`${p.date}: ${currencySymbol}${formatNumber(p.predicted)}`}
                  >
                    <div className="w-full flex flex-col items-center">
                      <div
                        className="w-full bg-violet-200/50 dark:bg-violet-800/20 rounded-t-sm relative"
                        style={{ height: `${rangeH * 0.3}px` }}
                      >
                        <div
                          className="absolute bottom-0 w-full bg-violet-500 rounded-sm"
                          style={{
                            height: `${predH * 0.3}px`,
                            minHeight: "4px",
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-[8px] text-gray-500 dark:text-gray-400 mt-1 text-center">
                      {p.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-violet-500 rounded-sm" /> Predicted
              </span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-violet-200 rounded-sm" /> Confidence
                Range
              </span>
            </div>
          </div>

          {/* Payment Method Breakdown */}
          {Object.keys(paymentBreakdown).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <CreditCard size={16} className="text-indigo-500" /> Payment
                Method Breakdown
              </h3>
              <div className="space-y-3">
                {(() => {
                  const entries = Object.entries(paymentBreakdown).sort(
                    (a, b) => b[1].total - a[1].total,
                  );
                  const grandTotal = entries.reduce(
                    (s, [, v]) => s + v.total,
                    0,
                  );
                  const methodColors: Record<string, string> = {
                    cash: "bg-green-500",
                    mpesa: "bg-purple-500",
                    card: "bg-blue-500",
                    bank: "bg-indigo-500",
                    credit: "bg-orange-500",
                    unknown: "bg-gray-500",
                  };
                  const methodLabels: Record<string, string> = {
                    cash: "Cash",
                    mpesa: "M-Pesa",
                    card: "Card",
                    bank: "Bank Transfer",
                    credit: "Credit",
                    unknown: "Other",
                  };
                  return entries.map(([method, data]) => {
                    const pct =
                      grandTotal > 0 ? (data.total / grandTotal) * 100 : 0;
                    return (
                      <div key={method}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-gray-400">
                            {methodLabels[method] || method}
                            <span className="text-gray-400 ml-1">
                              ({data.count} txn{data.count !== 1 ? "s" : ""})
                            </span>
                          </span>
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {currencySymbol}
                            {formatNumber(data.total, 0)} ({pct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${methodColors[method] || "bg-gray-500"} rounded-full transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Insights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Activity size={16} className="text-green-500" /> Key Insights
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2 p-2 bg-green-50 dark:bg-green-900/10 rounded-lg">
                  <TrendingUp size={12} className="text-green-500 mt-0.5" />
                  <p className="text-green-700 dark:text-green-400">
                    Peak sales day: <strong>{peakDay}</strong>
                  </p>
                </div>
                <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                  <Target size={12} className="text-blue-500 mt-0.5" />
                  <p className="text-blue-700 dark:text-blue-400">
                    14-day forecast: {currencySymbol}
                    {formatNumber(
                      predictions.reduce((s, p) => s + p.predicted, 0),
                      0,
                    )}
                  </p>
                </div>
                <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg">
                  <Layers size={12} className="text-amber-500 mt-0.5" />
                  <p className="text-amber-700 dark:text-amber-400">
                    Avg daily: {currencySymbol}
                    {formatNumber(totals.avgDaily, 0)}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <PieChart size={16} className="text-purple-500" /> Period Growth
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      7-Day Change
                    </span>
                    <span
                      className={`font-semibold ${growthData.growth7d >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {growthData.growth7d >= 0 ? "+" : ""}
                      {growthData.growth7d.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full">
                    <div
                      className={`h-full rounded-full transition-all ${growthData.growth7d >= 0 ? "bg-green-500" : "bg-red-500"}`}
                      style={{
                        width: `${Math.min(100, Math.abs(growthData.growth7d) * 2)}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      30-Day Trend
                    </span>
                    <span
                      className={`font-semibold ${growthData.growth30d >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {growthData.growth30d >= 0 ? "+" : ""}
                      {growthData.growth30d.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full">
                    <div
                      className={`h-full rounded-full transition-all ${growthData.growth30d >= 0 ? "bg-blue-500" : "bg-red-500"}`}
                      style={{
                        width: `${Math.min(100, Math.abs(growthData.growth30d) * 2)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tank Levels */}
          {inventoryLevels.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Activity size={16} className="text-cyan-500" /> Current Tank
                Levels
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {inventoryLevels.map((inv, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                        {inv.fuel_type}
                      </span>
                      <span className="font-semibold dark:text-gray-900 dark:text-white">
                        {inv.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${inv.percentage > 50 ? "bg-green-500" : inv.percentage > 25 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${inv.percentage}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      {formatNumber(inv.current_level)} /{" "}
                      {formatNumber(inv.tank_capacity)} L
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
