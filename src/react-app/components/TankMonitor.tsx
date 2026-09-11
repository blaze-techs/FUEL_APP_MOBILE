import { useMemo, useState } from "react";
import {
  Fuel,
  Plus,
  AlertTriangle,
  Droplets,
  Thermometer,
  Download,
  Trash2,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getFuelLabel, normalizeFuelType } from "@/react-app/config/pricing";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  CLOUD_KEYS,
  classifyReading,
  downloadCsv,
  TEMP_MIN,
  TEMP_MAX,
  VARIANCE_ALERT_PCT,
  WATER_ALERT_MM,
  type TankReading,
} from "@/react-app/lib/forecourt-features";

/**
 * TankMonitor (wet-stock / eVMI-style tank visibility).
 * Reverse-engineered from Shell eVMI, Crone SmartFuel and Advatech ATG:
 * per-fuel-type ATG-style readings (dip level, temperature, free water),
 * variance vs book stock, alert classification and reading history.
 * Book (expected) stock is derived from the station's own Sales Tracking
 * tank readings (pms/ago legacy + fuelTankValuesByType) so it always
 * reflects real user data — never fabricated.
 */
export default function TankMonitor() {
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();
  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      ),
    [state.companyData?.currency, currentStation?.currency],
  );

  const {
    data: readings,
    setData: setReadings,
    loading,
  } = useCloudKV<TankReading[]>(CLOUD_KEYS.tankReadings, stationId, []);

  const [form, setForm] = useState({
    fuelType: "",
    measuredLevel: "",
    temperature: "",
    waterMm: "",
  });
  const [saving, setSaving] = useState(false);

  // Expected (book) stock per fuel type from Sales Tracking tank readings.
  const expectedByType = useMemo(() => {
    const map: Record<string, number> = {};
    const tank = state.fuelTankValuesByType || {};
    for (const [k, v] of Object.entries(tank)) {
      map[k] = v?.closing ?? 0;
    }
    if (map.petrol == null && (state.agoTankClosing ?? 0) > 0) {
      // legacy fallback
    }
    if ((state as any).pmsTankClosing != null)
      map.petrol = (state as any).pmsTankClosing;
    if ((state as any).agoTankClosing != null)
      map.diesel = (state as any).agoTankClosing;
    return map;
  }, [state]);

  const activeTypes = useMemo(
    () => fuelTypeApi.activeFuelTypes,
    [fuelTypeApi.activeFuelTypes],
  );
  const chosenFuel = form.fuelType || activeTypes[0]?.name || "petrol";
  const canonical = normalizeFuelType(chosenFuel) || chosenFuel.toLowerCase();
  const expected = expectedByType[canonical] ?? 0;

  const alerts = useMemo(
    () => readings.filter((r) => r.status !== "ok").slice(0, 6),
    [readings],
  );

  const latestByFuel = useMemo(() => {
    const m = new Map<string, TankReading>();
    for (const r of readings) {
      if (!m.has(r.fuelType) || r.date > m.get(r.fuelType)!.date)
        m.set(r.fuelType, r);
    }
    return m;
  }, [readings]);

  const handleSave = async () => {
    const measured = parseFloat(form.measuredLevel);
    if (!Number.isFinite(measured) || measured < 0) {
      toastError("Enter a valid measured level (litres).");
      return;
    }
    const temperature = form.temperature
      ? parseFloat(form.temperature)
      : undefined;
    const waterMm = form.waterMm ? parseFloat(form.waterMm) : undefined;
    if (
      temperature != null &&
      (temperature < TEMP_MIN || temperature > TEMP_MAX)
    ) {
      toastError(`Temperature must be between ${TEMP_MIN} and ${TEMP_MAX} °C.`);
      return;
    }
    const cls = classifyReading(measured, expected, waterMm);
    const reading: TankReading = {
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fuelType: canonical,
      label: getFuelLabel(chosenFuel),
      date: new Date().toISOString(),
      measuredLevel: measured,
      temperature,
      waterMm,
      expectedLevel: expected,
      variance: cls.variance,
      variancePct: cls.variancePct,
      status: cls.status,
    };
    setSaving(true);
    try {
      setReadings((prev) => [reading, ...prev].slice(0, 500));
      setForm({
        fuelType: "",
        measuredLevel: "",
        temperature: "",
        waterMm: "",
      });
      toastSuccess(`Tank reading saved for ${getFuelLabel(chosenFuel)}.`);
    } catch {
      toastError("Failed to save tank reading.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    setReadings((prev) => prev.filter((r) => r.id !== id));
    toastSuccess("Reading deleted.");
  };

  const exportCsv = () => {
    downloadCsv(`tank-monitor-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        "Date",
        "Fuel",
        "Measured (L)",
        "Expected (L)",
        "Variance (L)",
        "Variance %",
        "Temp °C",
        "Water mm",
        "Status",
      ],
      ...readings.map((r) => [
        r.date,
        r.label,
        r.measuredLevel,
        r.expectedLevel,
        r.variance,
        r.variancePct.toFixed(2),
        r.temperature ?? "",
        r.waterMm ?? "",
        r.status,
      ]),
    ]);
  };

  const statusBadge = (s: TankReading["status"]) =>
    s === "ok"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      : s === "water"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

  return (
    <div className="space-y-5">
      {/* Alert strip (eVMI-style exception alerts) */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 flex flex-wrap gap-2 items-center">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {alerts.length} tank exception{alerts.length === 1 ? "" : "s"} —{" "}
            {alerts
              .slice(0, 2)
              .map((a) => `${a.label} (${a.status})`)
              .join(", ")}
            {alerts.length > 2 ? "…" : ""}
          </span>
          <button
            onClick={() => switchToTab("suppliers")}
            className="ml-auto text-xs font-semibold text-amber-700 dark:text-amber-300 underline"
          >
            Create re-order (Suppliers)
          </button>
        </div>
      )}

      {/* Per-fuel tank cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeTypes.map((ft) => {
          const c = normalizeFuelType(ft.name) || ft.name.toLowerCase();
          const latest = latestByFuel.get(c);
          const exp = expectedByType[c] ?? 0;
          return (
            <div
              key={ft.name}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Fuel className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {getFuelLabel(ft.name)}
                  </span>
                </div>
                {latest && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadge(latest.status)}`}
                  >
                    {latest.status.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Book stock:{" "}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {exp.toLocaleString()} L
                </span>
              </div>
              {latest ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div>
                    Last ATG reading:{" "}
                    <strong>{latest.measuredLevel.toLocaleString()} L</strong> (
                    {latest.variance >= 0 ? "+" : ""}
                    {latest.variancePct.toFixed(1)}%)
                  </div>
                  <div>
                    {latest.waterMm != null && (
                      <span className="inline-flex items-center gap-1 mr-2">
                        <Droplets className="w-3 h-3" /> {latest.waterMm} mm
                      </span>
                    )}
                    {latest.temperature != null && (
                      <span className="inline-flex items-center gap-1">
                        <Thermometer className="w-3 h-3" /> {latest.temperature}{" "}
                        °C
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400">No readings yet.</div>
              )}
              {exp <= 0 && (
                <button
                  onClick={() => switchToTab("suppliers")}
                  className="text-xs font-semibold text-red-600 dark:text-red-400 inline-flex items-center gap-1"
                >
                  <TrendingDown className="w-3 h-3" /> Stock empty — re-order
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* New ATG reading form */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-3 text-sm">
          Record ATG / Dip Reading
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <select
            value={form.fuelType || activeTypes[0]?.name || "petrol"}
            onChange={(e) =>
              setForm((f) => ({ ...f, fuelType: e.target.value }))
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            aria-label="Fuel type"
          >
            {activeTypes.map((ft) => (
              <option key={ft.name} value={ft.name}>
                {getFuelLabel(ft.name)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={form.measuredLevel}
            onChange={(e) =>
              setForm((f) => ({ ...f, measuredLevel: e.target.value }))
            }
            placeholder={`Measured level (L) — book ${expected.toLocaleString()} L`}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            type="number"
            step="0.1"
            value={form.temperature}
            onChange={(e) =>
              setForm((f) => ({ ...f, temperature: e.target.value }))
            }
            placeholder="Temp °C (optional)"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            type="number"
            step="0.1"
            min={0}
            value={form.waterMm}
            onChange={(e) =>
              setForm((f) => ({ ...f, waterMm: e.target.value }))
            }
            placeholder={`Water mm (alert > ${WATER_ALERT_MM})`}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Save Reading
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          A variance above {VARIANCE_ALERT_PCT}% vs book stock or water above{" "}
          {WATER_ALERT_MM} mm raises an exception. Currency context:{" "}
          {currencySymbol}.
        </p>
      </div>

      {/* History */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
            Reading History ({readings.length})
          </h4>
          <button
            onClick={exportCsv}
            disabled={readings.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Loading
            readings…
          </div>
        ) : readings.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No tank readings yet. Record your first ATG/dip reading above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Fuel</th>
                  <th className="px-4 py-2 text-right">Measured</th>
                  <th className="px-4 py-2 text-right">Book</th>
                  <th className="px-4 py-2 text-right">Var %</th>
                  <th className="px-4 py-2">Water/Temp</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {readings.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {new Date(r.date).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                      {r.label}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.measuredLevel.toLocaleString()} L
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.expectedLevel.toLocaleString()} L
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${Math.abs(r.variancePct) > VARIANCE_ALERT_PCT ? "text-amber-600" : "text-green-600"}`}
                    >
                      {r.variancePct >= 0 ? "+" : ""}
                      {r.variancePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                      {r.waterMm != null ? `${r.waterMm} mm` : "—"}
                      {r.temperature != null ? ` / ${r.temperature} °C` : ""}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge(r.status)}`}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="text-gray-400 hover:text-red-500"
                        aria-label="Delete reading"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
