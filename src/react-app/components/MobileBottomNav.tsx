import {
  Home,
  ShoppingCart,
  BarChart3,
  FileText,
  MoreHorizontal,
  Fuel,
  Truck,
  CreditCard,
  Users,
  FolderOpen,
  Newspaper,
  Database,
  Activity,
  TrendingUp,
  Package,
  Award,
  Wallet,
  LineChart,
  ClipboardList,
  Plug,
  Globe,
  Wrench,
  Monitor,
  Receipt,
  Settings,
  QrCode,
  Film,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { useTenant } from "@/react-app/context/TenantContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import QuickSearch from "@/react-app/components/QuickSearch";
import CompanyQrModal from "@/react-app/components/CompanyQrModal";
import Teleport from "@/react-app/components/ui/Teleport";

interface MobileBottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: any;
  color: string;
}

export default function MobileBottomNav({
  activeTab,
  onTabChange,
}: MobileBottomNavProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const { canAccessTab } = usePermissions();
  const { featureFlags } = useTenant();

  // Helper: Check if tab should show based on feature flags
  const isTabAllowed = (tabId: string): boolean => {
    if (!canAccessTab(tabId)) return false;
    // Filter by feature flags + location
    const flagMap: Record<string, keyof typeof featureFlags> = {
      mpesa: "mpesa",
      pos: "pos",
      inventory: "inventory",
      sales: "sales",
      analytics: "analytics",
      payroll: "payroll",
      expenses: "expenses",
      customers: "customers",
      suppliers: "suppliers",
      documents: "documents",
      invoice: "pos",
      communication: "email",
      audit: "audit",
      regional: "compliance",
      fueltypes: "fueltypes",
      maintenance: "maintenance",
    };
    const flag = flagMap[tabId];
    if (flag && !featureFlags[flag]) return false;
    return true;
  };

  const { state } = useFuel();

  // Registry-driven nav: every visible tab in FuelContext.tabConfigurations
  // is reachable on mobile (previously hardcoded and missed livetransaction,
  // suppliers, pumpmapping, automation, price-finder).
  const allNav: NavItem[] = useMemo(() => {
    const SHORT_LABEL: Record<string, string> = {
      dashboard: "Home",
      pos: "POS",
      sales: "Sales",
      inventory: "Stock",
      livetransaction: "Live Txn",
      fuelsalesreport: "Fuel Rpt",
      customers: "Loyalty",
      mpesa: "M-PESA",
      suppliers: "Suppliers",
      pumpmapping: "Pump Map",
      integration: "Integrate",
      regional: "Compliance",
      fueltypes: "Fuels",
      documents: "Docs",
      reports: "Reports",
      analytics: "Analytics",
      communication: "Comms",
      maintenance: "Maint.",
      expenses: "Expenses",
      data: "Data",
      news: "News",
      terminal: "Terminal",
      offloading: "Offload",
      delivery: "Delivery",
      invoice: "Invoice",
      credit: "Credit",
      payroll: "Payroll",
      team: "Team",
      audit: "Audit",
      "price-finder": "Price Finder",
      automation: "Automation",
    };
    const FALLBACK_ICONS: Record<string, any> = {
      dashboard: Home,
      pos: ShoppingCart,
      sales: BarChart3,
      inventory: Package,
      livetransaction: Activity,
      fuelsalesreport: TrendingUp,
      customers: Award,
      suppliers: Truck,
      pumpmapping: Monitor,
      "price-finder": Fuel,
      integration: Plug,
      regional: Globe,
      fueltypes: Fuel,
      audit: ClipboardList,
      terminal: Monitor,
      data: Database,
      documents: FolderOpen,
      reports: FileText,
      analytics: LineChart,
      communication: Activity,
      maintenance: Wrench,
      mpesa: CreditCard,
      invoice: FileText,
      offloading: Fuel,
      delivery: Truck,
      credit: Wallet,
      payroll: Users,
      team: Users,
      expenses: Receipt,
      news: Newspaper,
      settings: Settings,
    };
    const FALLBACK_COLORS: Record<string, string> = {
      dashboard: "text-blue-500",
      pos: "text-green-500",
      sales: "text-purple-500",
      inventory: "text-orange-500",
    };
    return state.tabConfigurations
      .filter((t) => t.visible && isTabAllowed(t.id))
      .sort((a, b) => a.order - b.order)
      .map((t) => ({
        id: t.id,
        label:
          SHORT_LABEL[t.id] ??
          (t.label.length > 12 ? t.label.slice(0, 12) : t.label),
        icon: FALLBACK_ICONS[t.id] ?? Monitor,
        color: FALLBACK_COLORS[t.id] ?? "text-gray-400",
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tabConfigurations, featureFlags, canAccessTab]);

  const PRIMARY_IDS = ["dashboard", "pos", "sales", "inventory"];
  const primaryNav: NavItem[] = allNav.filter((it) =>
    PRIMARY_IDS.includes(it.id),
  );
  const secondaryNav: NavItem[] = allNav.filter(
    (it) => !PRIMARY_IDS.includes(it.id),
  );

  const handleNavClick = (tabId: string) => {
    onTabChange(tabId);
    setShowMoreMenu(false);
  };

  // Site-wide search entries for the mobile QuickSearch — mirrors the
  // desktop Header scope (navigation + quick actions). Movies/sub-tabs are
  // searched automatically by QuickSearch's own index.
  const searchEntries = useMemo(() => {
    const entries = (state.tabConfigurations || [])
      .filter((t) => t.visible && isTabAllowed(t.id))
      .map((tab) => ({
        id: tab.id,
        label: tab.label,
        description: tab.description || "",
        category: "Navigation" as "Navigation" | "Quick Action",
        tabId: tab.id,
        keywords: `${tab.id} ${tab.label}`,
      }));
    entries.push(
      ...[
        {
          id: "qa-pos",
          label: "New Sale (POS)",
          description: "Quick fuel sale",
          category: "Quick Action" as const,
          tabId: "pos",
          keywords: "sell checkout pos cart",
        },
        {
          id: "qa-invoice",
          label: "New Invoice",
          description: "Create a new invoice",
          category: "Quick Action" as const,
          tabId: "invoice",
          keywords: "bill receipt customer",
        },
        {
          id: "qa-expense",
          label: "Record Expense",
          description: "Log a new expense",
          category: "Quick Action" as const,
          tabId: "expenses",
          keywords: "cost spend money",
        },
        {
          id: "qa-credit",
          label: "Credit Accounts",
          description: "Manage customer credit",
          category: "Quick Action" as const,
          tabId: "credit",
          keywords: "debt loan customer balance",
        },
        {
          id: "qa-stkpush",
          label: "M-PESA STK Push",
          description: "Collect payment via M-PESA",
          category: "Quick Action" as const,
          tabId: "livetransaction",
          keywords: "mpesa payment collect phone",
        },
      ],
    );
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tabConfigurations, featureFlags, canAccessTab]);

  const isMoreActive = secondaryNav.some((item) => item.id === activeTab);
  const showMoreButton = secondaryNav.length > 0;

  return (
    <>
      {/* QuickSearch (Ctrl+K palette) — full site search on mobile.
              The bottom-nav Search button clicks the (hidden) trigger, so
              mobile users get the exact same palette as desktop. */}
      <QuickSearch entries={searchEntries} triggerHidden />

      {/* Company QR modal (secure shareable/revocable grant). Teleported to
          <body> — a `fixed` overlay nested under this nav (also position:
          fixed) would be confined to the nav's box. */}
      {showQrModal && (
        <Teleport>
          <CompanyQrModal
            stationName={state.companyData?.name || "Station"}
            companyName={state.companyData?.name || "FuelPro"}
            onClose={() => setShowQrModal(false)}
          />
        </Teleport>
      )}

      {/* More Menu Overlay - dim backdrop. Must NOT intercept a tap that
          belongs to a sheet button — it's ultra-dim and closes on a tap
          outside the sheet. */}
      {showMoreMenu && (
        <div
          className="fixed inset-0 bg-black/60 z-[55] md:hidden"
          style={{ touchAction: "none" }}
          onClick={() => setShowMoreMenu(false)}
        />
      )}

      {/* More Menu Sheet - slides up. stopPropagation so tapping a button
          inside the sheet never reaches the backdrop's close handler. */}
      {showMoreMenu && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="All features"
          className="fixed bottom-[72px] left-2 right-2 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl z-[60] md:hidden border border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ maxHeight: "62vh", overflowY: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-white dark:bg-gray-800 p-3 border-b border-gray-200 dark:border-gray-700 z-10">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              All Features
            </h3>
            <p className="text-[10px] text-gray-400">
              All tabs · search · share the company QR
            </p>
          </div>

          {/* Site utilities row (always available in the sheet) */}
          <div className="flex flex-wrap gap-2 p-2">
            <button
              onClick={() => {
                setShowQrModal(true);
                setShowMoreMenu(false);
              }}
              aria-label="Company QR Code (secure, revocable station access)"
              title="Company QR Code"
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors"
            >
              <QrCode size={14} /> Company QR
            </button>
            <button
              onClick={() => switchToTab("news")}
              aria-label="Open Live TV & Movies"
              title="Live TV, Radio & Movies"
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors"
            >
              <Film size={14} /> TV & Movies
            </button>
          </div>

          {/* All secondary tabs — HORIZONTAL scroll so every feature is
              reachable at every aspect ratio (matches the desktop parity
              request: no grid crushing into unreadable columns). Proper
              ul>li>button semantics so screen readers announce a list of
              features (aria-label on the list, aria-current on the active). */}
          <div className="relative">
            <ul
              className="flex gap-1.5 p-2 overflow-x-auto snap-x scrollbar-hide"
              aria-label="All features"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {secondaryNav.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <li key={item.id} className="shrink-0 snap-start">
                    <button
                      onClick={() => handleNavClick(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={item.label}
                      className={`flex flex-col items-center justify-center min-w-16 px-3 rounded-xl transition-all active:scale-95 ${
                        isActive
                          ? "bg-blue-100 dark:bg-blue-900/40"
                          : "hover:bg-gray-100 dark:hover:bg-gray-700/50"
                      }`}
                      style={{ minHeight: 64, touchAction: "manipulation" }}
                    >
                      <Icon
                        size={22}
                        aria-hidden
                        className={
                          isActive
                            ? item.color
                            : "text-gray-500 dark:text-gray-400"
                        }
                      />
                      <span
                        className={`text-[11px] mt-1 font-medium ${
                          isActive
                            ? "text-blue-700 dark:text-blue-300"
                            : "text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* Right-edge fade hint so users know the rail scrolls. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-r from-transparent via-white/70 to-white dark:via-gray-800/70 dark:to-gray-800"
            />
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar - 64px height for proper touch targets */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden h-16 flex items-center justify-around border-t border-slate-800/80 bg-[#0B0F17]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div
          className="flex items-center justify-around w-full h-full"
          style={{ minHeight: 64 }}
        >
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className="flex flex-col items-center justify-center flex-1 h-full transition-all active:scale-95 relative"
                style={{ minWidth: 48, touchAction: "manipulation" }}
              >
                {/* Active indicator line */}
                {isActive && (
                  <div
                    className="absolute top-0 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-full"
                    style={{ width: 32, height: 3 }}
                  />
                )}
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    isActive ? "bg-blue-100 dark:bg-blue-900/40" : ""
                  }`}
                >
                  <Icon
                    size={22}
                    className={
                      isActive ? item.color : "text-gray-400 dark:text-gray-500"
                    }
                  />
                </div>
                <span
                  className={`text-[10px] mt-0.5 font-medium leading-none ${
                    isActive
                      ? "text-blue-700 dark:text-blue-300"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Search button — opens the same full-site QuickSearch the
              desktop header uses (essential tool previously unavailable
              on mobile mode). */}
          <button
            onClick={() => {
              const evt = document.querySelector(
                '[aria-label="Quick search (Ctrl+K)"]',
              ) as HTMLButtonElement | null;
              evt?.click();
            }}
            aria-label="Search anything (tabs, actions, movies)"
            title="Search anything"
            className="flex flex-col items-center justify-center flex-1 h-full transition-all active:scale-95 relative"
            style={{ minWidth: 48, touchAction: "manipulation" }}
          >
            <div className="p-1.5 rounded-xl transition-all">
              <SearchIcon
                size={22}
                className="text-gray-500 dark:text-gray-400"
              />
            </div>
            <span className="text-[10px] mt-0.5 font-medium leading-none text-gray-500 dark:text-gray-400">
              Search
            </span>
          </button>

          {/* More Button */}
          {showMoreButton && (
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              aria-expanded={showMoreMenu}
              aria-haspopup="menu"
              aria-label="More features (opens all features sheet)"
              className="flex flex-col items-center justify-center flex-1 h-full transition-all active:scale-95 relative"
              style={{ minWidth: 48, touchAction: "manipulation" }}
            >
              {isMoreActive && (
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-full"
                  style={{ width: 32, height: 3 }}
                />
              )}
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  showMoreMenu || isMoreActive
                    ? "bg-blue-100 dark:bg-blue-900/40"
                    : ""
                }`}
              >
                <MoreHorizontal
                  size={22}
                  className={
                    showMoreMenu || isMoreActive
                      ? "text-blue-500"
                      : "text-gray-400 dark:text-gray-500"
                  }
                />
              </div>
              <span
                className={`text-[10px] mt-0.5 font-medium leading-none ${
                  showMoreMenu || isMoreActive
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                More
              </span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
