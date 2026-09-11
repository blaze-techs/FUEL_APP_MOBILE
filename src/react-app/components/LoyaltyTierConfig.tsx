/* LoyaltyTierConfig — Veira CRM-style tier thresholds editor: owners define
 * spend thresholds for each loyalty tier (e.g. Bronze → Silver → Gold →
 * VIP). Stored in a station-scoped cloud KV so tier logic across the app
 * (CustomerSegments, PunchCardLoyalty) can read the same thresholds.
 */
import { Award, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface TierRule {
  id: string;
  name: string;
  minSpend: number;
  reward: string;
}

export default function LoyaltyTierConfig() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: tiers, setData: setTiers } = useCloudKV<TierRule[]>(
    "loyalty_tier_config",
    stationId,
    [],
  );
  const [name, setName] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [reward, setReward] = useState("");

  const addTier = () => {
    const m = Number(minSpend);
    if (!name.trim() || !m || m < 0) return;
    setTiers((prev) =>
      [
        ...(prev || []),
        {
          id: `tier_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: name.trim(),
          minSpend: m,
          reward: reward.trim(),
        },
      ].sort((a, b) => a.minSpend - b.minSpend),
    );
    setName("");
    setMinSpend("");
    setReward("");
  };

  const removeTier = (id: string) =>
    setTiers((prev) => (prev || []).filter((t) => t.id !== id));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Award size={16} /> Loyalty Tier Configuration
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Share the same thresholds everywhere — customers climb these tiers based
        on lifetime spend. {tiers?.length || 0} tiers configured.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tier name (e.g. Gold)"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={minSpend}
          onChange={(e) => setMinSpend(e.target.value)}
          type="number"
          placeholder={`Min spend (${currency})`}
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          placeholder="Reward (e.g. 3% back)"
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addTier}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {(tiers || []).length === 0 ? (
        <p className="text-sm text-gray-500">
          No tiers configured. Add thresholds like Bronze → Silver → Gold.
        </p>
      ) : (
        <div className="space-y-1.5">
          {(tiers || []).map((t, idx) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-200 text-amber-800" : idx === 1 ? "bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200" : "bg-amber-100 text-amber-700"}`}
                >
                  {idx + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                    {t.name}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Spend ≥ {currency}
                    {t.minSpend.toLocaleString()}
                    {t.reward ? ` • ${t.reward}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => removeTier(t.id)}
                className="text-red-500 hover:text-red-600"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
