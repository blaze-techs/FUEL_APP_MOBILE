import { useState, useEffect } from "react";
import {
  CreditCard,
  Landmark,
  Smartphone,
  Globe,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  MapPin,
  Banknote,
  Wallet,
  QrCode,
  Signal,
  Wifi,
  Phone,
  Check,
} from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
const CUR = () => getCurrencySymbol(getDetectedCurrency());
import {
  COUNTRY_CONFIGS,
  SORTED_COUNTRY_CODES,
} from "../../config/paymentConfigAdapter";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";

const PAYMENT_METHODS_KEY = "fuelpro_payment_methods"; // Non-versioned — survives upgrades

// Migrate from old versioned key
function migratePaymentMethods(): void {
  try {
    const current = localStorage.getItem(PAYMENT_METHODS_KEY);
    if (current) return;
    const old = localStorage.getItem("fuelpro_payment_methods_v2");
    if (old) localStorage.setItem(PAYMENT_METHODS_KEY, old);
  } catch {
    /* */
  }
}

// ─── Types ───
interface BankAccount {
  id: string;
  countryCode: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  currency: string;
  isActive: boolean;
  createdAt: string;
}

interface MobileMoneyConfig {
  id: string;
  countryCode: string;
  provider: string;
  paybillNumber: string;
  accountReference: string;
  apiKey: string;
  shortCode: string;
  isActive: boolean;
  createdAt: string;
}

interface AdditionalMethod {
  id: string;
  countryCode: string;
  name: string;
  config: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}

interface PaymentMethodsData {
  detectedCountry: string;
  detectedAt: string;
  bankAccounts: BankAccount[];
  mobileMoney: MobileMoneyConfig[];
  additional: AdditionalMethod[];
  globalTaxRate: number;
  receiptFooter: string;
}

