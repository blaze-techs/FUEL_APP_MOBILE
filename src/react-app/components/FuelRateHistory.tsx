/* FuelRateHistory — reverse-engineered Codelab FMS "fuel rate history"
 * (price-change audit trail): every configured price change is captured
 * from the Fuel Type Manager / Price Board via the existing
 * `price_history_data` cloud key, rendered as a per-fuel timeline with
 * change amounts and % moves. Pure computed view — dedupes same-price
 * rewrites so the timeline shows genuine changes only.
 */
import { History, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { getFuelLabel } from "@/react-app/config/pricing";

interface PriceChangeLike {
  id?: string;
  date?: string;
  timestamp?: string;
  changedAt?: string;
  fuelType?: string;
  label?: string;
  oldPrice?: number;
  newPrice?: number;
  price?: number;
  changedBy?: string;
  reason?: string;
}

export default function FuelRateHistory() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: history } = useCloudKV<PriceChangeLike[]>(
    "price_history_data",
    stationId,
    [],
  );

  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    const out: (PriceChangeLike & { change: number; changePct: number })[] = [];
    const sorted = [...(history || [])].sort((a, b) =>
      (a.date || a.timestamp || a.changedAt || "").localeCompare(
        b.date || b.timestamp || b.changedAt || "",
      ),
    );
    for (const h of sorted) {
      const fuel = h.fuelType || h.label || "Fuel";
      const old = h.oldPrice ?? seen.get(fuel);
      const price = h.newPrice ?? h.price ?? 0;
      seen.set(fuel, price);
      const change = price - (old ?? price);
      const changePct = old ? (change / old) * 100 : 0;
      out.push({ ...h, fuelType: fuel, change, changePct });
    }
    return out.reverse();
  }, [history]);

  const byFuel = useMemo(() => {
    const map = new Map<
      string,
      (PriceChangeLike & { change: number; changePct: number })[]
    >();
    for (const r of rows) {
      const fuel = r.fuelType || "Fuel";
      const group = map.get(fuel) ?? [];
      group.push(r);
      map.set(fuel, group);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-purple-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Fuel Rate History
          </h4>
          <p className="text-xs text-gray-500">
            Price-change audit timeline per fuel (Codelab rate history), from
            the station's recorded price changes.
          </p>
        </div>
      </div>

      {byFuel.length === 0 ? (
        <p className="text-xs text-gray-500">
          No price changes recorded yet — change a price in Fuel Type Manager,
          Price Board, Price Scheduler, Dashboard or Fuel Price Finder and it
          appears here.
        </p>
      ) : (
        <div className="space-y-3">
          {byFuel.map(([fuel, rowsForFuel]) => (
            <div key={fuel}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                {getFuelLabel(fuel)}
              </p>
              <div className="space-y-1">
                {rowsForFuel.map((r, i) => (
                  <div
                    key={r.id || i}
                    className="flex items-center justify-between gap-2 text-xs rounded border border-gray-100 dark:border-gray-800 px-2 py-1.5"
                  >
                    <span className="whitespace-nowrap">
                      {r.date || r.timestamp || r.changedAt
                        ? new Date(
                            (r.date || r.timestamp || r.changedAt) as string,
                          ).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </span>
                    <span className="font-medium whitespace-nowrap">
                      {currency}
                      {(r.newPrice ?? r.price ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                      /L
                    </span>
                    {r.changedBy && (
                      <span
                        className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 truncate max-w-[120px]"
                        title={r.reason || r.changedBy}
                      >
                        {r.changedBy}
                      </span>
                    )}
                    {r.change !== 0 && (
                      <span
                        className={`flex items-center gap-0.5 whitespace-nowrap ${
                          r.change > 0 ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        {r.change > 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {r.change > 0 ? "+" : ""}
                        {r.changePct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
