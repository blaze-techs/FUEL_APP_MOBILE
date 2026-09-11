import { useState, useEffect, useRef, useMemo } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { getCurrencySymbol } from "../lib/currency";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  onTabPayload,
  type ExpensePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import { emit } from "@/react-app/lib/automation-engine";
import {
  Receipt,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Calendar,
  Tag,
  TrendingDown,
  TrendingUp,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  Download,
  PieChart,
  DollarSign,
  FileText,
  Zap,
  Users,
  Wrench,
  Truck,
  Building2,
  ShoppingCart,
  BarChart3,
} from "lucide-react";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";

interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  receiptUrl?: string;
  approvedBy: string;
  status: "pending" | "approved" | "rejected";
  stationId: string;
  createdAt: string;
}

const STORAGE_KEY = "fuelpro_expenses_v2";
const CLOUD_KEY = "expenses_data";

const EXPENSE_CATEGORIES = [
  { value: "fuel_purchase", label: "Fuel Purchase", icon: Zap },
  { value: "salaries", label: "Salaries & Wages", icon: Users },
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "transport", label: "Transport & Logistics", icon: Truck },
  { value: "rent", label: "Rent & Utilities", icon: Building2 },
  { value: "supplies", label: "Office Supplies", icon: ShoppingCart },
  { value: "taxes", label: "Taxes & Licenses", icon: Receipt },
  { value: "other", label: "Other", icon: FileText },
];

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "M-PESA", "Card", "Cheque"];

const VALID_STATUSES: Expense["status"][] = ["pending", "approved", "rejected"];
const VALID_CATEGORIES = EXPENSE_CATEGORIES.map((c) => c.value);

/**
 * Normalize an expense from cloud/localStorage so it always has every field
 * the UI expects. Cloud data may be partial (older app versions, API imports,
 * or cross-device sync where the record was created with a subset of fields).
 * Without this, rendering crashes with
 * "Cannot read properties of undefined (reading 'toLowerCase'/'toLocaleString')".
 */
function normalizeExpense(e: Partial<Expense> | null | undefined): Expense {
  const id =
    e?.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const status = VALID_STATUSES.includes(e?.status as Expense["status"])
    ? (e!.status as Expense["status"])
    : "pending";
  const category = VALID_CATEGORIES.includes(e?.category)
    ? e!.category
    : "other";
  return {
    id,
    date: e?.date ?? new Date().toISOString().slice(0, 10),
    category,
    description: e?.description ?? "",
    amount: typeof e?.amount === "number" ? e.amount : 0,
    paymentMethod: e?.paymentMethod ?? "Bank Transfer",
    reference: e?.reference ?? "",
    receiptUrl: e?.receiptUrl,
    approvedBy: e?.approvedBy ?? "",
    status,
    stationId: e?.stationId ?? "default",
    createdAt: e?.createdAt ?? new Date().toISOString(),
  };
}

function normalizeExpenses(arr: unknown): Expense[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((e) => normalizeExpense(e as Partial<Expense>));
}

