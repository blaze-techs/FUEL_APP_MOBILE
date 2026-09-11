import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation } from "@/react-app/context/LocationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { getFuelLabel } from "@/react-app/config/pricing";
import {
  Users,
  Star,
  Plus,
  Search,
  Gift,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  User,
  Edit2,
  Trash2,
  Download,
  FileText,
  CreditCard,
  History,
  MessageSquareWarning,
  Award,
} from "lucide-react";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import SubTabBar from "@/react-app/components/SubTabBar";
import CustomerSegments from "@/react-app/components/CustomerSegments";
import CustomerComplaintsLog from "@/react-app/components/CustomerComplaintsLog";
import LoyaltyTierConfig from "@/react-app/components/LoyaltyTierConfig";
import Promotions from "@/react-app/components/Promotions";
import PunchCardLoyalty from "@/react-app/components/PunchCardLoyalty";
import CustomerPurchaseHistory from "@/react-app/components/CustomerPurchaseHistory";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicleReg: string;
  loyaltyPoints: number;
  totalSpent: number;
  visits: number;
  lastVisit: string;
  preferredFuel: string;
  tier: "Bronze" | "Silver" | "Gold" | "Platinum";
  notes: string;
  joinDate: string;
}

interface Reward {
  id: string;
  name: string;
  points: number;
  description: string;
  category: "discount" | "free_item" | "service";
}

const REWARDS: Reward[] = [
  {
    id: "r1",
    name: "5% Off Next Fill",
    points: 500,
    description: "Get 5% discount on your next fuel purchase",
    category: "discount",
  },
  {
    id: "r2",
    name: "Free Oil Check",
    points: 300,
    description: "Complimentary engine oil level check",
    category: "service",
  },
  {
    id: "r3",
    name: "Free Car Wash",
    points: 1000,
    description: "Premium car wash service on us",
    category: "service",
  },
  {
    id: "r4",
    name: "10% Off Total",
    points: 2000,
    description: "10% discount on entire purchase",
    category: "discount",
  },
  {
    id: "r5",
    name: "Free Engine Oil (1L)",
    points: 5000,
    description: "1L of engine oil (5W-30)",
    category: "free_item",
  },
  {
    id: "r6",
    name: "Free Tire Pressure Service",
    points: 200,
    description: "Tire pressure check and fill",
    category: "service",
  },
];

function getTier(points: number): Customer["tier"] {
  if (points >= 10000) return "Platinum";
  if (points >= 5000) return "Gold";
  if (points >= 1000) return "Silver";
  return "Bronze";
}

function tierColor(tier: Customer["tier"]): string {
  switch (tier) {
    case "Platinum":
      return "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300";
    case "Gold":
      return "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300";
    case "Silver":
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-300";
    default:
      return "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300";
  }
}

function normalizeLoyaltyCustomer(
  c: Partial<Customer> | null | undefined,
): Customer {
  const id =
    c?.id || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const loyaltyPoints =
    typeof c?.loyaltyPoints === "number" ? c.loyaltyPoints : 0;
  return {
    id,
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    vehicleReg: c?.vehicleReg ?? "",
    loyaltyPoints,
    totalSpent: typeof c?.totalSpent === "number" ? c.totalSpent : 0,
    visits: typeof c?.visits === "number" ? c.visits : 0,
    lastVisit: c?.lastVisit ?? new Date().toISOString(),
    preferredFuel:
      typeof c?.preferredFuel === "string" && c.preferredFuel
        ? c.preferredFuel
        : "Both",
    tier:
      c?.tier === "Bronze" ||
      c?.tier === "Silver" ||
      c?.tier === "Gold" ||
      c?.tier === "Platinum"
        ? c.tier
        : getTier(loyaltyPoints),
    notes: c?.notes ?? "",
    joinDate: c?.joinDate ?? new Date().toISOString().split("T")[0],
  };
}

function normalizeLoyaltyCustomers(arr: unknown): Customer[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => normalizeLoyaltyCustomer(c as Partial<Customer>));
}

