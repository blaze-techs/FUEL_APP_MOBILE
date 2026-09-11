import { useState, useEffect, useRef } from "react";
import {
  Lock,
  Eye,
  Save,
  CheckCircle2,
  RefreshCw,
  Globe,
  CreditCard,
  Timer,
  Tag,
  DollarSign,
  Smartphone,
  Shield,
  ToggleLeft,
  ToggleRight,
  Edit3,
  Plus,
  Trash2,
  AlertTriangle,
  Play,
  Check,
} from "lucide-react";
import {
  loadTiers,
  saveTiers,
  loadCoupons,
  saveCoupons,
  loadRegionalPrices,
  saveRegionalPrices,
  GATEWAYS,
  type PricingTier,
  type Coupon,
  type RegionalPrice,
  type TierSlug,
  type GatewayInfo,
} from "@/react-app/lib/subscription";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

const PAYWALL_CONTENT_KEY = "fuelpro_paywall_content";
// Cloud key (app_kv, owner-scoped) so paywall content edits sync across every
// founder device. localStorage is kept ONLY as a read-through cache.
const PAYWALL_CONTENT_CLOUD_KEY = "founder_paywall_content";

interface PaywallContent {
  title: string;
  subtitle: string;
  trialHeadline: string;
  trialDescription: string;
  trialDuration: number; // minutes
  features: string[];
  ctaText: string;
  skipTrialText: string;
  footerNote: string;
  accentColor: string;
  showGatewayIcons: boolean;
  enableCoupons: boolean;
  enableAccessCode: boolean;
  requireAuth: boolean;
  showTrustBadges: boolean;
  active: boolean;
}

const DEFAULT_CONTENT: PaywallContent = {
  title: "FuelPro",
  subtitle: "Professional Fuel Management System",
  trialHeadline: "Free Trial",
  trialDescription: "Experience the full power of FuelPro before you subscribe",
  trialDuration: 60,
  features: [
    "Complete fuel management",
    "Real-time sales tracking",
    "M-PESA integration",
    "Invoice & receipt generation",
    "Team management",
  ],
  ctaText: "Start Free Trial",
  skipTrialText: "Skip Trial, View Plans",
  footerNote: "No credit card required. One trial per device.",
  accentColor: "#d97706",
  showGatewayIcons: true,
  enableCoupons: true,
  enableAccessCode: true,
  requireAuth: true,
  showTrustBadges: true,
  active: true,
};

