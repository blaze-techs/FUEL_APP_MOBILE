import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useFuel } from "@/react-app/context/FuelContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { NAVIGATION_WORKSPACES } from "@/react-app/config/navigation-config";
import {
  LayoutDashboard,
  Fuel,
  Receipt,
  BarChart3,
  FileBarChart,
  CreditCard,
  Users,
  MessageCircle,
  Folder,
  Database,
  Newspaper,
  Activity,
  TrendingUp,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  Package,
  Award,
  ClipboardList,
  LineChart,
  Wallet,
  Plug,
  Globe,
  Wrench,
  Gauge,
  Settings,
  Gamepad2,
  Boxes,
  UserRound,
  BriefcaseBusiness,
  FileSignature,
  Workflow,
  Landmark,
  SlidersHorizontal,
  Search,
  Truck,
} from "lucide-react";

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavGroup {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tabs: string[];
}

const WORKSPACE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  home: LayoutDashboard,
  forecourt: Fuel,
  "stock-supply": Boxes,
  "sales-payments": Receipt,
  people: Users,
  finance: Landmark,
  business: Folder,
  connected: Workflow,
  administration: Settings,
  utilities: Gamepad2,
};

/**
 * Render the canonical navigation registry. The registry owns information
 * architecture; this component only handles presentation, permissions and
 * responsive scrolling.
 */
const NAV_GROUPS: NavGroup[] = NAVIGATION_WORKSPACES.map((workspace) => ({
  id: workspace.id,
  label: workspace.label,
  description: workspace.description,
  icon: WORKSPACE_ICONS[workspace.id] || Folder,
  tabs: workspace.modules,
}));

const TAB_META: Record<
  string,
  { label: string; icon: React.ReactNode; shortLabel?: string }
> = {
  dashboard: { label: "Dashboard", icon: <LayoutDashboard size={15} /> },
  pos: { label: "Point of Sale", icon: <ShoppingCart size={15} />, shortLabel: "POS" },
  sales: { label: "Sales Tracking", icon: <BarChart3 size={15} /> },
  livetransaction: { label: "Live Transaction", icon: <Activity size={15} /> },
  offloading: { label: "Fuel Offloading", icon: <Fuel size={15} /> },
  delivery: { label: "Fuel Statement Report", icon: <Truck size={15} /> },
  fuelsalesreport: { label: "Fuel Sales Report", icon: <TrendingUp size={15} /> },
  pumpmapping: { label: "Pump Mapping", icon: <Gauge size={15} /> },
  reports: { label: "Reports Center", icon: <FileBarChart size={15} /> },
  analytics: { label: "Analytics", icon: <LineChart size={15} /> },
  audit: { label: "Audit Trail", icon: <ClipboardList size={15} /> },
  invoice: { label: "Invoice", icon: <Receipt size={15} /> },
  credit: { label: "Credit", icon: <Wallet size={15} /> },
  customers: { label: "Customers", icon: <Award size={15} /> },
  communication: { label: "Communication", icon: <MessageCircle size={15} /> },
  inventory: { label: "Stock Management", icon: <Package size={15} /> },
  fueltypes: { label: "Fuel Type Manager", icon: <Fuel size={15} /> },
  suppliers: { label: "Supplier Management", icon: <Truck size={15} /> },
  maintenance: { label: "Maintenance", icon: <Wrench size={15} /> },
  "price-finder": { label: "Fuel Price Finder", icon: <Search size={15} /> },
  mpesa: { label: "M-PESA Analyzer", icon: <CreditCard size={15} /> },
  payroll: { label: "Payroll System", icon: <Users size={15} /> },
  expenses: { label: "Expenses", icon: <Receipt size={15} /> },
  projtime: { label: "Projects & Time", icon: <BriefcaseBusiness size={15} /> },
  team: { label: "Team Manager", icon: <Users size={15} /> },
  documents: { label: "Document Center", icon: <Folder size={15} /> },
  webstudio: { label: "Web Studio", icon: <Globe size={15} /> },
  agreements: { label: "Agreements", icon: <FileSignature size={15} /> },
  news: { label: "News", icon: <Newspaper size={15} /> },
  integration: { label: "Integration Hub", icon: <Plug size={15} /> },
  automation: { label: "Automation Engine", icon: <Activity size={15} /> },
  terminal: { label: "Terminal Sessions", icon: <Landmark size={15} /> },
  data: { label: "Data Manager", icon: <Database size={15} /> },
  regional: { label: "Compliance", icon: <Globe size={15} /> },
  subscription: { label: "Subscription", icon: <CreditCard size={15} /> },
  settings: { label: "Settings", icon: <Settings size={15} /> },
  videogames: { label: "Video Games", icon: <Gamepad2 size={15} /> },
};

