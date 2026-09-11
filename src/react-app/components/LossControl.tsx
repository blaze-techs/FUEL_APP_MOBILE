/**
 * LossControl.tsx — station shrinkage / loss-control dashboard.
 * Lives in Reports Center as a dedicated loss report, aggregating:
 *  - Tank Monitor variances (negative variance → stock loss)
 *  - Tank Monitor water-phase alerts (loss risk)
 *  - Day Book cash shortfalls (negative variance)
 * Where possible the litre/percent losses are valued at the station's
 * configured fuel price → a total shrinkage exposure in currency.
 */
import { useMemo } from "react";
import {
  ShieldAlert,
  Droplets,
  AlertTriangle,
  Download,
  TrendingDown,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  CLOUD_KEYS,
  type TankReading,
  WATER_ALERT_MM,
  VARIANCE_ALERT_PCT,
  downloadCsv,
} from "@/react-app/lib/forecourt-features";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";

export default function LossControl() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );

  const priceOf = (fuelType: string) => fuelTypeApi.getPriceFor(fuelType) ?? 0;

  type LossRow = {
    kind: "tank-variant" | "tank-water" | "daybook";
    date: string;
    label: string;
    litres: number;
    value: number;
  };

  const rows = useMemo(() => {
    const out: LossRow[] = [];
    for (const r of readings) {
      if (r.variance < 0) {
        const litres = Math.abs(r.variance);
        const price = priceOf(r.fuelType);
        out.push({
          kind: "tank-variant",
          date: r.date?.slice(0, 16).replace("T", " ") ?? "",
          label: `${r.label ?? r.fuelType}: negative variance ${Math.abs(
            r.variancePct ?? 0,
          ).toFixed(1)}%`,
          litres,
          value: litres * price,
        });
      }
      if ((r.waterMm ?? 0) > WATER_ALERT_MM) {
        out.push({
          kind: "tank-water",
          date: r.date?.slice(0, 16).replace("T", " ") ?? "",
          label: `${r.label ?? r.fuelType}: free-water phase ${r.waterMm} mm`,
          litres: 0,
          value: 0,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings]);

  const totalLitres = rows
    .filter((r) => r.kind === "tank-variant")
    .reduce((s, r) => s + r.litres, 0);
  const totalValue = rows
    .filter((r) => r.kind === "tank-variant")
    .reduce((s, r) => s + r.value, 0);
  const waterAlerts = rows.filter((r) => r.kind === "tank-water").length;

  const exportRows = () =>
    downloadCsv("loss-control.csv", [
      ["kind", "date", "detail", "litres", "estimated value"],
      ...rows.map((r) => [
        r.kind,
        r.date,
        r.label,
        r.litres.toFixed(1),
        r.value.toFixed(2),
      ]),
    ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-500" /> Loss control
          (shrinkage from Tank Monitor + Day Book)
        </h3>
        <button
          onClick={exportRows}
          disabled={rows.length === 0}
          className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 disabled:opacity-40"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
          <p className="text-xl font-bold text-red-500">
            {formatNumber(totalLitres)}
          </p>
          <p className="text-[10px] text-gray-500">Loss L</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
          <p className="text-xl font-bold text-red-500">
            {totalValue > 0
              ? `${currencySymbol}${formatNumber(totalValue)}`
              : "—"}
          </p>
          <p className="text-[10px] text-gray-500">Est. value</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
          <p className="text-xl font-bold text-amber-500">{waterAlerts}</p>
          <p className="text-[10px] text-gray-500">Water alerts</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
          <p className="text-xl font-bold">{rows.length}</p>
          <p className="text-[10px] text-gray-500">Loss events</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          <TrendingDown className="w-3.5 h-3.5" /> All clean — no negative
          variances or water alerts logged in the Tank Monitor yet.
        </p>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="min-w-[620px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Issue</th>
                  <th className="py-2 px-3 text-right">Lost L</th>
                  <th className="py-2 px-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.kind}-${i}`}
                    className="border-b border-gray-100 dark:border-gray-700/60"
                  >
                    <td className="py-2 px-3 text-gray-500">{r.date}</td>
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                      {r.kind === "tank-water" ? (
                        <Droplets className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      )}
                      {r.label}
                    </td>
                    <td className="py-2 px-3 text-right text-red-500 font-semibold">
                      {r.litres > 0 ? `-${formatNumber(r.litres)}` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {r.value > 0
                        ? `${currencySymbol}${formatNumber(r.value)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500">
            Indicates variance events beyond {VARIANCE_ALERT_PCT}% plus
            water-phase alerts above {WATER_ALERT_MM} mm. Values are estimated
            at your current configured price for that fuel.
          </p>
        </>
      )}
    </div>
  );
}
