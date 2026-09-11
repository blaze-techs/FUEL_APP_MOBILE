import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { cloudSync } from "@/react-app/services/CloudStorageService";

// ─── Platform Data Types ───
export interface PlatformSales {
  id: string;
  fuelType: string;
  quantity: number;
  pricePerLiter: number;
  total: number;
  date: string;
  stationId?: string;
  userId?: string;
  paymentMethod?: string;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  lastActive?: string;
}

export interface PlatformStation {
  id: string;
  name: string;
  location: string;
  phone: string;
  status: string;
  revenue: number;
  createdAt: string;
}

export interface PlatformInventory {
  id: string;
  fuelType: string;
  currentStock: number;
  capacity: number;
  pricePerLiter: number;
  alertThreshold: number;
}

export interface PlatformMetric {
  label: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "stable";
}

export interface PlatformStats {
  totalRevenue: number;
  totalSales: number;
  totalUsers: number;
  totalStations: number;
  totalInventory: number;
  todayRevenue: number;
  todaySales: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  activeUsers: number;
}

// ─── Context Interface ───
interface PlatformDataContextType {
  // Raw data
  sales: PlatformSales[];
  users: PlatformUser[];
  stations: PlatformStation[];
  inventory: PlatformInventory[];

  // Aggregated stats
  stats: PlatformStats;

  // Real-time metrics
  metrics: PlatformMetric[];

  // Refresh functions
  refreshData: () => void;
  addSale: (sale: Omit<PlatformSales, "id" | "date">) => void;
  addUser: (user: Omit<PlatformUser, "id" | "createdAt">) => void;

  // Activity tracking
  getRecentActivity: (limit?: number) => Array<{
    id: string;
    action: string;
    details: string;
    time: string;
    color: string;
  }>;

  // Cloud sync status
  cloudStatus: {
    enabled: boolean;
    isOnline: boolean;
    lastSync: number | null;
    pendingChanges: number;
  };
  configureCloud: (endpoint: string, apiKey: string) => void;

  // Loading state
  isLoading: boolean;
  lastUpdated: Date | null;
}

// ─── Context ───
const PlatformDataContext = createContext<PlatformDataContextType | undefined>(
  undefined,
);

// ─── Shared Storage Keys (aligned with main app) ───
// Main app uses: fuelpro_stations_v3, fuelpro_users_v3, fuelpro_sales_v3, fuelpro_inventory_v3
const KEYS = {
  SALES: "fuelpro_sales_v3",
  USERS: "fuelpro_users_v3",
  STATIONS: "fuelpro_stations_v3",
  INVENTORY: "fuelpro_inventory_v3",
  COUPONS: "fuelpro_coupons",
  ACTIVITY: "fuelpro_activity_log",
  ANALYTICS: "fuelpro_analytics",
};

// ─── Cross-app data helper with cloud sync ───
function getItem<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    if (!data) return fallback;
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

function setItem(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
  // Queue for cloud sync
  cloudSync.queueSync(key, value);
  // Broadcast for cross-tab sync
  try {
    const bc = new BroadcastChannel("fuelpro_sync");
    bc.postMessage({
      type: "data_update",
      key,
      data: value,
      timestamp: Date.now(),
    });
    bc.close();
  } catch {
    localStorage.setItem(
      "fuelpro_sync_event",
      JSON.stringify({ key, data: value, timestamp: Date.now() }),
    );
  }
}

