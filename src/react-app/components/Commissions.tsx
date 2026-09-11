/**
 * Commissions.tsx — attendant commission calculator
 * (Codelab FMS staff commission concept). Lives inside Payroll System as
 * the "Commissions" sub-view. For each active pump in Sales Tracking that
 * has an assigned attendant (assignedTo), uses total dispensed litres
 * (closing − opening) × a configured rate per litre to compute the
 * attendant's commission. The configuration is cloud-synced.
 */
import { useMemo, useState } from "react";
import {
  Coins,
  Plus,
  Trash2,
  Download,
  UserRound,
  AlertTriangle,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type CommissionSetting,
  downloadCsv,
} from "@/react-app/lib/forecourt-features";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { getFuelLabel, normalizeFuelType } from "@/react-app/config/pricing";

type Pump = {
  id: string;
  label: string;
  name?: string;
  opening: number;
  closing: number;
  rate?: number;
  total?: number;
  assignedTo?: string;
};

export default function Commissions() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const { data: settings, setData: setSettings } = useCloudKV<
    CommissionSetting[]
  >(CLOUD_KEYS.commissionSettings, stationId, []);

  const [rate, setRate] = useState("0.05");
  const [fuel, setFuel] = useState("");
  const [label, setLabel] = useState("");

  // aggregate litres per attendant across all fuel-type pump groups
  const attendantTotals = useMemo(() => {
    const map = new Map<
      string,
      { attendant: string; litres: number; fuMap: Map<string, number> }
    >();
    const groups: [string, Pump[]][] = Object.entries(
      state.fuelPumpsByType ?? {},
    ) as any;
    for (const [canonical, pumps] of groups) {
      const pumpArr = pumps as Pump[];
      for (const p of pumpArr) {
        const att = p.assignedTo?.trim();
        if (!att) continue;
        const litres = Math.max(0, (p.closing ?? 0) - (p.opening ?? 0));
        const t = map.get(att) ?? {
          attendant: att,
          litres: 0,
          fuMap: new Map(),
        };
        t.litres += litres;
        t.fuMap.set(canonical, (t.fuMap.get(canonical) ?? 0) + litres);
        map.set(att, t);
      }
    }
    return [...map.values()];
  }, [state.fuelPumpsByType]);

  const fuelOptions = useMemo(() => {
    const names = Object.keys(state.fuelPumpsByType ?? {});
    const uniq = [...new Set(names)];
    return uniq.length > 0 ? uniq : ["petrol"];
  }, [state.fuelPumpsByType]);

  type Row = {
    attendant: string;
    litres: number;
    commission: number;
    detail: { canonical: string; litres: number }[];
  };

  const rows = useMemo(() => {
    return attendantTotals.map((t) => {
      const matching = settings.filter((s) => s.active !== false);
      let commission = 0;
      const detail: { canonical: string; litres: number }[] = [];
      for (const [canonical, litres] of t.fuMap.entries()) {
        // Prefer a fuel-specific rule; fall back to the "all fuels" rule.
        const match =
          matching.find((s) => s.fuelType === canonical) ??
          matching.find((s) => !s.fuelType);
        const rate = match ? match.ratePerLitre : 0;
        if (rate > 0) {
          commission += litres * rate;
        }
        detail.push({ canonical, litres });
      }
      return {
        attendant: t.attendant,
        litres: t.litres,
        commission,
        detail,
      } as Row;
    });
  }, [attendantTotals, settings]);

  const addSetting = () => {
    const r = Number(rate);
    if (!(r > 0)) return;
    const entry: CommissionSetting = {
      id: `com_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ratePerLitre: r,
      fuelType: fuel ? (normalizeFuelType(fuel) ?? fuel) : "",
      active: true,
      label:
        label ||
        (fuel ? `${getFuelLabel(fuel)} attendants` : "all fuel attendants"),
    };
    setSettings((prev) => [...prev, entry]);
    setLabel("");
  };

  const toggle = (id: string) =>
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active } : s)),
    );
  const remove = (id: string) =>
    setSettings((prev) => prev.filter((s) => s.id !== id));

  const exportRows = () =>
    downloadCsv("commissions.csv", [
      ["attendant", "litres", "commission"],
      ...rows.map((r) => [
        r.attendant,
        r.litres.toFixed(1),
        r.commission.toFixed(2),
      ]),
    ]);

  const total = rows.reduce((s, r) => s + r.commission, 0);

  return (
    <div className="space-y-4">
      {/* --- commission rates --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-500" /> Commission rates
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm col-span-2"
            placeholder="Label (e.g. petrol attendants)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder={`Rate (${currencySymbol}/L)`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
          />
          <select
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
          >
            <option value="">All fuels</option>
            {fuelOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button
            onClick={addSetting}
            className="h-12 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add rule
          </button>
        </div>
        {settings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {settings.map((s) => (
              <div
                key={s.id}
                className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2 flex items-center justify-between text-sm"
              >
                <p className="text-gray-800 dark:text-gray-200">
                  {s.label}{" "}
                  {!s.active && (
                    <span className="text-xs text-red-400">(off)</span>
                  )}
                  <span className="text-xs text-gray-500 ml-2">
                    {s.fuelType ? s.fuelType : "all fuels"} · {currencySymbol}
                    {s.ratePerLitre.toFixed(3)}/L
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(s.id)}
                    className={`text-xs px-2 py-1 rounded border ${
                      s.active
                        ? "border-green-500 text-green-600"
                        : "border-gray-400 text-gray-400"
                    }`}
                  >
                    {s.active ? "on" : "off"}
                  </button>
                  <button
                    onClick={() => remove(s.id)}
                    className="text-red-500 hover:text-red-600"
                    aria-label="remove rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- attendant breakdown --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <UserRound className="w-4 h-4 text-amber-500" /> Attendant
            commission (saved pumps)
          </h3>
          <button
            onClick={exportRows}
            disabled={rows.length === 0}
            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-40"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-gray-400" /> No assigned
            attendants found in Sales Tracking — set a pump's "Assigned to" in
            Sales Tracking then re-open this view.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1.5 pr-4">Attendant</th>
                <th className="py-1.5 pr-4">Detail (fuel)</th>
                <th className="py-1.5 pr-4 text-right">Litres</th>
                <th className="py-1.5 pr-4 text-right">Commission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.attendant}
                  className="border-b border-gray-100 dark:border-gray-700/60"
                >
                  <td className="py-1.5 pr-4 font-medium text-gray-800 dark:text-gray-200">
                    {r.attendant}
                  </td>
                  <td className="py-1.5 pr-4 text-gray-500 text-xs">
                    {r.detail
                      .map(
                        (d) =>
                          `${getFuelLabel(d.canonical)} ${formatNumber(
                            d.litres,
                            1,
                          )} L`,
                      )
                      .join(" · ")}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-semibold">
                    {formatNumber(r.litres, 1)} L
                  </td>
                  <td className="py-1.5 pr-4 text-right text-green-600 font-semibold">
                    {r.commission > 0
                      ? `${currencySymbol}${formatNumber(r.commission)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <td
                  colSpan={3}
                  className="py-2 pr-4 text-right font-semibold text-gray-700"
                >
                  Total
                </td>
                <td className="py-2 pr-4 text-right font-bold text-green-600">
                  {total > 0 ? `${currencySymbol}${formatNumber(total)}` : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