function loadContent(): PaywallContent {
  // Instant first render: prefer the in-memory cache, then localStorage.
  const cached = cloudStorageService.getCached<PaywallContent>(
    PAYWALL_CONTENT_CLOUD_KEY,
  );
  if (cached && typeof cached === "object" && cached.title) return cached;
  try {
    const s = localStorage.getItem(PAYWALL_CONTENT_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return { ...DEFAULT_CONTENT };
}

function saveContent(c: PaywallContent) {
  // localStorage is a read-through cache; cloud (app_kv) is the source of truth.
  try {
    localStorage.setItem(PAYWALL_CONTENT_KEY, JSON.stringify(c));
  } catch {
    /* quota — non-fatal, cloud save is the durable copy */
  }
  cloudStorageService
    .set(PAYWALL_CONTENT_CLOUD_KEY, c)
    .catch((e) =>
      console.warn("[PaywallControl] cloud save failed:", e?.message || e),
    );
}

const COUNTRIES = [
  { code: "KE", name: "Kenya", currency: "KES" },
  { code: "UG", name: "Uganda", currency: "UGX" },
  { code: "TZ", name: "Tanzania", currency: "TZS" },
  { code: "NG", name: "Nigeria", currency: "NGN" },
  { code: "ZA", name: "South Africa", currency: "ZAR" },
  { code: "GH", name: "Ghana", currency: "GHS" },
  { code: "RW", name: "Rwanda", currency: "RWF" },
  { code: "ET", name: "Ethiopia", currency: "ETB" },
  { code: "US", name: "Global (USD)", currency: "USD" },
];

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function PaywallControlSection({ logAudit }: Props) {
  const [content, setContent] = useState<PaywallContent>(loadContent);
  const [activeTab, setActiveTab] = useState<
    "content" | "pricing" | "coupons" | "preview"
  >("content");
  const [saved, setSaved] = useState(false);
  const [tiers, setTiers] = useState<PricingTier[]>(loadTiers);
  const [coupons, setCoupons] = useState<Coupon[]>(loadCoupons);
  const [regionalPrices, setRegionalPrices] =
    useState<RegionalPrice[]>(loadRegionalPrices);
  const [selectedCountry, setSelectedCountry] = useState("KE");
  const [editPrices, setEditPrices] = useState<Record<string, number>>({});
  const [newFeature, setNewFeature] = useState("");

  // Cloud-first hydration + real-time sync so a paywall edit made on one
  // founder device reflects instantly on every other founder device.
  // Echo-guarded: skip the remote push when THIS device just saved it.
  const skipRemoteContentRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    cloudStorageService
      .get<PaywallContent>(PAYWALL_CONTENT_CLOUD_KEY)
      .then((cloud) => {
        if (cancelled) return;
        if (cloud && typeof cloud === "object" && cloud.title) {
          setContent((prev) =>
            prev.title === cloud.title && prev.active === cloud.active
              ? prev
              : { ...DEFAULT_CONTENT, ...cloud },
          );
        }
      })
      .catch(() => {});
    const unsub = cloudStorageService.subscribe<PaywallContent>(
      PAYWALL_CONTENT_CLOUD_KEY,
      undefined,
      (next) => {
        if (skipRemoteContentRef.current) {
          skipRemoteContentRef.current = false;
          return;
        }
        if (next && typeof next === "object" && next.title) {
          setContent({ ...DEFAULT_CONTENT, ...next });
        }
      },
    );
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const ep: Record<string, number> = {};
    regionalPrices.forEach((p) => {
      ep[`${p.tierId}_${p.currency}`] = p.price;
    });
    setEditPrices(ep);
  }, [regionalPrices]);

  const updateContent = (k: keyof PaywallContent, v: any) => {
    skipRemoteContentRef.current = true; // echo guard: skip the realtime echo
    setContent((p) => {
      const n = { ...p, [k]: v };
      saveContent(n);
      return n;
    });
    setSaved(false);
  };

  const toggleContent = (k: keyof PaywallContent) => {
    skipRemoteContentRef.current = true; // echo guard: skip the realtime echo
    setContent((p) => {
      const n = { ...p, [k]: !p[k] };
      saveContent(n);
      return n;
    });
    setSaved(false);
  };

  const handleSave = () => {
    skipRemoteContentRef.current = true; // echo guard: skip the realtime echo
    saveContent(content);
    saveTiers(tiers);
    saveCoupons(coupons);
    const updated = regionalPrices.map((p) => {
      const key = `${p.tierId}_${p.currency}`;
      if (editPrices[key] !== undefined)
        return { ...p, price: editPrices[key] };
      return p;
    });
    saveRegionalPrices(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      "Paywall Updated",
      "Paywall content, pricing, and coupons saved",
      "success",
    );
  };

  const addFeature = () => {
    if (!newFeature.trim()) return;
    updateContent("features", [...content.features, newFeature.trim()]);
    setNewFeature("");
  };

  const removeFeature = (i: number) => {
    updateContent(
      "features",
      content.features.filter((_, idx) => idx !== i),
    );
  };

  const toggleTier = (id: TierSlug) => {
    setTiers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isActive: !t.isActive } : t)),
    );
    setSaved(false);
  };

  const addCoupon = () => {
    const code: Coupon = {
      id: `c_${Date.now()}`,
      code: "NEWCODE",
      type: "percentage",
      value: 20,
      maxUses: 100,
      usedCount: 0,
      tierIds: ["monthly"],
      regionCodes: ["ALL"],
      expiresAt: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      description: "",
    };
    const updated = [...coupons, code];
    setCoupons(updated);
    setSaved(false);
  };

  const deleteCoupon = (id: string) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
    setSaved(false);
  };

  const toggleCoupon = (id: string) => {
    setCoupons((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c)),
    );
    setSaved(false);
  };

  const countryInfo = COUNTRIES.find((c) => c.code === selectedCountry);
  const currencyPrices = regionalPrices.filter((p) =>
    p.regionCodes.includes(selectedCountry),
  );

  const inputClass =
    "w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Lock size={18} className="text-amber-400" /> Paywall Control
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage paywall content, pricing, coupons, and preview
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save All
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`flex items-center justify-between p-3 rounded-xl border ${content.active ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}
      >
        <div className="flex items-center gap-2">
          {content.active ? (
            <Shield size={14} className="text-emerald-400" />
          ) : (
            <AlertTriangle size={14} className="text-red-400" />
          )}
          <span
            className={`text-xs ${content.active ? "text-emerald-400" : "text-red-400"}`}
          >
            Paywall is {content.active ? "ACTIVE" : "DISABLED"} — users{" "}
            {content.active ? "must subscribe or trial" : "have full access"}
          </span>
        </div>
        <button
          onClick={() => toggleContent("active")}
          className={`relative w-11 h-6 rounded-full transition-colors ${content.active ? "bg-emerald-500" : "bg-gray-600"}`}
        >
          <div
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${content.active ? "translate-x-5.5" : "translate-x-0.5"}`}
          />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-lg p-0.5 w-fit">
        {[
          { id: "content" as const, label: "Content", icon: Edit3 },
          { id: "pricing" as const, label: "Pricing", icon: DollarSign },
          { id: "coupons" as const, label: "Coupons", icon: Tag },
          { id: "preview" as const, label: "Preview", icon: Eye },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${activeTab === t.id ? "bg-amber-500/15 text-amber-300" : "text-gray-500 hover:text-gray-300"}`}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ CONTENT TAB ═══ */}
      {activeTab === "content" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-white mb-2">Branding</h3>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Title</label>
              <input
                value={content.title}
                onChange={(e) => updateContent("title", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Subtitle
              </label>
              <input
                value={content.subtitle}
                onChange={(e) => updateContent("subtitle", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Accent Color
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={content.accentColor}
                  onChange={(e) => updateContent("accentColor", e.target.value)}
                  className="w-10 h-10 rounded-lg bg-transparent"
                />
                <input
                  value={content.accentColor}
                  onChange={(e) => updateContent("accentColor", e.target.value)}
                  className={`${inputClass} flex-1 font-mono`}
                />
              </div>
            </div>
          </div>

          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-white mb-2">
              Trial Settings
            </h3>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Headline
              </label>
              <input
                value={content.trialHeadline}
                onChange={(e) => updateContent("trialHeadline", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Description
              </label>
              <input
                value={content.trialDescription}
                onChange={(e) =>
                  updateContent("trialDescription", e.target.value)
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Duration (minutes)
              </label>
              <input
                type="number"
                value={content.trialDuration}
                onChange={(e) =>
                  updateContent("trialDuration", Number(e.target.value))
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-white mb-2">
              Call to Action
            </h3>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                CTA Button Text
              </label>
              <input
                value={content.ctaText}
                onChange={(e) => updateContent("ctaText", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Skip Trial Text
              </label>
              <input
                value={content.skipTrialText}
                onChange={(e) => updateContent("skipTrialText", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Footer Note
              </label>
              <input
                value={content.footerNote}
                onChange={(e) => updateContent("footerNote", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-white mb-2">
              Features List
            </h3>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {content.features.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs bg-white/[0.02] rounded-lg px-2.5 py-1.5"
                >
                  <span className="text-gray-300 flex items-center gap-2">
                    <Check size={10} className="text-emerald-400" /> {f}
                  </span>
                  <button
                    onClick={() => removeFeature(i)}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFeature()}
                placeholder="Add feature..."
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={addFeature}
                className="px-2.5 py-1.5 bg-amber-500/15 text-amber-300 text-xs rounded-lg border border-amber-500/20 fp-icon-only"
                title="Add"
                aria-label="Add"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-white mb-2">Toggles</h3>
            {[
              {
                key: "showGatewayIcons" as const,
                label: "Show Gateway Icons",
                desc: "Display payment method icons",
              },
              {
                key: "enableCoupons" as const,
                label: "Enable Coupons",
                desc: "Allow coupon code input",
              },
              {
                key: "enableAccessCode" as const,
                label: "Enable Access Code",
                desc: "Allow activation code unlock",
              },
              {
                key: "showTrustBadges" as const,
                label: "Trust Badges",
                desc: "Show security/shield badges",
              },
            ].map((t) => (
              <div key={t.key} className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white">{t.label}</p>
                  <p className="text-[10px] text-gray-500">{t.desc}</p>
                </div>
                <button
                  onClick={() => toggleContent(t.key)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${content[t.key] ? "bg-green-500" : "bg-gray-600"}`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${content[t.key] ? "translate-x-4.5" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ PRICING TAB ═══ */}
      {activeTab === "pricing" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-72">
              <SearchableCountryDropdown
                value={selectedCountry}
                onChange={setSelectedCountry}
                label="Select Country / Region"
              />
            </div>
            {countryInfo && (
              <span className="text-xs text-gray-500">
                {countryInfo.name} &middot; {countryInfo.currency}
              </span>
            )}
          </div>

          <div className="space-y-2">
            {tiers.map((tier) => {
              const rp = currencyPrices.find((p) => p.tierId === tier.id);
              const key = `${tier.id}_${countryInfo?.currency}`;
              const gatewayNames = rp?.paymentGateways
                .map((g) => GATEWAYS.find((x) => x.id === g)?.name || g)
                .join(", ");
              return (
                <div
                  key={tier.id}
                  className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${tier.isActive ? "bg-amber-500/10" : "bg-white/5"}`}
                      >
                        <DollarSign
                          size={18}
                          className={
                            tier.isActive ? "text-amber-400" : "text-gray-600"
                          }
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            {tier.name}
                          </span>
                          {tier.recommended && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded">
                              Recommended
                            </span>
                          )}
                          {!tier.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">
                              Hidden
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500">
                          {gatewayNames}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
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
                          className="w-20 px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white text-right font-mono focus:outline-none focus:border-amber-500/30"
                        />
                      </div>
                      <button
                        onClick={() => toggleTier(tier.id)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${tier.isActive ? "bg-green-500" : "bg-gray-600"}`}
                      >
                        <div
                          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${tier.isActive ? "translate-x-4.5" : "translate-x-0.5"}`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ COUPONS TAB ═══ */}
      {activeTab === "coupons" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Active Coupons ({coupons.length})
            </h3>
            <button
              onClick={addCoupon}
              className="px-3 py-1.5 bg-amber-500/15 text-amber-300 text-xs rounded-lg border border-amber-500/20 flex items-center gap-1"
            >
              <Plus size={12} /> Add Coupon
            </button>
          </div>
          <div className="space-y-2">
            {coupons.map((c) => (
              <div
                key={c.id}
                className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                  <div>
                    <label className="text-[10px] text-gray-500">Code</label>
                    <input
                      value={c.code}
                      onChange={(e) =>
                        setCoupons((prev) =>
                          prev.map((x) =>
                            x.id === c.id
                              ? { ...x, code: e.target.value.toUpperCase() }
                              : x,
                          ),
                        )
                      }
                      className={`${inputClass} font-mono text-xs`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Type</label>
                    <select
                      value={c.type}
                      onChange={(e) =>
                        setCoupons((prev) =>
                          prev.map((x) =>
                            x.id === c.id
                              ? {
                                  ...x,
                                  type: e.target.value as
                                    "percentage" | "fixed",
                                }
                              : x,
                          ),
                        )
                      }
                      className={inputClass}
                    >
                      <option value="percentage">% Off</option>
                      <option value="fixed">Fixed</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Value</label>
                    <input
                      type="number"
                      value={c.value}
                      onChange={(e) =>
                        setCoupons((prev) =>
                          prev.map((x) =>
                            x.id === c.id
                              ? { ...x, value: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">
                      Max Uses
                    </label>
                    <input
                      type="number"
                      value={c.maxUses}
                      onChange={(e) =>
                        setCoupons((prev) =>
                          prev.map((x) =>
                            x.id === c.id
                              ? { ...x, maxUses: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => toggleCoupon(c.id)}
                    className={`text-[10px] px-2 py-1 rounded ${c.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-500/10 text-gray-500"}`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </button>
                  <span className="text-[10px] text-gray-500">
                    {c.usedCount}/{c.maxUses} used
                  </span>
                  <button
                    onClick={() => deleteCoupon(c.id)}
                    className="ml-auto text-gray-500 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {coupons.length === 0 && (
              <p className="text-center text-gray-600 text-xs py-8">
                No coupons
              </p>
            )}
          </div>
        </div>
      )}

      {/* ═══ PREVIEW TAB ═══ */}
      {activeTab === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Live Preview</h3>
            <span className="text-[10px] text-gray-500">
              This is what users see
            </span>
          </div>

          {/* Trial Preview */}
          <div className="bg-gradient-to-br from-slate-950 via-gray-900 to-slate-950 rounded-2xl p-8 border border-white/[0.08] max-w-md mx-auto text-center">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
              style={{ backgroundColor: content.accentColor }}
            >
              <Lock size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white font-serif mb-1">
              {content.title}
            </h1>
            <p className="text-gray-400 mb-6">{content.subtitle}</p>

            <div
              className="rounded-xl p-6 mb-6"
              style={{
                backgroundColor: content.accentColor + "10",
                border: `1px solid ${content.accentColor}30`,
              }}
            >
              <Timer
                size={32}
                className="mx-auto mb-3"
                style={{ color: content.accentColor }}
              />
              <h3 className="text-xl font-bold text-white mb-1">
                {content.trialHeadline}
              </h3>
              <p className="text-sm text-gray-400">
                {content.trialDescription}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Duration: {content.trialDuration} minutes
              </p>
            </div>

            <div className="space-y-2.5 mb-6 text-left max-w-xs mx-auto">
              {content.features.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-gray-300"
                >
                  <Check size={16} className="text-emerald-400 flex-shrink-0" />{" "}
                  {f}
                </div>
              ))}
            </div>

            <button
              className="w-full py-3 text-white font-semibold rounded-xl mb-3"
              style={{ backgroundColor: content.accentColor }}
            >
              {content.ctaText}
            </button>
            <button className="w-full py-2 text-sm text-gray-500 transition-colors">
              {content.skipTrialText}
            </button>

            {content.showTrustBadges && (
              <div className="flex items-center justify-center gap-1 mt-4 text-[10px] text-gray-600">
                <Shield size={10} /> {content.footerNote}
              </div>
            )}
          </div>

          {/* Pricing Preview */}
          <div className="bg-gradient-to-br from-slate-950 via-gray-900 to-slate-950 rounded-2xl p-6 border border-white/[0.08]">
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-white font-serif">
                Choose Your Plan
              </h3>
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              {tiers
                .filter((t) => t.isActive)
                .map((tier) => {
                  const rp = currencyPrices.find((p) => p.tierId === tier.id);
                  return (
                    <div
                      key={tier.id}
                      className="w-36 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center"
                    >
                      <h4 className="text-xs font-semibold text-white">
                        {tier.name}
                      </h4>
                      <p
                        className="text-lg font-bold mt-1"
                        style={{ color: content.accentColor }}
                      >
                        {countryInfo?.currency}{" "}
                        {rp?.price.toLocaleString() || 0}
                      </p>
                      <p className="text-[9px] text-gray-500">
                        {tier.durationDays === -1
                          ? "Lifetime"
                          : `${tier.durationDays} days`}
                      </p>
                      {content.enableCoupons && (
                        <p className="text-[9px] text-amber-400 mt-1">
                          Coupon eligible
                        </p>
                      )}
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
