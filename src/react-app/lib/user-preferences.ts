/**
 * user-preferences.ts
 * Cloud-backed, per-user site-wide preferences.
 *
 * Everything that was previously hardcoded (default categories, fuel types,
 * units, tax labels, currency formatting, automation settings, etc.) is now
 * adjustable per-user and syncs across devices via cloudStorageService.
 *
 * Components read these prefs via `useUserPrefs()` and fall back to sensible
 * defaults, so the app works out-of-the-box even for a brand-new user.
 */

import { useState, useEffect, useCallback } from "react";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  getDetectedCurrency,
  getCurrencySymbol,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import { getVATRate, CANONICAL_FUEL_TYPES } from "@/react-app/config/pricing";

/** Country-aware default fuel types (not hardcoded PMS/AGO only). */
function getDefaultFuelTypes() {
  const cc = getDetectedCountryCode();
  // Every station gets at least petrol + diesel; Kenya adds kerosene + LPG.
  const base = [
    { label: CANONICAL_FUEL_TYPES.petrol.label, code: "PMS", price: 0 },
    { label: CANONICAL_FUEL_TYPES.diesel.label, code: "AGO", price: 0 },
  ];
  if (cc === "KE") {
    return [
      ...base,
      { label: CANONICAL_FUEL_TYPES.kerosene.label, code: "IK", price: 0 },
      { label: CANONICAL_FUEL_TYPES.lpg.label, code: "LPG", price: 0 },
    ];
  }
  return [
    ...base,
    { label: CANONICAL_FUEL_TYPES.kerosene.label, code: "IK", price: 0 },
  ];
}

export interface UserPreferences {
  // Currency & formatting
  currency: string;
  currencySymbol: string;
  currencyPosition: "before" | "after";
  numberFormat: "1,000.00" | "1.000,00" | "1 000.00";
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  timeFormat: "12h" | "24h";

  // Tax
  vatRate: number; // override; null/0 means use country default
  vatLabel: string; // e.g. "VAT", "GST", "Sales Tax", "IVA"
  taxIncludedInPrice: boolean;

  // Product / inventory defaults
  defaultCategories: string[];
  defaultUnits: string[];
  defaultReorderLevel: number;
  lowStockThresholdPercent: number; // % of reorder level

  // Fuel defaults
  fuelTypes: { label: string; code: string; price: number }[];

  // POS / sales
  defaultPaymentMethods: string[];
  receiptFooter: string;
  invoicePrefix: string;
  invoiceNextNumber: number;

  // Automation (mirrors automation-engine prefs, kept here for unified editing)
  automation: {
    autoReorderEnabled: boolean;
    autoRecordStockOnProductEdit: boolean;
    autoRefreshDashboard: boolean;
    autoSyncPricesAcrossTabs: boolean;
    autoLogShiftTotals: boolean;
    // Module Behavior (General Settings -> Module Behavior tab)
    autoApplyLoyaltyDiscounts?: boolean;
    autoOpenCashDrawer?: boolean;
    autoPrintReceipt?: boolean;
    showShiftReminderOnClose?: boolean;
    autoCalculateDipDifferences?: boolean;
    autoFlagShortDeliveries?: boolean;
    showLiveTVTab?: boolean;
    showLiveRadioTab?: boolean;
    autoPlayLiveStreams?: boolean;
    requireInviteCodeApproval?: boolean;
    autoDeactivateExpiredMembers?: boolean;
    autoCreateProductOnDelivery?: boolean;
    showNegativeStockWarning?: boolean;
    autoUpdateFuelPrices?: boolean;
    showEpraReference?: boolean;
  };

  // UI
  theme: "dark" | "light";
  compactMode: boolean;
  /** Which registered tab id opens on login (General Settings →
   *  Default Landing Tab). Validated against tabConfigurations at
   *  apply-time with fallback to "dashboard". */
  defaultTab: string;
  /** When true, reopen the tab the owner last had open instead of
   *  defaultTab. */
  rememberLastTab?: boolean;

  // Misc
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
}

const PREFS_KEY = "user_preferences";

export const DEFAULT_PREFERENCES: UserPreferences = {
  currency: getDetectedCurrency(),
  currencySymbol: getCurrencySymbol(getDetectedCurrency()),
  currencyPosition: "before",
  numberFormat: "1,000.00",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",

  vatRate: getVATRate(getDetectedCountryCode()),
  vatLabel: getDefaultTaxLabel(getDetectedCountryCode()),
  taxIncludedInPrice: false,

  defaultCategories: ["Fuel", "Lubricants", "Accessories", "Services", "Other"],
  defaultUnits: ["pcs", "liters", "kg", "boxes", "drums", "cartons"],
  defaultReorderLevel: 10,
  lowStockThresholdPercent: 100,

  fuelTypes: getDefaultFuelTypes(),

  defaultPaymentMethods: ["cash", "card", "bank_transfer"],
  receiptFooter: "Thank you for your business!",
  invoicePrefix: "INV",
  invoiceNextNumber: 1,

  automation: {
    autoReorderEnabled: true,
    autoRecordStockOnProductEdit: true,
    autoRefreshDashboard: true,
    autoSyncPricesAcrossTabs: true,
    autoLogShiftTotals: true,
  },

  theme: "dark",
  compactMode: false,
  defaultTab: "dashboard",
  rememberLastTab: false,

  companyName: "",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
};

