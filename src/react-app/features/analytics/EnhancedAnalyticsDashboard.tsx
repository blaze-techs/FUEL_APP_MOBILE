/**
 * Enhanced Analytics Dashboard Component
 * Advanced real-time analytics with predictive insights and AI-powered recommendations
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
} from "recharts";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  ShoppingCart,
  AlertTriangle,
  Zap,
  Brain,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import { formatCurrency } from "@/react-app/lib/currency";
import {
  dataCache,
  usePerformanceMonitor,
} from "@/react-app/lib/enhanced/performance";

interface AnalyticsData {
  timestamp: string;
  value: number;
  label: string;
}

interface MetricCard {
  title: string;
  value: number;
  change: number;
  icon: React.ReactNode;
  color: string;
}

interface Prediction {
  metric: string;
  predictedValue: number;
  confidence: number;
  trend: "up" | "down" | "stable";
  recommendation: string;
}

const EnhancedAnalyticsDashboard: React.FC = () => {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id || "";
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "1y">(
    "30d",
  );
  const [loading, setLoading] = useState(true);
  const [salesData, setSalesData] = useState<AnalyticsData[]>([]);
  const [inventoryData, setInventoryData] = useState<AnalyticsData[]>([]);
  const [customerData, setCustomerData] = useState<AnalyticsData[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [metrics, setMetrics] = useState<MetricCard[]>([]);

  const performanceMetrics = usePerformanceMonitor();

  // Fetch analytics data with caching. Customer traffic is derived from
  // real customer-linked sales (or a real customer phone/name on legacy sales);
  // never from a guessed revenue/transaction ratio.
  const fetchAnalyticsData = useCallback(async () => {
    if (!stationId) {
      setSalesData([]);
      setCustomerData([]);
      setInventoryData([]);
      setMetrics([]);
      setLoading(false);
      return;
    }

    const cacheKey = `analytics_${stationId}_${timeRange}`;
    const cached = dataCache.get(cacheKey);

    if (cached) {
      setSalesData(cached.salesData);
      setInventoryData(cached.inventoryData);
      setCustomerData(cached.customerData);
      setMetrics(cached.metrics);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const days =
        timeRange === "7d"
          ? 7
          : timeRange === "30d"
            ? 30
            : timeRange === "90d"
              ? 90
              : 365;

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);

      const previousEndDate = new Date(startDate);
      const previousStartDate = new Date(previousEndDate);
      previousStartDate.setDate(previousStartDate.getDate() - days);

      // Prefer the canonical sales_enhanced table. It contains customer_id,
      // so customer analytics can be based on real relationships instead of
      // synthetic estimates. Fall back to the legacy sales table only when the
      // canonical table has no rows.
      const { data: enhancedSales, error: enhancedSalesError } = await supabase
        .from("sales_enhanced")
        .select("sale_date, total_amount, customer_id")
        .eq("station_id", stationId)
        .gte("sale_date", startDate.toISOString())
        .lt("sale_date", endDate.toISOString())
        .order("sale_date", { ascending: true });

      let salesRows: Array<Record<string, unknown>> = [];
      let customerRows: Array<Record<string, unknown>> = [];
      let previousRevenue = 0;
      let previousCustomers = 0;

      if (!enhancedSalesError && enhancedSales && enhancedSales.length > 0) {
        salesRows = enhancedSales.map((row) => ({
          created_at: row.sale_date,
          total_amount: Number(row.total_amount) || 0,
        }));
        customerRows = enhancedSales.map((row) => ({
          created_at: row.sale_date,
          customer_id: row.customer_id,
        }));

        const { data: previousSales } = await supabase
          .from("sales_enhanced")
          .select("total_amount, customer_id")
          .eq("station_id", stationId)
          .gte("sale_date", previousStartDate.toISOString())
          .lt("sale_date", previousEndDate.toISOString());

        previousRevenue = (previousSales || []).reduce(
          (sum, row) => sum + (Number(row.total_amount) || 0),
          0,
        );
        previousCustomers = new Set(
          (previousSales || [])
            .map((row) => String(row.customer_id || "").trim())
            .filter(Boolean),
        ).size;
      } else {
        const { data: legacySales, error: legacySalesError } = await supabase
          .from("sales")
          .select("created_at, total_amount, customer_phone, customer_name")
          .eq("station_id", stationId)
          .gte("created_at", startDate.toISOString())
          .lt("created_at", endDate.toISOString())
          .order("created_at", { ascending: true });

        if (legacySalesError && enhancedSalesError) {
          throw enhancedSalesError;
        }

        salesRows = (legacySales || []).map((row) => ({
          created_at: row.created_at,
          total_amount: Number(row.total_amount) || 0,
        }));
        customerRows = (legacySales || []).map((row) => ({
          created_at: row.created_at,
          customer_id:
            String(row.customer_phone || "").trim() ||
            String(row.customer_name || "").trim() ||
            null,
        }));

        const { data: previousSales } = await supabase
          .from("sales")
          .select("total_amount, customer_phone, customer_name")
          .eq("station_id", stationId)
          .gte("created_at", previousStartDate.toISOString())
          .lt("created_at", previousEndDate.toISOString());

        previousRevenue = (previousSales || []).reduce(
          (sum, row) => sum + (Number(row.total_amount) || 0),
          0,
        );
        previousCustomers = new Set(
          (previousSales || [])
            .map(
              (row) =>
                String(row.customer_phone || "").trim() ||
                String(row.customer_name || "").trim(),
            )
            .filter(Boolean),
        ).size;
      }

      // Inventory is informational; if the deployed schema doesn't expose
      // these legacy fields, keep analytics usable instead of failing the
      // entire dashboard.
      const { data: inventory } = await supabase
        .from("inventory")
        .select("created_at, quantity")
        .eq("station_id", stationId)
        .gte("created_at", startDate.toISOString())
        .lt("created_at", endDate.toISOString())
        .order("created_at", { ascending: true });

      const processedSales = processDailyData(salesRows, "total_amount");
      const processedInventory = processDailyData(inventory || [], "quantity");
      const processedCustomers = processDailyCustomerData(customerRows);

      const currentRevenue = salesRows.reduce(
        (sum, row) => sum + (Number(row.total_amount) || 0),
        0,
      );
      const currentCustomers = new Set(
        customerRows
          .map((row) => String(row.customer_id || "").trim())
          .filter(Boolean),
      ).size;

      const calculatedMetrics = calculateMetrics(
        processedSales,
        processedCustomers,
        previousRevenue,
        previousCustomers,
      );

      setSalesData(processedSales);
      setInventoryData(processedInventory);
      setCustomerData(processedCustomers);
      setMetrics(calculatedMetrics);

      dataCache.set(
        cacheKey,
        {
          salesData: processedSales,
          inventoryData: processedInventory,
          customerData: processedCustomers,
          metrics: calculatedMetrics,
        },
        300000,
      );

      generatePredictions(processedSales, processedCustomers);
    } catch (error) {
      console.error("Error fetching analytics:", error);
      setSalesData([]);
      setInventoryData([]);
      setCustomerData([]);
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  }, [stationId, timeRange]);

  useEffect(() => {
    fetchAnalyticsData();
  }, [fetchAnalyticsData]);

  const processDailyData = (
    data: any[],
    valueField: string,
  ): AnalyticsData[] => {
    const dailyMap = new Map<string, number>();

    data.forEach((item) => {
      const date = new Date(item.created_at).toISOString().split("T")[0];
      const currentValue = dailyMap.get(date) || 0;
      dailyMap.set(date, currentValue + (item[valueField] || 0));
    });

    return Array.from(dailyMap.entries()).map(([date, value]) => ({
      timestamp: date,
      value,
      label: new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));
  };

  const processDailyCustomerData = (
    rows: Array<Record<string, unknown>>,
  ): AnalyticsData[] => {
    const daily = new Map<string, Set<string>>();

    for (const row of rows) {
      const date = new Date(String(row.created_at || "")).toISOString().split("T")[0];
      const customerId = String(row.customer_id || "").trim();
      if (!date || !customerId) continue;
      if (!daily.has(date)) daily.set(date, new Set());
      daily.get(date)!.add(customerId);
    }

    return Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, ids]) => ({
        timestamp: date,
        value: ids.size,
        label: new Date(date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      }));
  };

  const calculateMetrics = (
    sales: AnalyticsData[],
    customers: AnalyticsData[],
    previousRevenue: number,
    previousCustomers: number,
  ): MetricCard[] => {
    const totalRevenue = sales.reduce((sum, day) => sum + day.value, 0);
    const transactionCount = sales.reduce(
      (sum, day) => sum + (day as AnalyticsData & { count?: number }).count || 0,
      0,
    );
    const avgTransaction =
      transactionCount > 0 ? totalRevenue / transactionCount : 0;
    const totalCustomers = customers.reduce((sum, day) => sum + day.value, 0);

    const revenueChange =
      previousRevenue > 0
        ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
        : 0;
    const previousAvg =
      previousCustomers > 0 ? previousRevenue / previousCustomers : 0;
    const avgChange =
      previousAvg > 0
        ? ((avgTransaction - previousAvg) / previousAvg) * 100
        : 0;
    const customerChange =
      previousCustomers > 0
        ? ((new Set(customers.map((d) => d.timestamp)).size - previousCustomers) /
            previousCustomers) *
          100
        : 0;

    return [
      {
        title: "Total Revenue",
        value: totalRevenue,
        change: Number.isFinite(revenueChange) ? revenueChange : 0,
        icon: <DollarSign className="w-5 h-5" />,
        color: "text-green-500",
      },
      {
        title: "Avg Transaction",
        value: avgTransaction,
        change: Number.isFinite(avgChange) ? avgChange : 0,
        icon: <ShoppingCart className="w-5 h-5" />,
        color: "text-blue-500",
      },
      {
        title: "Customer Visits",
        value: totalCustomers,
        change: Number.isFinite(customerChange) ? customerChange : 0,
        icon: <Users className="w-5 h-5" />,
        color: "text-purple-500",
      },
      {
        title: "Growth Rate",
        value: Number.isFinite(revenueChange) ? revenueChange : 0,
        change: Number.isFinite(revenueChange) ? revenueChange : 0,
        icon:
          revenueChange >= 0 ? (
            <TrendingUp className="w-5 h-5" />
          ) : (
            <TrendingDown className="w-5 h-5" />
          ),
        color: revenueChange >= 0 ? "text-green-500" : "text-red-500",
      },
    ];
  };

  const generatePredictions = (
    sales: AnalyticsData[],
    customers: AnalyticsData[],
  ) => {
    const predictTrend = (data: AnalyticsData[]) => {
      const n = data.length;
      if (n < 2)
        return { trend: "stable" as const, value: data[0]?.value || 0 };

      const sumX = (n * (n - 1)) / 2;
      const sumY = data.reduce((sum, d) => sum + d.value, 0);
      const sumXY = data.reduce((sum, d, i) => sum + i * d.value, 0);
      const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
      const denominator = n * sumXX - sumX * sumX;
      const slope =
        denominator !== 0
          ? (n * sumXY - sumX * sumY) / denominator
          : 0;
      const intercept = (sumY - slope * sumX) / n;
      const nextValue = Math.max(0, slope * n + intercept);
      const trend: "up" | "down" | "stable" =
        slope > 0.05 ? "up" : slope < -0.05 ? "down" : "stable";

      // Confidence is a data-sufficiency indicator, not a fabricated fixed
      // percentage. More observations and less volatility produce more stable
      // estimates; it is intentionally capped below 100%.
      const mean = n > 0 ? sumY / n : 0;
      const variance =
        n > 1
          ? data.reduce((sum, d) => sum + Math.pow(d.value - mean, 2), 0) / n
          : 0;
      const coefficient =
        mean > 0 ? Math.sqrt(Math.max(0, variance)) / mean : 1;
      const confidence = Math.max(
        35,
        Math.min(95, Math.round(100 - coefficient * 35 + Math.min(n, 30))),
      );

      return { trend, value: nextValue, confidence };
    };

    const salesPrediction = predictTrend(sales);
    const customerPrediction = predictTrend(customers);

    const newPredictions: Prediction[] = [
      {
        metric: "Next Day Sales",
        predictedValue: salesPrediction.value,
        confidence: salesPrediction.confidence,
        trend: salesPrediction.trend,
        recommendation:
          salesPrediction.trend === "up"
            ? "Review stock levels against the observed sales trend."
            : salesPrediction.trend === "down"
              ? "Review recent sales drivers before changing inventory."
              : "Maintain current operating levels while monitoring demand.",
      },
      {
        metric: "Customer Traffic",
        predictedValue: customerPrediction.value,
        confidence: customerPrediction.confidence,
        trend: customerPrediction.trend,
        recommendation:
          customerPrediction.trend === "up"
            ? "Review staffing and forecourt capacity against observed traffic."
            : customerPrediction.trend === "down"
              ? "Review recent customer activity and service issues."
              : "Continue monitoring customer activity.",
      },
    ];

    setPredictions(newPredictions);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-900 dark:text-white mb-2">
            {label}
          </p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {formatCurrency(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-4 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
          Enhanced Analytics
        </h2>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="90d">Last 90 Days</SelectItem>
            <SelectItem value="1y">Last Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Performance Monitor Display */}
      {performanceMetrics.lcp && performanceMetrics.lcp > 2500 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm font-medium">
                Performance alert: Page load is slower than optimal (LCP:{" "}
                {Math.round(performanceMetrics.lcp)}ms)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {metric.title}
              </CardTitle>
              <div className={metric.color}>{metric.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {metric.title.includes("Rate")
                  ? `${metric.value.toFixed(1)}%`
                  : formatCurrency(metric.value)}
              </div>
              <div
                className={`text-xs mt-1 ${metric.change >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {metric.change >= 0 ? "+" : ""}
                {metric.change.toFixed(1)}% from previous period
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AI Predictions */}
      <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI-Powered Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {predictions.map((prediction, index) => (
              <div
                key={index}
                className="bg-white dark:bg-slate-800 p-4 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {prediction.metric}
                  </span>
                  <Badge
                    variant={
                      prediction.trend === "up"
                        ? "default"
                        : prediction.trend === "down"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {prediction.trend === "up" ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : prediction.trend === "down" ? (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    ) : null}
                    {prediction.trend.toUpperCase()}
                  </Badge>
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  {formatCurrency(prediction.predictedValue)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Confidence: {prediction.confidence}%
                </div>
                <div className="flex items-start gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                  <Zap className="w-4 h-4 mt-0.5" />
                  <span>{prediction.recommendation}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales">Sales Trends</TabsTrigger>
          <TabsTrigger value="customers">Customer Analytics</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle>Sales Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={salesData}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#8884d8"
                    fillOpacity={1}
                    fill="url(#colorSales)"
                    name="Revenue"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <CardHeader>
              <CardTitle>Customer Traffic</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={customerData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="value" fill="#82ca9d" name="Customers" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Levels</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={inventoryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#ffc658"
                    name="Stock Level"
                  />
                  <ReferenceLine
                    y={20}
                    stroke="red"
                    strokeDasharray="3 3"
                    label="Low Stock Alert"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EnhancedAnalyticsDashboard;
