import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { getCurrencySymbol } from "../lib/currency";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { getFuelLabel } from "@/react-app/config/pricing";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  Truck,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Phone,
  Mail,
  MapPin,
  Fuel,
  Package,
  Star,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShoppingCart,
} from "lucide-react";
import PurchasesSuppliers from "@/react-app/components/PurchasesSuppliers";
import SupplierContractRegister from "@/react-app/components/SupplierContractRegister";
import SupplierScorecard from "@/react-app/components/SupplierScorecard";

interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  fuelTypes: string[];
  rating: number;
  status: "active" | "inactive" | "blacklisted";
  creditLimit: number;
  currentBalance: number;
  deliveryDays: string;
  notes: string;
  createdAt: string;
  lastOrderAt?: string;
}

interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  fuelType: string;
  liters: number;
  pricePerLiter: number;
  total: number;
  status: "pending" | "confirmed" | "delivered" | "cancelled";
  orderDate: string;
  expectedDate: string;
  actualDate?: string;
  notes: string;
}

const STORAGE_KEY = "fuelpro_suppliers_v2";
const ORDERS_KEY = "fuelpro_purchase_orders_v2";

/**
 * Normalize a supplier from cloud/localStorage so it always has every field
 * the UI expects. Cloud data may be partial (from older app versions, API
 * imports, or cross-device sync where the record was created with a subset of
 * fields). Without this, rendering crashes with
 * "Cannot read properties of undefined (reading 'map')" etc.
 */
function normalizeSupplier(s: Partial<Supplier> | null | undefined): Supplier {
  const id =
    s?.id || `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: s?.name ?? "",
    contactPerson: s?.contactPerson ?? "",
    phone: s?.phone ?? "",
    email: s?.email ?? "",
    address: s?.address ?? "",
    fuelTypes: Array.isArray(s?.fuelTypes) ? s.fuelTypes : [],
    rating: typeof s?.rating === "number" ? s.rating : 3,
    status: s?.status ?? "active",
    creditLimit: typeof s?.creditLimit === "number" ? s.creditLimit : 0,
    currentBalance:
      typeof s?.currentBalance === "number" ? s.currentBalance : 0,
    deliveryDays: s?.deliveryDays ?? "",
    notes: s?.notes ?? "",
    createdAt: s?.createdAt ?? new Date().toISOString(),
    lastOrderAt: s?.lastOrderAt,
  };
}

function normalizePurchaseOrder(
  o: Partial<PurchaseOrder> | null | undefined,
): PurchaseOrder {
  const id =
    o?.id || `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    supplierId: o?.supplierId ?? "",
    supplierName: o?.supplierName ?? "",
    fuelType: o?.fuelType ?? "",
    liters: typeof o?.liters === "number" ? o.liters : 0,
    pricePerLiter: typeof o?.pricePerLiter === "number" ? o.pricePerLiter : 0,
    total: typeof o?.total === "number" ? o.total : 0,
    status: o?.status ?? "pending",
    orderDate: o?.orderDate ?? new Date().toISOString(),
    expectedDate: o?.expectedDate ?? "",
    actualDate: o?.actualDate,
    notes: o?.notes ?? "",
  };
}

function normalizeSuppliers(arr: unknown): Supplier[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => normalizeSupplier(s as Partial<Supplier>));
}

function normalizeOrders(arr: unknown): PurchaseOrder[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => normalizePurchaseOrder(o as Partial<PurchaseOrder>));
}