function getDefaultTaxLabel(countryCode: string): string {
  const map: Record<string, string> = {
    GB: "VAT",
    DE: "MwSt",
    FR: "TVA",
    IT: "IVA",
    ES: "IVA",
    NL: "BTW",
    BE: "BTW",
    AT: "USt",
    IE: "VAT",
    PT: "IVA",
    GR: "ΦΠΑ",
    PL: "VAT",
    SE: "Moms",
    DK: "Moms",
    NO: "MVA",
    FI: "ALV",
    CZ: "DPH",
    HU: "ÁFA",
    RO: "TVA",
    BG: "ДДС",
    US: "Sales Tax",
    CA: "GST",
    AU: "GST",
    NZ: "GST",
    JP: "消費税",
    KR: "VAT",
    CN: "增值税",
    IN: "GST",
    SG: "GST",
    MY: "SST",
    TH: "VAT",
    ID: "PPN",
    PH: "VAT",
    VN: "VAT",
    AE: "VAT",
    SA: "VAT",
    QA: "VAT",
    BH: "VAT",
    OM: "VAT",
    BR: "ICMS",
    MX: "IVA",
    AR: "IVA",
    CL: "IVA",
    CO: "IVA",
    PE: "IGV",
    TR: "KDV",
    IL: 'מע"ם',
    EG: "VAT",
    MA: "TVA",
    TN: "TVA",
    KE: "VAT",
    UG: "VAT",
    TZ: "VAT",
    NG: "VAT",
    ZA: "VAT",
    GH: "VAT",
    RW: "VAT",
    ET: "VAT",
    PK: "GST",
    BD: "VAT",
    LK: "VAT",
  };
  return map[countryCode] || "VAT";
}

let cachedPrefs: UserPreferences | null = null;
const listeners = new Set<(p: UserPreferences) => void>();

export async function getUserPrefs(): Promise<UserPreferences> {
  if (cachedPrefs) return cachedPrefs;
  const stored =
    await cloudStorageService.get<Partial<UserPreferences>>(PREFS_KEY);
  const prefs = stored
    ? deepMerge(DEFAULT_PREFERENCES, stored)
    : { ...DEFAULT_PREFERENCES };
  cachedPrefs = prefs;
  return prefs;
}

export async function saveUserPrefs(prefs: UserPreferences): Promise<void> {
  cachedPrefs = prefs;
  await cloudStorageService.set(PREFS_KEY, prefs);
  listeners.forEach((fn) => fn(prefs));
  // Nudge the app so components that read prefs re-render
  window.dispatchEvent(
    new CustomEvent("user-prefs:changed", { detail: prefs }),
  );
}

export function updateUserPrefs(
  patch: Partial<UserPreferences>,
): Promise<void> {
  const current = cachedPrefs || DEFAULT_PREFERENCES;
  const merged = deepMerge(current, patch);
  return saveUserPrefs(merged);
}

export function onUserPrefsChanged(
  fn: (p: UserPreferences) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Deep merge (1 level for nested objects like automation)
function deepMerge<T>(base: T, patch: Partial<T>): T {
  const result = { ...base };
  for (const key in patch) {
    const v = (patch as any)[key];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof (result as any)[key] === "object"
    ) {
      (result as any)[key] = { ...(result as any)[key], ...v };
    } else if (v !== undefined) {
      (result as any)[key] = v;
    }
  }
  return result;
}

/**
 * React hook: reads user preferences, auto-loads on mount, and re-renders
 * when prefs change anywhere in the app.
 */
export function useUserPrefs(): {
  prefs: UserPreferences;
  loading: boolean;
  update: (patch: Partial<UserPreferences>) => Promise<void>;
  save: (prefs: UserPreferences) => Promise<void>;
} {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getUserPrefs();
      if (!cancelled) {
        setPrefs(p);
        setLoading(false);
      }
    })();
    const unsub = onUserPrefsChanged((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.id]);

  const update = useCallback(
    (patch: Partial<UserPreferences>) => updateUserPrefs(patch),
    [],
  );
  const save = useCallback((p: UserPreferences) => saveUserPrefs(p), []);

  return { prefs, loading, update, save };
}

// ─── Formatting helpers (use prefs when available) ────────────────────────

export function formatCurrency(
  amount: number,
  prefs?: UserPreferences | null,
): string {
  const p = prefs || cachedPrefs || DEFAULT_PREFERENCES;
  const symbol = p.currencySymbol || getCurrencySymbol(p.currency);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return p.currencyPosition === "after"
    ? `${formatted} ${symbol}`
    : `${symbol} ${formatted}`;
}

export function getTaxLabel(prefs?: UserPreferences | null): string {
  return (prefs || cachedPrefs)?.vatLabel || "VAT";
}

export function getEffectiveVatRate(prefs?: UserPreferences | null): number {
  const p = prefs || cachedPrefs;
  if (p && p.vatRate) return p.vatRate;
  return getVATRate(getDetectedCountryCode());
}
