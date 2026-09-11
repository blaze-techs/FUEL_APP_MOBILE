import { useMemo } from "react";
import { Fuel, Users, Download, Clock, TrendingUp } from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getFuelLabel } from "@/react-app/config/pricing";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { downloadCsv } from "@/react-app/lib/forecourt-features";

interface ShiftEntry {
  id?: string;
  employeeId?: string;
  employeeName?: string;
  name?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  hoursWorked?: number;
}

interface EmployeeEntry {
  id?: string;
  name?: string;
  role?: string;
  status?: string;
}

/**
 * NozzleAnalysis — nozzle-wise + attendant-wise sales analysis
 * (Codelab FMS "Nozzle wise / Dispensing unit wise Sales" +
 * "Salesman wise Day Book"). All figures derive from the user's real
 * pump readings (fuelPumpsByType) and saved shift records — nothing
 * fabricated.
 */
export default function NozzleAnalysis() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const fuelTypeApi = useStationFuelTypes();
  const stationId = currentStation?.id;
  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      ),
    [state.companyData?.currency, currentStation?.currency],
  );

  const { data: shifts } = useCloudKV<ShiftEntry[]>(
    "shift_data",
    stationId,
    [],
  );
  const { data: employees } = useCloudKV<EmployeeEntry[]>(
    "shift_employees",
    stationId,
    [],
  );

  // Nozzle-wise (per-pump) analysis. When a saved shift has no stored amount
  // (salesKsh missing/0), value the dispensed litres at the station's current
  // configured price so the nozzle report is never blank on amounts.
  const pumpRows = useMemo(() => {
    const pumps = state.fuelPumpsByType || {};
    const rows: {
      id: string;
      label: string;
      pumpId: string;
      salesL: number;
      salesAmount: number;
      opening: number;
      closing: number;
    }[] = [];
    let totalL = 0;
    for (const [type, list] of Object.entries(pumps)) {
      (list as any[]).forEach((p: any) => {
        const salesL = p?.salesL ?? (p?.closingL ?? 0) - (p?.openingL ?? 0);
        const stored = Number(p?.salesKsh ?? 0);
        const price = fuelTypeApi.getPriceFor(getFuelLabel(type)) ?? 0;
        rows.push({
          id: `${type}-${p?.id ?? Math.random()}`,
          label: getFuelLabel(type),
          pumpId: p?.id ?? "—",
          salesL,
          salesAmount: stored > 0 ? stored : salesL * price,
          opening: p?.openingL ?? 0,
          closing: p?.closingL ?? 0,
        });
        totalL += salesL;
      });
    }
    return { rows, totalL };
  }, [state.fuelPumpsByType, fuelTypeApi]);

  // Attendant (salesman) day book — shifts with employee names + hours.
  const attendantRows = useMemo(() => {
    const empMap = new Map<string, EmployeeEntry>();
    for (const e of employees) if (e.id) empMap.set(e.id, e);
    const byShift = (shifts || []).filter(Boolean) as ShiftEntry[];
    const agg = new Map<
      string,
      { name: string; shifts: number; hours: number; lastDate: string }
    >();
    for (const s of byShift) {
      const name =
        s.employeeName ||
        s.name ||
        (s.employeeId && empMap.get(s.employeeId)?.name) ||
        "Unassigned";
      const rec = agg.get(name) || { name, shifts: 0, hours: 0, lastDate: "" };
      rec.shifts += 1;
      rec.hours += s.hoursWorked ?? hoursBetween(s.checkIn, s.checkOut) ?? 0;
      if (s.date && (!rec.lastDate || s.date > rec.lastDate))
        rec.lastDate = s.date;
      agg.set(name, rec);
    }
    return [...agg.values()].sort((a, b) => b.shifts - a.shifts);
  }, [shifts, employees]);

  const exportCsv = () => {
    downloadCsv(
      `nozzle-attendant-analysis-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["--- NOZZLE-WISE SALES ---"],
        [
          "Fuel",
          "Pump",
          "Opening (L)",
          "Closing (L)",
          "Dispensed (L)",
          "Amount",
        ],
        ...pumpRows.rows.map((r) => [
          r.label,
          r.pumpId,
          r.opening,
          r.closing,
          r.salesL,
          r.salesAmount,
        ]),
        [],
        ["--- ATTENDANT DAY BOOK ---"],
        ["Attendant", "Shifts", "Hours", "Last Shift Date"],
        ...attendantRows.map((a) => [
          a.name,
          a.shifts,
          a.hours.toFixed(2),
          a.lastDate,
        ]),
      ],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Nozzle & Attendant Analysis
          </h3>
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Nozzle-wise */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <Fuel className="w-4 h-4 text-amber-500" /> Nozzle-wise Sales (current
          readings)
        </h4>
        {pumpRows.rows.length === 0 ? (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            No pump readings yet — add a pump in Sales Tracking.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2">Fuel</th>
                  <th className="px-4 py-2">Pump</th>
                  <th className="px-4 py-2 text-right">Dispensed (L)</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Share</th>
                  <th className="px-4 py-2 w-40">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {pumpRows.rows.map((r) => {
                  const share =
                    pumpRows.totalL > 0
                      ? (r.salesL / pumpRows.totalL) * 100
                      : 0;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                        {r.label}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {r.pumpId}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {formatNumber(r.salesL, 1)} L
                      </td>
                      <td className="px-4 py-2 text-right">
                        {currencySymbol} {formatNumber(r.salesAmount, 2)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">
                        {share.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2">
                        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.min(100, share)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attendant day book */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-500" /> Attendant Day Book
        </h4>
        {attendantRows.length === 0 ? (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            No shifts recorded yet — schedule a shift in Team Manager → Shifts.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2">Attendant</th>
                  <th className="px-4 py-2 text-right">Shifts</th>
                  <th className="px-4 py-2 text-right">Hours</th>
                  <th className="px-4 py-2">Last Shift</th>
                </tr>
              </thead>
              <tbody>
                {attendantRows.map((a) => (
                  <tr
                    key={a.name}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                      {a.name}
                    </td>
                    <td className="px-4 py-2 text-right">{a.shifts}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {a.hours.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                      {a.lastDate || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function hoursBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return null;
  return (t2 - t1) / 3600000;
}