function loadExpenses(): Expense[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeExpenses(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

export default function ExpenseTracker() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  // Resolve the currency symbol from the React-context station (not the
  // synchronous localStorage read) so it's correct on fresh devices before
  // the station data is written to localStorage, and for multi-currency
  // stations. Mirrors the SalesInvoices useCurrencySymbol pattern.
  const currencySymbol = useMemo(
    () =>
      getCurrencySymbol(
        (currentStation as any)?.companyCurrency ||
          (currentStation as any)?.currency,
      ),
    [currentStation],
  );
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "expenses_data",
      stationId,
    );
    if (Array.isArray(cloudCached)) return normalizeExpenses(cloudCached);
    return loadExpenses();
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [activeView, setActiveView] = useState<"list" | "analytics">("list");

  // Prevents the save effect from overwriting cloud data with default empty
  // state before the initial cloud load completes (cross-device overwrite race).
  const cloudLoadCompleteRef = useRef(false);

  // Guards against the real-time subscribe callback overwriting uncommitted
  // local changes. When the user adds/edits/deletes an expense, we set this
  // ref so the echo from our own cloud write doesn't wipe local state.
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagLocalModified = () => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 3000);
  };

  // Refs for post-load flush so the cloud write reads the latest state.
  const expensesRef = useRef(expenses);
  expensesRef.current = expenses;

  const [formData, setFormData] = useState<Partial<Expense>>({
    date: new Date().toISOString().slice(0, 10),
    category: "fuel_purchase",
    description: "",
    amount: 0,
    paymentMethod: "Bank Transfer",
    reference: "",
    approvedBy: "",
    status: "pending",
  });

  // Interlink receiver: PayrollSystem and MaintenanceTracker call
  // navigateToTab("expenses", <ExpensePrefill>) to record a payroll/maintenance
  // cost as an expense — open the form pre-filled with the category + amount.
  useEffect(() => {
    return onTabPayload("expenses", (raw) => {
      const p = (raw || {}) as ExpensePrefill;
      if (Object.keys(p).length === 0) return;
      setActiveView("list");
      setEditingId(null);
      setFormData({
        date: new Date().toISOString().slice(0, 10),
        category: p.category || "other",
        description: p.description || "",
        amount: p.amount ?? 0,
        paymentMethod: p.paymentMethod || "Bank Transfer",
        reference: p.reference || "",
        approvedBy: "",
        status: "pending",
      });
      setShowForm(true);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService.set(CLOUD_KEY, expenses, stationId).catch((err) => {
      console.error("ExpenseTracker cloud save failed:", err);
    });
  }, [expenses, stationId]);

  // Load from cloud on mount AND when the station changes (cross-device +
  // per-station sync). Each station has its own isolated expense set.
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await cloudStorageService.get<unknown>(
          CLOUD_KEY,
          stationId,
        );
        if (!cancelled) setExpenses(normalizeExpenses(cloud));
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    // Real-time cross-device sync: another device updates expenses_data.
    // Guard against echo overwrites: skip if we just made a local change.
    const unsub = cloudStorageService.subscribe<unknown>(
      CLOUD_KEY,
      stationId,
      (val) => {
        if (localModifiedRef.current) return;
        setExpenses(normalizeExpenses(val));
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set(CLOUD_KEY, expensesRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  useEffect(() => {
    return () => {
      if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    };
  }, []);

  const showNotification = (
    message: string,
    type: "success" | "warning" = "success",
  ) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const filtered = (expenses || []).filter((e) => {
    const matchesSearch =
      (e.description || "")
        .toLowerCase()
        .includes((searchTerm || "").toLowerCase()) ||
      (e.reference || "")
        .toLowerCase()
        .includes((searchTerm || "").toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || e.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesFrom = !dateRange.from || (e.date || "") >= dateRange.from;
    const matchesTo = !dateRange.to || (e.date || "") <= dateRange.to;
    return (
      matchesSearch &&
      matchesCategory &&
      matchesStatus &&
      matchesFrom &&
      matchesTo
    );
  });

  const totalExpenses = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const approvedTotal = filtered
    .filter((e) => e.status === "approved")
    .reduce((s, e) => s + (e.amount || 0), 0);
  const pendingTotal = filtered
    .filter((e) => e.status === "pending")
    .reduce((s, e) => s + (e.amount || 0), 0);

  const byCategory = (EXPENSE_CATEGORIES || [])
    .map((cat) => ({
      ...cat,
      total: filtered
        .filter((e) => e.category === cat.value)
        .reduce((s, e) => s + (e.amount || 0), 0),
      count: filtered.filter((e) => e.category === cat.value).length,
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Monthly budget (cloud-backed, cross-device)
  const [monthlyBudget, setMonthlyBudget] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("fuelpro_expense_budget");
      if (saved) return Number(JSON.parse(saved)) || 0;
    } catch {
      /* */
    }
    return 0;
  });
  const [budgetInput, setBudgetInput] = useState<string>(
    monthlyBudget > 0 ? String(monthlyBudget) : "",
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cloud = await cloudStorageService.get<number>(
        "expense_budget",
        stationId,
      );
      if (!cancelled && typeof cloud === "number" && cloud > 0) {
        setMonthlyBudget(cloud);
        setBudgetInput(String(cloud));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const saveBudget = () => {
    const val = Number(budgetInput) || 0;
    setMonthlyBudget(val);
    try {
      localStorage.setItem("fuelpro_expense_budget", JSON.stringify(val));
    } catch {
      /* */
    }
    cloudStorageService.set("expense_budget", val, stationId).catch(() => {});
    showNotification(val > 0 ? "Monthly budget saved" : "Budget cleared");
  };

  // Current-month spend
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthSpend = expenses
    .filter((e) => (e.date || "").startsWith(monthStr))
    .reduce((s, e) => s + (e.amount || 0), 0);
  const budgetPct =
    monthlyBudget > 0 ? Math.min(100, (monthSpend / monthlyBudget) * 100) : 0;
  const budgetRemaining = monthlyBudget - monthSpend;
  const overBudget = monthlyBudget > 0 && monthSpend > monthlyBudget;

  const handleSave = () => {
    if (!formData.description || !formData.amount) {
      showNotification("Description and amount are required", "warning");
      return;
    }
    const realStationId = currentStation?.id || "default";
    if (editingId) {
      flagLocalModified();
      setExpenses((prev) =>
        prev.map((e) =>
          e.id === editingId
            ? ({ ...e, ...formData, stationId: realStationId } as Expense)
            : e,
        ),
      );
      showNotification("Expense updated");
    } else {
      flagLocalModified();
      setExpenses((prev) => [
        {
          ...(formData as Expense),
          id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          stationId: realStationId,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      // Notify the automation engine that a new expense was recorded so it
      // can react (e.g. refresh dashboards, log shift totals). Emitted here
      // because the cloud sync below is fire-and-forget and we already have
      // the values locally — no need to await the storage write.
      emit({
        type: "expense:created",
        stationId: realStationId,
        amount: Number(formData.amount) || 0,
        category: formData.category || "",
      });
      showNotification("Expense added");
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this expense?")) {
      flagLocalModified();
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      showNotification("Expense deleted");
    }
  };

  const updateStatus = (id: string, newStatus: Expense["status"]) => {
    flagLocalModified();
    setExpenses((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e)),
    );
    showNotification(`Expense ${newStatus}`);
  };

  const statusColors: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-red-500/10 text-red-600 dark:text-red-400",
  };
  const DEFAULT_STATUS_COLOR =
    "bg-gray-500/10 text-gray-600 dark:text-gray-500 dark:text-gray-400";

  const catColors: Record<string, string> = {
    fuel_purchase: "text-amber-500",
    salaries: "text-blue-500",
    maintenance: "text-red-500",
    transport: "text-purple-500",
    rent: "text-green-500",
    supplies: "text-gray-500",
    taxes: "text-orange-500",
    other: "text-gray-500 dark:text-gray-400",
  };
  const DEFAULT_CAT_COLOR = "text-gray-500";

  return (
    <div className="p-4 md:p-6 space-y-4">
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
            <Receipt size={22} className="text-amber-500" /> Expense Tracker
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Track operational expenses and approvals
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("list")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "list" ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
          >
            Records
          </button>
          <button
            onClick={() => setActiveView("analytics")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "analytics" ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
          >
            Analytics
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} className="text-red-500" />
            <span className="text-xs text-gray-500">Total Expenses</span>
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            {currencySymbol} {(totalExpenses || 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="text-xs text-gray-500">Approved</span>
          </div>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {currencySymbol} {(approvedTotal || 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-xs text-gray-500">Pending</span>
          </div>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
            {currencySymbol} {(pendingTotal || 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Monthly Budget Alert */}
      {monthlyBudget > 0 && (
        <div
          className={`rounded-xl border p-4 ${overBudget ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800" : budgetPct >= 80 ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800" : "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"}`}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {overBudget ? (
                <AlertTriangle size={16} className="text-red-500" />
              ) : (
                <TrendingUp size={16} className="text-emerald-500" />
              )}
              <span
                className={`text-sm font-medium ${overBudget ? "text-red-700 dark:text-red-400" : budgetPct >= 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}
              >
                {overBudget
                  ? `Over budget by ${currencySymbol} ${Math.abs(budgetRemaining).toLocaleString()}`
                  : `${currencySymbol} ${budgetRemaining.toLocaleString()} remaining this month`}
              </span>
            </div>
            <span className="text-xs text-gray-500">
              {currencySymbol} {monthSpend.toLocaleString()} / {currencySymbol}{" "}
              {monthlyBudget.toLocaleString()} ({budgetPct.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 bg-white/50 dark:bg-gray-700/50 rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${overBudget ? "bg-red-500" : budgetPct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(budgetPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {activeView === "list" ? (
        <>
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
              />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search expenses..."
                className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-300 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-300 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setFormData({
                  date: new Date().toISOString().slice(0, 10),
                  category: "fuel_purchase",
                  description: "",
                  amount: 0,
                  paymentMethod: "Bank Transfer",
                  reference: "",
                  approvedBy: "",
                  status: "pending",
                });
              }}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
            >
              <Plus size={16} /> Add Expense
            </button>
            <button
              onClick={() => switchToTab("reports")}
              className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all"
              title="View expense breakdown in Reports"
            >
              <PieChart size={16} /> Reports
            </button>
            <button
              onClick={() => switchToTab("analytics")}
              className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all"
              title="View analytics dashboard"
            >
              <BarChart3 size={16} /> Analytics
            </button>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Ref
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(filtered || []).map((exp) => {
                    const CatIcon =
                      (EXPENSE_CATEGORIES || []).find(
                        (c) => c.value === exp.category,
                      )?.icon || FileText;
                    return (
                      <tr
                        key={exp.id || `exp_${Math.random()}`}
                        className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20"
                      >
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                          {(exp.date &&
                            new Date(exp.date).toLocaleDateString()) ||
                            "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <CatIcon
                              size={12}
                              className={
                                catColors[exp.category] || DEFAULT_CAT_COLOR
                              }
                            />
                            <span className="text-gray-700 dark:text-gray-300">
                              {(EXPENSE_CATEGORIES || []).find(
                                (c) => c.value === exp.category,
                              )?.label ||
                                exp.category ||
                                "Other"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-900 dark:text-white max-w-[200px] truncate">
                          {exp.description || ""}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                          {currencySymbol} {(exp.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[exp.status] || DEFAULT_STATUS_COLOR}`}
                          >
                            {exp.status || "pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                          {exp.reference || ""}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-1">
                            {exp.status === "pending" && (
                              <button
                                onClick={() => updateStatus(exp.id, "approved")}
                                className="px-2 py-1 bg-emerald-500/10 text-emerald-600 rounded text-[10px] hover:bg-emerald-500/20"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setEditingId(exp.id);
                                setFormData(exp);
                                setShowForm(true);
                              }}
                              className="p-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 rounded transition-colors"
                            >
                              <Edit3 size={10} />
                            </button>
                            <button
                              onClick={() => handleDelete(exp.id)}
                              className="p-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded transition-colors"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No expenses found
              </div>
            )}
          </div>
        </>
      ) : (
        /* Analytics View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Monthly Budget Setter */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500" /> Monthly
              Budget
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                min={0}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="Set monthly expense budget (0 = none)"
                className="flex-1 min-w-[200px] px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
              <button
                onClick={saveBudget}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
              >
                <Save size={14} /> Save Budget
              </button>
            </div>
            {monthlyBudget > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Current month spend:{" "}
                <span
                  className={`font-medium ${overBudget ? "text-red-500" : "text-emerald-500"}`}
                >
                  {currencySymbol} {monthSpend.toLocaleString()}
                </span>{" "}
                of {currencySymbol} {monthlyBudget.toLocaleString()} budget.{" "}
                {overBudget
                  ? "Over budget — review expenses."
                  : `${currencySymbol} ${budgetRemaining.toLocaleString()} remaining.`}
              </p>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <PieChart size={14} className="text-amber-500" /> By Category
            </h3>
            <div className="space-y-3">
              {(byCategory || []).map((cat) => {
                const CatIcon = cat.icon;
                const pct =
                  totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
                return (
                  <div key={cat.value}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                        <CatIcon size={12} /> {cat.label}
                      </span>
                      <span className="text-gray-900 dark:text-gray-900 dark:text-white font-medium">
                        {currencySymbol} {(cat.total || 0).toLocaleString()} (
                        {(pct || 0).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {byCategory.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No data
                </p>
              )}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500" /> Summary
            </h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-xs text-gray-500">Total Records</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  {filtered.length}
                </p>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {currencySymbol} {(approvedTotal || 0).toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-lg">
                <p className="text-xs text-gray-500">Pending Approval</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {currencySymbol} {(pendingTotal || 0).toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-500/10 rounded-lg">
                <p className="text-xs text-gray-500">Average per Expense</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {currencySymbol}{" "}
                  {filtered.length > 0
                    ? Math.round(
                        (totalExpenses || 0) / filtered.length,
                      ).toLocaleString()
                    : "0"}
                </p>
              </div>
              {byCategory.length > 0 && (
                <div className="p-3 bg-violet-50 dark:bg-violet-500/10 rounded-lg">
                  <p className="text-xs text-gray-500">Top Category</p>
                  <p className="text-lg font-bold text-violet-600 dark:text-violet-400">
                    {byCategory[0].label}
                  </p>
                  <p className="text-xs text-gray-500">
                    {currencySymbol}{" "}
                    {(byCategory[0].total || 0).toLocaleString()} ·{" "}
                    {byCategory[0].count} entr
                    {byCategory[0].count !== 1 ? "ies" : "y"}
                  </p>
                </div>
              )}
              {monthlyBudget > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                  <p className="text-xs text-gray-500">
                    Budget Utilization ({currencySymbol}
                    {(monthlyBudget || 0).toLocaleString()})
                  </p>
                  <div className="mt-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(totalExpenses || 0) > monthlyBudget ? "bg-red-500" : (totalExpenses || 0) > monthlyBudget * 0.8 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{
                        width: `${Math.min(100, ((totalExpenses || 0) / monthlyBudget) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs mt-1 text-gray-500">
                    {Math.min(
                      100,
                      ((totalExpenses || 0) / monthlyBudget) * 100,
                    ).toFixed(0)}
                    % used
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  {editingId ? "Edit" : "New"} Expense
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Date
                    </label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) =>
                        setFormData({ ...formData, date: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Amount ({currencySymbol}) *
                    </label>
                    <input
                      type="number"
                      value={formData.amount || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          amount: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Category
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) =>
                        setFormData({ ...formData, category: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Payment Method
                    </label>
                    <select
                      value={formData.paymentMethod}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          paymentMethod: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Description *
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Reference #
                    </label>
                    <input
                      value={formData.reference}
                      onChange={(e) =>
                        setFormData({ ...formData, reference: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Approved By
                    </label>
                    <input
                      value={formData.approvedBy}
                      onChange={(e) =>
                        setFormData({ ...formData, approvedBy: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
