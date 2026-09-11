/**
 * TankCalibration.tsx — wetstock tank calibration / strapping (dip chart)
 * sub-tab inside Stock Management (Advatech ATG / Dover DFS calibration
 * concept). Per-fuel tank geometry → dip-to-volume + ullage conversion.
 * Saved to cloud key tank_calibration via useCloudKV (cross-device).
 */
import { useEffect, useMemo, useState } from "react";
import { Gauge, Plus, Trash2, Ruler, Download, Fuel } from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankCalibration,
  dipToVolume,
  ullage,
  cylinderVolumeFraction,
  downloadCsv,
} from "@/react-app/lib/forecourt-features";
import { formatNumber } from "@/react-app/utils/formatUtils";

export default function TankCalibration() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();

  const { data: calibrations, setData: setCalibrations } = useCloudKV<
    TankCalibration[]
  >(CLOUD_KEYS.tankCalibration, stationId, []);

  // form
  const [fuel, setFuel] = useState("");
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [diameter, setDiameter] = useState("");
  const [length, setLength] = useState("");
  const [dip, setDip] = useState("");

  const fuelOptions = useMemo(() => {
    const fts = fuelTypeApi.fuelTypes ?? [];
    const opts = fts
      .map((f) => fuelTypeApi.labelOf(f.name ?? ""))
      .filter(Boolean);
    const uniq = [...new Set(opts)];
    return uniq.length > 0 ? uniq : ["Super Petrol", "Diesel"];
  }, [fuelTypeApi]);

  // Default the fuel select to the first option once fuelTypes load (so
  // Add is never silently rejected by an empty value).
  useEffect(() => {
    if (fuelOptions.length > 0 && !fuelOptions.includes(fuel))
      setFuel(fuelOptions[0]);
  }, [fuelOptions, fuel]);

  const addCalibration = () => {
    const cap = Number(capacity);
    const dia = Number(diameter);
    if (!fuel || !(cap > 0) || !(dia > 0)) return;
    const entry: TankCalibration = {
      id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fuelType: fuel,
      label:
        label ||
        `${fuel} tank (${formatNumber(cap || 0, 0)} L, ∅ ${diameter} mm)`,
      capacity: cap,
      diameterMm: dia,
      lengthMm: Number(length) || 0,
    };
    setCalibrations((prev) => [...prev, entry]);
    setLabel("");
    setCapacity("");
    setDiameter("");
    setLength("");
  };

  const removeCalibration = (id: string) =>
    setCalibrations((prev) => prev.filter((c) => c.id !== id));

  const exportRows = () =>
    downloadCsv("tank-calibration.csv", [
      ["fuel", "label", "capacity (L)", "diameter (mm)", "length (mm)"],
      ...calibrations.map((c) => [
        c.fuelType,
        c.label,
        c.capacity,
        c.diameterMm,
        c.lengthMm,
      ]),
    ]);

  const dipNum = Number(dip);

  return (
    <div className="space-y-4">
      {/* +--------- add calibration tank geometry --------- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Ruler className="w-4 h-4 text-amber-500" /> Define tank geometry
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
          >
            <option value="">Fuel…</option>
            {fuelOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="Label (e.g. PMS 1)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="Capacity (L)"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            inputMode="decimal"
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="∅ diameter (mm)"
            value={diameter}
            onChange={(e) => setDiameter(e.target.value)}
            inputMode="decimal"
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="Length (mm)"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            inputMode="decimal"
          />
          <button
            onClick={addCalibration}
            className="h-12 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {calibrations.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">
                {calibrations.length} calibrated tank
                {calibrations.length !== 1 ? "s" : ""}
              </p>
              <button
                onClick={exportRows}
                className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Export CSV
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {calibrations.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3 flex items-center justify-between"
                >
                  <div className="text-sm">
                    <p className="font-medium text-gray-800 dark:text-gray-200">
                      {c.label}
                    </p>
                    <p className="text-xs text-gray-500">
                      {c.fuelType} · {formatNumber(c.capacity, 0)} L · ∅{" "}
                      {c.diameterMm} mm
                      {c.lengthMm > 0 ? ` · ${c.lengthMm} mm long` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => removeCalibration(c.id)}
                    className="text-red-500 hover:text-red-600"
                    aria-label="remove calibration"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* +--------- dip → volume / ullage converter --------- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-amber-500" /> Dip → volume / ullage
          converter
        </h3>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <input
            value={dip}
            onChange={(e) => setDip(e.target.value)}
            inputMode="decimal"
            placeholder="Water level / dip (mm)"
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm w-56"
          />
          <span className="text-xs text-gray-500">
            Enter a product dip level in millimetres.
          </span>
        </div>

        {calibrations.length === 0 ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Fuel className="w-4 h-4 text-gray-400" /> Add a tank geometry above
            to start converting dips.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[520px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-4">Tank</th>
                  <th className="py-2 pr-4">Fuel</th>
                  <th className="py-2 pr-4 text-right">Volume</th>
                  <th className="py-2 pr-4 text-right">Ullage</th>
                  <th className="py-2 pr-4 text-right">% full</th>
                </tr>
              </thead>
              <tbody>
                {calibrations.map((c) => {
                  const vol = dipToVolume(dipNum, c.diameterMm, c.capacity);
                  const u = ullage(dipNum, c.diameterMm, c.capacity);
                  const pct =
                    cylinderVolumeFraction(dipNum, c.diameterMm) * 100;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-gray-100 dark:border-gray-700/60"
                    >
                      <td className="py-2 pr-4 font-medium text-gray-800 dark:text-gray-200">
                        {c.label}
                      </td>
                      <td className="py-2 pr-4 text-gray-500">{c.fuelType}</td>
                      <td className="py-2 pr-4 text-right text-gray-800 dark:text-gray-200">
                        {formatNumber(vol)} L
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-500">
                        {formatNumber(u)} L
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <span
                          className={`font-semibold ${
                            pct > 90
                              ? "text-green-600"
                              : pct > 50
                                ? "text-amber-600"
                                : "text-red-500"
                          }`}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-400">
              Horizontal-cylinder geometry model —{" "}
              {dipNum > 0
                ? "computed for every calibrated tank at the dip above."
                : "enter a dip level to see volumes."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
