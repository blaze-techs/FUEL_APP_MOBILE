import { useState, useEffect } from "react";
import {
  DollarSign,
  Save,
  CheckCircle2,
  Plus,
  Trash2,
  Globe,
  Edit3,
  ToggleLeft,
  ToggleRight,
  Layers,
  Clock,
  Star,
} from "lucide-react";
import {
  loadTiers,
  saveTiers,
  loadRegionalPrices,
  saveRegionalPrices,
  DEFAULT_TIERS,
  DEFAULT_REGIONAL_PRICES,
  GATEWAYS,
  type PricingTier,
  type RegionalPrice,
  type TierSlug,
} from "@/react-app/lib/subscription";
import { ALL_COUNTRIES } from "@/react-app/lib/world-country-utils";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";

// Use all 250+ countries from world configs
const COUNTRIES = ALL_COUNTRIES.map((c) => ({
  code: c.code,
  name: c.name,
  currency: c.currency,
}));

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function PricingManagerSection({ logAudit }: Props) {
  const [tiers, setTiers] = useState<PricingTier[]>(loadTiers);
  const [prices, setPrices] = useState<RegionalPrice[]>(loadRegionalPrices);
  const [activeTab, setActiveTab] = useState<"tiers" | "regional">("tiers");
  const [editingTier, setEditingTier] = useState<TierSlug | null>(null);
  const [editName, setEditName] = useState("");
  const [editDays, setEditDays] = useState("");
  const [editFeatures, setEditFeatures] = useState("");
  const [saved, setSaved] = useState(false);
  const [editPrices, setEditPrices] = useState<Record<string, number>>({});
  const [selectedCountry, setSelectedCountry] = useState("KE");

  useEffect(() => {
    const ep: Record<string, number> = {};
    prices.forEach((p) => {
      ep[`${p.tierId}_${p.currency}`] = p.price;
    });
    setEditPrices(ep);
  }, [prices]);

  const handleSaveTiers = () => {
    saveTiers(tiers);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    logAudit(
      "Pricing Updated",
      `Modified ${tiers.length} pricing tiers`,
      "success",
    );
  };

  const handleSavePrices = () => {
    const updated = prices.map((p) => {
      const key = `${p.tierId}_${p.currency}`;
      if (editPrices[key] !== undefined) {
        return { ...p, price: editPrices[key] };
      }
      return p;
    });
    saveRegionalPrices(updated);
    setPrices(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    logAudit(
      "Regional Pricing Updated",
      `Updated ${COUNTRIES.find((c) => c.code === selectedCountry)?.name} prices`,
      "success",
    );
  };

  const toggleTier = (id: TierSlug) => {
    setTiers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isActive: !t.isActive } : t)),
    );
    setSaved(false);
  };

  const toggleRecommended = (id: TierSlug) => {
    setTiers((prev) =>
      prev.map((t) => ({
        ...t,
        recommended: t.id === id ? !t.recommended : false,
      })),
    );
    setSaved(false);
  };

  const resetDefaults = () => {
    if (!confirm("Reset all pricing to defaults?")) return;
    setTiers([...DEFAULT_TIERS]);
    setPrices([...DEFAULT_REGIONAL_PRICES]);
    saveTiers([...DEFAULT_TIERS]);
    saveRegionalPrices([...DEFAULT_REGIONAL_PRICES]);
    logAudit("Pricing Reset", "All pricing reset to defaults", "warning");
  };

  const updateTierEdit = (id: TierSlug) => {
    const t = tiers.find((x) => x.id === id);
    if (!t) return;
    setEditingTier(id);
    setEditName(t.name);
    setEditDays(t.durationDays === -1 ? "-1" : t.durationDays.toString());
    setEditFeatures(t.features.join("\n"));
  };

  const saveTierEdit = () => {
    if (!editingTier) return;
    setTiers((prev) =>
      prev.map((t) =>
        t.id === editingTier
          ? {
              ...t,
              name: editName,
              durationDays: parseInt(editDays) || t.durationDays,
              features: editFeatures.split("\n").filter((f) => f.trim()),
            }
          : t,
      ),
    );
    setEditingTier(null);
    setSaved(false);
  };

  const currencyPrices = prices.filter((p) =>
    p.regionCodes.includes(selectedCountry),
  );
  const countryInfo = COUNTRIES.find((c) => c.code === selectedCountry);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <DollarSign size={18} className="text-green-400" /> Pricing Manager
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage subscription tiers and regional pricing
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={resetDefaults}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors"
          >
            Reset
          </button>
          <button
            onClick={activeTab === "tiers" ? handleSaveTiers : handleSavePrices}
            className="px-3 py-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-white/5 rounded-lg p-0.5 w-fit">
        {[
          { id: "tiers" as const, label: "Tiers", icon: Layers },
          { id: "regional" as const, label: "Regional Prices", icon: Globe },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${activeTab === t.id ? "bg-green-500/15 text-green-300" : "text-gray-500 hover:text-gray-300"}`}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === "tiers" && (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
            >
              {editingTier === tier.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">
                        Name
                      </label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-green-500/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">
                        Duration Days (-1 = lifetime)
                      </label>
                      <input
                        type="number"
                        value={editDays}
                        onChange={(e) => setEditDays(e.target.value)}
                        className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-green-500/30"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        onClick={saveTierEdit}
                        className="px-3 py-2 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingTier(null)}
                        className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">
                      Features (one per line)
                    </label>
                    <textarea
                      value={editFeatures}
                      onChange={(e) => setEditFeatures(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-green-500/30 resize-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${tier.isActive ? "bg-green-500/10" : "bg-white/5"}`}
                    >
                      {tier.recommended ? (
                        <Star size={18} className="text-amber-400" />
                      ) : (
                        <Layers
                          size={18}
                          className={
                            tier.isActive ? "text-green-400" : "text-gray-600"
                          }
                        />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {tier.name}
                        </span>
                        {!tier.isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">
                            Inactive
                          </span>
                        )}
                        {tier.recommended && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded">
                            Recommended
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {tier.features.slice(0, 3).map((f) => (
                          <span
                            key={f}
                            className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {tier.durationDays === -1
                        ? "Lifetime"
                        : `${tier.durationDays} days`}
                    </span>
                    <button
                      onClick={() => toggleRecommended(tier.id)}
                      className={`p-1.5 rounded ${tier.recommended ? "text-amber-400" : "text-gray-600 hover:text-gray-400"}`}
                    >
                      <Star size={13} />
                    </button>
                    <button
                      onClick={() => toggleTier(tier.id)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${tier.isActive ? "bg-green-500" : "bg-gray-600"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${tier.isActive ? "translate-x-4.5" : "translate-x-0.5"}`}
                      />
                    </button>
                    <button
                      onClick={() => updateTierEdit(tier.id)}
                      className="p-1.5 text-gray-500 hover:text-blue-400"
                    >
                      <Edit3 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === "regional" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-80">
              <SearchableCountryDropdown
                value={selectedCountry}
                onChange={setSelectedCountry}
              />
            </div>
            {countryInfo && (
              <span className="text-xs text-gray-500">
                {countryInfo.name} &middot; {countryInfo.currency}
              </span>
            )}
          </div>

          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">
              {countryInfo?.name} Pricing ({countryInfo?.currency})
            </h3>
            <div className="space-y-3">
              {tiers
                .filter((t) => t.isActive)
                .map((tier) => {
                  const rp = currencyPrices.find((p) => p.tierId === tier.id);
                  const key = `${tier.id}_${countryInfo?.currency}`;
                  return (
                    <div
                      key={tier.id}
                      className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
                    >
                      <div>
                        <p className="text-sm text-white">{tier.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {tier.durationDays === -1
                            ? "Lifetime"
                            : `${tier.durationDays} days`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {rp?.paymentGateways.map((g) => {
                            const gi = GATEWAYS.find((x) => x.id === g);
                            return (
                              <span
                                key={g}
                                className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500"
                              >
                                {gi?.name || g}
                              </span>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">
                            {countryInfo?.currency}
                          </span>
                          <input
                            type="number"
                            value={editPrices[key] || rp?.price || 0}
                            onChange={(e) =>
                              setEditPrices((p) => ({
                                ...p,
                                [key]: Number(e.target.value),
                              }))
                            }
                            className="w-20 px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white text-right focus:outline-none focus:border-green-500/30"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
