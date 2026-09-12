import {
  useState,
  useEffect,
  useRef,
  lazy,
  Suspense,
  useMemo,
  useCallback,
} from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useStations } from "@/react-app/context/StationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { useTheme } from "@/react-app/context/ThemeContext";
import { useZoom } from "@/react-app/context/ZoomContext";
import { useTenant } from "@/react-app/context/TenantContext";
import { LocationProvider } from "@/react-app/context/LocationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useTutorial } from "@/react-app/context/TutorialContext";
import { useUserPrefs } from "@/react-app/lib/user-preferences";
import {
  resolveLandingTab,
  persistLastActiveTab,
} from "@/react-app/lib/landing-tab";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  applyTabSeo,
  applyLocalBusinessSchema,
  applyBreadcrumbSchema,
} from "@/react-app/lib/seo";
import OnboardingTutorial from "@/react-app/components/OnboardingTutorial";
import Header from "@/react-app/components/Header";
import TabNavigation from "@/react-app/components/TabNavigation";
import MobileBottomNav from "@/react-app/components/MobileBottomNav";
import { CloudSyncIndicator } from "@/react-app/components/CloudSyncIndicator";
import AIChatbot from "@/react-app/components/AIChatbot";
// Shell components loaded eagerly
import StationManager from "@/react-app/components/StationManager";
import CombinedStationsView from "@/react-app/components/CombinedStationsView";
import SetupWizard from "@/react-app/components/SetupWizard";
import FirstLoginChoice from "@/react-app/components/FirstLoginChoice";

// All tab content lazy-loaded to reduce main bundle
const Dashboard = lazy(() => import("@/react-app/components/Dashboard"));
const DeliveryTracker = lazy(
  () => import("@/react-app/components/DeliveryTracker"),
);
const FuelOffloading = lazy(
  () => import("@/react-app/components/FuelOffloading"),
);
const Invoice = lazy(() => import("@/react-app/components/Invoice"));
// DebtReminder merged into CreditManagement as a sub-tab (no top-level tab).
const SalesTracking = lazy(
  () => import("@/react-app/components/SalesTracking"),
);
const ReportsCenter = lazy(
  () => import("@/react-app/components/ReportsCenter"),
);
const MPESAAnalyzer = lazy(
  () => import("@/react-app/components/MPESAAnalyzer"),
);
const PayrollSystem = lazy(
  () => import("@/react-app/components/PayrollSystem"),
);
const DataManager = lazy(() => import("@/react-app/components/DataManager"));
const News = lazy(() => import("@/react-app/components/News"));
const LiveTransaction = lazy(
  () => import("@/react-app/components/LiveTransaction"),
);
const FuelSalesReport = lazy(
  () => import("@/react-app/components/FuelSalesReport"),
);
const Communication = lazy(
  () => import("@/react-app/components/Communication"),
);
const PointOfSale = lazy(() => import("@/react-app/components/PointOfSale"));
const InventoryManagement = lazy(
  () => import("@/react-app/components/InventoryManagement"),
);
const CustomerLoyalty = lazy(
  () => import("@/react-app/components/CustomerLoyalty"),
);
const AuditTrail = lazy(() => import("@/react-app/components/AuditTrail"));
const CreditManagement = lazy(
  () => import("@/react-app/components/CreditManagement"),
);
const AdvancedAnalytics = lazy(
  () => import("@/react-app/components/AdvancedAnalytics"),
);
const IntegrationHub = lazy(
  () => import("@/react-app/components/IntegrationHub"),
);
const Compliance = lazy(() => import("@/react-app/components/Compliance"));
const FuelTypesManager = lazy(
  () => import("@/react-app/components/FuelTypesManager"),
);
const TeamManager = lazy(() => import("@/react-app/components/TeamManager"));
const DocumentCenter = lazy(
  () => import("@/react-app/components/DocumentCenter"),
);
const SupplierManagement = lazy(
  () => import("@/react-app/components/SupplierManagement"),
);
const MaintenanceTracker = lazy(
  () => import("@/react-app/components/MaintenanceTracker"),
);
const ExpenseTracker = lazy(
  () => import("@/react-app/components/ExpenseTracker"),
);
const PumpMappingV1 = lazy(
  () => import("@/react-app/components/PumpMappingV1"),
);
const FuelPriceLocator = lazy(
  () => import("@/react-app/components/FuelPriceLocator"),
);
const GeneralSettings = lazy(
  () => import("@/react-app/components/GeneralSettings"),
);

