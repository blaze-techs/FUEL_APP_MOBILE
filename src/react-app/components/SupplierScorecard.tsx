/* SupplierScorecard — supplier performance scoring computed from purchase
 * orders (Supplier Management "scorecard"): on-time delivery + short-supply
 * % computed against expected quantities; ranks each supplier so the
 * purchase team can pick winners.
 */
import { Medal } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface PoLike {
  id?: string;
  supplierId?: string;
  supplier?: string;
  expectedQty?: number;
  receivedQty?: number;
  deliveredAt?: string;
  expectedAt?: string;
  status?: string;
}

interface SupplierLike {
  id?: string;
  name?: string;
}

interface ScoreRow {
  supplier: string;
  orders: number;
  onTime: number;
  fillRate: number;
  score: number;
}

export default function SupplierScorecard({
  suppliers,
}: {
  suppliers?: SupplierLike[];
}) {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: orders } = useCloudKV<PoLike[]>(
    "purchase_orders",
    stationId,
    [],
  );
  const { data: suppliersData } = useCloudKV<SupplierLike[]>(
    "suppliers_data",
    stationId,
    [],
  );

  const rows = useMemo<ScoreRow[]>(() => {
    const list = suppliers?.length ? suppliers : suppliersData || [];
    return (list || [])
      .map((s) => {
        const related = (orders || []).filter(
          (o) => o.supplierId === s.id || o.supplier === s.name,
        );
        const done = related.filter(
          (o) => o.status === "delivered" || o.receivedQty != null,
        );
        const onTime = done.filter(
          (o) =>
            o.deliveredAt ||
            !o.expectedAt ||
            (o.deliveredAt || "") <= o.expectedAt,
        ).length;
        const fillValues = done.map((o) => {
          const exp = o.expectedQty || 0;
          const rec = o.receivedQty ?? exp;
          return exp ? rec / exp : 1;
        });
        const fillRate =
          fillValues.length > 0
            ? fillValues.reduce((a, b) => a + b, 0) / fillValues.length
            : 1;
        const score = Math.round(
          (related.length > 0 ? onTime / (done.length || 1) : 1) * 0.5 * 100 +
            fillRate * 0.5 * 100,
        );
        return {
          supplier: s.name || "Supplier",
          orders: related.length,
          onTime:
            done.length > 0 ? Math.round((onTime / done.length) * 100) : 100,
          fillRate: Math.round(fillRate * 100),
          score,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [suppliers, suppliersData, orders]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Medal size={16} /> Supplier Scorecard
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        50% on-time delivery + 50% fill rate. Computed from delivered orders.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No suppliers yet — link purchase orders to suppliers to score them.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700">
              <th className="py-2">Rank</th>
              <th>Supplier</th>
              <th className="text-right">Orders</th>
              <th className="text-right">On-time</th>
              <th className="text-right">Fill rate</th>
              <th className="text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.supplier + idx}
                className="border-b border-gray-100 dark:border-gray-700/60"
              >
                <td className="py-1.5">
                  {idx === 0 ? (
                    <Medal size={14} className="text-amber-500" />
                  ) : (
                    <span className="text-gray-400 text-xs">{idx + 1}</span>
                  )}
                </td>
                <td className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {r.supplier}
                </td>
                <td className="text-right">{r.orders}</td>
                <td className="text-right">{r.onTime}%</td>
                <td className="text-right">{r.fillRate}%</td>
                <td className="text-right">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${r.score >= 80 ? "bg-emerald-100 text-emerald-700" : r.score >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                  >
                    {r.score}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