function loadSuppliers(): Supplier[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeSuppliers(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

function loadOrders(): PurchaseOrder[] {
  try {
    const saved = localStorage.getItem(ORDERS_KEY);
    if (saved) return normalizeOrders(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

export default function SupplierManagement() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id || "default";
  const { user } = useAuth();
  // Resolve currency from React-context station (not synchronous localStorage)
  // so it's correct on fresh devices / multi-currency stations.
  const currencySymbol = useMemo(
    () =>
      getCurrencySymbol(
        (currentStation as any)?.companyCurrency ||
          (currentStation as any)?.currency,
      ),
    [currentStation],
  );
  // Unified station fuel types — so supplier fuel-type checkboxes & the
  // purchase-order fuel dropdown reflect the station's actual configured fuels
  // (from Fuel Type Manager) instead of a hardcoded list.
  const fuelTypeApi = useStationFuelTypes(stationId);
  const fuelTypeOptions = useMemo(() => {
    const fromConfig = fuelTypeApi.activeFuelTypes.map((ft) =>
      getFuelLabel(ft.name),
    );
    // Merge with legacy fallbacks so a station with no fuel_types_config still
    // has options; dedupe case-insensitively.
    const legacy = ["Petrol", "Diesel", "Premium", "Kerosene", "LPG"];
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const f of [...fromConfig, ...legacy]) {
      const key = f.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(f);
      }
    }
    return merged;
  }, [fuelTypeApi.activeFuelTypes]);

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "suppliers_data",
      stationId,
    );
    if (Array.isArray(cloudCached)) return normalizeSuppliers(cloudCached);
    return loadSuppliers();
  });
  const [orders, setOrders] = useState<PurchaseOrder[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "purchase_orders",
      stationId,
    );
    if (Array.isArray(cloudCached)) return normalizeOrders(cloudCached);
    return loadOrders();
  });
  const [activeView, setActiveView] = useState<
    "suppliers" | "orders" | "purchases" | "contracts" | "scorecard"
  >("suppliers");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);

  const [formData, setFormData] = useState<Partial<Supplier>>({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    fuelTypes: [],
    rating: 3,
    status: "active",
    creditLimit: 0,
    currentBalance: 0,
    deliveryDays: "",
    notes: "",
  });

  const [orderForm, setOrderForm] = useState({
    fuelType: "Petrol",
    liters: 0,
    pricePerLiter: 0,
    total: 0,
    expectedDate: "",
    notes: "",
  });

  // Prevents save effects from overwriting cloud data with default state
  // before the initial cloud load completes (cross-device overwrite race).
  const cloudLoadCompleteRef = useRef(false);
  // Echo guard: prevents the real-time subscribe callback from overwriting
  // uncommitted local edits (the cloud write echoes back and wipes state).
  const localModifiedRef = useRef(false);
  const suppliersRef = useRef(suppliers);
  suppliersRef.current = suppliers;
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(suppliers));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService
      .set("suppliers_data", suppliers, stationId)
      .catch(() => {});
  }, [suppliers, stationId]);
  useEffect(() => {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService
      .set("purchase_orders", orders, stationId)
      .catch(() => {});
  }, [orders, stationId]);

  // Load from cloud on mount + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const cloudSuppliers = await cloudStorageService.get<unknown>(
          "suppliers_data",
          stationId,
        );
        if (!cancelled && !localModifiedRef.current)
          setSuppliers(normalizeSuppliers(cloudSuppliers));
        const cloudOrders = await cloudStorageService.get<unknown>(
          "purchase_orders",
          stationId,
        );
        if (!cancelled && !localModifiedRef.current)
          setOrders(normalizeOrders(cloudOrders));
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    // Real-time: when another device updates suppliers/orders, update instantly
    const unsubs = [
      cloudStorageService.subscribe<unknown>(
        "suppliers_data",
        stationId,
        (val) => {
          if (localModifiedRef.current) return;
          setSuppliers(normalizeSuppliers(val));
        },
      ),
      cloudStorageService.subscribe<unknown>(
        "purchase_orders",
        stationId,
        (val) => {
          if (localModifiedRef.current) return;
          setOrders(normalizeOrders(val));
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set("suppliers_data", suppliersRef.current, stationId)
        .catch(() => {});
      cloudStorageService
        .set("purchase_orders", ordersRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  const showNotification = (
    message: string,
    type: "success" | "warning" = "success",
  ) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const filteredSuppliers = suppliers.filter((s) => {
    const name = (s.name || "").toLowerCase();
    const contact = (s.contactPerson || "").toLowerCase();
    const phone = s.phone || "";
    const matchesSearch =
      name.includes(searchTerm.toLowerCase()) ||
      contact.includes(searchTerm.toLowerCase()) ||
      phone.includes(searchTerm);
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSave = () => {
    if (!formData.name || !formData.phone) {
      showNotification("Name and phone are required", "warning");
      return;
    }
    localModifiedRef.current = true;
    if (editingId) {
      setSuppliers((prev) =>
        prev.map((s) =>
          s.id === editingId ? ({ ...s, ...formData } as Supplier) : s,
        ),
      );
      showNotification("Supplier updated");
    } else {
      const newSupplier: Supplier = {
        ...(formData as Supplier),
        id: `sup_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setSuppliers((prev) => [...prev, newSupplier]);
      showNotification("Supplier added");
    }
    setShowForm(false);
    setEditingId(null);
    setFormData({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      fuelTypes: [],
      rating: 3,
      status: "active",
      creditLimit: 0,
      currentBalance: 0,
      deliveryDays: "",
      notes: "",
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this supplier?")) {
      localModifiedRef.current = true;
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      showNotification("Supplier deleted");
    }
  };

  const handlePlaceOrder = () => {
    if (!selectedSupplierId || !orderForm.liters || !orderForm.pricePerLiter) {
      showNotification("Please fill all required fields", "warning");
      return;
    }
    const supplier = suppliers.find((s) => s.id === selectedSupplierId);
    if (!supplier) return;
    localModifiedRef.current = true;
    const newOrder: PurchaseOrder = {
      id: `po_${Date.now()}`,
      supplierId: selectedSupplierId,
      supplierName: supplier.name,
      fuelType: orderForm.fuelType,
      liters: orderForm.liters,
      pricePerLiter: orderForm.pricePerLiter,
      total: orderForm.liters * orderForm.pricePerLiter,
      status: "pending",
      orderDate: new Date().toISOString(),
      expectedDate:
        orderForm.expectedDate ||
        new Date(Date.now() + 3 * 86400000).toISOString(),
      notes: orderForm.notes,
    };
    setOrders((prev) => [newOrder, ...prev]);
    // Update supplier balance
    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === selectedSupplierId
          ? {
              ...s,
              currentBalance: s.currentBalance + newOrder.total,
              lastOrderAt: new Date().toISOString(),
            }
          : s,
      ),
    );
    setShowOrderForm(false);
    setOrderForm({
      fuelType: "Petrol",
      liters: 0,
      pricePerLiter: 0,
      total: 0,
      expectedDate: "",
      notes: "",
    });
    showNotification("Purchase order placed");
  };

  const updateOrderStatus = (
    orderId: string,
    newStatus: PurchaseOrder["status"],
  ) => {
    localModifiedRef.current = true;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: newStatus,
              actualDate:
                newStatus === "delivered"
                  ? new Date().toISOString()
                  : o.actualDate,
            }
          : o,
      ),
    );
    showNotification(`Order ${newStatus}`);
  };

  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    inactive:
      "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20",
    blacklisted: "bg-red-500/10 text-red-400 border-red-500/20",
    pending: "bg-amber-500/10 text-amber-400",
    confirmed: "bg-blue-500/10 text-blue-400",
    delivered: "bg-emerald-500/10 text-emerald-400",
    cancelled: "bg-red-500/10 text-red-400",
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 ${notification.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}
        >
          {notification.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span className="text-sm">{notification.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
            <Truck size={22} className="text-amber-500" /> Supplier Management
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {suppliers.length} suppliers &middot; {orders.length} orders
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setActiveView("suppliers");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "suppliers" ? "bg-amber-500 text-gray-900 dark:text-white shadow-lg" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
          >
            Suppliers
          </button>
          <button
            onClick={() => {
              setActiveView("orders");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "orders" ? "bg-amber-500 text-gray-900 dark:text-white shadow-lg" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => {
              setActiveView("purchases");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${activeView === "purchases" ? "bg-amber-500 text-gray-900 dark:text-white shadow-lg" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
          >
            <ShoppingCart size={14} />
            Purchases
          </button>
          <button
            onClick={() => {
              setActiveView("contracts");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "contracts" ? "bg-amber-500 text-gray-900 dark:text-white shadow-lg" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
          >
            Contracts
          </button>
          <button
            onClick={() => {
              setActiveView("scorecard");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "scorecard" ? "bg-amber-500 text-gray-900 dark:text-white shadow-lg" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
          >
            Scorecard
          </button>
          <button
            onClick={() => switchToTab("delivery")}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
          >
            <Truck size={14} />
            Deliveries
          </button>
          <button
            onClick={() => switchToTab("offloading")}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
          >
            <Truck size={14} />
            Offloading
          </button>
        </div>
      </div>

      {activeView === "purchases" ? (
        <PurchasesSuppliers />
      ) : activeView === "contracts" ? (
        <SupplierContractRegister />
      ) : activeView === "scorecard" ? (
        <SupplierScorecard />
      ) : activeView === "suppliers" ? (
        <>
          {/* Supplier Summary Stats */}
          {suppliers.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
                <p className="text-[10px] text-gray-500">Total Suppliers</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  {suppliers.length}
                </p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">Active</p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {suppliers.filter((s) => s.status === "active").length}
                </p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">Avg Rating</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  {suppliers.length > 0
                    ? (
                        suppliers.reduce((s, x) => s + (x.rating || 0), 0) /
                        suppliers.length
                      ).toFixed(1)
                    : "0"}
                  ★
                </p>
              </div>
              <div className="bg-red-50 dark:bg-red-500/10 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">Blacklisted</p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                  {suppliers.filter((s) => s.status === "blacklisted").length}
                </p>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
              />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search suppliers..."
                className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blacklisted">Blacklisted</option>
            </select>
            <button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setFormData({
                  name: "",
                  contactPerson: "",
                  phone: "",
                  email: "",
                  address: "",
                  fuelTypes: [],
                  rating: 3,
                  status: "active",
                  creditLimit: 0,
                  currentBalance: 0,
                  deliveryDays: "",
                  notes: "",
                });
              }}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
            >
              <Plus size={16} /> Add Supplier
            </button>
          </div>

          {/* Supplier Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center">
                        <Truck
                          size={18}
                          className="text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                          {supplier.name}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {supplier.contactPerson}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusColors[supplier.status] || statusColors.inactive}`}
                    >
                      {supplier.status}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <Phone size={12} /> {supplier.phone}
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <Mail size={12} /> {supplier.email || "N/A"}
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <MapPin size={12} /> {supplier.address || "N/A"}
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <Clock size={12} /> {supplier.deliveryDays}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {(supplier.fuelTypes || []).map((ft) => (
                      <span
                        key={ft}
                        className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md text-[10px] font-medium flex items-center gap-1"
                      >
                        <Fuel size={10} /> {ft}
                      </span>
                    ))}
                  </div>

                  {/* Credit info */}
                  <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">
                        Credit: {currencySymbol}{" "}
                        {(supplier.creditLimit || 0).toLocaleString()}
                      </span>
                      <span className="text-gray-500">
                        Balance: {currencySymbol}{" "}
                        {(supplier.currentBalance || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{
                          width: `${Math.min(((supplier.currentBalance || 0) / Math.max(supplier.creditLimit || 0, 1)) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setExpandedId(
                          expandedId === supplier.id ? null : supplier.id,
                        );
                      }}
                      className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-300 transition-colors flex items-center justify-center gap-1"
                    >
                      {expandedId === supplier.id ? (
                        <>
                          <ChevronUp size={12} /> Less
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} /> Details
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedSupplierId(supplier.id);
                        setShowOrderForm(true);
                      }}
                      className="flex-1 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                    >
                      <Package size={12} /> Order
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(supplier.id);
                        setFormData(supplier);
                        setShowForm(true);
                      }}
                      className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 rounded-lg transition-colors"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(supplier.id)}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-lg transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedId === supplier.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-500">Rating:</span>{" "}
                        <span className="text-amber-500">
                          {"★".repeat(Math.round(supplier.rating || 0))}
                          {"☆".repeat(5 - Math.round(supplier.rating || 0))}
                        </span>{" "}
                        ({supplier.rating || 0})
                      </div>
                      <div>
                        <span className="text-gray-500">Created:</span>{" "}
                        {supplier.createdAt
                          ? new Date(supplier.createdAt).toLocaleDateString()
                          : "—"}
                      </div>
                      {supplier.lastOrderAt && (
                        <div>
                          <span className="text-gray-500">Last Order:</span>{" "}
                          {new Date(supplier.lastOrderAt).toLocaleDateString()}
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">Available Credit:</span>{" "}
                        {currencySymbol}{" "}
                        {(
                          supplier.creditLimit - supplier.currentBalance
                        ).toLocaleString()}
                      </div>
                    </div>
                    {supplier.notes && (
                      <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
                        <FileText size={10} className="inline mr-1" />{" "}
                        {supplier.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredSuppliers.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <Truck size={48} className="mx-auto mb-3 opacity-30" />
              <p>No suppliers found</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-2 text-amber-500 text-sm hover:underline"
              >
                Add your first supplier
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Orders view */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedSupplierId("");
                setShowOrderForm(true);
              }}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
            >
              <Plus size={16} /> New Purchase Order
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Order ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Fuel
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Liters
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Total
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Expected
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
                        {order.id.slice(-6)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-900 dark:text-white font-medium">
                        {order.supplierName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded text-[10px]">
                          {order.fuelType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                        {order.liters.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                        {currencySymbol} {order.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[order.status] || statusColors.pending}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-500 dark:text-gray-400">
                        {new Date(order.expectedDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          {order.status === "pending" && (
                            <button
                              onClick={() =>
                                updateOrderStatus(order.id, "confirmed")
                              }
                              className="px-2 py-1 bg-blue-500/10 text-blue-600 rounded text-[10px] hover:bg-blue-500/20"
                            >
                              Confirm
                            </button>
                          )}
                          {order.status === "confirmed" && (
                            <button
                              onClick={() =>
                                updateOrderStatus(order.id, "delivered")
                              }
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 rounded text-[10px] hover:bg-emerald-500/20"
                            >
                              Receive
                            </button>
                          )}
                          {(order.status === "pending" ||
                            order.status === "confirmed") && (
                            <button
                              onClick={() =>
                                updateOrderStatus(order.id, "cancelled")
                              }
                              className="px-2 py-1 bg-red-500/10 text-red-600 rounded text-[10px] hover:bg-red-500/20"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {orders.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No purchase orders yet
              </div>
            )}
          </div>
        </>
      )}

      {/* Supplier Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  {editingId ? "Edit Supplier" : "Add Supplier"}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Company Name *
                  </label>
                  <input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Contact Person
                    </label>
                    <input
                      value={formData.contactPerson}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contactPerson: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Phone *
                    </label>
                    <input
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Email
                    </label>
                    <input
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Delivery Time
                    </label>
                    <input
                      value={formData.deliveryDays}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          deliveryDays: e.target.value,
                        })
                      }
                      placeholder="e.g. 3-5 days"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Address
                  </label>
                  <input
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Fuel Types Supplied
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {fuelTypeOptions.map((ft) => (
                      <button
                        key={ft}
                        onClick={() =>
                          setFormData({
                            ...formData,
                            fuelTypes: formData.fuelTypes?.includes(ft)
                              ? formData.fuelTypes.filter((f) => f !== ft)
                              : [...(formData.fuelTypes || []), ft],
                          })
                        }
                        className={`px-3 py-1 rounded-lg text-xs border transition-all ${formData.fuelTypes?.includes(ft) ? "bg-amber-500 text-gray-900 dark:text-white border-amber-500" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"}`}
                      >
                        {ft}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Credit Limit
                    </label>
                    <input
                      type="number"
                      value={formData.creditLimit}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          creditLimit: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Rating (1-5)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      step={0.5}
                      value={formData.rating}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rating: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <button
                  onClick={handleSave}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} /> {editingId ? "Update" : "Save"} Supplier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Form Modal */}
      {showOrderForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  New Purchase Order
                </h3>
                <button
                  onClick={() => setShowOrderForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Supplier
                  </label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers
                      .filter((s) => s.status === "active")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (Credit: {currencySymbol}{" "}
                          {(s.creditLimit - s.currentBalance).toLocaleString()})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Fuel Type
                  </label>
                  <select
                    value={orderForm.fuelType}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, fuelType: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  >
                    {fuelTypeOptions.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Liters
                    </label>
                    <input
                      type="number"
                      value={orderForm.liters || ""}
                      onChange={(e) =>
                        setOrderForm({
                          ...orderForm,
                          liters: Number(e.target.value),
                          total:
                            Number(e.target.value) * orderForm.pricePerLiter,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Price/Liter ({currencySymbol})
                    </label>
                    <input
                      type="number"
                      value={orderForm.pricePerLiter || ""}
                      onChange={(e) =>
                        setOrderForm({
                          ...orderForm,
                          pricePerLiter: Number(e.target.value),
                          total: orderForm.liters * Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                {orderForm.total > 0 && (
                  <div className="p-3 bg-amber-500/10 rounded-lg text-center">
                    <span className="text-sm text-gray-500">Total: </span>
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      {currencySymbol} {orderForm.total.toLocaleString()}
                    </span>
                  </div>
                )}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Expected Delivery
                  </label>
                  <input
                    type="date"
                    value={orderForm.expectedDate}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        expectedDate: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Notes
                  </label>
                  <textarea
                    value={orderForm.notes}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, notes: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <button
                  onClick={handlePlaceOrder}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  <Package size={16} /> Place Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
