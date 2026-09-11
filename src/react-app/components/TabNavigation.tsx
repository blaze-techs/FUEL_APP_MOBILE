import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFuel } from "@/react-app/context/FuelContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import {
  LayoutDashboard,
  Truck,
  Fuel,
  Receipt,
  Bell,
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
  Calendar,
  FlaskConical,
  LineChart,
  Wallet,
  Plug,
  Globe,
  Wrench,
  Monitor,
  FileUp,
  Gauge,
  PackageSearch,
  FileText,
  Store,
  Settings,
} from "lucide-react";

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { state } = useFuel();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Map tab IDs to Lucide icons
  const iconMap: Record<string, React.ReactNode> = {
    dashboard: <LayoutDashboard size={16} />,
    delivery: <Truck size={16} />,
    offloading: <Fuel size={16} />,
    invoice: <Receipt size={16} />,
    debt: <Bell size={16} />,
    sales: <BarChart3 size={16} />,
    reports: <FileBarChart size={16} />,
    mpesa: <CreditCard size={16} />,
    payroll: <Users size={16} />,
    communication: <MessageCircle size={16} />,
    documents: <Folder size={16} />,
    data: <Database size={16} />,
    news: <Newspaper size={16} />,
    livetransaction: <Activity size={16} />,
    fuelsalesreport: <TrendingUp size={16} />,
    pos: <ShoppingCart size={16} />,
    inventory: <Package size={16} />,
    customers: <Award size={16} />,
    audit: <ClipboardList size={16} />,
    shifts: <Calendar size={16} />,
    quality: <FlaskConical size={16} />,
    credit: <Wallet size={16} />,
    analytics: <LineChart size={16} />,
    integration: <Plug size={16} />,
    regional: <Globe size={16} />,
    fueltypes: <Fuel size={16} />,
    team: <Users size={16} />,
    suppliers: <Truck size={16} />,
    maintenance: <Wrench size={16} />,
    expenses: <Receipt size={16} />,
    priceboard: <Monitor size={16} />,
    docconverter: <FileUp size={16} />,
    pumpmapping: <Gauge size={16} />,
    // SalesZote-style additive modules
    products: <PackageSearch size={16} />,
    "sales-invoices": <FileText size={16} />,
    purchases: <ShoppingCart size={16} />,
    terminal: <Store size={16} />,
    automation: <Activity size={16} />,
    "price-finder": <Globe size={16} />,
    settings: <Settings size={16} />,
  };

  // Check scroll position for arrow visibility
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
  }, [checkScroll, state.tabConfigurations]);

  // Controlled wheel scrolling - FIXED to prevent overshoot
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle if the container is scrollable
      if (container.scrollWidth <= container.clientWidth) return;

      // Determine scroll direction (horizontal wheel OR vertical wheel converted to horizontal)
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;

      // Ignore tiny movements (prevents jitter)
      if (Math.abs(delta) < 2) return;

      e.preventDefault();

      // FIXED: Small controlled increment - 60px per wheel tick max
      // This prevents overshooting tabs
      const direction = Math.sign(delta);
      const scrollAmount = direction * 60;

      container.scrollBy({
        left: scrollAmount,
        behavior: "smooth",
      });

      // Update arrows after scroll
      setTimeout(checkScroll, 150);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [checkScroll]);

  // Manual scroll handlers for arrow buttons
  const scrollLeft = () => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollBy({ left: -150, behavior: "smooth" });
    setTimeout(checkScroll, 150);
  };

  const scrollRight = () => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollBy({ left: 150, behavior: "smooth" });
    setTimeout(checkScroll, 150);
  };

  // Get visible tabs sorted by order, filtered by role permissions
  const { canAccessTab } = usePermissions();
  const visibleTabs = state.tabConfigurations
    .filter((tab) => tab.visible !== false)
    .filter((tab) => canAccessTab(tab.id))
    .sort((a, b) => a.order - b.order);

  return (
    <div className="relative group fp-tab-nav">
      {/* Left Arrow */}
      {showLeftArrow && (
        <button
          onClick={scrollLeft}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-full flex items-center justify-center bg-gradient-to-r from-white/95 dark:from-gray-900/90 to-transparent hover:from-white dark:hover:from-gray-900 transition-all fp-icon-only"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft
            size={18}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          />
        </button>
      )}

      {/* Tabs Container - NO SCROLLBAR VISIBLE */}
      <div
        ref={containerRef}
        onScroll={checkScroll}
        className="flex overflow-x-auto px-1 py-0"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Inline style to hide webkit scrollbar completely */}
        <style>{`
          div::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        `}</style>

        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const icon = iconMap[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-semibold 
                transition-all duration-200 border-b-[3px] flex-shrink-0
                first:ml-0 last:mr-0
                ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400 border-blue-500 bg-blue-500/5"
                    : "text-gray-600 dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 hover:border-gray-300 dark:hover:border-gray-700"
                }
              `}
            >
              {icon && (
                <span className={isActive ? "text-blue-400" : "text-gray-500"}>
                  {icon}
                </span>
              )}
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right Arrow */}
      {showRightArrow && (
        <button
          onClick={scrollRight}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-full flex items-center justify-center bg-gradient-to-l from-white/95 dark:from-gray-900/90 to-transparent hover:from-white dark:hover:from-gray-900 transition-all fp-icon-only"
          aria-label="Scroll tabs right"
        >
          <ChevronRight
            size={18}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          />
        </button>
      )}
    </div>
  );
};

export default TabNavigation;