// ─── SalesZote-style POS business suite modules ───
// These are ADDITIVE features layered onto the existing FuelPro tab system
// (not a replica/replacement of app.saleszote.com). Only the modules that
// provide genuinely new capability not already covered by a FuelPro tab are
// wired in here; modules that duplicate an existing FuelPro tab reuse the
// FuelPro component instead.
// NOTE: ProductsManagement was merged into InventoryManagement (Stock
// Management) as a "Products" sub-tab — no longer a standalone top-level tab.
const TerminalSessions = lazy(
  () => import("@/react-app/components/TerminalSessions"),
);
const AutomationPanel = lazy(
  () => import("@/react-app/components/AutomationPanel"),
);

// ─── Cross-Tab Data Sync ───
// Shared state channel for real-time updates between tabs
const SYNC_CHANNEL = "fuelpro_sync";

function useCrossTabSync() {
  const broadcast = useCallback((event: string, data: unknown) => {
    try {
      const bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.postMessage({ event, data, timestamp: Date.now() });
      bc.close();
    } catch {
      // Fallback: use localStorage events
      localStorage.setItem(
        "fuelpro_sync_event",
        JSON.stringify({ event, data, timestamp: Date.now() }),
      );
    }
  }, []);

  const subscribe = useCallback(
    (event: string, handler: (data: unknown) => void) => {
      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (e) => {
          if (e.data.event === event) handler(e.data.data);
        };
      } catch {
        // Fallback
      }

      const storageHandler = (e: StorageEvent) => {
        if (e.key === "fuelpro_sync_event") {
          try {
            const msg = JSON.parse(e.newValue || "{}");
            if (msg.event === event) handler(msg.data);
          } catch {}
        }
      };
      window.addEventListener("storage", storageHandler);

      return () => {
        if (bc) {
          bc.close();
        }
        window.removeEventListener("storage", storageHandler);
      };
    },
    [],
  );

  return { broadcast, subscribe };
}