function loadData(): PaymentMethodsData {
  try {
    const s = localStorage.getItem(PAYMENT_METHODS_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return {
    detectedCountry: "",
    detectedAt: "",
    bankAccounts: [],
    mobileMoney: [],
    additional: [],
    globalTaxRate: 16,
    receiptFooter: "Thank you for choosing FuelPro!",
  };
}

function saveData(data: PaymentMethodsData) {
  localStorage.setItem(PAYMENT_METHODS_KEY, JSON.stringify(data));
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Country detection via precise location ───
async function detectCountryFromLocation(): Promise<{
  code: string;
  name: string;
} | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { "Accept-Language": "en" } },
          );
          const data = await res.json();
          const cc = data.address?.country_code?.toUpperCase();
          const displayName = data.address?.country || "";
          if (cc && COUNTRY_CONFIGS[cc]) {
            resolve({ code: cc, name: COUNTRY_CONFIGS[cc].name });
            return;
          }
          // Country detected but not in our config — still report it
          if (cc) {
            resolve({ code: cc, name: displayName || cc });
            return;
          }
        } catch {
          /* */
        }
        resolve(null);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function PaymentMethodsSection({ logAudit }: Props) {
  const [data, setData] = useState<PaymentMethodsData>(loadData);
  const [activeTab, setActiveTab] = useState<
    "methods" | "bank" | "mobile" | "additional" | "settings"
  >("methods");
  const [selectedCountry, setSelectedCountry] = useState("KE");
  const [detecting, setDetecting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Bank form
  const [bankForm, setBankForm] = useState({
    bankName: "",
    accountName: "",
    accountNumber: "",
    branch: "",
  });
  const [showBankForm, setShowBankForm] = useState(false);

  // Mobile money form
  const [mmForm, setMmForm] = useState({
    provider: "",
    paybillNumber: "",
    accountReference: "",
    apiKey: "",
    shortCode: "",
  });
  const [showMmForm, setShowMmForm] = useState(false);

  // Additional form
  const [addForm, setAddForm] = useState({
    name: "",
    configKey: "",
    configValue: "",
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addConfigEntries, setAddConfigEntries] = useState<
    Record<string, string>
  >({});

  const update = (patch: Partial<PaymentMethodsData>) => {
    setData((prev) => {
      const n = { ...prev, ...patch };
      saveData(n);
      return n;
    });
    setSaved(false);
  };

  const handleSave = () => {
    saveData(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      "Payment Methods Saved",
      `Saved payment config for ${selectedCountry}`,
      "success",
    );
  };

  const detectLocation = async () => {
    setDetecting(true);
    logAudit(
      "Location Detection",
      "Starting precise location detection for payment methods",
      "info",
    );
    const result = await detectCountryFromLocation();
    if (result) {
      setSelectedCountry(result.code);
      update({
        detectedCountry: result.code,
        detectedAt: new Date().toISOString(),
      });
      logAudit(
        "Location Detected",
        `Detected country: ${result.name} (${result.code})`,
        "success",
      );
    } else {
      logAudit(
        "Location Detection Failed",
        "Could not detect location, using manual selection",
        "warning",
      );
    }
    setDetecting(false);
  };

  // ─── Bank Account CRUD ───
  const addBankAccount = () => {
    if (!bankForm.bankName || !bankForm.accountName || !bankForm.accountNumber)
      return;
    const cc = COUNTRY_CONFIGS[selectedCountry];
    const acc: BankAccount = {
      id: genId("bank"),
      countryCode: selectedCountry,
      ...bankForm,
      currency: cc?.currency || getDetectedCurrency(),
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    update({ bankAccounts: [...data.bankAccounts, acc] });
    setBankForm({
      bankName: "",
      accountName: "",
      accountNumber: "",
      branch: "",
    });
    setShowBankForm(false);
    logAudit(
      "Bank Account Added",
      `${acc.bankName} - ${acc.accountName}`,
      "success",
    );
  };

  const removeBankAccount = (id: string) => {
    const acc = data.bankAccounts.find((a) => a.id === id);
    update({ bankAccounts: data.bankAccounts.filter((a) => a.id !== id) });
    if (acc) logAudit("Bank Account Removed", `${acc.bankName}`, "warning");
  };

  const toggleBankAccount = (id: string) => {
    update({
      bankAccounts: data.bankAccounts.map((a) =>
        a.id === id ? { ...a, isActive: !a.isActive } : a,
      ),
    });
  };

  // ─── Mobile Money CRUD ───
  const addMobileMoney = () => {
    if (!mmForm.provider) return;
    const mm: MobileMoneyConfig = {
      id: genId("mm"),
      countryCode: selectedCountry,
      ...mmForm,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    update({ mobileMoney: [...data.mobileMoney, mm] });
    setMmForm({
      provider: "",
      paybillNumber: "",
      accountReference: "",
      apiKey: "",
      shortCode: "",
    });
    setShowMmForm(false);
    logAudit("Mobile Money Added", `${mm.provider}`, "success");
  };

  const removeMobileMoney = (id: string) => {
    const mm = data.mobileMoney.find((m) => m.id === id);
    update({ mobileMoney: data.mobileMoney.filter((m) => m.id !== id) });
    if (mm) logAudit("Mobile Money Removed", `${mm.provider}`, "warning");
  };

  const toggleMobileMoney = (id: string) => {
    update({
      mobileMoney: data.mobileMoney.map((m) =>
        m.id === id ? { ...m, isActive: !m.isActive } : m,
      ),
    });
  };

  // ─── Additional Methods CRUD ───
  const addAdditional = () => {
    if (!addForm.name) return;
    const am: AdditionalMethod = {
      id: genId("add"),
      countryCode: selectedCountry,
      name: addForm.name,
      config: { ...addConfigEntries },
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    update({ additional: [...data.additional, am] });
    setAddForm({ name: "", configKey: "", configValue: "" });
    setAddConfigEntries({});
    setShowAddForm(false);
    logAudit("Payment Method Added", `${am.name}`, "success");
  };

  const removeAdditional = (id: string) => {
    const am = data.additional.find((a) => a.id === id);
    update({ additional: data.additional.filter((a) => a.id !== id) });
    if (am) logAudit("Payment Method Removed", `${am.name}`, "warning");
  };

  const toggleAdditional = (id: string) => {
    update({
      additional: data.additional.map((a) =>
        a.id === id ? { ...a, isActive: !a.isActive } : a,
      ),
    });
  };

  const addConfigEntry = () => {
    if (!addForm.configKey || !addForm.configValue) return;
    setAddConfigEntries((prev) => ({
      ...prev,
      [addForm.configKey]: addForm.configValue,
    }));
    setAddForm((prev) => ({ ...prev, configKey: "", configValue: "" }));
  };

  const countryConfig = COUNTRY_CONFIGS[selectedCountry];
  const countryBankAccounts = data.bankAccounts.filter(
    (a) => a.countryCode === selectedCountry,
  );
  const countryMobileMoney = data.mobileMoney.filter(
    (m) => m.countryCode === selectedCountry,
  );
  const countryAdditional = data.additional.filter(
    (a) => a.countryCode === selectedCountry,
  );
  const allMethods = [
    ...countryBankAccounts,
    ...countryMobileMoney,
    ...countryAdditional,
  ];
  const activeCount = allMethods.filter((m) => m.isActive).length;

  const inputClass =
    "w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Banknote size={18} className="text-green-400" /> Payment Methods
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure bank, mobile money & payment methods per location
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
            className="px-3 py-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between p-3 bg-[#161618] border border-white/[0.06] rounded-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Globe size={12} className="text-blue-400" />
            <span className="text-xs text-gray-400">
              {countryConfig?.flag} {countryConfig?.name}
            </span>
            <span className="text-xs text-gray-500">
              ({countryConfig?.currency})
            </span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1">
            <CheckCircle2 size={10} className="text-emerald-400" />
            <span className="text-[10px] text-emerald-400">
              {activeCount} active
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Wallet size={10} className="text-gray-500" />
            <span className="text-[10px] text-gray-500">
              {allMethods.length} total
            </span>
          </div>
          {data.detectedCountry && (
            <div className="flex items-center gap-1">
              <MapPin size={10} className="text-amber-400" />
              <span className="text-[10px] text-amber-400">
                Detected: {COUNTRY_CONFIGS[data.detectedCountry]?.name}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={detectLocation}
          disabled={detecting}
          className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors disabled:opacity-50 flex items-center gap-1 fp-icon-only"
          title="Refresh"
          aria-label="Refresh"
        >
          {detecting ? (
            <>
              <RefreshCw size={10} className="animate-spin" /> Detecting...
            </>
          ) : (
            <>
              <MapPin size={10} /> Detect Location
            </>
          )}
        </button>
      </div>

      {/* Country selector — searchable dropdown for all 250 countries */}
      <div className="flex items-center gap-3">
        <div className="w-80">
          <SearchableCountryDropdown
            value={selectedCountry}
            onChange={setSelectedCountry}
            filterCountries={SORTED_COUNTRY_CODES}
          />
        </div>
        <span className="text-[10px] text-gray-600">
          {SORTED_COUNTRY_CODES.length} countries configured
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-lg p-0.5 w-fit">
        {[
          { id: "methods" as const, label: "All Methods", icon: CreditCard },
          { id: "bank" as const, label: "Bank Accounts", icon: Landmark },
          { id: "mobile" as const, label: "Mobile Money", icon: Smartphone },
          { id: "additional" as const, label: "Additional", icon: Wallet },
          { id: "settings" as const, label: "Settings", icon: Globe },
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

      {/* ═════ ALL METHODS TAB ═════ */}
      {activeTab === "methods" && (
        <div className="space-y-4">
          {allMethods.length === 0 ? (
            <div className="text-center py-12 bg-[#161618] border border-white/[0.06] rounded-xl">
              <Banknote size={32} className="mx-auto mb-3 text-gray-700" />
              <p className="text-sm text-gray-500">
                No payment methods configured for {countryConfig?.name}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Add bank accounts, mobile money, or additional methods
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {allMethods.map((m) => {
                const isBank = "bankName" in m;
                const isMM = "provider" in m;
                const isAdd = "name" in m && !isBank && !isMM;
                return (
                  <div
                    key={m.id}
                    className={`bg-[#161618] border rounded-xl p-4 ${m.isActive ? "border-white/[0.06]" : "border-white/[0.03] opacity-60"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${m.isActive ? "bg-green-500/10" : "bg-white/5"}`}
                        >
                          {isBank ? (
                            <Landmark
                              size={18}
                              className={
                                m.isActive ? "text-blue-400" : "text-gray-600"
                              }
                            />
                          ) : isMM ? (
                            <Smartphone
                              size={18}
                              className={
                                m.isActive ? "text-green-400" : "text-gray-600"
                              }
                            />
                          ) : (
                            <Wallet
                              size={18}
                              className={
                                m.isActive ? "text-amber-400" : "text-gray-600"
                              }
                            />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {isBank
                              ? (m as BankAccount).bankName
                              : isMM
                                ? (m as MobileMoneyConfig).provider
                                : (m as AdditionalMethod).name}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            {isBank
                              ? `${(m as BankAccount).accountName} • ****${(m as BankAccount).accountNumber.slice(-4)}`
                              : isMM
                                ? `Paybill: ${(m as MobileMoneyConfig).paybillNumber || "N/A"}`
                                : `${Object.keys((m as AdditionalMethod).config).length} config keys`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            isBank
                              ? toggleBankAccount(m.id)
                              : isMM
                                ? toggleMobileMoney(m.id)
                                : toggleAdditional(m.id)
                          }
                          className={`relative w-8 h-4.5 rounded-full transition-colors ${m.isActive ? "bg-green-500" : "bg-gray-600"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${m.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                        <button
                          onClick={() =>
                            isBank
                              ? removeBankAccount(m.id)
                              : isMM
                                ? removeMobileMoney(m.id)
                                : removeAdditional(m.id)
                          }
                          className="text-gray-600 hover:text-red-400 p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═════ BANK ACCOUNTS TAB ═════ */}
      {activeTab === "bank" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Bank Accounts ({countryBankAccounts.length})
            </h3>
            <button
              onClick={() => setShowBankForm(!showBankForm)}
              className="px-3 py-1.5 bg-blue-500/15 text-blue-300 text-xs rounded-lg border border-blue-500/20 flex items-center gap-1"
            >
              {showBankForm ? (
                "Cancel"
              ) : (
                <>
                  <Plus size={12} /> Add Bank
                </>
              )}
            </button>
          </div>

          {showBankForm && (
            <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Bank Name
                  </label>
                  <select
                    value={bankForm.bankName}
                    onChange={(e) =>
                      setBankForm((p) => ({ ...p, bankName: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">Select bank...</option>
                    {countryConfig?.banks.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Branch
                  </label>
                  <input
                    value={bankForm.branch}
                    onChange={(e) =>
                      setBankForm((p) => ({ ...p, branch: e.target.value }))
                    }
                    placeholder="Main Branch"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Account Name
                  </label>
                  <input
                    value={bankForm.accountName}
                    onChange={(e) =>
                      setBankForm((p) => ({
                        ...p,
                        accountName: e.target.value,
                      }))
                    }
                    placeholder="FuelPro Station Ltd"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Account Number
                  </label>
                  <input
                    value={bankForm.accountNumber}
                    onChange={(e) =>
                      setBankForm((p) => ({
                        ...p,
                        accountNumber: e.target.value,
                      }))
                    }
                    placeholder="1234567890"
                    className={inputClass}
                  />
                </div>
              </div>
              <button
                onClick={addBankAccount}
                className="px-4 py-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors flex items-center gap-1"
              >
                <Save size={12} /> Save Bank Account
              </button>
            </div>
          )}

          {countryBankAccounts.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-8">
              No bank accounts for {countryConfig?.name}
            </p>
          ) : (
            <div className="space-y-2">
              {countryBankAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Landmark size={16} className="text-blue-400" />
                      <div>
                        <p className="text-sm text-white font-medium">
                          {acc.bankName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {acc.accountName} • {acc.currency}
                        </p>
                        <p className="text-[10px] text-gray-600 font-mono">
                          ****{acc.accountNumber.slice(-4)} • {acc.branch}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleBankAccount(acc.id)}
                        className={`relative w-8 h-4.5 rounded-full transition-colors ${acc.isActive ? "bg-green-500" : "bg-gray-600"}`}
                      >
                        <div
                          className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${acc.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      <button
                        onClick={() => removeBankAccount(acc.id)}
                        className="text-gray-600 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════ MOBILE MONEY TAB ═════ */}
      {activeTab === "mobile" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Mobile Money ({countryMobileMoney.length})
            </h3>
            <button
              onClick={() => setShowMmForm(!showMmForm)}
              className="px-3 py-1.5 bg-green-500/15 text-green-300 text-xs rounded-lg border border-green-500/20 flex items-center gap-1"
            >
              {showMmForm ? (
                "Cancel"
              ) : (
                <>
                  <Plus size={12} /> Add Mobile Money
                </>
              )}
            </button>
          </div>

          {showMmForm && (
            <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Provider
                  </label>
                  <select
                    value={mmForm.provider}
                    onChange={(e) =>
                      setMmForm((p) => ({ ...p, provider: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">Select provider...</option>
                    {countryConfig?.mobileMoney.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Paybill / Till Number
                  </label>
                  <input
                    value={mmForm.paybillNumber}
                    onChange={(e) =>
                      setMmForm((p) => ({
                        ...p,
                        paybillNumber: e.target.value,
                      }))
                    }
                    placeholder="123456"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Account Reference
                  </label>
                  <input
                    value={mmForm.accountReference}
                    onChange={(e) =>
                      setMmForm((p) => ({
                        ...p,
                        accountReference: e.target.value,
                      }))
                    }
                    placeholder="FUELPRO"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Short Code
                  </label>
                  <input
                    value={mmForm.shortCode}
                    onChange={(e) =>
                      setMmForm((p) => ({ ...p, shortCode: e.target.value }))
                    }
                    placeholder="247247"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">
                    API Key (optional)
                  </label>
                  <input
                    type="password"
                    value={mmForm.apiKey}
                    onChange={(e) =>
                      setMmForm((p) => ({ ...p, apiKey: e.target.value }))
                    }
                    placeholder="sk_live_..."
                    className={inputClass}
                  />
                </div>
              </div>
              <button
                onClick={addMobileMoney}
                className="px-4 py-2 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors flex items-center gap-1"
              >
                <Save size={12} /> Save Mobile Money
              </button>
            </div>
          )}

          {countryMobileMoney.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-8">
              No mobile money for {countryConfig?.name}
            </p>
          ) : (
            <div className="space-y-2">
              {countryMobileMoney.map((mm) => (
                <div
                  key={mm.id}
                  className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Smartphone size={16} className="text-green-400" />
                      <div>
                        <p className="text-sm text-white font-medium">
                          {mm.provider}
                        </p>
                        <div className="flex gap-3 mt-0.5">
                          {mm.paybillNumber && (
                            <span className="text-[10px] text-gray-500">
                              Paybill: {mm.paybillNumber}
                            </span>
                          )}
                          {mm.shortCode && (
                            <span className="text-[10px] text-gray-500">
                              Shortcode: {mm.shortCode}
                            </span>
                          )}
                          {mm.accountReference && (
                            <span className="text-[10px] text-gray-500">
                              Ref: {mm.accountReference}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleMobileMoney(mm.id)}
                        className={`relative w-8 h-4.5 rounded-full transition-colors ${mm.isActive ? "bg-green-500" : "bg-gray-600"}`}
                      >
                        <div
                          className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${mm.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      <button
                        onClick={() => removeMobileMoney(mm.id)}
                        className="text-gray-600 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════ ADDITIONAL METHODS TAB ═════ */}
      {activeTab === "additional" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Additional Methods ({countryAdditional.length})
            </h3>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 bg-amber-500/15 text-amber-300 text-xs rounded-lg border border-amber-500/20 flex items-center gap-1"
            >
              {showAddForm ? (
                "Cancel"
              ) : (
                <>
                  <Plus size={12} /> Add Method
                </>
              )}
            </button>
          </div>

          {showAddForm && (
            <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Method Name
                </label>
                <select
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, name: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Select method...</option>
                  {countryConfig?.additional.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={addForm.configKey}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, configKey: e.target.value }))
                  }
                  placeholder="Config key"
                  className={inputClass}
                />
                <input
                  value={addForm.configValue}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, configValue: e.target.value }))
                  }
                  placeholder="Config value"
                  className={inputClass}
                />
              </div>
              <button
                onClick={addConfigEntry}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors"
              >
                <Plus size={10} className="inline mr-1" /> Add Config Entry
              </button>
              {Object.keys(addConfigEntries).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(addConfigEntries).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex justify-between text-xs bg-white/[0.02] rounded px-2 py-1"
                    >
                      <span className="text-gray-400 font-mono">{k}</span>
                      <span className="text-gray-500 font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={addAdditional}
                className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1"
              >
                <Save size={12} /> Save Method
              </button>
            </div>
          )}

          {countryAdditional.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-8">
              No additional methods for {countryConfig?.name}
            </p>
          ) : (
            <div className="space-y-2">
              {countryAdditional.map((am) => (
                <div
                  key={am.id}
                  className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Wallet size={16} className="text-amber-400" />
                      <div>
                        <p className="text-sm text-white font-medium">
                          {am.name}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {Object.entries(am.config).map(([k, v]) => (
                            <span
                              key={k}
                              className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500 font-mono"
                            >
                              {k}: {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleAdditional(am.id)}
                        className={`relative w-8 h-4.5 rounded-full transition-colors ${am.isActive ? "bg-green-500" : "bg-gray-600"}`}
                      >
                        <div
                          className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${am.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      <button
                        onClick={() => removeAdditional(am.id)}
                        className="text-gray-600 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════ SETTINGS TAB ═════ */}
      {activeTab === "settings" && (
        <div className="space-y-4">
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-white mb-2">
              Global Payment Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Default Tax Rate (%)
                </label>
                <input
                  type="number"
                  value={data.globalTaxRate}
                  onChange={(e) =>
                    update({ globalTaxRate: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Receipt Footer Text
                </label>
                <input
                  value={data.receiptFooter}
                  onChange={(e) => update({ receiptFooter: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Available providers per country */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">
              Available Providers for {countryConfig?.name}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-blue-400 font-medium mb-2 flex items-center gap-1">
                  <Landmark size={12} /> Banks
                </p>
                <div className="space-y-1">
                  {countryConfig?.banks.map((b) => (
                    <p key={b} className="text-[10px] text-gray-500">
                      {b}
                    </p>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-green-400 font-medium mb-2 flex items-center gap-1">
                  <Smartphone size={12} /> Mobile Money
                </p>
                <div className="space-y-1">
                  {countryConfig?.mobileMoney.map((m) => (
                    <p key={m} className="text-[10px] text-gray-500">
                      {m}
                    </p>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-amber-400 font-medium mb-2 flex items-center gap-1">
                  <Wallet size={12} /> Additional
                </p>
                <div className="space-y-1">
                  {countryConfig?.additional.map((a) => (
                    <p key={a} className="text-[10px] text-gray-500">
                      {a}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
