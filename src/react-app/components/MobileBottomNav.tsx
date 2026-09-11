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
} from "lucide-react";
import { useMemo, useState } from "react";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { useTenant } from "@/react-app/context/TenantContext";
import { useFuel } from "@/react-app/context/FuelContext";

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

  const isMoreActive = secondaryNav.some((item) => item.id === activeTab);
  const showMoreButton = secondaryNav.length > 0;

  return (
    <>
      {/* More Menu Overlay - backdrop */}
      {showMoreMenu && (
        <div
          className="fixed inset-0 bg-black/60 z-[55] md:hidden"
          style={{ touchAction: "none" }}
          onClick={() => setShowMoreMenu(false)}
        />
      )}

      {/* More Menu Sheet - slides up */}
      {showMoreMenu && (
        <div
          className="fixed bottom-[72px] left-2 right-2 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl z-[60] md:hidden border border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ maxHeight: "60vh", overflowY: "auto" }}
        >
          <div className="sticky top-0 bg-white dark:bg-gray-800 p-3 border-b border-gray-200 dark:border-gray-700 z-10">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              All Features
            </h3>
            <p className="text-[10px] text-gray-400">Tap to navigate</p>
          </div>
          <div className="grid grid-cols-3 gap-1 p-2">
            {secondaryNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 ${
                    isActive
                      ? "bg-blue-100 dark:bg-blue-900/40"
                      : "hover:bg-gray-100 dark:hover:bg-gray-700/50"
                  }`}
                  style={{ minHeight: 64, touchAction: "manipulation" }}
                >
                  <Icon
                    size={22}
                    className={
                      isActive ? item.color : "text-gray-500 dark:text-gray-400"
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
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar - 64px height for proper touch targets */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-50 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div
          className="flex items-center justify-around"
          style={{ height: 64 }}
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

          {/* More Button */}
          {showMoreButton && (
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
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