function HomeContent() {
  const {
    currentStation,
    stations,
    isStationLoading,
    adminSettings,
    switchStation,
    verifyStationAccess,
    createStation,
    loginAdmin,
  } = useStations();
  const { user, getActiveBinding, bindings } = useAuth();
  const { setRole } = usePermissions();
  const { frame } = useZoom();
  const { featureFlags, isFeatureEnabled } = useTenant();
  const { broadcast, subscribe } = useCrossTabSync();
  const { state: fuelState } = useFuel();
  const tutorial = useTutorial();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  // Default Landing Tab (General Settings): resolves the owner-configured
  // landing tab once preferences load, then persists every subsequent tab
  // switch so the optional "Resume where I left off" mode can restore it.
  const { prefs: userPrefs, loading: prefsLoading } = useUserPrefs();
  const landingAppliedRef = useRef(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showStationManager, setShowStationManager] = useState(false);
  const [showCombined, setShowCombined] = useState(false);
  const [lastSaleTime, setLastSaleTime] = useState(Date.now());
  const [automationNotice, setAutomationNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);

  // One-time onboarding tutorial: auto-launch the first time a logged-in user
  // reaches the main dashboard (after station setup). It is a one-time
  // experience — once completed/skipped it won't show again unless replayed
  // from the Header Help menu. "Remind me later" snoozes it for 3 days.
  useEffect(() => {
    if (tutorial.shouldAutoStart && !tutorial.active) {
      const t = setTimeout(() => tutorial.startTutorial("basic"), 800);
      return () => clearTimeout(t);
    }
  }, [tutorial.shouldAutoStart, tutorial.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply the Default Landing Tab once when user preferences finish loading.
  // Runs exactly once per mount (the ref guard keeps later preference edits
  // from yanking the owner back mid-session; the new choice takes effect on
  // the next login/navigation home).
  useEffect(() => {
    if (landingAppliedRef.current || prefsLoading) return;
    landingAppliedRef.current = true;
    const target = resolveLandingTab(userPrefs, fuelState.tabConfigurations);
    if (target && target !== "dashboard") setActiveTab(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoading]);

  // Persist the last-opened tab so "Resume where I left off" (General
  // Settings → Default Landing Tab) can reopen it on the next login.
  useEffect(() => {
    persistLastActiveTab(activeTab);
  }, [activeTab]);

  // Per-tab SEO: unique document title + meta description for every view,
  // plus BreadcrumbList structured data (Home → current view).
  useEffect(() => {
    applyTabSeo(activeTab, resolveTabLabel(activeTab));
    applyBreadcrumbSchema(resolveTabLabel(activeTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // LocalBusiness (GasStation) structured data from the active station so
  // search engines can associate the app with the real business.
  useEffect(() => {
    if (!currentStation) return;
    applyLocalBusinessSchema({
      name: currentStation.name,
      location: currentStation.location,
      phone: currentStation.phone,
      email: currentStation.email,
      country: currentStation.country,
      currency: currentStation.currency,
      logo: currentStation.logo,
    });
  }, [currentStation]);

  // Auto-login to role
  useEffect(() => {
    if (!user || !currentStation) return;
    const binding = getActiveBinding(currentStation.id);
    if (binding && binding.active) {
      setRole(binding.role);
    }
  }, [user, currentStation, getActiveBinding, setRole]);

  // CLOUD-BACKED SETUP-COMPLETE CHECK (fixes "offline re-triggers setup
  // wizard on a new device"). The `fuelpro_setup_complete` flag was only in
  // localStorage, so on a fresh device/browser (empty localStorage) a
  // returning user offline was sent back to the SetupWizard even though they
  // already completed setup on another device. Now we also persist the flag
  // to cloud (app_kv key `setup_complete`) per user and hydrate the local
  // flag from cloud on mount so the "Loading your station data…" state shows
  // instead of the wizard. The write happens in the wizard onComplete handler.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await cloudStorageService.get<boolean>(
          "setup_complete",
          undefined,
        );
        if (!cancelled && cloud === true) {
          // Hydrate the local flag so the offline loading-state path runs.
          localStorage.setItem("fuelpro_setup_complete", "true");
        }
      } catch {
        /* cloud unavailable — the local flag still governs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Check for stations in localStorage after wizard completes
  // This fixes the race condition where createStation hasn't propagated yet.
  // IMPORTANT: checks the USER-SCOPED key (fuelpro_stations_v3_<userId>),
  // not the legacy bare key — using the bare key caused a reload loop when
  // StationContext hadn't hydrated from the scoped key yet but the bare key
  // had leftover data. Also uses safeReload (loop-guarded) instead of a
  // raw window.location.reload().
  useEffect(() => {
    if (!showSetupWizard && stations.length === 0) {
      const interval = setInterval(() => {
        try {
          // Resolve the user-scoped stations key (mirrors StationContext).
          let scopedKey = "fuelpro_stations_v3";
          const identityRaw = localStorage.getItem("fuelpro_auth_identity");
          if (identityRaw) {
            const id = JSON.parse(identityRaw)?.id;
            if (typeof id === "string" && id)
              scopedKey = `fuelpro_stations_v3_${id}`;
          }
          const raw =
            localStorage.getItem(scopedKey) ||
            localStorage.getItem("fuelpro_stations_v3");
          if (raw) {
            const parsed = JSON.parse(raw);
            const stationList = Array.isArray(parsed)
              ? parsed
              : parsed?.stations;
            if (stationList && stationList.length > 0) {
              clearInterval(interval);
              if (
                typeof window !== "undefined" &&
                typeof window.__fuelproSafeReload === "function"
              ) {
                window.__fuelproSafeReload("home-station-found");
              } else {
                window.location.reload();
              }
            }
          }
        } catch {}
      }, 500);
      // Stop polling after 10 seconds
      const timeout = setTimeout(() => clearInterval(interval), 10000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [showSetupWizard, stations.length]);

  // Check for combined view
  useEffect(() => {
    if (searchParams.get("combined") === "true") setShowCombined(true);
  }, [searchParams]);

  // Cross-tab sync listeners
  useEffect(() => {
    const unsub1 = subscribe("sale_made", () => setLastSaleTime(Date.now()));
    const unsub2 = subscribe("inventory_update", () =>
      setLastSaleTime(Date.now()),
    );
    const unsub3 = subscribe("tab_change", (tabId: string) =>
      setActiveTab(tabId),
    );
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [subscribe]);

  // Listen for tab change events
  useEffect(() => {
    const handleChangeTab = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        setActiveTab(customEvent.detail);
        broadcast("tab_change", customEvent.detail);
      }
    };
    window.addEventListener("changeTab", handleChangeTab);
    return () => window.removeEventListener("changeTab", handleChangeTab);
  }, [broadcast]);

  // Listen for requests to open the Station Manager modal (dispatched by
  // Team Manager and other components that want to deep-link into it).
  useEffect(() => {
    const handleOpenStationManager = () => setShowStationManager(true);
    window.addEventListener("open-station-manager", handleOpenStationManager);
    return () =>
      window.removeEventListener(
        "open-station-manager",
        handleOpenStationManager,
      );
  }, []);

  // Automation notification toast — listens for `automation:notify`
  // CustomEvents fired by the automation engine (e.g. auto-reorder created)
  // and surfaces them as a transient toast near the bottom of the page.
  useEffect(() => {
    const onNotify = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const title = detail.title || "Automation";
      const message = detail.message || "";
      setAutomationNotice({ title, message });
      setTimeout(() => setAutomationNotice(null), 5000);
    };
    window.addEventListener("automation:notify", onNotify);
    return () => window.removeEventListener("automation:notify", onNotify);
  }, []);

  // Validate tab access - redirect if current tab is restricted by feature flag
  const { canAccessTab } = usePermissions();
  useEffect(() => {
    const tabFeatureMap: Record<string, keyof typeof featureFlags> = {
      communication: "email",
      audit: "audit",
      regional: "compliance",
      fueltypes: "fueltypes",
      maintenance: "maintenance",
    };
    const requiredFeature = tabFeatureMap[activeTab];
    if (requiredFeature && !featureFlags[requiredFeature]) {
      const fallbackTabs = ["dashboard", "pos", "sales", "inventory"];
      const fallback = fallbackTabs.find((t) => canAccessTab(t));
      if (fallback && fallback !== activeTab) setActiveTab(fallback);
    }
  }, [activeTab, canAccessTab, featureFlags]);

  // Filter tab configurations based on feature flags
  const filteredTabConfig = useMemo(() => {
    const config = { ...adminSettings.tabConfig };
    // M-PESA Analyzer is available to ALL users — the statement analysis
    // (paste SMS text, pattern match, AI extract) is country-agnostic.
    // The Kenya-specific Daraja STK Push API gracefully degrades inside
    // the component based on the configured integration.
    // Compliance tab controlled by compliance feature flag
    if (!featureFlags.compliance) {
      config.regional = { ...config.regional, enabled: false };
    }
    return config;
  }, [adminSettings.tabConfig, featureFlags]);

  // Alt+1..9 keyboard shortcuts — switch to the Nth visible tab
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const num = parseInt(e.key, 10);
      if (isNaN(num) || num < 1 || num > 9) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const tabs = Object.values(filteredTabConfig)
        .filter((t: any) => t.enabled !== false)
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) as any[];
      const target = tabs[num - 1];
      if (target?.id) {
        e.preventDefault();
        setActiveTab(target.id);
        broadcast("tab_change", target.id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [filteredTabConfig, broadcast]);

  // Resolve a tab's display label from adminSettings first, then fall back to
  // FuelContext's authoritative tabConfigurations (which use the canonical
  // lowercase ids). Prevents the raw tab id (e.g. "fuelsalesreport") leaking
  // into the mobile heading when the two configs use different casing.
  const resolveTabLabel = (tabId: string): string => {
    const adminEntry =
      filteredTabConfig[tabId as keyof typeof filteredTabConfig];
    if (adminEntry?.label) return adminEntry.label;
    const fuelEntry = fuelState.tabConfigurations?.find((t) => t.id === tabId);
    if (fuelEntry?.label) return fuelEntry.label;
    return tabId;
  };

  // ─── Render tab content with cross-tab data ───
  const renderTabContent = () => {
    const tabConfig =
      filteredTabConfig[activeTab as keyof typeof filteredTabConfig];
    if (tabConfig && !tabConfig.enabled) {
      return (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-200 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
              <span className="text-2xl text-gray-400">!</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-500 dark:text-gray-400">
              Feature Not Available
            </h3>
            <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
              This feature is not available in your region or has been disabled.
              {activeTab === "mpesa" && (
                <span className="block mt-2">
                  M-PESA is only available in Kenya and Tanzania.
                </span>
              )}
            </p>
          </div>
        </div>
      );
    }

    const commonProps = {
      stationId: currentStation?.id || "default",
      lastSyncTime: lastSaleTime,
      onBroadcast: broadcast,
    };

    switch (activeTab) {
      case "dashboard":
        return <Dashboard />;
      case "delivery":
        return <DeliveryTracker />;
      case "offloading":
        return <FuelOffloading />;
      case "invoice":
        return <Invoice />;
      case "sales":
        return <SalesTracking />;
      case "reports":
        return <ReportsCenter />;
      case "mpesa":
        return <MPESAAnalyzer />;
      case "payroll":
        return <PayrollSystem />;
      case "data":
        return <DataManager />;
      case "news":
        return <News />;
      case "livetransaction":
        return <LiveTransaction />;
      case "fuelsalesreport":
        return <FuelSalesReport />;
      case "communication":
        return <Communication />;
      case "pos":
        return <PointOfSale />;
      case "inventory":
        return <InventoryManagement />;
      case "customers":
        return <CustomerLoyalty />;
      case "audit":
        return <AuditTrail {...commonProps} />;
      case "credit":
        return <CreditManagement />;
      case "analytics":
        return <AdvancedAnalytics />;
      case "integration":
        return <IntegrationHub />;
      case "regional":
        return <Compliance />;
      case "fueltypes":
        return <FuelTypesManager />;
      case "team":
        return <TeamManager />;
      case "documents":
        return <DocumentCenter />;
      case "suppliers":
        return <SupplierManagement />;
      case "maintenance":
        return <MaintenanceTracker />;
      case "expenses":
        return <ExpenseTracker />;
      case "pumpmapping":
        return <PumpMappingV1 />;
      // ─── SalesZote-style additive modules ───
      // Each maps to a genuinely-new capability. Where a SalesZote module
      // duplicates a FuelPro tab, the FuelPro component is reused above.
      // "products" was merged into "inventory" (Stock Management) as a sub-tab.
      case "terminal":
        return <TerminalSessions />;
      case "automation":
        return <AutomationPanel />;
      case "price-finder":
        return <FuelPriceLocator />;
      case "settings":
        return <GeneralSettings />;
      default:
        return <Dashboard />;
    }
  };

  if (isStationLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center animate-pulse">
            <span className="text-2xl font-bold text-white">F</span>
          </div>
          <h2 className="text-xl font-bold text-white font-serif">FuelPro</h2>
          <p className="text-gray-400 text-sm mt-2">Loading stations...</p>
          <div className="mt-4 w-48 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full animate-pulse"
              style={{ width: "60%" }}
            />
          </div>
        </div>
      </div>
    );
  }

  // No stations: route based on whether the user has shared-station bindings.
  //  - New user (no bindings): go straight to the SetupWizard — the station
  //    setup is part of the "account sign up" flow, not a separate choice.
  //  - Invited team member (has active bindings): show FirstLoginChoice so they
  //    can access the shared station they were invited to.
  //  - Returning user who ALREADY completed setup (fuelpro_setup_complete flag
  //    is set) but stations haven't loaded yet (cloud sync in progress, or
  //    offline): show a "syncing your station" loading state instead of forcing
  //    the setup wizard again. This fixes the "offline keeps asking me to set
  //    up again" bug — the user already set up on another device; we just need
  //    to wait for (or retry) the cloud load instead of re-running the wizard.
  const hasActiveBindings = bindings.some((b) => b.active);
  const setupAlreadyCompleted =
    localStorage.getItem("fuelpro_setup_complete") === "true";
  // A returning user on a NEW device won't have the local setup flag, but they
  // DO have an auth identity (logged-in user with a Supabase session). Treat
  // an authenticated user with no local setup flag + no stations as a
  // "syncing from cloud" state (not a brand-new user) so they don't see the
  // SetupWizard while their cloud data loads. This is the core fix for the
  // "site keeps forgetting my data" complaint — the wizard was showing on
  // every fresh-device login before cloud data arrived.
  const hasAuthIdentity = Boolean(
    localStorage.getItem("fuelpro_auth_identity"),
  );

  if (stations.length === 0 || !currentStation) {
    // Returning user: setup was completed before but stations are empty (cloud
    // sync pending or offline). Do NOT re-run the wizard — show a loading
    // state that retries the cloud sync. Only brand-new users (no setup flag,
    // no auth identity) or users who explicitly clicked "create station" see
    // the wizard.
    if (
      (setupAlreadyCompleted || hasAuthIdentity) &&
      !showSetupWizard &&
      !hasActiveBindings
    ) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center animate-pulse">
              <span className="text-2xl font-bold text-white">F</span>
            </div>
            <h2 className="text-xl font-bold text-white font-serif">FuelPro</h2>
            <p className="text-gray-300 text-sm mt-2">
              Loading your station data…
            </p>
            <p className="text-gray-500 text-xs mt-1">
              If you're offline, your data will sync automatically when you're
              back online.
            </p>
            <div className="mt-4 w-48 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full animate-pulse"
                style={{ width: "60%" }}
              />
            </div>
            <button
              onClick={() => {
                // Allow the user to manually retry if they've been stuck.
                localStorage.removeItem("fuelpro_setup_complete");
                setShowSetupWizard(true);
              }}
              className="mt-6 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 underline"
            >
              Station not found? Set up a new one
            </button>
          </div>
        </div>
      );
    }
    if (showSetupWizard || !hasActiveBindings) {
      return (
        <SetupWizard
          onComplete={() => {
            // Mark setup complete WITHOUT reloading. The previous
            // window.location.reload() fired synchronously right after the
            // wizard dispatched SET_COMPANY_DATA / SET_TANK_VALUES /
            // SET_PRICES / SET_PUMPS — before the debounced saveToStorage
            // (100ms) and saveToCloud (300ms) could persist them. That wiped
            // the wizard-entered tanks, pumps, prices, KRA PIN, and company
            // data from memory, so they never reached localStorage or cloud
            // and were lost on the reload. Keeping state in memory lets the
            // normal debounced saves persist it.
            localStorage.setItem("fuelpro_setup_complete", "true");
            // Also persist to cloud so a returning user on a NEW device
            // (empty localStorage) offline is NOT sent back to the wizard —
            // the cloud-backed check hydrates the local flag.
            cloudStorageService
              .set("setup_complete", true, undefined)
              .catch(() => {});
            setShowSetupWizard(false);
          }}
          onAccessShared={
            hasActiveBindings ? () => setShowSetupWizard(false) : undefined
          }
        />
      );
    }
    const showAccessMode = stations.length > 0;
    return (
      <FirstLoginChoice
        existingStations={stations}
        showAccessMode={showAccessMode}
        onCreateStation={() => setShowSetupWizard(true)}
        onAccessShared={(stationId, password) => {
          if (verifyStationAccess(stationId, password)) {
            switchStation(stationId);
            const accesses = JSON.parse(
              localStorage.getItem("fuelpro_shared_access") || "[]",
            );
            accesses.push({ stationId, date: new Date().toISOString() });
            localStorage.setItem(
              "fuelpro_shared_access",
              JSON.stringify(accesses),
            );
            return true;
          }
          return false;
        }}
        onSelectStation={(stationId) => {
          switchStation(stationId);
          return true;
        }}
        loginAdmin={loginAdmin}
      />
    );
  }

  // Combined view
  if (showCombined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header onShowStations={() => setShowStationManager(true)} />
        <div className="container mx-auto px-2 md:px-4 py-6">
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => {
                setShowCombined(false);
                navigate("/");
              }}
              className="px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 text-sm"
            >
              Back to Station
            </button>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Combined Stations View
            </h2>
          </div>
          <CombinedStationsView />
        </div>
      </div>
    );
  }

  // Setup wizard
  if (showSetupWizard)
    return <SetupWizard onComplete={() => setShowSetupWizard(false)} />;

  // Station manager
  if (showStationManager) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900">
        <StationManager onClose={() => setShowStationManager(false)} />
      </div>
    );
  }

  // ─── MAIN APP ───
  // The original FuelPro tab system is the primary app shell. SalesZote-style
  // POS modules are layered in as ADDITIONAL tabs (see renderTabContent) rather
  // than replacing the whole interface, so existing FuelPro features (Delivery,
  // Offloading, Invoice, Debt, M-PESA, Payroll, Pump Mapping, etc.) remain
  // first-class and the result is an enhancement, not a replica of
  // app.saleszote.com.
  return (
    <div className="h-[100dvh] w-full bg-gray-50 dark:bg-[#0A0D14] transition-colors duration-300 max-w-[100vw] overflow-hidden">
      <div
        className="relative mx-auto flex h-full w-full flex-col overflow-hidden bg-gray-50 dark:bg-[#0D1117] shadow-2xl"
        style={{
          maxWidth:
            frame === "wide"
              ? "min(1600px, 100%)"
              : frame === "full"
                ? "100%"
                : "min(1400px, 100%)",
        }}
      >
        <Header
          onShowStations={() => setShowStationManager(true)}
          onShowCombined={() => setShowCombined(true)}
        />

        <div className="flex-1 overflow-y-auto scrollbar-none pb-24 md:pb-0">
          <div className="container mx-auto px-1 sm:px-2 lg:px-4 py-1 sm:py-2">
            {/* Desktop Tab Navigation */}
            <div className="hidden md:block">
              <TabNavigation
                activeTab={activeTab}
                onTabChange={(tab) => {
                  setActiveTab(tab);
                  broadcast("tab_change", tab);
                }}
              />
            </div>

            {/* Breadcrumb navigation (desktop) */}
            <nav aria-label="Breadcrumb" className="hidden md:block px-1 pb-1">
              <ol className="flex items-center gap-1.5 text-xs">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("dashboard");
                      broadcast("tab_change", "dashboard");
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 font-medium transition-colors"
                  >
                    Home
                  </button>
                </li>
                <li
                  aria-hidden="true"
                  className="text-gray-400 dark:text-gray-500 select-none"
                >
                  /
                </li>
                <li
                  aria-current="page"
                  className="text-gray-700 dark:text-gray-300 font-medium"
                >
                  {resolveTabLabel(activeTab)}
                </li>
              </ol>
            </nav>

            {/* Mobile Active Tab Title */}
            <div className="md:hidden mb-1 sm:mb-2">
              <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl px-3 py-2 sm:px-4 sm:py-3 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 capitalize">
                  {resolveTabLabel(activeTab)}
                </h2>
                {featureFlags.mpesa && activeTab === "mpesa" && (
                  <span className="text-[10px] px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full font-medium">
                    M-PESA Ready
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 md:rounded-b-2xl rounded-b-lg shadow-lg flex-1 overflow-hidden flex flex-col">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-64 sm:h-96">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" />
                  </div>
                }
              >
                {renderTabContent()}
              </Suspense>
            </div>

            {/* Site footer */}
            <footer className="mt-4 mb-16 md:mb-2 border-t border-gray-200 dark:border-gray-700 pt-3 pb-2 px-1">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                FuelPro — Fuel Station Management System
                {currentStation?.name ? ` · ${currentStation.name}` : ""}
              </p>
            </footer>
          </div>

          {/* Mobile Bottom Navigation - NO duplicate AI here */}
          <MobileBottomNav
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              broadcast("tab_change", tab);
            }}
          />

          {/* AI Chatbot - single instance, NOT duplicated */}
          {featureFlags.ai && <AIChatbot />}

          {/* Cloud Sync Indicator */}
          <CloudSyncIndicator />

          {/* One-time onboarding tutorial overlay (auto-launches on first login,
          replayable from the Header Help menu). */}
          <OnboardingTutorial />

          {/* Automation notification toast */}
          {automationNotice && (
            <div className="fixed bottom-20 right-4 z-50 bg-amber-500/95 text-white rounded-xl shadow-lg p-4 max-w-sm">
              <p className="font-semibold text-sm">{automationNotice.title}</p>
              <p className="text-white/80 text-xs mt-1">
                {automationNotice.message}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = currentStation?.id || "default";

  // Detect country for tenant context
  const detectedCountry = useMemo(() => {
    try {
      const saved = localStorage.getItem("fuelpro_location_country");
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc = parsed.currentCountry || parsed.country;
        if (cc) return cc.toUpperCase();
      }
    } catch {}
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Map common TZs to countries
    if (tz.includes("Nairobi")) return "KE";
    if (tz.includes("Lagos") || tz.includes("Lagos")) return "NG";
    if (tz.includes("Johannesburg")) return "ZA";
    if (tz.includes("Accra")) return "GH";
    if (tz.includes("Dar_es_Salaam") || tz.includes("Dar es Salaam"))
      return "TZ";
    if (tz.includes("Kampala")) return "UG";
    return "US";
  }, []);

  return (
    <LocationProvider
      stationId={stationId}
      stationLocation={currentStation?.location}
      stationCountry={currentStation?.country}
      stationCurrency={currentStation?.currency}
      companyCurrency={state?.companyData?.currency}
    >
      <HomeContent />
    </LocationProvider>
  );
}
