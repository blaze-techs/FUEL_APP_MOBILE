/* AbcInventoryAnalysis — classic Pareto ABC classification of product
 * revenue (Crone/ERP-style): reads the station's POS transactions cloud KV,
 * ranks products, and assigns A (top ~80% of revenue), B (next ~15%),
 * C (remainder). Helps buyers focus stock/cash on the movers.
 */
import { Package } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface PosTxnLike {
  id?: string;
  items?: { name?: string; desc?: string; total?: number; amount?: number }[];
  total?: number;
  payment?: string;
}

interface AbcRow {
  name: string;
  revenue: number;
  share: number;
  cumShare: number;
  klass: "A" | "B" | "C";
}

export default function AbcInventoryAnalysis() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: txns } = useCloudKV<PosTxnLike[]>(
    "pos_transactions",
    stationId,
    [],
  );

  const rows = useMemo<AbcRow[]>(() => {
    const byName = new Map<string, number>();
    for (const t of txns || []) {
      for (const item of t.items || []) {
        const name = item.name || item.desc || "Item";
        const amt = item.total ?? item.amount ?? 0;
        byName.set(name, (byName.get(name) || 0) + amt);
      }
    }
    const sorted = [...byName.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    let cum = 0;
    return sorted.map(([name, revenue]) => {
      cum += revenue;
      const cumShare = total ? (cum / total) * 100 : 0;
      const klass: "A" | "B" | "C" =
        cumShare <= 80 ? "A" : cumShare <= 95 ? "B" : "C";
      return {
        name,
        revenue,
        share: total ? (revenue / total) * 100 : 0,
        cumShare,
        klass,
      };
    });
  }, [txns]);

  const counts = {
    A: rows.filter((r) => r.klass === "A").length,
    B: rows.filter((r) => r.klass === "B").length,
    C: rows.filter((r) => r.klass === "C").length,
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Package size={16} /> ABC Inventory Analysis
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Pareto classification of product revenue from POS history: A = top 80%,
        B = next 15%, C = remainder.
      </p>
      <div className="flex gap-3 mb-3">
        {(["A", "B", "C"] as const).map((k) => (
          <div
            key={k}
            className="flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium bg-gray-100 dark:bg-gray-700"
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${k === "A" ? "bg-emerald-500" : k === "B" ? "bg-amber-500" : "bg-gray-400"}`}
            />
            Class {k}: {counts[k]} items
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No POS transactions yet — classification appears after the first
          sales.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700">
                <th className="py-2">Class</th>
                <th>Product</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Share</th>
                <th className="text-right">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.name}
                  className="border-b border-gray-100 dark:border-gray-700/60"
                >
                  <td className="py-1.5">
                    <span
                      className={`inline-flex w-6 justify-center rounded text-xs font-bold ${r.klass === "A" ? "bg-emerald-100 text-emerald-700" : r.klass === "B" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                    >
                      {r.klass}
                    </span>
                  </td>
                  <td className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                    {r.name}
                  </td>
                  <td className="text-right">
                    {currency}
                    {r.revenue.toLocaleString()}
                  </td>
                  <td className="text-right">{r.share.toFixed(1)}%</td>
                  <td className="text-right">{r.cumShare.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