// ─── Provider Component ───
export function PlatformDataProvider({ children }: { children: ReactNode }) {
  const [sales, setSales] = useState<PlatformSales[]>(() =>
    getItem(KEYS.SALES, []),
  );
  const [users, setUsers] = useState<PlatformUser[]>(() =>
    getItem(KEYS.USERS, []),
  );
  const [stations, setStations] = useState<PlatformStation[]>(() =>
    getItem(KEYS.STATIONS, []),
  );
  const [inventory, setInventory] = useState<PlatformInventory[]>(() =>
    getItem(KEYS.INVENTORY, []),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Calculate aggregated stats
  const stats = calculateStats(sales, users, stations, inventory);

  // Calculate real-time metrics
  const metrics = calculateMetrics(stats);

  // Refresh data from localStorage
  // Only triggers loading state when explicitly requested
  const refreshData = useCallback((showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      setSales(getItem(KEYS.SALES, []));
      setUsers(getItem(KEYS.USERS, []));
      setStations(getItem(KEYS.STATIONS, []));
      setInventory(getItem(KEYS.INVENTORY, []));
      setLastUpdated(new Date());
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("fuelpro_")) {
        // Only refresh specific data types, not all data
        if (e.key.includes("sales")) {
          setSales(getItem(KEYS.SALES, []));
        } else if (e.key.includes("users")) {
          setUsers(getItem(KEYS.USERS, []));
        } else if (e.key.includes("stations")) {
          setStations(getItem(KEYS.STATIONS, []));
        } else if (e.key.includes("inventory")) {
          setInventory(getItem(KEYS.INVENTORY, []));
        }
      }
    };

    window.addEventListener("storage", handleStorage);

    // Only poll infrequently for same-tab updates (reduced from 5s to 60s)
    // This is just a fallback - BroadcastChannel handles most sync
    const interval = setInterval(() => {
      // Only refresh if window is visible to avoid background drain
      if (!document.hidden) {
        refreshData();
      }
    }, 60000); // 60 seconds instead of 5 seconds

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, [refreshData]);

  // Add a new sale
  const addSale = useCallback(
    (sale: Omit<PlatformSales, "id" | "date">) => {
      const newSale: PlatformSales = {
        ...sale,
        id: `sale_${Date.now()}`,
        date: new Date().toISOString(),
      };
      const updated = [newSale, ...sales].slice(0, 1000); // Keep last 1000
      setSales(updated);
      setItem(KEYS.SALES, updated);
      logActivity(
        "Sale recorded",
        `${sale.fuelType} - $${sale.total.toFixed(2)}`,
        "#10b981",
      );
    },
    [sales],
  );

  // Add a new user
  const addUser = useCallback(
    (user: Omit<PlatformUser, "id" | "createdAt">) => {
      const newUser: PlatformUser = {
        ...user,
        id: `user_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      const updated = [...users, newUser];
      setUsers(updated);
      setItem(KEYS.USERS, updated);
      logActivity("New user", `${user.name} (${user.role})`, "#8b5cf6");
    },
    [users],
  );

  // Get recent activity
  const getRecentActivity = useCallback((limit = 10) => {
    const activity = getItem<
      Array<{
        id: string;
        action: string;
        details: string;
        time: string;
        color: string;
        timestamp: number;
      }>
    >(KEYS.ACTIVITY, []);

    return activity
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        action: item.action,
        details: item.details,
        time: item.time,
        color: item.color,
      }));
  }, []);

  // Cloud sync configuration
  const cloudStatus = cloudSync.getStatus();

  const configureCloud = useCallback((endpoint: string, apiKey: string) => {
    cloudSync.configure(endpoint, apiKey);
  }, []);

  return (
    <PlatformDataContext.Provider
      value={{
        sales,
        users,
        stations,
        inventory,
        stats,
        metrics,
        refreshData,
        addSale,
        addUser,
        getRecentActivity,
        cloudStatus,
        configureCloud,
        isLoading,
        lastUpdated,
      }}
    >
      {children}
    </PlatformDataContext.Provider>
  );
}

// ─── Helper Functions ───
function calculateStats(
  sales: PlatformSales[],
  users: PlatformUser[],
  stations: PlatformStation[],
  inventory: PlatformInventory[],
): PlatformStats {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const totalRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
  const todaySales = sales.filter((s) => s.date?.startsWith(today));
  const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const weeklySales = sales.filter((s) => new Date(s.date) >= weekAgo);
  const weeklyRevenue = weeklySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const monthlySales = sales.filter((s) => new Date(s.date) >= monthAgo);
  const monthlyRevenue = monthlySales.reduce(
    (sum, s) => sum + (s.total || 0),
    0,
  );
  const activeUsers = users.filter((u) => u.status === "active").length;

  return {
    totalRevenue,
    totalSales: sales.length,
    totalUsers: users.length,
    totalStations: stations.length,
    totalInventory: inventory.length,
    todayRevenue,
    todaySales: todaySales.length,
    weeklyRevenue,
    monthlyRevenue,
    activeUsers,
  };
}

function calculateMetrics(stats: PlatformStats): PlatformMetric[] {
  return [
    {
      label: "Total Revenue",
      value: `$${stats.totalRevenue.toLocaleString()}`,
      trend: stats.totalRevenue > 0 ? "up" : "stable",
    },
    { label: "Today Revenue", value: `$${stats.todayRevenue.toFixed(2)}` },
    { label: "This Week", value: `$${stats.weeklyRevenue.toLocaleString()}` },
    { label: "This Month", value: `$${stats.monthlyRevenue.toLocaleString()}` },
    { label: "Active Sales", value: stats.totalSales },
    { label: "Active Users", value: stats.activeUsers },
    { label: "Stations", value: stats.totalStations },
    { label: "Inventory Items", value: stats.totalInventory },
  ];
}

function logActivity(action: string, details: string, color: string): void {
  const activity = getItem<
    Array<{
      id: string;
      action: string;
      details: string;
      time: string;
      color: string;
      timestamp: number;
    }>
  >("fuelpro_activity_log", []);

  const newActivity = {
    id: `activity_${Date.now()}`,
    action,
    details,
    time: "Just now",
    color,
    timestamp: Date.now(),
  };

  const updated = [newActivity, ...activity].slice(0, 100);
  setItem("fuelpro_activity_log", updated);
}

// ─── Hook ───
export function usePlatformData() {
  const context = useContext(PlatformDataContext);
  if (!context) {
    throw new Error(
      "usePlatformData must be used within a PlatformDataProvider",
    );
  }
  return context;
}

export default PlatformDataContext;
