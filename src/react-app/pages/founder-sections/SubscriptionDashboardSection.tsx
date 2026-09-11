import { useState, useMemo } from "react";
import {
  TrendingUp,
  Users,
  CreditCard,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  RefreshCw,
  Calendar,
  Globe,
} from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
const CUR = () => getCurrencySymbol(getDetectedCurrency());
import {
  getSubscription,
  getTrial,
  loadPayments,
  loadCoupons,
  checkTrialStatus,
  type PaymentRecord,
  type Subscription,
} from "@/react-app/lib/subscription";

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function SubscriptionDashboardSection({ logAudit }: Props) {
  const sub = getSubscription();
  const trial = getTrial();
  const trialStatus = checkTrialStatus();
  const payments = loadPayments();
  const coupons = loadCoupons();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "all">(
    "30d",
  );

  const stats = useMemo(() => {
    const cutoff =
      timeRange === "all"
        ? 0
        : Date.now() -
          ({ "7d": 7, "30d": 30, "90d": 90 }[timeRange] || 30) * 86400000;
    const filtered = payments.filter(
      (p) => new Date(p.createdAt).getTime() > cutoff,
    );
    const revenue = filtered
      .filter((p) => p.status === "success")
      .reduce((s, p) => s + p.amount, 0);
    const failed = filtered.filter((p) => p.status === "failed").length;
    const refunded = filtered.filter((p) => p.status === "refunded").length;
    const avgOrder = filtered.length > 0 ? revenue / filtered.length : 0;

    const byGateway: Record<string, { revenue: number; count: number }> = {};
    filtered
      .filter((p) => p.status === "success")
      .forEach((p) => {
        if (!byGateway[p.gateway])
          byGateway[p.gateway] = { revenue: 0, count: 0 };
        byGateway[p.gateway].revenue += p.amount;
        byGateway[p.gateway].count++;
      });

    const dailyData: Record<string, number> = {};
    filtered
      .filter((p) => p.status === "success")
      .forEach((p) => {
        const d = new Date(p.createdAt).toISOString().slice(0, 10);
        dailyData[d] = (dailyData[d] || 0) + p.amount;
      });

    const dates = Object.keys(dailyData).sort().slice(-14);
    const chartData = dates.map((d) => ({
      date: d.slice(5),
      amount: dailyData[d],
    }));

    return {
      revenue,
      total: filtered.length,
      failed,
      refunded,
      avgOrder,
      byGateway,
      chartData,
    };
  }, [payments, timeRange]);

  const mrr = useMemo(() => {
    const monthPayments = payments.filter((p) => {
      const d = new Date(p.createdAt);
      const now = new Date();
      return (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear() &&
        p.status === "success"
      );
    });
    return monthPayments.reduce((s, p) => s + p.amount, 0);
  }, [payments]);

  const activeSubs = useMemo(() => {
    const subs: Subscription[] = [];
    if (sub && sub.status === "active") subs.push(sub);
    return subs.length;
  }, [sub]);

  const trialConversionRate = useMemo(() => {
    if (!trial) return 0;
    return sub ? 100 : 0;
  }, [trial, sub]);

  const maxChart = Math.max(...stats.chartData.map((d) => d.amount), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-400" /> Subscription
            Dashboard
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Revenue, MRR, conversion analytics
          </p>
        </div>
        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          {[
            { id: "7d" as const, label: "7D" },
            { id: "30d" as const, label: "30D" },
            { id: "90d" as const, label: "90D" },
            { id: "all" as const, label: "All" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTimeRange(t.id)}
              className={`px-3 py-1 rounded text-xs transition-all ${timeRange === t.id ? "bg-emerald-500/15 text-emerald-300" : "text-gray-500 hover:text-gray-300"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "MRR",
            value: `${CUR()} ${mrr.toLocaleString()}`,
            icon: TrendingUp,
            change: "+12%",
            up: true,
            color: "text-emerald-400",
          },
          {
            label: "Total Revenue",
            value: `${CUR()} ${stats.revenue.toLocaleString()}`,
            icon: CreditCard,
            change: `${CUR()} ${stats.avgOrder.toFixed(0)} avg`,
            up: true,
            color: "text-blue-400",
          },
          {
            label: "Active Subs",
            value: activeSubs.toString(),
            icon: Users,
            change: `${sub?.tierId || "None"}`,
            up: sub?.status === "active",
            color: "text-purple-400",
          },
          {
            label: "Trial Conv.",
            value: `${trialConversionRate}%`,
            icon: Clock,
            change: trialStatus.active
              ? "Trial running"
              : trial
                ? "Expired"
                : "No trial",
            up: trialConversionRate > 0,
            color: "text-amber-400",
          },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-500">{k.label}</span>
              <k.icon size={14} className={k.color} />
            </div>
            <p className="text-lg font-bold text-white">{k.value}</p>
            <div
              className={`flex items-center gap-1 mt-1 text-[10px] ${k.up ? "text-emerald-400" : "text-gray-600"}`}
            >
              {k.change}
            </div>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <BarChart3 size={14} className="text-blue-400" /> Revenue Trend
        </h3>
        {stats.chartData.length > 0 ? (
          <div className="h-40 flex items-end gap-2">
            {stats.chartData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-sm"
                  style={{ height: `${(d.amount / maxChart) * 100}%` }}
                />
                <span className="text-[8px] text-gray-600">{d.date}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-gray-600 text-xs">
            No revenue data for this period
          </div>
        )}
      </div>

      {/* Gateway Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">
            Gateway Performance
          </h3>
          <div className="space-y-2">
            {Object.entries(stats.byGateway).map(([gateway, data]) => (
              <div
                key={gateway}
                className="flex items-center justify-between py-2 border-b border-white/[0.04]"
              >
                <span className="text-xs text-gray-400 capitalize">
                  {gateway}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500">
                    {data.count} txns
                  </span>
                  <span className="text-xs text-white">
                    {CUR()} {data.revenue.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
            {Object.keys(stats.byGateway).length === 0 && (
              <p className="text-xs text-gray-600 py-4 text-center">
                No gateway data
              </p>
            )}
          </div>
        </div>

        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">
            Payment Status
          </h3>
          <div className="space-y-3">
            {[
              {
                label: "Successful",
                value: stats.total - stats.failed - stats.refunded,
                color: "bg-emerald-400",
              },
              { label: "Failed", value: stats.failed, color: "bg-red-400" },
              {
                label: "Refunded",
                value: stats.refunded,
                color: "bg-amber-400",
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">{s.label}</span>
                  <span className="text-white">{s.value}</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${s.color} rounded-full`}
                    style={{
                      width: `${stats.total > 0 ? (s.value / stats.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Payments */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-3">
          Recent Transactions
        </h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {payments.slice(0, 20).map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between py-1.5 border-b border-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${p.status === "success" ? "bg-emerald-400" : p.status === "failed" ? "bg-red-400" : p.status === "refunded" ? "bg-amber-400" : "bg-blue-400"}`}
                />
                <span className="text-xs text-gray-400 font-mono">
                  {p.transactionRef.slice(0, 16)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-500 capitalize">
                  {p.gateway}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500">
                  {p.currency}
                </span>
                <span className="text-xs text-white">
                  {p.amount.toLocaleString()}
                </span>
                <span className="text-[10px] text-gray-600">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
          {payments.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">
              No transactions yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
