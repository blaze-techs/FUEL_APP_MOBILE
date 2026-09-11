/**
 * Promotions.tsx — loyalty promotions & campaigns editor
 * (Veira CRM / BPme Rewards concept). Lives as the "Promotions" sub-view
 * in the Customers tab, using a LoyaltySettings record synced to cloud.
 *
 * Lets the station owner tune:
 *  - base points per litre (fallback earn rate)
 *  - redemption parameters (points ⇒ currency)
 *  - activation/campaign rules (per fuel, multiplier, date window)
 *  - a live earn preview showing which rule applies
 */
import { useMemo, useState } from "react";
import {
  Gift,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Sparkles,
  Download,
  Zap,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  CLOUD_KEYS,
  type PromoRule,
  type LoyaltySettings,
  bestRuleFor,
  earnForLitres,
  downloadCsv,
} from "@/react-app/lib/forecourt-features";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { normalizeFuelType } from "@/react-app/config/pricing";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";

const DEFAULTS: LoyaltySettings = {
  basePointsPerLitre: 10,
  redemptionPointsPerCurrency: 100,
  redemptionRate: 100,
  rules: [],
};

export default function Promotions() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const { data: settings, setData: setSettings } = useCloudKV<LoyaltySettings>(
    CLOUD_KEYS.promoRules,
    stationId,
    DEFAULTS,
  );

  const fuelOptions = useMemo(() => {
    const fts = fuelTypeApi.fuelTypes ?? [];
    const opts = fts
      .map((f) => fuelTypeApi.labelOf(f.name ?? ""))
      .filter(Boolean);
    const uniq = [...new Set(opts)];
    return uniq;
  }, [fuelTypeApi]);

  // ── rule form ────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [fuel, setFuel] = useState("");
  const [rate, setRate] = useState("10");
  const [mult, setMult] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [previewLitres, setPreviewLitres] = useState("100");
  const [previewFuel, setPreviewFuel] = useState("Super Petrol");

  const resetForm = () => {
    setEditingId(null);
    setLabel("");
    setFuel("");
    setRate("10");
    setMult("1");
    setFrom("");
    setTo("");
  };

  const saveRule = () => {
    const r = Number(rate);
    const m = Number(mult) || 1;
    if (!label || !(r > 0)) return;
    const rule: PromoRule = {
      id: editingId ?? `promo_${Date.now()}`,
      label,
      fuelType: fuel ? (normalizeFuelType(fuel) ?? fuel) : "",
      pointsPerLitre: r,
      multiplier: m,
      fromDate: from,
      toDate: to,
      active: true,
    };
    setSettings((prev) => ({
      ...prev,
      rules: editingId
        ? prev.rules.map((rr) => (rr.id === editingId ? rule : rr))
        : [...prev.rules, rule],
    }));
    resetForm();
  };

  const toggleRule = (id: string) =>
    setSettings((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r,
      ),
    }));

  const removeRule = (id: string) =>
    setSettings((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== id),
    }));

  const editRule = (r: PromoRule) => {
    setEditingId(r.id);
    setLabel(r.label);
    setFuel(r.fuelType);
    setRate(String(r.pointsPerLitre));
    setMult(String(r.multiplier || 1));
    setFrom(r.fromDate);
    setTo(r.toDate);
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const preview = earnForLitres(
    Number(previewLitres) || 0,
    normalizeFuelType(previewFuel) ?? previewFuel,
    settings,
    todayIso,
  );

  const bestForPreview = bestRuleFor(
    settings.rules,
    normalizeFuelType(previewFuel) ?? previewFuel,
    todayIso,
  );

  const exportRules = () =>
    downloadCsv("loyalty-promos.csv", [
      ["label", "fuel", "points/L", "multiplier", "from", "to", "active"],
      ...settings.rules.map((r) => [
        r.label,
        r.fuelType || "all",
        r.pointsPerLitre,
        r.multiplier,
        r.fromDate,
        r.toDate,
        r.active ? "yes" : "no",
      ]),
    ]);

  return (
    <div className="space-y-4">
      {/* ── campaign rule builder ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" /> Campaign rules
          </h3>
          <button
            onClick={exportRules}
            disabled={settings.rules.length === 0}
            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-40"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm col-span-2"
            placeholder="Campaign label (e.g. Weekend boost)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
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
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="Points per litre"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder="Multiplier × (e.g. 2)"
            value={mult}
            onChange={(e) => setMult(e.target.value)}
            inputMode="decimal"
          />
          <input
            type="date"
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <button
            onClick={saveRule}
            className="h-12 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-1 fp-icon-only"
            title="Confirm"
            aria-label="Confirm"
          >
            {editingId ? (
              <Check className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}{" "}
            {editingId ? "Update" : "Add"}
          </button>
        </div>
        {editingId && (
          <button
            onClick={resetForm}
            className="mt-2 text-xs text-gray-500 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> cancel edit
          </button>
        )}

        {/* rules list */}
        {settings.rules.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {settings.rules.map((r) => (
              <div
                key={r.id}
                className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3 flex items-center justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <Gift className="w-3.5 h-3.5 text-amber-500" />
                    {r.label}
                    {!r.active && (
                      <span className="text-xs text-red-400">(off)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {r.fuelType ? r.fuelType : "all fuels"} · {r.pointsPerLitre}{" "}
                    pts/L
                    {r.multiplier && r.multiplier !== 1
                      ? ` ×${r.multiplier}`
                      : ""}
                    {r.fromDate || r.toDate
                      ? ` · ${r.fromDate || "…"} → ${r.toDate || "…"}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => editRule(r)}
                    className="text-gray-400 hover:text-amber-600"
                    aria-label="edit rule"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleRule(r.id)}
                    className={`text-xs px-2 py-1 rounded border ${
                      r.active
                        ? "border-green-500 text-green-600"
                        : "border-gray-400 text-gray-400"
                    }`}
                  >
                    {r.active ? "on" : "off"}
                  </button>
                  <button
                    onClick={() => removeRule(r.id)}
                    className="text-red-500 hover:text-red-600"
                    aria-label="delete rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            No campaign rules yet. The base earn rate below applies.
          </p>
        )}

        {/* base rate + redemption */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
            <p className="text-xs text-gray-500 mb-1">Base earn rate</p>
            <input
              className="h-9 w-full px-2 rounded text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600"
              value={settings.basePointsPerLitre}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  basePointsPerLitre: Number(e.target.value) || 0,
                }))
              }
              inputMode="decimal"
            />
            <p className="text-[10px] text-gray-400 mt-1">points per litre</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
            <p className="text-xs text-gray-500 mb-1">Redemption value</p>
            <input
              className="h-9 w-full px-2 rounded text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600"
              value={settings.redemptionRate}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  redemptionRate: Number(e.target.value) || 1,
                }))
              }
              inputMode="decimal"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              points ⇒ {currencySymbol}1
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Preview
            </p>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {formatNumber(settings.basePointsPerLitre)} pts/L
            </p>
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              {settings.rules.filter((r) => r.active).length} promotional rule
              {settings.rules.filter((r) => r.active).length !== 1
                ? "s"
                : ""}{" "}
              live
            </p>
          </div>
        </div>
      </div>

      {/* ── earn preview ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Gift className="w-4 h-4 text-amber-500" /> Earn preview (today)
        </h3>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm w-36"
            placeholder="Litres"
            value={previewLitres}
            onChange={(e) => setPreviewLitres(e.target.value)}
            inputMode="decimal"
          />
          <select
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={previewFuel}
            onChange={(e) => setPreviewFuel(e.target.value)}
          >
            {fuelOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {Number(previewLitres) || 0} L of {previewFuel} ={" "}
            <span className="font-bold text-amber-600">
              {formatNumber(preview.points, 0)} points
            </span>{" "}
            ({preview.via}
            {bestForPreview
              ? bestForPreview.multiplier && bestForPreview.multiplier !== 1
                ? ` ×${bestForPreview.multiplier}`
                : ""
              : ""}
            )
          </p>
        </div>
      </div>
    </div>
  );
}
