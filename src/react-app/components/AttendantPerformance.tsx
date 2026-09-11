/* Attendant Performance — KPI tracker for pump attendants and cashiers. */
import { useMemo, useState } from "react";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import {
  Award,
  BarChart3,
  Download,
  Gauge,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";

const CLOUD_KEY = "attendant_kpi";

interface EmployeeLite {
  id?: string;
  name?: string;
  role?: string;
  status?: string;
}

export interface KpiRecord {
  id: string;
  employeeId: string;
  label: string;
  actual: number;
  target: number;
  unit: "$" | "L" | "tx" | "%";
  period: string; // YYYY-MM
  note?: string;
}

const UNIT_LABEL: Record<KpiRecord["unit"], string> = {
  $: "Sales revenue",
  L: "Volume (L)",
  tx: "Transactions",
  "%": "Variance %",
};

export default function AttendantPerformance() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const { data: employees } = useCloudKV<EmployeeLite[]>(
    "shift_employees",
    stationId,
    [],
  );

  const { data: records, setData: setRecords } = useCloudKV<KpiRecord[]>(
    CLOUD_KEY,
    stationId,
    [],
  );

  const [employeeId, setEmployeeId] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState<KpiRecord["unit"]>("$");
  const [actual, setActual] = useState("");
  const [target, setTarget] = useState("");

  const period = new Date().toISOString().slice(0, 7);

  const addRecord = () => {
    const a = Number(actual);
    const t = Number(target);
    if (!employeeId || !label || !Number.isFinite(a) || !Number.isFinite(t))
      return;
    const rec: KpiRecord = {
      id: `kpi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      employeeId,
      label,
      actual: a,
      target: t,
      unit,
      period,
    };
    setRecords((prev) => [...prev, rec]);
    setLabel("");
    setActual("");
    setTarget("");
  };

  const removeRecord = (id: string) =>
    setRecords((prev) => prev.filter((r) => r.id !== id));

  const byEmployee = useMemo(() => {
    const map = new Map<string, KpiRecord[]>();
    records.forEach((r) => {
      const bucket = map.get(r.employeeId) ?? [];
      bucket.push(r);
      map.set(r.employeeId, bucket);
    });
    return map;
  }, [records]);

  const employeeLabel = (id: string) => {
    const e = employees.find((x) => x.id === id);
    if (!e) return id;
    return e.name ?? id;
  };

  const leaderboard = useMemo(() => {
    const totals = new Map<string, number>();
    records.forEach((r) => {
      if (r.unit !== "$") return;
      totals.set(r.employeeId, (totals.get(r.employeeId) ?? 0) + r.actual);
    });
    return [...totals.entries()]
      .map(([id, sum]) => ({ id, sum }))
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 5);
  }, [records]);

  const exportCsv = () => {
    const rows = [
      ["employee", "label", "unit", "actual", "target", "period"],
      ...records.map((r) => [
        employeeLabel(r.employeeId),
        r.label,
        r.unit,
        r.actual.toFixed(2),
        r.target.toFixed(2),
        r.period,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendant-kpi-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-500" /> Attendant KPI tracker
          </h3>
          <button
            onClick={exportCsv}
            disabled={records.length === 0}
            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-40"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {employees.length === 0 ? (
          <p className="text-xs text-gray-500">
            Employees come from the Shifts sub-tab roster — open the Shifts view
            to add employees, then record their KPIs here.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            >
              <option value="">Employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name ?? e.id}
                </option>
              ))}
            </select>
            <input
              className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              placeholder="KPI label (e.g. Sales target)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as KpiRecord["unit"])}
              className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            >
              {Object.entries(UNIT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              placeholder="Actual"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              inputMode="decimal"
            />
            <input
              className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              placeholder="Target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
            />
            <button
              onClick={addRecord}
              className="h-12 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" /> Record
            </button>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-2">
          <Award className="w-4 h-4 text-amber-500" /> Revenue leaderboard
        </h3>
        {leaderboard.length === 0 ? (
          <p className="text-xs text-gray-500">
            No revenue KPIs yet — record a Sales ($ amount) KPI.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {leaderboard.map((row, idx) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600"
              >
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <TrendingUp
                    className={`w-3.5 h-3.5 ${
                      idx === 0 ? "text-amber-500" : "text-gray-400"
                    }`}
                  />
                  {idx + 1}. {employeeLabel(row.id)}
                </span>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                  {currencySymbol}
                  {formatNumber(row.sum)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* All records grouped by employee */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-amber-500" /> KPI records (
          {records.length})
        </h3>
        {records.length === 0 ? (
          <p className="text-xs text-gray-500">
            Record an actual vs target above to start tracking an attendant.
          </p>
        ) : (
          <div className="space-y-3">
            {[...byEmployee.keys()].map((empId) => (
              <div key={empId}>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-gray-500" />
                  {employeeLabel(empId)}
                </p>
                <div className="space-y-1.5">
                  {(byEmployee.get(empId) ?? []).map((r) => {
                    const pct =
                      r.target > 0
                        ? Math.min(100, (r.actual / r.target) * 100)
                        : 0;
                    const unitSymbol =
                      r.unit === "$"
                        ? currencySymbol
                        : r.unit === "L"
                          ? "L"
                          : r.unit === "tx"
                            ? "tx"
                            : "%";
                    return (
                      <div
                        key={r.id}
                        className="rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5 text-amber-500" />
                            {r.label} · {UNIT_LABEL[r.unit]}
                          </span>
                          <button
                            onClick={() => removeRecord(r.id)}
                            className="text-red-400 hover:text-red-500"
                            aria-label="delete kpi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="mt-1 text-sm font-bold text-gray-800 dark:text-gray-100">
                          {r.unit === "$"
                            ? `${currencySymbol}${formatNumber(r.actual)}`
                            : `${formatNumber(r.actual)}${unitSymbol}`}{" "}
                          of{" "}
                          {r.unit === "$"
                            ? `${currencySymbol}${formatNumber(r.target)}`
                            : `${formatNumber(r.target)}${unitSymbol}`}{" "}
                          target
                        </p>
                        <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-600 overflow-hidden">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {r.period} · {pct.toFixed(0)}%
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] text-gray-400 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5" /> KPIs sync via {CLOUD_KEY} cloud
          envelope.
        </p>
      </div>
    </div>
  );
}