const HIDDEN_LEGACY_IDS = new Set([
  "debt",
  "shifts",
  "quality",
  "priceboard",
  "docconverter",
  "purchases",
  "sales-invoices",
  "integrations-settings",
]);

function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const { state } = useFuel();
  const { canAccessTab } = usePermissions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeGroup, setActiveGroup] = useState("overview");
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const visibleTabIds = useMemo(
    () =>
      new Set(
        state.tabConfigurations
          .filter((tab) => tab.visible !== false)
          .filter((tab) => !HIDDEN_LEGACY_IDS.has(tab.id))
          .filter((tab) => canAccessTab(tab.id))
          .map((tab) => tab.id),
      ),
    [state.tabConfigurations, canAccessTab],
  );

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        tabs: group.tabs.filter((id) => visibleTabIds.has(id)),
      })).filter((group) => group.tabs.length > 0),
    [visibleTabIds],
  );

  useEffect(() => {
    const group = visibleGroups.find((g) => g.tabs.includes(activeTab));
    if (group) setActiveGroup(group.id);
    else if (visibleGroups[0]) setActiveGroup(visibleGroups[0].id);
  }, [activeTab, visibleGroups]);

  const currentGroup =
    visibleGroups.find((group) => group.id === activeGroup) || visibleGroups[0];
  const visibleChildren = currentGroup?.tabs || [];

  const selectGroup = (group: NavGroup) => {
    setActiveGroup(group.id);
    const accessibleChild =
      group.tabs.find((id) => visibleTabIds.has(id)) || group.tabs[0];
    if (accessibleChild) onTabChange(accessibleChild);
  };

  const checkScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > 5);
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 5);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll, currentGroup?.id, visibleChildren.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (container.scrollWidth <= container.clientWidth) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 2) return;
      e.preventDefault();
      container.scrollBy({
        left: Math.sign(delta) * 60,
        behavior: "smooth",
      });
      setTimeout(checkScroll, 150);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [checkScroll]);

  const scroll = (amount: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollBy({ left: amount, behavior: "smooth" });
    setTimeout(checkScroll, 150);
  };

  if (!visibleGroups.length) return null;

  return (
    <div className="relative fp-tab-nav space-y-1">
      <div
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 pb-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        role="tablist"
        aria-label="FuelPro workspaces"
      >
        {visibleGroups.map((group) => {
          const Icon = group.icon;
          const selected = currentGroup?.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={group.description}
              onClick={() => selectGroup(group)}
              className={[
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm",
                "font-semibold whitespace-nowrap transition-all flex-shrink-0",
                selected
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white",
              ].join(" ")}
            >
              <Icon size={15} />
              <span>{group.label}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        {showLeftArrow && (
          <button
            type="button"
            onClick={() => scroll(-150)}
            className="absolute left-0 top-0 z-10 h-full w-8 flex items-center justify-center bg-gradient-to-r from-white/95 dark:from-gray-900/95 to-transparent fp-icon-only"
            aria-label="Scroll modules left"
          >
            <ChevronLeft size={17} className="text-gray-600 dark:text-gray-400" />
          </button>
        )}

        <div
          ref={containerRef}
          onScroll={checkScroll}
          className="flex overflow-x-auto px-1"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            WebkitOverflowScrolling: "touch",
          }}
          role="tablist"
          aria-label={currentGroup?.label || "Modules"}
        >
          {visibleChildren.map((id) => {
            const meta = TAB_META[id];
            if (!meta) return null;
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onTabChange(id)}
                className={[
                  "flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm",
                  "font-medium transition-all border-b-2 flex-shrink-0",
                  selected
                    ? "text-blue-600 dark:text-blue-400 border-blue-500 bg-blue-500/5"
                    : "text-gray-600 dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5",
                ].join(" ")}
              >
                {meta.icon}
                <span className="whitespace-nowrap">
                  {meta.shortLabel || meta.label}
                </span>
              </button>
            );
          })}
        </div>

        {showRightArrow && (
          <button
            type="button"
            onClick={() => scroll(150)}
            className="absolute right-0 top-0 z-10 h-full w-8 flex items-center justify-center bg-gradient-to-l from-white/95 dark:from-gray-900/95 to-transparent fp-icon-only"
            aria-label="Scroll modules right"
          >
            <ChevronRight size={17} className="text-gray-600 dark:text-gray-400" />
          </button>
        )}
      </div>

      {currentGroup && (
        <div className="hidden lg:flex items-center gap-2 px-1 pt-0.5 text-[10px] text-gray-500 dark:text-gray-500">
          <SlidersHorizontal size={11} />
          <span>
            {currentGroup.description} · Open a module above; module-specific
            tools appear inside that module.
          </span>
        </div>
      )}
    </div>
  );
}

export default TabNavigation;