export default function CustomerLoyalty() {
  const [innerView, setInnerView] = useState<
    | "customers"
    | "segments"
    | "promos"
    | "punchcards"
    | "history"
    | "complaints"
    | "tiers"
  >("customers");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("customers", setInnerView);
  const location = useLocation();
  const { user } = useAuth();
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes(stationId);
  const [customers, setCustomers] = useState<Customer[]>(() => {
    // Cloud cache first (freshest cross-device data), then localStorage
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "loyalty_customers",
      stationId,
    );
    if (Array.isArray(cloudCached))
      return normalizeLoyaltyCustomers(cloudCached);
    try {
      return normalizeLoyaltyCustomers(
        JSON.parse(localStorage.getItem("fuelpro_customers") || "[]"),
      );
    } catch {
      return defaultCustomers();
    }
  });
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newCustomer, setNewCustomer] = useState<{
    name: string;
    phone: string;
    email: string;
    vehicleReg: string;
    preferredFuel: string;
    notes: string;
  }>({
    name: "",
    phone: "",
    email: "",
    vehicleReg: "",
    preferredFuel: "Both",
    notes: "",
  });
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [showRewards, setShowRewards] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  // Race-condition guard: prevents the async cloud-load effect from
  // overwriting local state before the load completes, and prevents the
  // real-time echo from wiping uncommitted local edits. Without this,
  // switching to the tab shows cached data for a glimpse then the cloud
  // load wipes it (the "flash then blank" bug).
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const customersRef = useRef(customers);
  customersRef.current = customers;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const currencySymbol = location.currencySymbol;
  const save = (c: Customer[]) => {
    localModifiedRef.current = true;
    setCustomers(c);
    localStorage.setItem("fuelpro_customers", JSON.stringify(c));
    if (cloudLoadCompleteRef.current)
      cloudStorageService
        .set("loyalty_customers", c, stationId)
        .then(() => {
          console.log(
            "[CustomerLoyalty] cloud save OK:",
            c.length,
            "customers",
          );
        })
        .catch((e) => {
          console.error("[CustomerLoyalty] cloud save FAILED:", e);
        });
  };

  // Load from cloud on mount + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    setSynced(false);
    let cancelled = false;
    (async () => {
      const cloudData = await cloudStorageService.get<Customer[]>(
        "loyalty_customers",
        stationId,
      );
      if (cancelled) return;
      if (cloudData && cloudData.length > 0 && !localModifiedRef.current) {
        setCustomers(normalizeLoyaltyCustomers(cloudData));
      } else {
        // Fallback: read from FuelContext compact blob (state.clients).
        // POS/Invoice tabs save customers here; without this fallback the
        // Customers tab appears empty even though customers exist.
        const compactClients = Object.values(state.clients || {});
        if (compactClients.length > 0 && !localModifiedRef.current) {
          const mapped: Customer[] = compactClients.map((c: any) => ({
            id: c.id || c.phone || c.name || String(Math.random()),
            name: c.name || c.clientName || "Unknown",
            email: c.email || "",
            phone: c.phone || c.phoneNo || "",
            vehicleReg: c.vehicleReg || c.vehicleNumber || "",
            preferredFuel: "Both",
            loyaltyPoints: 0,
            totalSpent: 0,
            visits: 0,
            lastVisit: "",
            tier: "Bronze" as const,
            notes: "",
            joinDate: c.createdAt || new Date().toISOString(),
          }));
          setCustomers(mapped);
        }
      }
      if (!cancelled) {
        cloudLoadCompleteRef.current = true;
        setSynced(true);
      }
    })();
    // Real-time: when another device updates customers, update instantly
    const unsubs = [
      cloudStorageService.subscribe<Customer[]>(
        "loyalty_customers",
        stationId,
        (val) => {
          if (!val || localModifiedRef.current) return;
          setCustomers(normalizeLoyaltyCustomers(val));
          setSynced(true);
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set("loyalty_customers", customersRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q) ||
        (c.vehicleReg || "").toLowerCase().includes(q),
    );
  }, [customers, search]);

  const totalPoints = customers.reduce(
    (s, c) => s + (typeof c.loyaltyPoints === "number" ? c.loyaltyPoints : 0),
    0,
  );
  const avgSpend =
    customers.length > 0
      ? customers.reduce(
          (s, c) => s + (typeof c.totalSpent === "number" ? c.totalSpent : 0),
          0,
        ) / customers.length
      : 0;

  const addCustomer = () => {
    if (!newCustomer.name.trim()) {
      showToast("Please enter a customer name");
      return;
    }
    if (!newCustomer.phone.trim()) {
      showToast("Please enter a phone number");
      return;
    }
    const c: Customer = {
      ...newCustomer,
      id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      loyaltyPoints: 0,
      totalSpent: 0,
      visits: 0,
      lastVisit: new Date().toISOString().split("T")[0],
      tier: "Bronze",
      joinDate: new Date().toISOString().split("T")[0],
    };
    save([c, ...customers]);
    setNewCustomer({
      name: "",
      phone: "",
      email: "",
      vehicleReg: "",
      preferredFuel: "Both",
      notes: "",
    });
    setShowAdd(false);
    showToast(`Customer "${c.name}" added`);
  };

  const editCustomer = (updated: Customer) => {
    if (!updated.name.trim()) {
      showToast("Customer name cannot be empty");
      return;
    }
    save(
      (customers || []).map((c) =>
        c.id === updated.id
          ? { ...updated, tier: getTier(updated.loyaltyPoints || 0) }
          : c,
      ),
    );
    setEditingCustomer(null);
    setSelectedCustomer(null);
    showToast(`Customer "${updated.name}" updated`);
  };

  const deleteCustomer = (id: string) => {
    const c = (customers || []).find((x) => x.id === id);
    save((customers || []).filter((x) => x.id !== id));
    setDeleteId(null);
    if (selectedCustomer?.id === id) setSelectedCustomer(null);
    showToast(`Deleted customer: ${c?.name || "Unknown"}`);
  };

  const addCustomPoints = (id: string) => {
    const pts = parseInt(customPoints, 10);
    if (!pts || pts === 0) {
      showToast("Enter a valid points value");
      return;
    }
    setCustomPoints("");
    // addPoints already shows a toast — no duplicate here
    addPoints(id, pts);
  };

  const exportCustomersCSV = () => {
    const rows = [
      [
        "Name",
        "Phone",
        "Email",
        "Vehicle Reg",
        "Preferred Fuel",
        "Loyalty Points",
        "Total Spent",
        "Visits",
        "Tier",
        "Last Visit",
        "Join Date",
        "Notes",
      ],
      ...(filtered || []).map((c) => [
        c.name || "",
        c.phone || "",
        c.email || "",
        c.vehicleReg || "",
        c.preferredFuel || "",
        c.loyaltyPoints || 0,
        c.totalSpent || 0,
        c.visits || 0,
        c.tier || "Bronze",
        c.lastVisit || "",
        c.joinDate || "",
        (c.notes || "").replace(/"/g, '""'),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((f) => `"${String(f)}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loyalty_customers_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(
      filtered.length === customers.length
        ? `Exported ${filtered.length} customers to CSV`
        : `Exported ${filtered.length} of ${customers.length} customers (filtered)`,
    );
  };

  const addPoints = (id: string, points: number) => {
    save(
      (customers || []).map((c) => {
        if (c.id === id) {
          const newPoints = (c.loyaltyPoints || 0) + points;
          return {
            ...c,
            loyaltyPoints: newPoints,
            tier: getTier(newPoints),
            lastVisit: new Date().toISOString().split("T")[0],
          };
        }
        return c;
      }),
    );
    showToast(
      `${points > 0 ? "Added" : "Deducted"} ${Math.abs(points)} points`,
    );
  };

  const redeem = (customerId: string, points: number) => {
    const c = (customers || []).find((x) => x.id === customerId);
    if (c && (c.loyaltyPoints || 0) < points) {
      showToast("Not enough points to redeem this reward");
      return;
    }
    save(
      (customers || []).map((c) =>
        c.id === customerId
          ? {
              ...c,
              loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - points),
            }
          : c,
      ),
    );
    showToast(`Redeemed ${points} points`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
            <Users size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Customer Loyalty
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Manage customers, points &amp; rewards
              {synced && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Synced
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCustomersCSV}
            disabled={customers.length === 0}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Export
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> Add Customer
          </button>
        </div>
      </div>

      {/* Inner sub-tabs */}
      <SubTabBar
        tabs={[
          { id: "customers", label: "Customers", icon: Users },
          { id: "segments", label: "Segments & Events", icon: Star },
          { id: "promos", label: "Promotions", icon: Sparkles },
          { id: "punchcards", label: "Punch Cards", icon: Gift },
          { id: "history", label: "Purchase History", icon: History },
          { id: "complaints", label: "Complaints", icon: MessageSquareWarning },
          { id: "tiers", label: "Loyalty Tiers", icon: Award },
        ]}
        active={innerView}
        onChange={(id) => setInnerView(id as typeof innerView)}
      />

      {innerView === "segments" ? (
        <CustomerSegments customers={customers} />
      ) : innerView === "promos" ? (
        <Promotions />
      ) : innerView === "punchcards" ? (
        <PunchCardLoyalty />
      ) : innerView === "complaints" ? (
        <CustomerComplaintsLog />
      ) : innerView === "tiers" ? (
        <LoyaltyTierConfig />
      ) : innerView === "history" ? (
        <CustomerPurchaseHistory />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Total Members</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                {customers.length}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Points Issued</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatNumber(totalPoints)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Avg. Spend</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {currencySymbol} {formatNumber(avgSpend)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Avg. Visits</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {customers.length > 0
                  ? (
                      customers.reduce(
                        (s, c) =>
                          s + (typeof c.visits === "number" ? c.visits : 0),
                        0,
                      ) / customers.length
                    ).toFixed(1)
                  : "0"}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            />
            <input
              type="text"
              placeholder="Search by name, phone, or vehicle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white"
            />
          </div>

          {/* Add Customer Modal */}
          {showAdd && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-900 dark:text-white mb-3">
                New Customer
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Full Name *"
                  value={newCustomer.name}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, name: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Phone *"
                  value={newCustomer.phone}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, phone: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Email"
                  value={newCustomer.email}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, email: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Vehicle Registration"
                  value={newCustomer.vehicleReg}
                  onChange={(e) =>
                    setNewCustomer({
                      ...newCustomer,
                      vehicleReg: e.target.value,
                    })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <select
                  value={newCustomer.preferredFuel}
                  onChange={(e) =>
                    setNewCustomer({
                      ...newCustomer,
                      preferredFuel: e.target.value,
                    })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                >
                  {(fuelTypeApi.activeFuelTypes.length > 0
                    ? fuelTypeApi.activeFuelTypes
                    : [
                        { name: "PMS", label: getFuelLabel("PMS") },
                        { name: "AGO", label: getFuelLabel("AGO") },
                      ]
                  ).map((ft) => (
                    <option key={ft.name} value={ft.name}>
                      {fuelTypeApi.labelOf(ft.name) || getFuelLabel(ft.name)}
                    </option>
                  ))}
                  <option value="Both">All Fuels</option>
                </select>
                <input
                  placeholder="Notes"
                  value={newCustomer.notes}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, notes: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={addCustomer}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium"
                >
                  Add Customer
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Customer Detail + Rewards */}
          {selectedCustomer && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 rounded-xl p-5 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center">
                      <User
                        size={24}
                        className="text-amber-700 dark:text-amber-300"
                      />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                        {selectedCustomer.name || "Unnamed"}
                      </h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${tierColor(
                          selectedCustomer.tier || "Bronze",
                        )}`}
                      >
                        {selectedCustomer.tier || "Bronze"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-600"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <Phone size={14} />
                    {selectedCustomer.phone ? (
                      <a
                        href={`tel:${selectedCustomer.phone}`}
                        className="hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                      >
                        {selectedCustomer.phone}
                      </a>
                    ) : (
                      ""
                    )}
                  </div>
                  {selectedCustomer.email && (
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <Mail size={14} />
                      <a
                        href={`mailto:${selectedCustomer.email}`}
                        className="hover:text-amber-600 dark:hover:text-amber-400 hover:underline break-all"
                      >
                        {selectedCustomer.email}
                      </a>
                    </div>
                  )}
                  {selectedCustomer.vehicleReg && (
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <MapPin size={14} />
                      {selectedCustomer.vehicleReg}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <Star size={14} className="text-amber-500" />
                    {formatNumber(selectedCustomer.loyaltyPoints || 0)} pts
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => addPoints(selectedCustomer.id, 100)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium"
                  >
                    +100 pts
                  </button>
                  <button
                    onClick={() => addPoints(selectedCustomer.id, 500)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium"
                  >
                    +500 pts
                  </button>
                  <button
                    onClick={() => addPoints(selectedCustomer.id, 1000)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium"
                  >
                    +1000 pts
                  </button>
                  <button
                    onClick={() => setShowRewards(!showRewards)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1"
                  >
                    <Gift size={12} /> Redeem
                  </button>
                </div>
                {/* Custom points input */}
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    placeholder="Custom pts (+/-)"
                    value={customPoints}
                    onChange={(e) => setCustomPoints(e.target.value)}
                    className="flex-1 px-3 py-1.5 border rounded-lg text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                  />
                  <button
                    onClick={() => addCustomPoints(selectedCustomer.id)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium"
                  >
                    Apply
                  </button>
                </div>
                {/* Stats: Total Spent, Visits, Join Date */}
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="bg-white/60 dark:bg-gray-700/40 rounded-lg p-2">
                    <p className="text-[10px] text-gray-500">Total Spent</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      {currencySymbol}
                      {formatNumber(selectedCustomer.totalSpent || 0)}
                    </p>
                  </div>
                  <div className="bg-white/60 dark:bg-gray-700/40 rounded-lg p-2">
                    <p className="text-[10px] text-gray-500">Visits</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      {selectedCustomer.visits || 0}
                    </p>
                  </div>
                  <div className="bg-white/60 dark:bg-gray-700/40 rounded-lg p-2">
                    <p className="text-[10px] text-gray-500">Joined</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      {selectedCustomer.joinDate || "-"}
                    </p>
                  </div>
                </div>
                {/* Notes */}
                {selectedCustomer.notes && (
                  <div className="mt-3 p-2 bg-white/60 dark:bg-gray-700/40 rounded-lg">
                    <p className="text-[10px] text-gray-500 mb-1">Notes</p>
                    <p className="text-xs text-gray-700 dark:text-gray-300">
                      {selectedCustomer.notes}
                    </p>
                  </div>
                )}
                {/* Edit / Delete */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setEditingCustomer(selectedCustomer)}
                    className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  >
                    <Edit2 size={12} /> Edit
                  </button>
                  <button
                    onClick={() => setDeleteId(selectedCustomer.id)}
                    className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
              {showRewards && (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-900 dark:text-white mb-3">
                    Available Rewards
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(REWARDS || []).map((r) => {
                      const canRedeem =
                        (selectedCustomer.loyaltyPoints || 0) >= r.points;
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center justify-between p-3 rounded-lg border ${canRedeem ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10" : "border-gray-200 dark:border-gray-700 opacity-50"}`}
                        >
                          <div>
                            <p className="text-sm font-medium dark:text-gray-900 dark:text-white">
                              {r.name}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {r.description}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold text-amber-600">
                              {r.points} pts
                            </p>
                            {canRedeem && (
                              <button
                                onClick={() =>
                                  redeem(selectedCustomer.id, r.points)
                                }
                                className="text-[10px] px-2 py-1 bg-green-600 text-gray-900 dark:text-white rounded mt-1"
                              >
                                Redeem
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Customers Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                  <Users
                    size={28}
                    className="text-amber-500 dark:text-amber-400"
                  />
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {customers.length === 0
                    ? "No customers yet"
                    : "No matching customers"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-1 mb-4">
                  {customers.length === 0
                    ? "Add your first customer to start tracking loyalty points and rewards."
                    : "Try adjusting your search terms."}
                </p>
                {customers.length === 0 && (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors"
                  >
                    <Plus size={16} /> Add Customer
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-4 py-3">Customer</th>
                      <th className="text-left px-4 py-3">Contact</th>
                      <th className="text-right px-4 py-3">Points</th>
                      <th className="text-right px-4 py-3">Spent</th>
                      <th className="text-center px-4 py-3">Tier</th>
                      <th className="text-right px-4 py-3">Visits</th>
                      <th className="text-center px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filtered || []).map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCustomer(c)}
                        className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium dark:text-gray-900 dark:text-white">
                            {c.name || ""}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {c.vehicleReg || ""}{" "}
                            {c.preferredFuel === "Both"
                              ? "All Fuels"
                              : fuelTypeApi.labelOf(c.preferredFuel) ||
                                getFuelLabel(c.preferredFuel)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                          {c.phone || ""}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                          {formatNumber(c.loyaltyPoints || 0)}
                        </td>
                        <td className="px-4 py-3 text-right dark:text-gray-900 dark:text-white">
                          {currencySymbol}
                          {formatNumber(c.totalSpent || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${tierColor(
                              c.tier || "Bronze",
                            )}`}
                          >
                            {c.tier || "Bronze"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right dark:text-gray-900 dark:text-white">
                          {c.visits || 0}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCustomer(c);
                                setShowRewards(true);
                              }}
                              className="p-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 rounded-lg text-amber-600"
                              title="Rewards"
                            >
                              <Gift size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const prefillPayload = {
                                  customerName: c.name || "",
                                  description: c.preferredFuel
                                    ? `${c.preferredFuel} fuel`
                                    : "",
                                };
                                console.log(
                                  "[CustomerLoyalty] Create Invoice clicked, prefill:",
                                  JSON.stringify(prefillPayload),
                                );
                                navigateToTab("invoice", prefillPayload);
                              }}
                              className="p-1.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 rounded-lg text-purple-600"
                              title="Create Invoice"
                            >
                              <FileText size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToTab("livetransaction", {
                                  phone: c.phone || "",
                                  account_reference:
                                    c.vehicleReg || c.name || "",
                                  transaction_desc: `Loyalty: ${c.name || ""}`,
                                  openStkPush: true,
                                });
                              }}
                              className="p-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 rounded-lg text-emerald-600"
                              title="Collect via M-PESA"
                            >
                              <CreditCard size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCustomer(c);
                              }}
                              className="p-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 rounded-lg text-blue-600"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteId(c.id);
                              }}
                              className="p-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 rounded-lg text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Edit Customer Modal */}
          {editingCustomer && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                    Edit Customer
                  </h3>
                  <button
                    onClick={() => setEditingCustomer(null)}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-600"
                  >
                    Close
                  </button>
                </div>
                <EditCustomerForm
                  customer={editingCustomer}
                  onSave={editCustomer}
                  onCancel={() => setEditingCustomer(null)}
                />
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deleteId && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xl max-w-sm w-full">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-900 dark:text-white mb-2">
                  Delete Customer?
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 mb-4">
                  This will permanently remove{" "}
                  <strong className="text-gray-700 dark:text-gray-200">
                    {customers.find((c) => c.id === deleteId)?.name ||
                      "Unknown"}
                  </strong>{" "}
                  and all their loyalty data. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteCustomer(deleteId)}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeleteId(null)}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Toast Notification */}
          {toast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 dark:bg-gray-700 text-gray-900 dark:text-white text-sm px-4 py-2 rounded-lg shadow-lg">
              {toast}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EditCustomerForm({
  customer,
  onSave,
  onCancel,
}: {
  customer: Customer;
  onSave: (c: Customer) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Customer>(customer);
  const fuelTypeApi = useStationFuelTypes();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          placeholder="Full Name *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        />
        <input
          placeholder="Phone *"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        />
        <input
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        />
        <input
          placeholder="Vehicle Registration"
          value={form.vehicleReg}
          onChange={(e) => setForm({ ...form, vehicleReg: e.target.value })}
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        />
        <select
          value={form.preferredFuel}
          onChange={(e) =>
            setForm({
              ...form,
              preferredFuel: e.target.value,
            })
          }
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        >
          {(fuelTypeApi.activeFuelTypes.length > 0
            ? fuelTypeApi.activeFuelTypes
            : [
                { name: "PMS", label: getFuelLabel("PMS") },
                { name: "AGO", label: getFuelLabel("AGO") },
              ]
          ).map((ft) => (
            <option key={ft.name} value={ft.name}>
              {fuelTypeApi.labelOf(ft.name) || getFuelLabel(ft.name)}
            </option>
          ))}
          <option value="Both">All Fuels</option>
        </select>
        <input
          type="number"
          placeholder="Loyalty Points"
          value={form.loyaltyPoints || 0}
          onChange={(e) =>
            setForm({ ...form, loyaltyPoints: parseInt(e.target.value) || 0 })
          }
          className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
        />
      </div>
      <textarea
        placeholder="Notes"
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        rows={2}
        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(form)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium"
        >
          Save Changes
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function defaultCustomers(): Customer[] {
  return [];
}
