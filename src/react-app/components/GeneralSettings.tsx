/**
 * GeneralSettings.tsx — Comprehensive admin/owner-only Settings tab.
 *
 * A single control center for EVERY modification (present + future) to:
 * tabs, sub-tabs, logic, integrations, branding, localization, security,
 * notifications, automation, and system config. Cloud-backed (cross-device)
 * via cloudStorageService + real-time subscription.
 *
 * Sub-tabs:
 *  1. General       — company info, currency, date/time format, default tab
 *  2. Tab Manager   — show/hide/reorder every top-level tab + label editing
 *  3. Features      — feature flags (POS, inventory, AI, cloud sync, etc.)
 *  4. Appearance    — theme, compact mode, accent color, branding/logo
 *  5. Tax & Finance — VAT rate/label, payment methods, invoice prefix
 *  6. Integrations  — M-PESA, Kopo Kopo, KRA, webhooks, SMS/email gateways
 *  7. Automation    — auto-reorder, auto-sync, auto-refresh toggles
 *  8. Security      — 2FA, session timeout, access codes, API keys
 *  9. Notifications — email/SMS/push notification preferences
 * 10. System        — version, docs links, health check, backup/restore
 *
 * Admin/owner-only. The gate is enforced via PermissionContext.canDo("manage","settings").
 */
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  Settings,
  LayoutGrid,
  ToggleLeft,
  Palette,
  Receipt,
  Plug,
  Zap,
  Shield,
  Bell,
  Server,
  Save,
  RotateCcw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Search,
  GripVertical,
  Eye,
  EyeOff,
  RefreshCw,
  Download,
  Upload,
  Info,
  Globe,
  Package,
  Fuel,
  Monitor,
  Clock,
  DollarSign,
  Tag,
  KeyRound,
  Activity,
  Database,
  Cloud,
  ChevronUp,
  ChevronDown,
  Building,
  CreditCard,
  MapPin,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import SubTabBar, { SubTab } from "@/react-app/components/SubTabBar";
import { useFuel, CompanyData } from "@/react-app/context/FuelContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { useTenant } from "@/react-app/context/TenantContext";
import { uploadStationLogo } from "@/react-app/lib/logo-storage-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  useUserPrefs,
  UserPreferences,
} from "@/react-app/lib/user-preferences";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  getCurrencySymbol,
  getDetectedCurrency,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import { getVATRate } from "@/react-app/config/pricing";
import { TabConfiguration } from "@/react-app/context/FuelContext";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  FALLBACK_TAB,
  resolveLandingTab,
  beginLandingPreview,
} from "@/react-app/lib/landing-tab";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

// ─── Cloud-backed settings store ────────────────────────────────────────────
const SETTINGS_KEY = "general_settings_v1";

export interface GeneralSettingsConfig {
  // General
  stationName: string;
  stationAddress: string;
  stationPhone: string;
  stationEmail: string;
  stationWebsite: string;
  timezone: string;
  businessHours: { open: string; close: string; days: string[] };

  // Appearance
  theme: "dark" | "light" | "system";
  accentColor: string;
  compactMode: boolean;
  sidebarCollapsed: boolean;
  logoUrl: string;

  // Tax & Finance
  taxEnabled: boolean;
  taxRate: number;
  taxLabel: string;
  taxIncludedInPrice: boolean;
  currency: string;
  currencyPosition: "before" | "after";
  invoicePrefix: string;
  invoiceNextNumber: number;
  receiptFooter: string;
  receiptHeader: string;

  // Notifications
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  lowStockAlerts: boolean;
  dailySummaryEmail: boolean;
  creditAlerts: boolean;
  shiftReminders: boolean;

  // Security
  sessionTimeoutMinutes: number;
  requireTwoFactor: boolean;
  maxLoginAttempts: number;
  ipWhitelist: string;
  auditLogRetentionDays: number;

  // System
  autoBackup: boolean;
  backupFrequency: "daily" | "weekly" | "monthly";
  dataRetentionDays: number;
  enableRealtime: boolean;
  enableCompression: boolean;
  lowBandwidthMode: boolean;

  // Metadata
  updatedAt: string;
  updatedBy: string;
  version: number;
}

const DEFAULT_CONFIG: GeneralSettingsConfig = {
  stationName: "",
  stationAddress: "",
  stationPhone: "",
  stationEmail: "",
  stationWebsite: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  businessHours: {
    open: "06:00",
    close: "22:00",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },

  theme: "dark",
  accentColor: "#c5a059",
  compactMode: false,
  sidebarCollapsed: false,
  logoUrl: "",

  taxEnabled: true,
  taxRate: getVATRate(getDetectedCountryCode()),
  taxLabel: "VAT",
  taxIncludedInPrice: false,
  currency: getDetectedCurrency(),
  currencyPosition: "before",
  invoicePrefix: "INV",
  invoiceNextNumber: 1,
  receiptFooter: "Thank you for your business!",
  receiptHeader: "FuelPro Station",

  emailNotifications: true,
  smsNotifications: false,
  pushNotifications: true,
  lowStockAlerts: true,
  dailySummaryEmail: false,
  creditAlerts: true,
  shiftReminders: true,

  sessionTimeoutMinutes: 30,
  requireTwoFactor: false,
  maxLoginAttempts: 5,
  ipWhitelist: "",
  auditLogRetentionDays: 90,

  autoBackup: true,
  backupFrequency: "daily",
  dataRetentionDays: 365,
  // Realtime is OFF by default to respect the Supabase Free-plan Realtime
  // message quota (org was >170% over). Enable manually for instant sync.
  enableRealtime: false,
  enableCompression: true,
  lowBandwidthMode: true,

  updatedAt: new Date().toISOString(),
  updatedBy: "",
  version: 1,
};

// ─── Toast helper ───────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const show = useCallback(
    (msg: string, type: "success" | "error" | "info" = "success") => {
      setToast({ msg, type });
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );
  return { toast, show };
}

