import { useState } from "react";
import {
  Tag,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Percent,
  DollarSign,
  Calendar,
  Copy,
  Check,
  Edit3,
  X,
  RefreshCw,
} from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
const CUR = () => getCurrencySymbol(getDetectedCurrency());
import {
  loadCoupons,
  saveCoupons,
  type Coupon,
  type TierSlug,
} from "@/react-app/lib/subscription";

const ALL_TIERS: { id: TierSlug; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
  { id: "lifetime", label: "Lifetime" },
];

const REGIONS = [
  { code: "KE", name: "Kenya" },
  { code: "UG", name: "Uganda" },
  { code: "TZ", name: "Tanzania" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "GH", name: "Ghana" },
  { code: "RW", name: "Rwanda" },
  { code: "ET", name: "Ethiopia" },
  { code: "ALL", name: "All Regions" },
];

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function CouponSection({ logAudit }: Props) {
  const [coupons, setCoupons] = useState<Coupon[]>(loadCoupons);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState("");

  // Form state
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<"percentage" | "fixed">(
    "percentage",
  );
  const [formValue, setFormValue] = useState("");
  const [formMaxUses, setFormMaxUses] = useState("100");
  const [formTierIds, setFormTierIds] = useState<TierSlug[]>(["monthly"]);
  const [formRegions, setFormRegions] = useState<string[]>(["ALL"]);
  const [formExpires, setFormExpires] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const persist = (c: Coupon[]) => {
    saveCoupons(c);
    setCoupons(c);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addCoupon = () => {
    if (!formCode.trim() || !formValue) return;
    const coupon: Coupon = {
      id: `c_${Date.now()}`,
      code: formCode.trim().toUpperCase(),
      type: formType,
      value: Number(formValue),
      maxUses: Number(formMaxUses) || 100,
      usedCount: 0,
      tierIds: formTierIds,
      regionCodes: formRegions,
      expiresAt: formExpires ? new Date(formExpires).toISOString() : null,
      isActive: true,
      createdAt: new Date().toISOString(),
      description: formDesc,
    };
    persist([...coupons, coupon]);
    resetForm();
    setShowAdd(false);
    logAudit("Coupon Created", `Created coupon "${coupon.code}"`, "success");
  };

  const resetForm = () => {
    setFormCode("");
    setFormType("percentage");
    setFormValue("");
    setFormMaxUses("100");
    setFormTierIds(["monthly"]);
    setFormRegions(["ALL"]);
    setFormExpires("");
    setFormDesc("");
  };

  const toggleActive = (id: string) => {
    persist(
      coupons.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c)),
    );
  };

  const deleteCoupon = (id: string) => {
    if (!confirm("Delete this coupon?")) return;
    persist(coupons.filter((c) => c.id !== id));
    logAudit("Coupon Deleted", `Removed coupon ${id}`, "warning");
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Tag size={18} className="text-purple-400" /> Coupon & Discount
            Engine
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Create and manage promo codes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs rounded-lg border border-purple-500/20 transition-colors flex items-center gap-1"
          >
            {showAdd ? <X size={12} /> : <Plus size={12} />}{" "}
            {showAdd ? "Cancel" : "Create Coupon"}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">New Coupon</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Code</label>
              <input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                placeholder="WELCOME50"
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500/30"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Description
              </label>
              <input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="50% off for new users"
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/30"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFormType("percentage")}
                  className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${formType === "percentage" ? "bg-purple-500/15 border-purple-500/30 text-purple-300" : "bg-white/5 border-white/10 text-gray-500"}`}
                >
                  <Percent size={12} className="inline mr-1" /> Percentage
                </button>
                <button
                  onClick={() => setFormType("fixed")}
                  className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${formType === "fixed" ? "bg-purple-500/15 border-purple-500/30 text-purple-300" : "bg-white/5 border-white/10 text-gray-500"}`}
                >
                  <DollarSign size={12} className="inline mr-1" /> Fixed
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                {formType === "percentage" ? "Discount %" : "Discount Amount"}
              </label>
              <input
                type="number"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={formType === "percentage" ? "50" : "500"}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/30"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Max Uses
              </label>
              <input
                type="number"
                value={formMaxUses}
                onChange={(e) => setFormMaxUses(e.target.value)}
                placeholder="100"
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/30"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Expiry Date
              </label>
              <input
                type="datetime-local"
                value={formExpires}
                onChange={(e) => setFormExpires(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-purple-500/30"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Valid Tiers
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_TIERS.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    setFormTierIds((prev) =>
                      prev.includes(t.id)
                        ? prev.filter((x) => x !== t.id)
                        : [...prev, t.id],
                    )
                  }
                  className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${formTierIds.includes(t.id) ? "bg-purple-500/15 border-purple-500/30 text-purple-300" : "bg-white/5 border-white/10 text-gray-500"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Valid Regions
            </label>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((r) => (
                <button
                  key={r.code}
                  onClick={() =>
                    setFormRegions((prev) =>
                      prev.includes(r.code)
                        ? prev.filter((x) => x !== r.code)
                        : [...prev, r.code],
                    )
                  }
                  className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${formRegions.includes(r.code) ? "bg-purple-500/15 border-purple-500/30 text-purple-300" : "bg-white/5 border-white/10 text-gray-500"}`}
                >
                  {r.code === "ALL" ? "All" : r.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={addCoupon}
            className="px-4 py-2 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs rounded-lg border border-purple-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Create Coupon
          </button>
        </div>
      )}

      {/* Coupons List */}
      <div className="space-y-2">
        {coupons.map((c) => (
          <div
            key={c.id}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Tag size={18} className="text-purple-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-white font-mono bg-white/5 px-2 py-0.5 rounded">
                      {c.code}
                    </code>
                    <button
                      onClick={() => copyCode(c.code)}
                      className="text-gray-500 hover:text-purple-300"
                    >
                      {copied === c.code ? (
                        <Check size={12} className="text-green-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    {c.isActive ? (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/10 text-gray-500 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {c.description}
                  </p>
                  <div className="flex gap-1 mt-1">
                    {c.tierIds.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500 capitalize"
                      >
                        {t}
                      </span>
                    ))}
                    {c.regionCodes.map((r) => (
                      <span
                        key={r}
                        className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 rounded text-blue-400"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">
                    {c.type === "percentage"
                      ? `${c.value}%`
                      : `${CUR()} ${c.value}`}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {c.usedCount}/{c.maxUses} used
                  </p>
                </div>
                <div className="h-8 w-8 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full bg-purple-400"
                    style={{
                      width: `${Math.min((c.usedCount / c.maxUses) * 100, 100)}%`,
                    }}
                  />
                </div>
                <button
                  onClick={() => toggleActive(c.id)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${c.isActive ? "bg-green-500" : "bg-gray-600"}`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${c.isActive ? "translate-x-4.5" : "translate-x-0.5"}`}
                  />
                </button>
                <button
                  onClick={() => deleteCoupon(c.id)}
                  className="p-1.5 text-gray-500 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {coupons.length === 0 && (
          <p className="text-center text-gray-600 py-8 text-xs">
            No coupons created
          </p>
        )}
      </div>
    </div>
  );
}
