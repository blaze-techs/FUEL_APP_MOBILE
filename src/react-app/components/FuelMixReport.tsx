/* FuelMixReport — eVMI/sales-analytics fuel-mix view: aggregates POS
 * transaction items by fuel label and shows the volume vs value mix with
 * percentage bars. Computed from the shared `pos_transactions` cloud KV.
 */
import { PieChart } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface PosItemLike {
  name?: string;
  desc?: string;
  quantity?: number;
  qty?: number;
  total?: number;
  amount?: number;
}

interface PosTxnLike {
  items?: PosItemLike[];
}

interface MixRow {
  fuel: string;
  litres: number;
  value: number;
  volumeShare: number;
  valueShare: number;
}

export default function FuelMixReport() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: txns } = useCloudKV<PosTxnLike[]>(
    "pos_transactions",
    stationId,
    [],
  );

  const rows = useMemo<MixRow[]>(() => {
    const byFuel = new Map<string, { litres: number; value: number }>();
    for (const t of txns || []) {
      for (const item of t.items || []) {
        const fuel = item.name || item.desc || "Fuel";
        const litres = item.quantity ?? item.qty ?? 0;
        const value = item.total ?? item.amount ?? 0;
        const acc = byFuel.get(fuel) || { litres: 0, value: 0 };
        acc.litres += litres;
        acc.value += value;
        byFuel.set(fuel, acc);
      }
    }
    const totalL = [...byFuel.values()].reduce((s, r) => s + r.litres, 0);
    const totalV = [...byFuel.values()].reduce((s, r) => s + r.value, 0);
    return [...byFuel.entries()]
      .map(([fuel, { litres, value }]) => ({
        fuel,
        litres,
        value,
        volumeShare: totalL ? (litres / totalL) * 100 : 0,
        valueShare: totalV ? (value / totalV) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [txns]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <PieChart size={16} /> Fuel Mix
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Volume vs revenue mix across fuel types from POS history.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No POS sales yet — the mix appears after the first fuel sale.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.fuel}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {r.fuel}
                </span>
                <span className="text-gray-500">
                  {r.litres.toLocaleString()} L • {currency}
                  {r.value.toLocaleString()}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${Math.min(100, r.valueShare)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {r.volumeShare.toFixed(1)}% of volume •{" "}
                {r.valueShare.toFixed(1)}% of revenue
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