// ─── Reusable toggle ────────────────────────────────────────────────────────
function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3 ${disabled ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Reusable field ─────────────────────────────────────────────────────────
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

const inputClass =
  "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-h-[40px]";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function GeneralSettings() {
  const { state, dispatch } = useFuel();
  const { canDo } = usePermissions();
  const { user } = useAuth();
  const { currentStation } = useStations();
  const { featureFlags } = useTenant();
  const { prefs, update: updatePrefs } = useUserPrefs();
  const { toast, show } = useToast();

  const [activeSubTab, setActiveSubTab] = useState("general");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("settings", setActiveSubTab);
  const [config, setConfig] = useState<GeneralSettingsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 3-ref guard for cloud sync
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  // Permission gate — admin/owner only. Owner has FULL control (no field is
  // locked); managers/staff with the "settings" grant can view + edit too.
  const canManageSettings =
    canDo("manage", "settings") || canDo("view", "settings");
  const isOwner = canDo("manage", "settings");

  // ─── PRE-FILL from existing data (prevents double entry) ──────────────────
  // Merge the station/company data the user ALREADY entered (via the setup
  // wizard, Header "Edit Info", or station creation) into the GeneralSettings
  // config, so the fields are populated on first open instead of blank. The
  // cloud config row wins when it has a value; otherwise we fall back to the
  // authoritative `state.companyData` / `currentStation` fields.
  const prefilledConfig = useMemo<GeneralSettingsConfig>(() => {
    const cd = state.companyData;
    const st = currentStation;
    return {
      ...config,
      stationName: config.stationName || cd.name || st?.name || "",
      stationAddress:
        config.stationAddress || cd.physicalAddress || st?.location || "",
      stationPhone: config.stationPhone || cd.contacts || st?.phone || "",
      stationEmail: config.stationEmail || cd.email || st?.email || "",
      timezone:
        config.timezone ||
        st?.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC",
      logoUrl: config.logoUrl || cd.logo || st?.logo || "",
      currency:
        config.currency ||
        cd.companyCurrency ||
        st?.currency ||
        getDetectedCurrency(),
      taxRate:
        config.taxRate ||
        (typeof st?.taxRate === "number" ? st.taxRate : 0) ||
        getVATRate(st?.country || getDetectedCountryCode()),
      taxLabel: config.taxLabel || "VAT",
      receiptHeader:
        config.receiptHeader || cd.name || st?.name || "FuelPro Station",
      receiptFooter:
        config.receiptFooter ||
        `Thank you for choosing ${cd.name || st?.name || "FuelPro"}!`,
      invoicePrefix: config.invoicePrefix || cd.etrInvoicePrefix || "INV",
    };
  }, [config, state.companyData, currentStation]);

  // Keep the live config in sync with the pre-filled values (one-shot per
  // load/station change) so edits persist to cloud with the merged data.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && config === prefilledConfig) return;
    setConfig(prefilledConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledConfig]);

  // Load config from cloud
  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const cloud =
          await cloudStorageService.get<GeneralSettingsConfig>(SETTINGS_KEY);
        if (!cancelled && cloud) {
          setConfig({ ...DEFAULT_CONFIG, ...cloud });
        }
      } catch (e) {
        console.error("[GeneralSettings] load error:", e);
      } finally {
        if (!cancelled) {
          cloudLoadCompleteRef.current = true;
          setLoading(false);
          // Flush local modifications made during load
          if (localModifiedRef.current) {
            cloudStorageService
              .set(SETTINGS_KEY, configRef.current)
              .catch(() => {});
            localModifiedRef.current = false;
          }
        }
      }
    })();
    const unsub = cloudStorageService.subscribe<GeneralSettingsConfig>(
      SETTINGS_KEY,
      undefined,
      (cloud) => {
        if (!localModifiedRef.current && cloud) {
          setConfig({ ...DEFAULT_CONFIG, ...cloud });
        }
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.id]);

  // Save handler
  const saveConfig = useCallback(
    (newConfig: GeneralSettingsConfig) => {
      if (!cloudLoadCompleteRef.current) return;
      localModifiedRef.current = true;
      const updated = {
        ...newConfig,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || "unknown",
      };
      setConfig(updated);
      setSaving(true);
      cloudStorageService
        .set(SETTINGS_KEY, updated)
        .then(() => {
          localModifiedRef.current = false;
          show("Settings saved & synced across devices", "success");
        })
        .catch(() => show("Failed to save settings to cloud", "error"))
        .finally(() => setSaving(false));
    },
    [user?.email, show],
  );

  // Update a single field
  const update = useCallback(
    <K extends keyof GeneralSettingsConfig>(
      key: K,
      value: GeneralSettingsConfig[K],
    ) => {
      saveConfig({ ...configRef.current, [key]: value });
    },
    [saveConfig],
  );

  // ─── Two-way sync: currency/tax/name changes also write to the ───────────
  // authoritative `state.companyData` so invoices, receipts, reports, and the
  // Header "Edit Info" form all read the SAME values the owner set here.
  // (CompanyData is the source of truth for printed/exported documents.)
  const syncCompanyData = useCallback(
    (patch: Partial<CompanyData>) => {
      const merged = { ...state.companyData, ...patch };
      // Clean empty strings so mergeCompanyData keeps existing values.
      (Object.keys(merged) as (keyof CompanyData)[]).forEach((k) => {
        if (merged[k] === "") delete (merged as any)[k];
      });
      dispatch({ type: "SET_COMPANY_DATA", payload: merged });
    },
    [state.companyData, dispatch],
  );

  // Update a config field AND mirror it into companyData when relevant.
  const updateAndSync = useCallback(
    <K extends keyof GeneralSettingsConfig>(
      key: K,
      value: GeneralSettingsConfig[K],
      companyPatch?: Partial<CompanyData>,
    ) => {
      update(key, value);
      if (companyPatch) syncCompanyData(companyPatch);
    },
    [update, syncCompanyData],
  );

  // Reset to defaults
  const resetConfig = useCallback(() => {
    if (!confirm("Reset ALL settings to defaults? This cannot be undone."))
      return;
    saveConfig({ ...DEFAULT_CONFIG, stationName: config.stationName });
    show("Settings reset to defaults", "info");
  }, [saveConfig, config.stationName, show]);

  // Export settings
  const exportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro-settings-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show("Settings exported", "success");
  }, [config, show]);

  // Import settings
  const importSettings = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target?.result as string);
          saveConfig({ ...DEFAULT_CONFIG, ...imported });
          show("Settings imported successfully", "success");
        } catch {
          show("Invalid settings file", "error");
        }
      };
      reader.readAsText(file);
    },
    [saveConfig, show],
  );

  // Sub-tab definitions
  const subTabs: SubTab[] = useMemo(
    () => [
      { id: "general", label: "General", icon: Settings },
      { id: "company", label: "Company Profile", icon: Building },
      { id: "tabs", label: "Tab Manager", icon: LayoutGrid },
      { id: "modules", label: "Module Behavior", icon: Monitor },
      { id: "api", label: "API & Backend", icon: Globe },
      { id: "deployment", label: "Deployment", icon: Cloud },
      { id: "features", label: "Features", icon: ToggleLeft },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "finance", label: "Tax & Finance", icon: Receipt },
      { id: "integrations", label: "Integrations", icon: Plug },
      { id: "automation", label: "Automation", icon: Zap },
      { id: "security", label: "Security", icon: Shield },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "system", label: "System", icon: Server },
    ],
    [],
  );

  // ─── Permission gate ──────────────────────────────────────────────────────
  if (!canManageSettings) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Access Restricted
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Only the station owner or admin can manage settings.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Loading settings…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8" />
            <div>
              <h2 className="text-xl font-bold">General Settings</h2>
              <p className="text-sm text-blue-100">
                Admin control center — manage tabs, features, integrations &
                system config
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full flex items-center gap-1">
              <Cloud size={10} /> Cloud-synced
            </span>
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
              Updated {new Date(config.updatedAt).toLocaleDateString()}
            </span>
            <button
              onClick={exportSettings}
              className="text-xs px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg flex items-center gap-1 transition-colors"
              title="Export settings as JSON"
            >
              <Download size={12} /> Export
            </button>
            <label
              className="text-xs px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              title="Import settings from JSON"
            >
              <Upload size={12} /> Import
              <input
                type="file"
                accept=".json"
                onChange={importSettings}
                className="hidden"
              />
            </label>
            {isOwner && (
              <button
                onClick={resetConfig}
                className="text-xs px-3 py-1.5 bg-red-500/30 hover:bg-red-500/40 rounded-lg flex items-center gap-1 transition-colors"
                title="Reset all settings to defaults"
              >
                <RotateCcw size={12} /> Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={subTabs}
        active={activeSubTab}
        onChange={setActiveSubTab}
      />

      {/* Content */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {activeSubTab === "general" && (
          <GeneralTab
            config={config}
            update={update}
            updateAndSync={updateAndSync}
            prefs={prefs}
            updatePrefs={updatePrefs}
            tabConfigs={state.tabConfigurations}
            show={show}
          />
        )}
        {activeSubTab === "company" && (
          <CompanyProfileTab
            companyData={state.companyData}
            syncCompanyData={syncCompanyData}
            config={config}
            update={update}
            updateAndSync={updateAndSync}
            user={user}
            show={show}
          />
        )}
        {activeSubTab === "tabs" && (
          <TabManagerTab
            tabConfigs={state.tabConfigurations}
            dispatch={dispatch}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            show={show}
            isOwner={isOwner}
          />
        )}
        {activeSubTab === "modules" && (
          <ModuleBehaviorTab
            config={config}
            update={update}
            updatePrefs={updatePrefs}
            prefs={prefs}
            show={show}
            isOwner={isOwner}
          />
        )}
        {activeSubTab === "api" && (
          <ApiBackendTab config={config} update={update} show={show} />
        )}
        {activeSubTab === "deployment" && (
          <DeploymentTab config={config} update={update} show={show} />
        )}
        {activeSubTab === "features" && (
          <FeaturesTab
            featureFlags={featureFlags as unknown as Record<string, boolean>}
            show={show}
          />
        )}
        {activeSubTab === "appearance" && (
          <AppearanceTab
            config={config}
            update={update}
            updatePrefs={updatePrefs}
            show={show}
          />
        )}
        {activeSubTab === "finance" && (
          <FinanceTab
            config={config}
            update={update}
            updateAndSync={updateAndSync}
            prefs={prefs}
            updatePrefs={updatePrefs}
            show={show}
          />
        )}
        {activeSubTab === "integrations" && <IntegrationsTab />}
        {activeSubTab === "automation" && (
          <AutomationTab prefs={prefs} updatePrefs={updatePrefs} show={show} />
        )}
        {activeSubTab === "security" && (
          <SecurityTab
            config={config}
            update={update}
            show={show}
            isOwner={isOwner}
          />
        )}
        {activeSubTab === "notifications" && (
          <NotificationsTab config={config} update={update} />
        )}
        {activeSubTab === "system" && <SystemTab config={config} show={show} />}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium animate-fade-in ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : toast.type === "error"
                ? "bg-red-600 text-white"
                : "bg-blue-600 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : toast.type === "error" ? (
            <AlertCircle size={16} />
          ) : (
            <Info size={16} />
          )}
          {toast.msg}
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="fixed bottom-6 left-6 z-50 px-4 py-2 bg-gray-900 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Syncing…
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: COMPANY PROFILE  (NEW — full owner control over CompanyData)
// ═══════════════════════════════════════════════════════════════════════════
// Edits the authoritative `state.companyData` directly via SET_COMPANY_DATA.
// Every field the owner sets here is read by invoices, receipts, reports, the
// Header "Edit Info" form, and exports — so there is ONE place to tweak every
// company detail. Fields are PRE-FILLED from existing companyData (no double
// entry). No field is locked for the owner.
function CompanyProfileTab({
  companyData,
  syncCompanyData,
  config,
  update,
  updateAndSync,
  user,
  show,
}: {
  companyData: CompanyData;
  syncCompanyData: (patch: Partial<CompanyData>) => void;
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  updateAndSync: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
    companyPatch?: Partial<CompanyData>,
  ) => void;
  user: { id?: string; email?: string } | null;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local working copy mirroring companyData so inputs feel instant.
  const [form, setForm] = useState<CompanyData>(companyData);
  useEffect(() => {
    setForm(companyData);
  }, [companyData]);

  const set = <K extends keyof CompanyData>(key: K, value: CompanyData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Commit a single field to the authoritative companyData (live save).
  const commit = <K extends keyof CompanyData>(
    key: K,
    value: CompanyData[K],
  ) => {
    syncCompanyData({ [key]: value } as Partial<CompanyData>);
  };

  // Commit all fields at once (Save button).
  const saveAll = () => {
    syncCompanyData(form);
    toastSuccess("Company profile saved & synced across devices");
    show("Company profile saved & synced across devices", "success");
  };

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) {
      toastError("Could not upload logo — please re-login and retry");
      return;
    }
    setUploadingLogo(true);
    try {
      const result = await uploadStationLogo(file, user.id);
      set("logo", result.url);
      commit("logo", result.url);
      update("logoUrl", result.url); // mirror into general config
      toastSuccess("Logo uploaded & saved");
    } catch (err: any) {
      toastError(err?.message || "Logo upload failed");
      show("Logo upload failed", "error");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    set("logo", "");
    commit("logo", "");
    update("logoUrl", "");
    show("Logo removed", "info");
  };

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Company Profile
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Full control over every company detail used in invoices, receipts,
            reports &amp; exports. Changes save to the cloud instantly.
          </p>
        </div>
        <button
          onClick={saveAll}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors"
        >
          <Save size={14} /> Save All
        </button>
      </div>

      {/* Logo */}
      <SectionCard title="Company Logo" icon={ImageIcon}>
        <div className="flex items-center gap-4 flex-wrap">
          {form.logo ? (
            <img
              src={form.logo}
              alt="Company logo"
              className="w-24 h-24 rounded-xl object-cover border border-gray-200 dark:border-gray-700"
            />
          ) : (
            <div className="w-24 h-24 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
              <ImageIcon size={28} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={onLogoChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {uploadingLogo ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploadingLogo ? "Uploading…" : "Upload Logo"}
            </button>
            {form.logo && (
              <button
                onClick={removeLogo}
                className="px-3 py-2 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2 transition-colors"
              >
                Remove
              </button>
            )}
            <p className="text-xs text-gray-400">
              Stored in Supabase Storage (cross-device). PNG/JPEG/SVG/WebP.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Business Identity */}
      <SectionCard title="Business Identity" icon={Building}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => {
                set("name", e.target.value);
                updateAndSync("stationName", e.target.value, {
                  name: e.target.value,
                });
              }}
              onBlur={(e) => commit("name", e.target.value)}
              placeholder="Registered company name"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={(e) => commit("email", e.target.value)}
              placeholder="info@company.com"
            />
          </Field>
          <Field label="Phone / Contacts">
            <input
              className={inputClass}
              value={form.contacts}
              onChange={(e) => set("contacts", e.target.value)}
              onBlur={(e) => commit("contacts", e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </Field>
          <Field label="PO Box / Postal Address">
            <input
              className={inputClass}
              value={form.poBox}
              onChange={(e) => set("poBox", e.target.value)}
              onBlur={(e) => commit("poBox", e.target.value)}
              placeholder="P.O. Box 12345"
            />
          </Field>
        </div>
      </SectionCard>

      {/* Address */}
      <SectionCard title="Physical Address" icon={MapPin}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Physical Address">
            <input
              className={inputClass}
              value={form.physicalAddress}
              onChange={(e) => set("physicalAddress", e.target.value)}
              onBlur={(e) => commit("physicalAddress", e.target.value)}
              placeholder="Street address"
            />
          </Field>
          <Field label="Town / City">
            <input
              className={inputClass}
              value={form.town}
              onChange={(e) => set("town", e.target.value)}
              onBlur={(e) => commit("town", e.target.value)}
              placeholder="Nairobi / New York"
            />
          </Field>
          <Field label="County / State / Province">
            <input
              className={inputClass}
              value={form.county}
              onChange={(e) => set("county", e.target.value)}
              onBlur={(e) => commit("county", e.target.value)}
              placeholder="County, State or Province"
            />
          </Field>
          <Field
            label="Country Code"
            hint="ISO 2-letter (US, KE, GB, DE…) — drives tax regime & currency"
          >
            <input
              className={inputClass}
              value={form.country || ""}
              onChange={(e) =>
                set("country", e.target.value.toUpperCase().slice(0, 2))
              }
              onBlur={(e) =>
                commit("country", e.target.value.toUpperCase().slice(0, 2))
              }
              maxLength={2}
              placeholder="US"
            />
          </Field>
        </div>
      </SectionCard>

      {/* Tax & Compliance */}
      <SectionCard title="Tax & Compliance" icon={FileText}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Tax ID / KRA PIN"
            hint="Kenya: KRA PIN (P000000000X). Others: VAT/Tax/EIN number"
          >
            <input
              className={inputClass}
              value={form.kraPin}
              onChange={(e) => set("kraPin", e.target.value)}
              onBlur={(e) => commit("kraPin", e.target.value)}
              placeholder="P051234567X"
            />
          </Field>
          <Field label="VAT Registration No.">
            <input
              className={inputClass}
              value={form.vatRegNo}
              onChange={(e) => set("vatRegNo", e.target.value)}
              onBlur={(e) => commit("vatRegNo", e.target.value)}
              placeholder="VRN"
            />
          </Field>
          <Field
            label="ETR Serial No."
            hint="Kenya eTIMS Electronic Tax Register (optional)"
          >
            <input
              className={inputClass}
              value={form.etrSerialNo}
              onChange={(e) => set("etrSerialNo", e.target.value)}
              onBlur={(e) => commit("etrSerialNo", e.target.value)}
              placeholder="ETR-00000000"
            />
          </Field>
          <Field label="CU Serial No." hint="Control Unit serial (optional)">
            <input
              className={inputClass}
              value={form.cuSerialNo}
              onChange={(e) => set("cuSerialNo", e.target.value)}
              onBlur={(e) => commit("cuSerialNo", e.target.value)}
              placeholder="CU-00000000"
            />
          </Field>
          <Field label="ETR Invoice Prefix">
            <input
              className={inputClass}
              value={form.etrInvoicePrefix}
              onChange={(e) => {
                set("etrInvoicePrefix", e.target.value);
                updateAndSync("invoicePrefix", e.target.value, {
                  etrInvoicePrefix: e.target.value,
                });
              }}
              onBlur={(e) => commit("etrInvoicePrefix", e.target.value)}
              placeholder="INV"
            />
          </Field>
        </div>
      </SectionCard>

      {/* Bank Details */}
      <SectionCard title="Bank Details" icon={CreditCard}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Bank Name">
            <input
              className={inputClass}
              value={form.bankName}
              onChange={(e) => set("bankName", e.target.value)}
              onBlur={(e) => commit("bankName", e.target.value)}
              placeholder="e.g. Equity Bank"
            />
          </Field>
          <Field label="Branch">
            <input
              className={inputClass}
              value={form.branchName}
              onChange={(e) => set("branchName", e.target.value)}
              onBlur={(e) => commit("branchName", e.target.value)}
              placeholder="Branch name"
            />
          </Field>
          <Field label="Account Holder">
            <input
              className={inputClass}
              value={form.accountHolder}
              onChange={(e) => set("accountHolder", e.target.value)}
              onBlur={(e) => commit("accountHolder", e.target.value)}
              placeholder="Account holder name"
            />
          </Field>
          <Field label="Account Number">
            <input
              className={inputClass}
              value={form.accountNumber}
              onChange={(e) => set("accountNumber", e.target.value)}
              onBlur={(e) => commit("accountNumber", e.target.value)}
              placeholder="0000000000"
            />
          </Field>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button
          onClick={saveAll}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors"
        >
          <Save size={14} /> Save All Changes
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: GENERAL
// ═══════════════════════════════════════════════════════════════════════════
function GeneralTab({
  config,
  update,
  updateAndSync,
  prefs,
  updatePrefs,
  tabConfigs,
  show,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  updateAndSync: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
    companyPatch?: Partial<CompanyData>,
  ) => void;
  prefs: UserPreferences;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  tabConfigs: TabConfiguration[];
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const timezones = useMemo(() => {
    try {
      const intlWithSupportedValues = Intl as unknown as {
        supportedValuesOf?: (key: "timeZone") => string[];
      };
      if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
        return intlWithSupportedValues.supportedValuesOf("timeZone");
      }
      throw new Error("supportedValuesOf unavailable");
    } catch {
      return [
        "UTC",
        "Africa/Nairobi",
        "America/New_York",
        "Europe/London",
        "Asia/Dubai",
        "Asia/Kolkata",
      ];
    }
  }, []);

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const toggleDay = (day: string) => {
    const days = config.businessHours.days.includes(day)
      ? config.businessHours.days.filter((d) => d !== day)
      : [...config.businessHours.days, day];
    update("businessHours", { ...config.businessHours, days });
  };

  return (
    <div className="p-5 space-y-6">
      <SectionCard title="Station Information" icon={Info}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Station Name">
            <input
              className={inputClass}
              value={config.stationName}
              onChange={(e) =>
                updateAndSync("stationName", e.target.value, {
                  name: e.target.value,
                })
              }
              placeholder="e.g. Global Energy Station"
            />
          </Field>
          <Field label="Website">
            <input
              className={inputClass}
              value={config.stationWebsite}
              onChange={(e) => update("stationWebsite", e.target.value)}
              placeholder="https://"
            />
          </Field>
          <Field label="Address">
            <input
              className={inputClass}
              value={config.stationAddress}
              onChange={(e) => update("stationAddress", e.target.value)}
              placeholder="Street, City, Country"
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputClass}
              value={config.stationPhone}
              onChange={(e) => update("stationPhone", e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </Field>
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={config.stationEmail}
              onChange={(e) => update("stationEmail", e.target.value)}
              placeholder="contact@station.com"
            />
          </Field>
          <Field label="Timezone" hint="Used for all date/time displays">
            <select
              className={inputClass}
              value={config.timezone}
              onChange={(e) => update("timezone", e.target.value)}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Business Hours" icon={Clock}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Opening Time">
            <input
              type="time"
              className={inputClass}
              value={config.businessHours.open}
              onChange={(e) =>
                update("businessHours", {
                  ...config.businessHours,
                  open: e.target.value,
                })
              }
            />
          </Field>
          <Field label="Closing Time">
            <input
              type="time"
              className={inputClass}
              value={config.businessHours.close}
              onChange={(e) =>
                update("businessHours", {
                  ...config.businessHours,
                  close: e.target.value,
                })
              }
            />
          </Field>
          <Field label="Operating Days">
            <div className="flex flex-wrap gap-2">
              {days.map((day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    config.businessHours.days.includes(day)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Localization" icon={Globe}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Currency"
            hint="3-letter ISO code (USD, KES, EUR, etc.)"
          >
            <input
              className={inputClass}
              value={config.currency}
              onChange={(e) => {
                const code = e.target.value.toUpperCase();
                updateAndSync("currency", code, {
                  companyCurrency: code,
                  currency: getCurrencySymbol(code),
                });
                updatePrefs({
                  currency: code,
                  currencySymbol: getCurrencySymbol(code),
                });
              }}
              maxLength={3}
            />
          </Field>
          <Field label="Date Format">
            <select
              className={inputClass}
              value={prefs.dateFormat}
              onChange={(e) =>
                updatePrefs({
                  dateFormat: e.target.value as UserPreferences["dateFormat"],
                })
              }
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY (International)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
            </select>
          </Field>
          <Field label="Time Format">
            <select
              className={inputClass}
              value={prefs.timeFormat}
              onChange={(e) =>
                updatePrefs({
                  timeFormat: e.target.value as UserPreferences["timeFormat"],
                })
              }
            >
              <option value="24h">24-hour (14:30)</option>
              <option value="12h">12-hour (2:30 PM)</option>
            </select>
          </Field>
          <Field label="Number Format">
            <select
              className={inputClass}
              value={prefs.numberFormat}
              onChange={(e) =>
                updatePrefs({
                  numberFormat: e.target
                    .value as UserPreferences["numberFormat"],
                })
              }
            >
              <option value="1,000.00">1,000.00 (US/UK)</option>
              <option value="1.000,00">1.000,00 (EU)</option>
              <option value="1 000.00">1 000.00 (Space)</option>
            </select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Default Landing Tab" icon={LayoutGrid}>
        {/* Dynamic registry-driven dropdown — every tab registered in
            FuelContext.tabConfigurations (current AND future) appears here
            automatically. Hidden tabs stay selectable (marked) so the
            owner can prepare a landing tab before un-hiding it; if the tab
            is ever removed the app falls back to Dashboard. */}
        <LandingTabOptions tabConfigs={tabConfigs}>
          {(options) => (
            <>
              <Field
                label="Which tab should open when you log in?"
                hint="Lists every tab in the app — new tabs are added automatically when future features ship."
              >
                <select
                  className={inputClass}
                  value={prefs.defaultTab}
                  onChange={(e) => {
                    updatePrefs({ defaultTab: e.target.value });
                    show(
                      "Default tab updated — applies on next login",
                      "success",
                    );
                  }}
                >
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {!t.visible ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  id="remember-last-tab"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={prefs.rememberLastTab ?? false}
                  onChange={(e) => {
                    updatePrefs({ rememberLastTab: e.target.checked });
                    show(
                      e.target.checked
                        ? "Will reopen your last-used tab on login"
                        : "Will use the Default Landing Tab on login",
                      "success",
                    );
                  }}
                />
                <label
                  htmlFor="remember-last-tab"
                  className="text-sm text-gray-700 dark:text-gray-300 leading-snug cursor-pointer select-none"
                >
                  Resume where I left off
                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                    Reopens the last tab you had open instead of the default
                    landing tab above. Syncs across your devices.
                  </span>
                </label>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    // Preview = switch to the RESOLVED landing tab (same
                    // logic the router uses on login) so the owner sees the
                    // real behavior, then auto-return to Settings so they
                    // don't lose their place.
                    const target = resolveLandingTab(prefs, tabConfigs);
                    const label =
                      tabConfigs.find((t) => t.id === target)?.label || target;
                    beginLandingPreview(); // don't clobber the real last-tab
                    switchToTab(target);
                    show(
                      `Preview: opened "${label}" — returning to Settings`,
                      "info",
                    );
                    window.setTimeout(() => switchToTab("settings"), 1800);
                  }}
                  className="px-3 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  Apply &amp; preview now
                </button>
                <ResolvedLandingHint prefs={prefs} tabConfigs={tabConfigs} />
              </div>
            </>
          )}
        </LandingTabOptions>
      </SectionCard>
    </div>
  );
}

// ─── Landing-tab helpers (module scope — General sub-tab above) ───────────
/**
 * Renders the dynamic options for the Default Landing Tab dropdown by
 * deriving them from the live tab registry. Current and future tabs are
 * all recognized automatically because the list is registry-driven (not a
 * hardcoded enum).
 */
function LandingTabOptions({
  tabConfigs,
  children,
}: {
  tabConfigs: TabConfiguration[];
  children: (options: TabConfiguration[]) => React.ReactNode;
}) {
  const options = useMemo(
    () => [...tabConfigs].sort((a, b) => a.order - b.order),
    [tabConfigs],
  );
  return <>{children(options)}</>;
}

/**
 * Live read-out of which tab the app will actually open on next login —
 * reverse-engineers the same resolveLandingTab decision the router makes,
 * so the owner sees fallback/remember-last resolution immediately.
 */
function ResolvedLandingHint({
  prefs,
  tabConfigs,
}: {
  prefs: UserPreferences;
  tabConfigs: TabConfiguration[];
}) {
  const [target, setTarget] = useState<string>(() =>
    resolveLandingTab(prefs, tabConfigs),
  );
  useEffect(() => {
    const recompute = () => setTarget(resolveLandingTab(prefs, tabConfigs));
    recompute();
    // localStorage (last-used tab) can change in another tab/window
    window.addEventListener("storage", recompute);
    window.addEventListener("user-prefs:changed", recompute);
    return () => {
      window.removeEventListener("storage", recompute);
      window.removeEventListener("user-prefs:changed", recompute);
    };
  }, [prefs, tabConfigs]);

  const label = useMemo(
    () =>
      tabConfigs.find((t) => t.id === target)?.label ||
      (target === FALLBACK_TAB ? "Dashboard" : target),
    [tabConfigs, target],
  );
  const isFallback =
    target === FALLBACK_TAB && prefs.defaultTab !== FALLBACK_TAB;
  return (
    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
      Next login opens:{" "}
      <span className="font-semibold text-gray-800 dark:text-gray-200">
        {label}
      </span>
      <span className="text-gray-400 dark:text-gray-500"> ({target})</span>
      {prefs.rememberLastTab ? " — resuming last-used tab" : ""}
      {isFallback ? " (saved tab unavailable → fallback)" : ""}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: TAB MANAGER
// ═══════════════════════════════════════════════════════════════════════════
function TabManagerTab({
  tabConfigs,
  dispatch,
  searchQuery,
  setSearchQuery,
  show,
  isOwner,
}: {
  tabConfigs: TabConfiguration[];
  dispatch: React.Dispatch<any>;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  show: (msg: string, type?: "success" | "error" | "info") => void;
  isOwner: boolean;
}) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim())
      return [...tabConfigs].sort((a, b) => a.order - b.order);
    const q = searchQuery.toLowerCase();
    return tabConfigs
      .filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      )
      .sort((a, b) => a.order - b.order);
  }, [tabConfigs, searchQuery]);

  const toggleVisible = (id: string) => {
    const updated = tabConfigs.map((t) =>
      t.id === id ? { ...t, visible: !t.visible } : t,
    );
    dispatch({ type: "SET_TAB_CONFIGURATIONS", payload: updated });
    show(
      `Tab ${updated.find((t) => t.id === id)?.visible ? "shown" : "hidden"}`,
      "success",
    );
  };

  const moveTab = (id: string, direction: "up" | "down") => {
    const sorted = [...tabConfigs].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    const updated = tabConfigs.map((t) => {
      if (t.id === a.id) return { ...t, order: b.order };
      if (t.id === b.id) return { ...t, order: a.order };
      return t;
    });
    dispatch({ type: "SET_TAB_CONFIGURATIONS", payload: updated });
  };

  const saveLabel = (id: string) => {
    if (!tempLabel.trim()) {
      setEditingLabel(null);
      return;
    }
    const updated = tabConfigs.map((t) =>
      t.id === id ? { ...t, label: tempLabel.trim() } : t,
    );
    dispatch({ type: "SET_TAB_CONFIGURATIONS", payload: updated });
    show("Tab label updated", "success");
    setEditingLabel(null);
  };

  const showAll = () => {
    dispatch({
      type: "SET_TAB_CONFIGURATIONS",
      payload: tabConfigs.map((t) => ({ ...t, visible: true })),
    });
    show("All tabs shown", "success");
  };

  const hideAll = () => {
    if (
      !confirm(
        "Hide ALL tabs except Dashboard? This will make most features invisible.",
      )
    )
      return;
    dispatch({
      type: "SET_TAB_CONFIGURATIONS",
      payload: tabConfigs.map((t) => ({ ...t, visible: t.id === "dashboard" })),
    });
    show("All tabs hidden (except Dashboard)", "info");
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Tab Manager
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Control which tabs are visible, their order, and custom labels.
            Changes apply instantly across all devices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={showAll}
            className="text-xs px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
          >
            <Eye size={12} className="inline mr-1" /> Show All
          </button>
          {isOwner && (
            <button
              onClick={hideAll}
              className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <EyeOff size={12} className="inline mr-1" /> Hide All
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          className={`${inputClass} pl-10`}
          placeholder="Search tabs by name or description…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        {filtered.map((tab) => {
          const sorted = [...tabConfigs].sort((a, b) => a.order - b.order);
          const isFirst = sorted[0]?.id === tab.id;
          const isLast = sorted[sorted.length - 1]?.id === tab.id;
          return (
            <div
              key={tab.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                tab.visible
                  ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50"
                  : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/20 opacity-60"
              }`}
            >
              <GripVertical
                size={16}
                className="text-gray-300 dark:text-gray-600 flex-shrink-0"
              />
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveTab(tab.id, "up")}
                  disabled={isFirst}
                  className="text-gray-400 hover:text-blue-500 disabled:opacity-30"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => moveTab(tab.id, "down")}
                  disabled={isLast}
                  className="text-gray-400 hover:text-blue-500 disabled:opacity-30"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                {editingLabel === tab.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className="px-2 py-1 text-sm border border-blue-500 rounded text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800"
                      value={tempLabel}
                      onChange={(e) => setTempLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveLabel(tab.id);
                        if (e.key === "Escape") setEditingLabel(null);
                      }}
                      onBlur={() => saveLabel(tab.id)}
                    />
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      {tab.label}
                      {tab.label !== tab.originalLabel && (
                        <span className="text-xs text-gray-400 line-through">
                          {tab.originalLabel}
                        </span>
                      )}
                      {isOwner && (
                        <button
                          onClick={() => {
                            setEditingLabel(tab.id);
                            setTempLabel(tab.label);
                          }}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {tab.description}
                    </p>
                  </div>
                )}
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">
                #{tab.order}
              </span>
              <button
                onClick={() => toggleVisible(tab.id)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors flex-shrink-0 ${
                  tab.visible
                    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-500"
                }`}
              >
                {tab.visible ? "Visible" : "Hidden"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: FEATURES (Feature Flags)
// ═══════════════════════════════════════════════════════════════════════════
function FeaturesTab({
  featureFlags,
  show,
}: {
  featureFlags: Record<string, boolean>;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const flagCategories = useMemo(
    () => [
      {
        title: "Core Modules",
        icon: LayoutGrid,
        flags: [
          {
            key: "pos",
            label: "Point of Sale",
            desc: "Quick sales + receipt printing",
          },
          {
            key: "inventory",
            label: "Stock Management",
            desc: "Products, stock adjustments, transfers",
          },
          {
            key: "sales",
            label: "Sales Tracking",
            desc: "Pump readings & daily operations",
          },
          {
            key: "analytics",
            label: "Analytics",
            desc: "Predictions, trends & BI",
          },
          {
            key: "payroll",
            label: "Payroll System",
            desc: "Employee payments",
          },
          {
            key: "expenses",
            label: "Expense Tracker",
            desc: "Operational expenses",
          },
          {
            key: "customers",
            label: "Customer Loyalty",
            desc: "Rewards program",
          },
          {
            key: "suppliers",
            label: "Supplier Management",
            desc: "Suppliers & purchase orders",
          },
          {
            key: "documents",
            label: "Document Center",
            desc: "Smart document management",
          },
        ],
      },
      {
        title: "Payment Methods",
        icon: DollarSign,
        flags: [
          {
            key: "mpesa",
            label: "M-PESA Analyzer",
            desc: "Mobile money transaction analysis",
          },
          {
            key: "creditCards",
            label: "Credit Cards",
            desc: "Card payment processing",
          },
          { key: "cash", label: "Cash", desc: "Cash payment tracking" },
          {
            key: "bankTransfer",
            label: "Bank Transfer",
            desc: "Bank transfer records",
          },
          {
            key: "mobileMoney",
            label: "Mobile Money",
            desc: "Generic mobile money support",
          },
        ],
      },
      {
        title: "Regional & Compliance",
        icon: Globe,
        flags: [
          {
            key: "kraIntegration",
            label: "KRA Integration",
            desc: "Kenya Revenue Authority eTIMS",
          },
          {
            key: "etims",
            label: "eTIMS",
            desc: "Electronic Tax Invoice Management",
          },
          {
            key: "efd",
            label: "EFD",
            desc: "Electronic Fiscal Device (Tanzania)",
          },
          { key: "etr", label: "ETR", desc: "Electronic Tax Register" },
          {
            key: "vatReporting",
            label: "VAT Reporting",
            desc: "VAT compliance reports",
          },
          {
            key: "compliance",
            label: "Compliance Tab",
            desc: "Country-specific regulations",
          },
        ],
      },
      {
        title: "Advanced Features",
        icon: Zap,
        flags: [
          {
            key: "ai",
            label: "AI Assistant",
            desc: "Gemini-powered AI chatbot",
          },
          {
            key: "cloudSync",
            label: "Cloud Sync",
            desc: "Cross-device data synchronization",
          },
          {
            key: "webhooks",
            label: "Webhooks",
            desc: "Outbound event notifications",
          },
          {
            key: "integrations",
            label: "Integration Hub",
            desc: "Third-party service connectors",
          },
          {
            key: "audit",
            label: "Audit Trail",
            desc: "Complete activity logging",
          },
          {
            key: "loyalty",
            label: "Loyalty Program",
            desc: "Points & rewards",
          },
          {
            key: "priceboard",
            label: "Price Board",
            desc: "Fuel price display board",
          },
          {
            key: "fueltypes",
            label: "Fuel Type Manager",
            desc: "Fuel products & pump settings",
          },
          {
            key: "maintenance",
            label: "Maintenance Tracker",
            desc: "Equipment servicing schedules",
          },
          {
            key: "quality",
            label: "Fuel Quality Testing",
            desc: "Quality test records",
          },
        ],
      },
      {
        title: "Communication",
        icon: Bell,
        flags: [
          { key: "whatsapp", label: "WhatsApp", desc: "WhatsApp integration" },
          { key: "email", label: "Email", desc: "Email notifications" },
          { key: "sms", label: "SMS", desc: "SMS gateway" },
        ],
      },
      {
        title: "Company-Level",
        icon: Server,
        flags: [
          {
            key: "founderAccess",
            label: "Founder Access",
            desc: "Global admin console",
          },
          {
            key: "combinedView",
            label: "Combined View",
            desc: "Multi-station overview",
          },
        ],
      },
    ],
    [],
  );

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Feature Flags
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Enable or disable features across the entire station. Feature flags
          are resolved based on your country and company settings.
        </p>
        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-start gap-2">
          <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Feature flags are currently resolved automatically based on your
            station's country and plan. To customize them, configure your
            company settings in the Founder Access console.
          </p>
        </div>
      </div>

      {flagCategories.map((cat) => {
        const Icon = cat.icon;
        return (
          <SectionCard key={cat.title} title={cat.title} icon={Icon}>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {cat.flags.map((flag) => (
                <Toggle
                  key={flag.key}
                  checked={!!featureFlags[flag.key]}
                  onChange={() =>
                    show(
                      `Feature "${flag.label}" is ${featureFlags[flag.key] ? "enabled" : "disabled"} (managed by company settings)`,
                      "info",
                    )
                  }
                  label={flag.label}
                  description={flag.desc}
                  disabled
                />
              ))}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: APPEARANCE
// ═══════════════════════════════════════════════════════════════════════════
function AppearanceTab({
  config,
  update,
  updatePrefs,
  show,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const accentColors = [
    { name: "Blue", value: "#3b82f6" },
    { name: "Indigo", value: "#6366f1" },
    { name: "Purple", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
  ];

  return (
    <div className="p-5 space-y-6">
      <SectionCard title="Theme" icon={Palette}>
        <div className="grid grid-cols-3 gap-3">
          {(["dark", "light", "system"] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => {
                update("theme", theme);
                updatePrefs({ theme: theme === "system" ? "dark" : theme });
                show(`Theme set to ${theme}`, "success");
              }}
              className={`p-4 rounded-lg border-2 text-center transition-all ${
                config.theme === theme
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
              }`}
            >
              <div
                className={`w-full h-16 rounded mb-2 ${
                  theme === "dark"
                    ? "bg-gray-900"
                    : theme === "light"
                      ? "bg-white border border-gray-200"
                      : "bg-gradient-to-r from-gray-900 to-white"
                }`}
              />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                {theme}
              </p>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Accent Color" icon={Palette}>
        <div className="flex flex-wrap gap-3">
          {accentColors.map((color) => (
            <button
              key={color.value}
              onClick={() => {
                update("accentColor", color.value);
                show(`Accent color: ${color.name}`, "success");
              }}
              className={`w-12 h-12 rounded-full border-4 transition-all ${
                config.accentColor === color.value
                  ? "border-gray-900 dark:border-white scale-110"
                  : "border-transparent"
              }`}
              style={{ backgroundColor: color.value }}
              title={color.name}
            />
          ))}
          <label className="w-12 h-12 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors">
            <input
              type="color"
              value={config.accentColor}
              onChange={(e) => update("accentColor", e.target.value)}
              className="hidden"
            />
            <Palette size={16} className="text-gray-400" />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Layout" icon={LayoutGrid}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.compactMode}
            onChange={(v) => {
              update("compactMode", v);
              updatePrefs({ compactMode: v });
            }}
            label="Compact Mode"
            description="Reduce padding & spacing for more content per screen"
          />
          <Toggle
            checked={config.sidebarCollapsed}
            onChange={(v) => update("sidebarCollapsed", v)}
            label="Collapse Sidebar by Default"
            description="Start with the navigation sidebar collapsed"
          />
        </div>
      </SectionCard>

      <SectionCard title="Logo" icon={Tag}>
        <div className="space-y-3">
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt="Station logo"
              className="max-h-24 rounded-lg border border-gray-200 dark:border-gray-700"
            />
          )}
          <Field
            label="Logo URL"
            hint="Paste a public image URL. The logo appears on receipts, invoices & reports."
          >
            <input
              className={inputClass}
              value={config.logoUrl}
              onChange={(e) => update("logoUrl", e.target.value)}
              placeholder="https://… or upload via Edit Info"
            />
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: TAX & FINANCE
// ═══════════════════════════════════════════════════════════════════════════
function FinanceTab({
  config,
  update,
  updateAndSync,
  prefs,
  updatePrefs,
  show,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  updateAndSync: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
    companyPatch?: Partial<CompanyData>,
  ) => void;
  prefs: UserPreferences;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  return (
    <div className="p-5 space-y-6">
      <SectionCard title="Tax Configuration" icon={Receipt}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.taxEnabled}
            onChange={(v) => update("taxEnabled", v)}
            label="Enable Tax"
            description="Apply tax to sales, invoices & receipts"
          />
          <Toggle
            checked={config.taxIncludedInPrice}
            onChange={(v) => update("taxIncludedInPrice", v)}
            label="Tax Included in Price"
            description="Prices already include tax (don't add on top)"
          />
        </div>
        {config.taxEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="Tax Rate (%)" hint="0 = use country default">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className={inputClass}
                value={config.taxRate}
                onChange={(e) => {
                  const rate = parseFloat(e.target.value) || 0;
                  update("taxRate", rate);
                  updatePrefs({ vatRate: rate });
                }}
              />
            </Field>
            <Field label="Tax Label" hint="VAT, GST, Sales Tax, IVA, etc.">
              <input
                className={inputClass}
                value={config.taxLabel}
                onChange={(e) => {
                  update("taxLabel", e.target.value);
                  updatePrefs({ vatLabel: e.target.value });
                }}
                placeholder="VAT"
              />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Currency" icon={DollarSign}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Currency Code">
            <input
              className={inputClass}
              value={config.currency}
              onChange={(e) => {
                const code = e.target.value.toUpperCase();
                updateAndSync("currency", code, {
                  companyCurrency: code,
                  currency: getCurrencySymbol(code),
                });
                updatePrefs({
                  currency: code,
                  currencySymbol: getCurrencySymbol(code),
                });
              }}
              maxLength={3}
            />
          </Field>
          <Field label="Symbol Position">
            <select
              className={inputClass}
              value={config.currencyPosition}
              onChange={(e) => {
                update(
                  "currencyPosition",
                  e.target.value as "before" | "after",
                );
                updatePrefs({
                  currencyPosition: e.target.value as "before" | "after",
                });
              }}
            >
              <option value="before">$ 1,000 (before)</option>
              <option value="after">1,000 $ (after)</option>
            </select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Invoice & Receipt Settings" icon={Receipt}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Invoice Prefix">
            <input
              className={inputClass}
              value={config.invoicePrefix}
              onChange={(e) => {
                update("invoicePrefix", e.target.value);
                updatePrefs({ invoicePrefix: e.target.value });
              }}
              placeholder="INV"
            />
          </Field>
          <Field label="Next Invoice Number">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={config.invoiceNextNumber}
              onChange={(e) => {
                update("invoiceNextNumber", parseInt(e.target.value) || 1);
                updatePrefs({
                  invoiceNextNumber: parseInt(e.target.value) || 1,
                });
              }}
            />
          </Field>
          <Field label="Receipt Header">
            <input
              className={inputClass}
              value={config.receiptHeader}
              onChange={(e) => update("receiptHeader", e.target.value)}
            />
          </Field>
          <Field label="Receipt Footer">
            <input
              className={inputClass}
              value={config.receiptFooter}
              onChange={(e) => {
                update("receiptFooter", e.target.value);
                updatePrefs({ receiptFooter: e.target.value });
              }}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Payment Methods" icon={DollarSign}>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Default payment methods available at the Point of Sale.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            "cash",
            "card",
            "bank_transfer",
            "mobile_money",
            "mpesa",
            "credit",
          ].map((method) => {
            const active = prefs.defaultPaymentMethods.includes(method);
            return (
              <button
                key={method}
                onClick={() => {
                  const methods = active
                    ? prefs.defaultPaymentMethods.filter((m) => m !== method)
                    : [...prefs.defaultPaymentMethods, method];
                  updatePrefs({ defaultPaymentMethods: methods });
                  show(
                    `Payment method ${active ? "removed" : "added"}: ${method}`,
                    "success",
                  );
                }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium capitalize transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {method.replace("_", " ")}
              </button>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════
function IntegrationsTab() {
  const integrations = useMemo(
    () => [
      {
        name: "M-PESA Daraja",
        desc: "Safaricom M-PESA STK Push & C2B payments",
        docs: "https://developer.safaricom.co.ke/APIs/",
        tab: "integration",
        status: "Configure in Integration Hub → Payment Setup",
      },
      {
        name: "Kopo Kopo",
        desc: "Kopo Kopo Till Number integration",
        docs: "https://kopokopo.co.ke/developers",
        tab: "integration",
        status: "Configure in Integration Hub → Payment Setup",
      },
      {
        name: "KRA eTIMS",
        desc: "Kenya Revenue Authority electronic Tax Invoice Management",
        docs: "https://www.kra.go.ke/en/information/e-tims",
        tab: "integration",
        status: "Kenya-only — auto-enabled with KRA PIN",
      },
      {
        name: "Supabase (Backend)",
        desc: "Cloud database, auth, real-time sync & storage",
        docs: "https://supabase.com/docs",
        tab: "data",
        status: "Connected (active)",
        connected: true,
      },
      {
        name: "Cloudflare Pages",
        desc: "Static site hosting & edge CDN",
        docs: "https://developers.cloudflare.com/pages/",
        tab: "",
        status: "Deployed",
        connected: true,
      },
      {
        name: "Vercel",
        desc: "Serverless functions & preview deployments",
        docs: "https://vercel.com/docs",
        tab: "",
        status: "Connected",
        connected: true,
      },
      {
        name: "Global Live Feed",
        desc: "Live TV/Radio channels (News tab)",
        docs: "",
        tab: "news",
        status: "Connected via /api/live-channels proxy",
        connected: true,
      },
      {
        name: "Google Identity Services",
        desc: "Sign in with Google OAuth",
        docs: "https://developers.google.com/identity/gsi/web/guides/overview",
        tab: "",
        status: "Enabled",
        connected: true,
      },
      {
        name: "Nominatim Geocoding",
        desc: "OpenStreetMap reverse geocoding for fuel prices",
        docs: "https://nominatim.org/release-docs/latest/api/Overview/",
        tab: "price-finder",
        status: "Connected",
        connected: true,
      },
      {
        name: "PostGIS Fuel Prices",
        desc: "Spatial fuel price cache & nearest-town lookup",
        docs: "https://postgis.net/documentation/",
        tab: "price-finder",
        status: "Connected (Supabase)",
        connected: true,
      },
    ],
    [],
  );

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Integrations
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          All third-party integrations connected to your station. Click an
          integration to view its documentation or configure it.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integrations.map((int) => (
          <div
            key={int.name}
            className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${int.connected ? "bg-green-100 dark:bg-green-900/30" : "bg-gray-100 dark:bg-gray-700"}`}
                >
                  {int.connected ? (
                    <CheckCircle2
                      size={16}
                      className="text-green-600 dark:text-green-400"
                    />
                  ) : (
                    <Plug size={16} className="text-gray-400" />
                  )}
                </div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {int.name}
                </h4>
              </div>
              {int.docs && (
                <a
                  href={int.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-blue-500"
                  title="View documentation"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {int.desc}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {int.status}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: AUTOMATION
// ═══════════════════════════════════════════════════════════════════════════
function AutomationTab({
  prefs,
  updatePrefs,
  show,
}: {
  prefs: UserPreferences;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const automation = prefs.automation;
  const setAuto = (
    key: keyof UserPreferences["automation"],
    value: boolean,
  ) => {
    updatePrefs({ automation: { ...automation, [key]: value } });
    show(
      `Automation ${value ? "enabled" : "disabled"}: ${key.replace(/([A-Z])/g, " $1").trim()}`,
      "success",
    );
  };

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Automation Engine
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The site's brain — automated actions that run without manual
          intervention. Changes sync across all devices.
        </p>
      </div>

      <SectionCard title="Stock Automation" icon={Zap}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={automation.autoReorderEnabled}
            onChange={(v) => setAuto("autoReorderEnabled", v)}
            label="Auto-Reorder"
            description="Automatically create purchase orders when stock drops below reorder level"
          />
          <Toggle
            checked={automation.autoRecordStockOnProductEdit}
            onChange={(v) => setAuto("autoRecordStockOnProductEdit", v)}
            label="Auto-Record Stock Changes"
            description="Log an inventory transaction whenever a product's stock is edited"
          />
        </div>
      </SectionCard>

      <SectionCard title="Dashboard & Sync" icon={RefreshCw}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={automation.autoRefreshDashboard}
            onChange={(v) => setAuto("autoRefreshDashboard", v)}
            label="Auto-Refresh Dashboard"
            description="Dashboard KPIs update automatically when new sales/transactions occur"
          />
          <Toggle
            checked={automation.autoSyncPricesAcrossTabs}
            onChange={(v) => setAuto("autoSyncPricesAcrossTabs", v)}
            label="Sync Prices Across Tabs"
            description="Fuel price changes propagate to Dashboard, POS, Invoice, Reports instantly"
          />
          <Toggle
            checked={automation.autoLogShiftTotals}
            onChange={(v) => setAuto("autoLogShiftTotals", v)}
            label="Auto-Log Shift Totals"
            description="Record shift totals automatically when a shift is closed"
          />
        </div>
      </SectionCard>

      <SectionCard title="Documentation" icon={ExternalLink}>
        <div className="space-y-2">
          <a
            href="https://supabase.com/docs/guides/realtime"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300">
              Supabase Realtime — how cross-device sync works
            </span>
            <ExternalLink size={14} className="text-gray-400" />
          </a>
          <a
            href="https://postgis.net/documentation/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300">
              PostGIS — spatial fuel price cache
            </span>
            <ExternalLink size={14} className="text-gray-400" />
          </a>
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: SECURITY
// ═══════════════════════════════════════════════════════════════════════════
function SecurityTab({
  config,
  update,
  show,
  isOwner,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  show: (msg: string, type?: "success" | "error" | "info") => void;
  isOwner: boolean;
}) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Security
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Authentication, session, and access control settings for your station.
        </p>
      </div>

      <SectionCard title="Authentication" icon={Shield}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.requireTwoFactor}
            onChange={(v) => {
              update("requireTwoFactor", v);
              show(
                v
                  ? "2FA requirement enabled for all team members"
                  : "2FA requirement disabled",
                "success",
              );
            }}
            label="Require Two-Factor Authentication (2FA)"
            description="All team members must enable 2FA before accessing the station"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field
            label="Session Timeout (minutes)"
            hint="Auto-logout after inactivity (0 = never)"
          >
            <input
              type="number"
              min="0"
              max="1440"
              className={inputClass}
              value={config.sessionTimeoutMinutes}
              onChange={(e) =>
                update("sessionTimeoutMinutes", parseInt(e.target.value) || 0)
              }
            />
          </Field>
          <Field label="Max Login Attempts" hint="Before account lockout">
            <input
              type="number"
              min="3"
              max="20"
              className={inputClass}
              value={config.maxLoginAttempts}
              onChange={(e) =>
                update("maxLoginAttempts", parseInt(e.target.value) || 5)
              }
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Access Control" icon={KeyRound}>
        <Field
          label="IP Whitelist"
          hint="Comma-separated list of allowed IP addresses (empty = allow all)"
        >
          <input
            className={inputClass}
            value={config.ipWhitelist}
            onChange={(e) => update("ipWhitelist", e.target.value)}
            placeholder="e.g. 192.168.1.0/24, 10.0.0.5"
          />
        </Field>
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-start gap-2">
          <AlertCircle
            size={16}
            className="text-amber-500 flex-shrink-0 mt-0.5"
          />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Access codes &amp; team member permissions are managed in the Team
            Manager tab. Role-based access control (Owner &gt; Manager &gt;
            Staff &gt; Auditor) is configured there.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Audit & Compliance" icon={Activity}>
        <Field
          label="Audit Log Retention (days)"
          hint="How long to keep activity logs"
        >
          <input
            type="number"
            min="30"
            max="3650"
            className={inputClass}
            value={config.auditLogRetentionDays}
            onChange={(e) =>
              update("auditLogRetentionDays", parseInt(e.target.value) || 90)
            }
          />
        </Field>
      </SectionCard>

      <SectionCard title="Security Documentation" icon={ExternalLink}>
        <div className="space-y-2">
          <a
            href="https://supabase.com/docs/guides/auth"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300">
              Supabase Auth — authentication documentation
            </span>
            <ExternalLink size={14} className="text-gray-400" />
          </a>
          <a
            href="https://supabase.com/docs/guides/database/postgres/row-level-security"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300">
              Row-Level Security — how data isolation works
            </span>
            <ExternalLink size={14} className="text-gray-400" />
          </a>
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
function NotificationsTab({
  config,
  update,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
}) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Notifications
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure how and when you receive alerts about station activity.
        </p>
      </div>

      <SectionCard title="Delivery Channels" icon={Bell}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.emailNotifications}
            onChange={(v) => update("emailNotifications", v)}
            label="Email Notifications"
            description="Receive alerts via email"
          />
          <Toggle
            checked={config.smsNotifications}
            onChange={(v) => update("smsNotifications", v)}
            label="SMS Notifications"
            description="Receive alerts via SMS (requires SMS gateway in Integration Hub)"
          />
          <Toggle
            checked={config.pushNotifications}
            onChange={(v) => update("pushNotifications", v)}
            label="Push Notifications"
            description="Browser push notifications"
          />
        </div>
      </SectionCard>

      <SectionCard title="Alert Types" icon={AlertCircle}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.lowStockAlerts}
            onChange={(v) => update("lowStockAlerts", v)}
            label="Low Stock Alerts"
            description="Notify when a product drops below its reorder level"
          />
          <Toggle
            checked={config.creditAlerts}
            onChange={(v) => update("creditAlerts", v)}
            label="Credit Account Alerts"
            description="Notify when a credit account is overdue or near its limit"
          />
          <Toggle
            checked={config.shiftReminders}
            onChange={(v) => update("shiftReminders", v)}
            label="Shift Reminders"
            description="Remind staff about upcoming shift changes"
          />
          <Toggle
            checked={config.dailySummaryEmail}
            onChange={(v) => update("dailySummaryEmail", v)}
            label="Daily Summary Email"
            description="Receive a daily summary of sales, expenses & stock changes"
          />
        </div>
      </SectionCard>

      <SectionCard title="Notification Documentation" icon={ExternalLink}>
        <a
          href="https://supabase.com/docs/guides/realtime"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
        >
          <span className="text-gray-700 dark:text-gray-300">
            Supabase Realtime — how instant notifications work
          </span>
          <ExternalLink size={14} className="text-gray-400" />
        </a>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
function SystemTab({
  config,
  show,
}: {
  config: GeneralSettingsConfig;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [healthStatus, setHealthStatus] = useState<
    Record<string, "ok" | "error" | "checking">
  >({
    supabase: "checking",
    cloudflare: "checking",
    vercel: "checking",
    realtime: "checking",
  });

  const runHealthCheck = useCallback(async () => {
    setHealthStatus({
      supabase: "checking",
      cloudflare: "checking",
      vercel: "checking",
      realtime: "checking",
    });
    try {
      // Check Supabase
      const sbRes = await fetch(
        "https://ojsscjwatikixlpshmub.supabase.co/rest/v1/",
        { method: "HEAD" },
      );
      setHealthStatus((s) => ({ ...s, supabase: sbRes.ok ? "ok" : "error" }));
    } catch {
      setHealthStatus((s) => ({ ...s, supabase: "error" }));
    }
    try {
      // Check Cloudflare
      const cfRes = await fetch("https://fuel-app-mobile.pages.dev/", {
        method: "HEAD",
      });
      setHealthStatus((s) => ({ ...s, cloudflare: cfRes.ok ? "ok" : "error" }));
    } catch {
      setHealthStatus((s) => ({ ...s, cloudflare: "error" }));
    }
    try {
      // Check Vercel
      const vRes = await fetch("https://fuel-app-mobile.vercel.app/", {
        method: "HEAD",
      });
      setHealthStatus((s) => ({ ...s, vercel: vRes.ok ? "ok" : "error" }));
    } catch {
      setHealthStatus((s) => ({ ...s, vercel: "error" }));
    }
    setHealthStatus((s) => ({
      ...s,
      realtime: config.enableRealtime ? "ok" : "error",
    }));
    show("Health check complete", "success");
  }, [config.enableRealtime, show]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const systemInfo = useMemo(
    () => [
      { label: "App Version", value: "FuelPro v3.0 (2026)", icon: Info },
      {
        label: "Backend",
        value: "Supabase (ojsscjwatikixlpshmub)",
        icon: Database,
      },
      {
        label: "Frontend Hosting",
        value: "Cloudflare Pages + Vercel",
        icon: Cloud,
      },
      {
        label: "Realtime",
        value: config.enableRealtime
          ? "Enabled (Supabase Realtime)"
          : "Disabled",
        icon: Activity,
      },
      {
        label: "Compression",
        value: config.enableCompression ? "Enabled (gzip level 9)" : "Disabled",
        icon: Database,
      },
      {
        label: "Low-Bandwidth Mode",
        value: config.lowBandwidthMode ? "ON (Realtime paused)" : "OFF",
        icon: Zap,
      },
      {
        label: "Auto-Backup",
        value: config.autoBackup
          ? `${config.backupFrequency} (to cloud)`
          : "Disabled",
        icon: Save,
      },
      {
        label: "Data Retention",
        value: `${config.dataRetentionDays} days`,
        icon: Clock,
      },
      {
        label: "Last Updated",
        value: new Date(config.updatedAt).toLocaleString(),
        icon: Clock,
      },
    ],
    [config],
  );

  const docLinks = useMemo(
    () => [
      {
        title: "FuelPro Documentation",
        url: "https://fuel-app-mobile.pages.dev/",
        desc: "Main app documentation",
      },
      {
        title: "Supabase Docs",
        url: "https://supabase.com/docs",
        desc: "Backend database, auth & realtime",
      },
      {
        title: "Cloudflare Pages Docs",
        url: "https://developers.cloudflare.com/pages/",
        desc: "Frontend hosting",
      },
      {
        title: "Vercel Docs",
        url: "https://vercel.com/docs",
        desc: "Serverless functions",
      },
      {
        title: "React Documentation",
        url: "https://react.dev/",
        desc: "Frontend framework",
      },
      {
        title: "Vite Documentation",
        url: "https://vitejs.dev/guide/",
        desc: "Build tool",
      },
      {
        title: "Tailwind CSS",
        url: "https://tailwindcss.com/docs",
        desc: "Styling framework",
      },
      {
        title: "hls.js",
        url: "https://github.com/video-dev/hls.js/",
        desc: "Live TV video player",
      },
      {
        title: "Supabase Realtime",
        url: "https://supabase.com/docs/guides/realtime",
        desc: "Cross-device sync",
      },
      {
        title: "PostGIS",
        url: "https://postgis.net/documentation/",
        desc: "Spatial fuel price cache",
      },
    ],
    [],
  );

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          System
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          System information, health status, backup configuration &
          documentation.
        </p>
      </div>

      <SectionCard title="System Information" icon={Server}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {systemInfo.map((info) => {
            const Icon = info.icon;
            return (
              <div
                key={info.label}
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50"
              >
                <Icon size={16} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {info.label}
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {info.value}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Health Check" icon={Activity}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Live connectivity status of all services
          </p>
          <button
            onClick={runHealthCheck}
            className="text-xs px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-1"
          >
            <RefreshCw size={12} /> Recheck
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(healthStatus).map(([service, status]) => (
            <div
              key={service}
              className={`p-3 rounded-lg border text-center ${
                status === "ok"
                  ? "border-green-300 bg-green-50 dark:bg-green-900/20"
                  : status === "error"
                    ? "border-red-300 bg-red-50 dark:bg-red-900/20"
                    : "border-gray-200 bg-gray-50 dark:bg-gray-800"
              }`}
            >
              <div className="flex items-center justify-center mb-1">
                {status === "ok" ? (
                  <CheckCircle2
                    size={20}
                    className="text-green-600 dark:text-green-400"
                  />
                ) : status === "error" ? (
                  <AlertCircle
                    size={20}
                    className="text-red-600 dark:text-red-400"
                  />
                ) : (
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              <p className="text-xs font-medium capitalize text-gray-900 dark:text-gray-100">
                {service}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {status === "ok"
                  ? "Connected"
                  : status === "error"
                    ? "Offline"
                    : "Checking…"}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Backup & Data" icon={Database}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.autoBackup}
            onChange={(v) => updateAutoBackup(v)}
            label="Automatic Cloud Backup"
            description="Periodically back up all station data to the cloud"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <Field label="Backup Frequency">
            <select
              className={inputClass}
              value={config.backupFrequency}
              onChange={(e) =>
                updateAutoBackupFreq(
                  e.target.value as "daily" | "weekly" | "monthly",
                )
              }
              disabled={!config.autoBackup}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Data Retention (days)">
            <input
              type="number"
              min="30"
              max="3650"
              className={inputClass}
              value={config.dataRetentionDays}
              onChange={(e) =>
                updateDataRetention(parseInt(e.target.value) || 365)
              }
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Performance" icon={Zap}>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          <Toggle
            checked={config.enableRealtime}
            onChange={(v) => {
              updateEnableRealtime(v);
              cloudStorageService.setRealtimeEnabled(v);
            }}
            label="Real-time Sync"
            description="Instant cross-device updates via Supabase Realtime (uses more bandwidth)"
          />
          <Toggle
            checked={config.enableCompression}
            onChange={(v) => updateEnableCompression(v)}
            label="Data Compression"
            description="Compress cloud data with gzip (reduces storage & egress)"
          />
          <Toggle
            checked={config.lowBandwidthMode}
            onChange={(v) => {
              updateLowBandwidth(v);
              cloudStorageService.setRealtimeEnabled(!v);
            }}
            label="Low-Bandwidth Mode"
            description="Pause real-time sync to save data (use manual refresh)"
          />
        </div>
      </SectionCard>

      <SectionCard title="Documentation & Resources" icon={ExternalLink}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {docLinks.map((doc) => (
            <a
              key={doc.title}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm group"
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {doc.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {doc.desc}
                </p>
              </div>
              <ExternalLink
                size={14}
                className="text-gray-400 group-hover:text-blue-500"
              />
            </a>
          ))}
        </div>
      </SectionCard>
    </div>
  );

  function updateAutoBackup(v: boolean) {
    // Inline update to avoid prop drilling
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        autoBackup: v,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Auto-backup ${v ? "enabled" : "disabled"}`, "success");
  }
  function updateAutoBackupFreq(freq: "daily" | "weekly" | "monthly") {
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        backupFrequency: freq,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Backup frequency: ${freq}`, "success");
  }
  function updateDataRetention(days: number) {
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        dataRetentionDays: days,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Data retention: ${days} days`, "success");
  }
  function updateEnableRealtime(v: boolean) {
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        enableRealtime: v,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Real-time sync ${v ? "enabled" : "disabled"}`, "success");
  }
  function updateEnableCompression(v: boolean) {
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        enableCompression: v,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Compression ${v ? "enabled" : "disabled"}`, "success");
  }
  function updateLowBandwidth(v: boolean) {
    cloudStorageService
      .set(SETTINGS_KEY, {
        ...config,
        lowBandwidthMode: v,
        enableRealtime: !v,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
    show(`Low-bandwidth mode ${v ? "ON" : "OFF"}`, "success");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REUSABLE SECTION CARD
// ═══════════════════════════════════════════════════════════════════════════
function SectionCard({
  title,

  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <Icon size={16} className="text-blue-500 flex-shrink-0" />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h4>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: MODULE BEHAVIOR — per-tab functional tunables (admin/owner)
// ═══════════════════════════════════════════════════════════════════════════
function ModuleBehaviorTab({
  config,
  update,
  prefs,
  updatePrefs,
  show,
  isOwner,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  prefs: UserPreferences;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  show: (msg: string, type?: "success" | "error" | "info") => void;
  isOwner: boolean;
}) {
  const setAuto = (key: string, value: boolean, label: string) => {
    updatePrefs({
      automation: { ...prefs.automation, [key]: value },
    });
    show(`${label}: ${value ? "enabled" : "disabled"}`, "success");
  };

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Module Behavior
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Per-tab functional controls. Changes sync across all devices
          instantly.
        </p>
      </div>

      <SectionCard title="Point of Sale" icon={DollarSign}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.autoApplyLoyaltyDiscounts ?? false}
            onChange={(v) =>
              setAuto("autoApplyLoyaltyDiscounts", v, "Loyalty discounts")
            }
            label="Auto-Apply Loyalty Discounts"
            description="Automatically apply loyalty points as a discount at checkout"
          />
          <Toggle
            checked={prefs.automation?.autoOpenCashDrawer ?? false}
            onChange={(v) =>
              setAuto("autoOpenCashDrawer", v, "Cash drawer auto-open")
            }
            label="Auto-Open Cash Drawer"
            description="Open the cash drawer on every cash sale (POS hardware)"
          />
          <Toggle
            checked={prefs.automation?.autoPrintReceipt ?? false}
            onChange={(v) =>
              setAuto("autoPrintReceipt", v, "Receipt auto-print")
            }
            label="Auto-Print Receipt"
            description="Print the receipt immediately after every sale completes"
          />
          <Toggle
            checked={prefs.automation?.showShiftReminderOnClose ?? true}
            onChange={(v) =>
              setAuto("showShiftReminderOnClose", v, "Shift close reminder")
            }
            label="Shift Close Reminder"
            description="Prompt the cashier to close the shift at end of day"
          />
        </div>
      </SectionCard>

      <SectionCard title="Sales Tracking" icon={Tag}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.autoCalculateDipDifferences ?? true}
            onChange={(v) =>
              setAuto(
                "autoCalculateDipDifferences",
                v,
                "Dip-difference auto-calc",
              )
            }
            label="Auto-Calculate Dip Differences"
            description="Auto-compute stock variance from tank dip readings"
          />
          <Toggle
            checked={prefs.automation?.autoFlagShortDeliveries ?? true}
            onChange={(v) =>
              setAuto("autoFlagShortDeliveries", v, "Short-delivery flags")
            }
            label="Auto-Flag Short Deliveries"
            description="Flag deliveries with less quantity than invoiced"
          />
        </div>
      </SectionCard>

      <SectionCard title="Invoice & Billing" icon={FileText}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Invoice Prefix">
              <input
                className={inputClass}
                value={config.invoicePrefix}
                onChange={(e) => update("invoicePrefix", e.target.value)}
                disabled={!isOwner}
                placeholder="INV"
              />
            </Field>
            <Field label="Next Invoice Number">
              <input
                type="number"
                className={inputClass}
                value={config.invoiceNextNumber}
                onChange={(e) =>
                  update("invoiceNextNumber", parseInt(e.target.value) || 1)
                }
                disabled={!isOwner}
                min={1}
              />
            </Field>
          </div>
          <Field label="Receipt Header">
            <input
              className={inputClass}
              value={config.receiptHeader}
              onChange={(e) => update("receiptHeader", e.target.value)}
              disabled={!isOwner}
              placeholder="FuelPro Station"
            />
          </Field>
          <Field label="Receipt Footer">
            <input
              className={inputClass}
              value={config.receiptFooter}
              onChange={(e) => update("receiptFooter", e.target.value)}
              disabled={!isOwner}
              placeholder="Thank you for your business!"
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="News & Live TV" icon={Monitor}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.showLiveTVTab ?? true}
            onChange={(v) => setAuto("showLiveTVTab", v, "Live TV tab")}
            label="Live TV Tab"
            description="Show the Live TV sub-tab in the News section"
          />
          <Toggle
            checked={prefs.automation?.showLiveRadioTab ?? true}
            onChange={(v) => setAuto("showLiveRadioTab", v, "Live Radio tab")}
            label="Live Radio Tab"
            description="Show the Live Radio sub-tab in the News section"
          />
          <Toggle
            checked={prefs.automation?.autoPlayLiveStreams ?? true}
            onChange={(v) =>
              setAuto("autoPlayLiveStreams", v, "Auto-play live streams")
            }
            label="Auto-Play Streams"
            description="Automatically play the first available stream when a channel is selected"
          />
        </div>
      </SectionCard>

      <SectionCard title="Team Manager" icon={Shield}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.requireInviteCodeApproval ?? true}
            onChange={(v) =>
              setAuto("requireInviteCodeApproval", v, "Invite code approval")
            }
            label="Require Invite Code Approval"
            description="Owner must approve each access-code login before the member gets in"
          />
          <Toggle
            checked={prefs.automation?.autoDeactivateExpiredMembers ?? true}
            onChange={(v) =>
              setAuto(
                "autoDeactivateExpiredMembers",
                v,
                "Auto-deactivate expired members",
              )
            }
            label="Auto-Deactivate Expired Members"
            description="Automatically disable members whose invite/access period has ended"
          />
        </div>
      </SectionCard>

      <SectionCard title="Stock Management" icon={Package}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.autoCreateProductOnDelivery ?? false}
            onChange={(v) =>
              setAuto(
                "autoCreateProductOnDelivery",
                v,
                "Auto-create products on delivery",
              )
            }
            label="Auto-Create Product on Delivery"
            description="Create a stock product entry automatically when a delivery arrives"
          />
          <Toggle
            checked={prefs.automation?.showNegativeStockWarning ?? true}
            onChange={(v) =>
              setAuto("showNegativeStockWarning", v, "Negative-stock warning")
            }
            label="Negative Stock Warning"
            description="Alert when stock would go below zero after a sale"
          />
        </div>
      </SectionCard>

      <SectionCard title="Fuel Price Engine" icon={Fuel}>
        <div className="space-y-4">
          <Toggle
            checked={prefs.automation?.autoUpdateFuelPrices ?? false}
            onChange={(v) =>
              setAuto("autoUpdateFuelPrices", v, "Auto-update fuel prices")
            }
            label="Auto-Update Fuel Prices"
            description="Sync fuel prices from the regional price feed automatically"
          />
          <Toggle
            checked={prefs.automation?.showEpraReference ?? true}
            onChange={(v) => setAuto("showEpraReference", v, "EPRA reference")}
            label="Show EPRA Reference"
            description="Display the EPRA published reference price alongside yours"
          />
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: API & BACKEND — endpoint config + live status + health checks
// ═══════════════════════════════════════════════════════════════════════════
function ApiBackendTab({
  config,
  update,
  show,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [endpoints, setEndpoints] = useState<
    { name: string; url: string; status: "ok" | "error" | "checking" }[]
  >([]);
  const [testing, setTesting] = useState(false);

  const testEndpoint = useCallback(async (url: string, name: string) => {
    setEndpoints((s) => [
      ...s.filter((e) => e.name !== name),
      { name, url, status: "checking" },
    ]);
    try {
      const res = await fetch(url, { method: "HEAD" });
      setEndpoints((s) =>
        s.map((e) =>
          e.name === name
            ? { ...e, status: res.ok ? ("ok" as const) : ("error" as const) }
            : e,
        ),
      );
    } catch {
      setEndpoints((s) =>
        s.map((e) =>
          e.name === name ? { ...e, status: "error" as const } : e,
        ),
      );
    }
  }, []);

  const testAll = useCallback(async () => {
    setTesting(true);
    const checks = [
      {
        name: "Supabase API",
        url: "https://ojsscjwatikixlpshmub.supabase.co/rest/v1/",
      },
      { name: "Cloudflare Pages", url: "https://fuel-app-mobile.pages.dev/" },
      { name: "Vercel", url: "https://fuel-app-mobile.vercel.app/" },
      {
        name: "Live Channels",
        url: "https://fuel-app-mobile.pages.dev/api/live-channels?mode=tv&type=categories&id=news",
      },
      {
        name: "HLS Proxy",
        url: "https://fuel-app-mobile.pages.dev/api/hls-proxy",
      },
    ];
    for (const c of checks) await testEndpoint(c.url, c.name);
    setTesting(false);
    show("All endpoints tested", "success");
  }, [testEndpoint, show]);

  useEffect(() => {
    testAll();
  }, []);

  const customApiBase = useMemo(() => {
    return window.location.origin;
  }, []);

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            API & Backend
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Backend endpoints, live health checks, and integration references.
          </p>
        </div>
        <button
          onClick={testAll}
          disabled={testing}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
          Test All
        </button>
      </div>

      <SectionCard title="Live Endpoint Status" icon={Activity}>
        <div className="space-y-2">
          {endpoints.length === 0 ? (
            <p className="text-xs text-gray-500">Running health checks…</p>
          ) : (
            endpoints.map((e) => (
              <div
                key={e.name}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {e.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{e.url}</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    e.status === "ok"
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : e.status === "error"
                        ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
                  }`}
                >
                  {e.status === "ok"
                    ? "OK"
                    : e.status === "error"
                      ? "Error"
                      : "Checking…"}
                </span>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="Current Deployment Origin" icon={Globe}>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          <Globe size={16} className="text-blue-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {customApiBase}
            </p>
            <p className="text-xs text-gray-400">
              This is the host the browser is talking to right now. All API
              calls are relative to this origin (same-origin CORS-free).
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Integration Documentation" icon={FileText}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              name: "Supabase REST API",
              url: "https://supabase.com/docs/guides/api",
              desc: "RESTful access to all database tables",
            },
            {
              name: "Supabase Realtime",
              url: "https://supabase.com/docs/guides/realtime",
              desc: "Cross-device WebSocket subscriptions",
            },
            {
              name: "PostgREST",
              url: "https://postgrest.org/en/stable/",
              desc: "Auto-generated REST API for PostgreSQL",
            },
            {
              name: "hls.js",
              url: "https://github.com/video-dev/hls.js/",
              desc: "HLS video player for Live TV",
            },
            {
              name: "Nominatim Geocoding",
              url: "https://nominatim.org/release-docs/latest/api/Overview/",
              desc: "Reverse geocoding for fuel price location",
            },
            {
              name: "Safaricom Daraja",
              url: "https://developer.safaricom.co.ke/APIs/",
              desc: "M-PESA STK Push + C2B + B2C APIs",
            },
            {
              name: "Kopo Kopo API",
              url: "https://kopokopo.co.ke/developers",
              desc: "Till number + transaction search API",
            },
            {
              name: "Fuel Price Data (EPRA)",
              url: "https://www.epra.go.ke/",
              desc: "Kenya fuel price reference",
            },
            {
              name: "Vercel Serverless Functions",
              url: "https://vercel.com/docs/functions",
              desc: "API endpoints & cron jobs",
            },
            {
              name: "Cloudflare Pages Functions",
              url: "https://developers.cloudflare.com/pages/platform/functions/",
              desc: "Edge serverless for the Pages mirror",
            },
          ].map((d) => (
            <a
              key={d.name}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-blue-300 dark:hover:border-blue-600 transition-colors group"
            >
              <ExternalLink
                size={16}
                className="text-blue-500 flex-shrink-0 mt-0.5 group-hover:text-blue-600"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  {d.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {d.desc}
                </p>
              </div>
            </a>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TAB: DEPLOYMENT — live deployment status + version + sync info
// ═══════════════════════════════════════════════════════════════════════════
function DeploymentTab({
  config,
  update,
  show,
}: {
  config: GeneralSettingsConfig;
  update: <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => void;
  show: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [deployStatus, setDeployStatus] = useState<
    {
      name: string;
      url: string;
      status: "ok" | "error" | "checking";
      time?: string;
    }[]
  >([
    {
      name: "Cloudflare Pages (Primary)",
      url: "https://fuel-app-mobile.pages.dev/",
      status: "checking",
    },
    {
      name: "Vercel Production",
      url: "https://fuel-app-mobile.vercel.app/",
      status: "checking",
    },
    {
      name: "Supabase Backend",
      url: "https://ojsscjwatikixlpshmub.supabase.co/rest/v1/",
      status: "checking",
    },
    {
      name: "Supabase Storage",
      url: "https://ojsscjwatikixlpshmub.supabase.co/storage/v1/",
      status: "checking",
    },
    {
      name: "Supabase Realtime",
      url: "https://ojsscjwatikixlpshmub.supabase.co/realtime/v1/",
      status: "checking",
    },
  ]);

  const checkDeployment = useCallback(async (name: string, url: string) => {
    setDeployStatus((s) =>
      s.map((d) =>
        d.name === name ? { ...d, status: "checking" as const } : d,
      ),
    );
    try {
      const res = await fetch(url, { method: "HEAD" });
      const ok = res.ok || res.status === 401 || res.status === 403;
      setDeployStatus((s) =>
        s.map((d) =>
          d.name === name
            ? {
                ...d,
                status: ok ? ("ok" as const) : ("error" as const),
                time: new Date().toLocaleTimeString(),
              }
            : d,
        ),
      );
    } catch {
      setDeployStatus((s) =>
        s.map((d) =>
          d.name === name
            ? {
                ...d,
                status: "error" as const,
                time: new Date().toLocaleTimeString(),
              }
            : d,
        ),
      );
    }
  }, []);

  const checkAll = useCallback(async () => {
    for (const d of deployStatus) {
      await checkDeployment(d.name, d.url);
    }
    show("Deployment status refreshed", "success");
  }, [deployStatus, checkDeployment, show]);

  useEffect(() => {
    checkAll();
  }, []);

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Deployment
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Live deployment status, version info, and sync configuration.
          </p>
        </div>
        <button
          onClick={checkAll}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <SectionCard title="Live Deployment Status" icon={Cloud}>
        <div className="space-y-2">
          {deployStatus.map((d) => (
            <div
              key={d.name}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {d.name}
                </p>
                <p className="text-xs text-gray-400 truncate">{d.url}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {d.time && (
                  <span className="text-xs text-gray-400">{d.time}</span>
                )}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    d.status === "ok"
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : d.status === "error"
                        ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
                  }`}
                >
                  {d.status === "ok"
                    ? "Live"
                    : d.status === "error"
                      ? "Error"
                      : "Checking…"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Version Information" icon={Info}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              App Version
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              FuelPro v3.0 (2026)
            </p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">Build</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {new Date(config.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Cloud Save Debounce
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {config.lowBandwidthMode ? "2000ms (low-bandwidth)" : "500ms"}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Compression
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {config.enableCompression ? "gzip level 9 (enabled)" : "disabled"}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Sync Configuration" icon={Zap}>
        <div className="space-y-4">
          <Toggle
            checked={config.enableRealtime}
            onChange={(v) => update("enableRealtime", v)}
            label="Real-Time Sync"
            description="Cross-device instant updates via Supabase Realtime (all tabs)"
          />
          <Toggle
            checked={config.enableCompression}
            onChange={(v) => update("enableCompression", v)}
            label="Data Compression"
            description="gzip level 9 compression for cloud storage (reduces Supabase egress/storage)"
          />
          <Toggle
            checked={config.lowBandwidthMode}
            onChange={(v) => update("lowBandwidthMode", v)}
            label="Low-Bandwidth Mode"
            description="Slower sync (2s debounce) + no realtime — for slow/unstable networks"
          />
          <Toggle
            checked={config.autoBackup}
            onChange={(v) => update("autoBackup", v)}
            label="Auto-Backup"
            description="Automatically back up all data to cloud storage"
          />
          <Field label="Backup Frequency">
            <select
              className={inputClass}
              value={config.backupFrequency}
              onChange={(e) =>
                update(
                  "backupFrequency",
                  e.target.value as GeneralSettingsConfig["backupFrequency"],
                )
              }
              disabled={!config.autoBackup}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Data Retention (days)">
            <input
              type="number"
              className={inputClass}
              value={config.dataRetentionDays}
              onChange={(e) =>
                update("dataRetentionDays", parseInt(e.target.value) || 365)
              }
              min={30}
              max={3650}
            />
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}
