import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation } from "@/react-app/context/LocationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  CreditCard,
  Plus,
  Search,
  AlertTriangle,
  BellRing,
  Smartphone,
  FileText,
  Trash2,
  History,
  CheckCircle2,
  Truck,
  Share,
  CalendarClock,
  Tag,
} from "lucide-react";
import FleetCards from "@/react-app/components/FleetCards";
import FleetTelemetry from "@/react-app/components/FleetTelemetry";
import FarmFuelEquipment from "@/react-app/components/FarmFuelEquipment";
import FleetEmissionsTracker from "@/react-app/components/FleetEmissionsTracker";
import CustomerStatement from "@/react-app/components/CustomerStatement";
import CreditCustomerPortal from "@/react-app/components/CreditCustomerPortal";
import CreditAgingReport from "@/react-app/components/CreditAgingReport";
import CustomerPriceLists from "@/react-app/components/CustomerPriceLists";
import { formatNumber } from "@/react-app/utils/formatUtils";
import SubTabBar from "@/react-app/components/SubTabBar";
import DebtReminder from "@/react-app/components/DebtReminder";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";
import {
  navigateToTab,
  onTabPayload,
  type StkPushPrefill,
  type InvoicePrefill,
  type CreditPrefill,
} from "@/react-app/lib/mpesa-integration-service";

interface CreditAccount {
  id: string;
  customerName: string;
  phone: string;
  vehicleReg: string;
  creditLimit: number;
  balanceUsed: number;
  status: "active" | "suspended" | "blacklisted";
  paymentTerms: number; // days
  lastPayment: string;
  totalPayments: number;
  totalPurchases: number;
  notes: string;
  createdDate: string;
}

interface CreditTransaction {
  id: string;
  accountId: string;
  type: "purchase" | "payment";
  amount: number;
  description: string;
  date: string;
  recordedBy: string;
}

/**
 * Cloud-loaded records (credit_accounts / credit_transactions) may be partial
 * or malformed, which previously crashed the UI ("Cannot read properties of
 * undefined" on .toLowerCase()/.includes()/.map()). These normalizers fill
 * every field with safe defaults so render-time access never throws.
 */
function normalizeCreditAccount(
  a: Partial<CreditAccount> | null | undefined,
): CreditAccount {
  const id =
    a?.id || `ca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    customerName: a?.customerName ?? "",
    phone: a?.phone ?? "",
    vehicleReg: a?.vehicleReg ?? "",
    creditLimit: typeof a?.creditLimit === "number" ? a.creditLimit : 0,
    balanceUsed: typeof a?.balanceUsed === "number" ? a.balanceUsed : 0,
    status: a?.status ?? "active",
    paymentTerms: typeof a?.paymentTerms === "number" ? a.paymentTerms : 0,
    lastPayment: a?.lastPayment ?? "",
    totalPayments: typeof a?.totalPayments === "number" ? a.totalPayments : 0,
    totalPurchases:
      typeof a?.totalPurchases === "number" ? a.totalPurchases : 0,
    notes: a?.notes ?? "",
    createdDate: a?.createdDate ?? new Date().toISOString().split("T")[0],
  };
}

function normalizeCreditTransaction(
  t: Partial<CreditTransaction> | null | undefined,
): CreditTransaction {
  const id =
    t?.id || `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    accountId: t?.accountId ?? "",
    type: t?.type === "purchase" || t?.type === "payment" ? t.type : "payment",
    amount: typeof t?.amount === "number" ? t.amount : 0,
    description: t?.description ?? "",
    date: t?.date ?? new Date().toISOString(),
    recordedBy: t?.recordedBy ?? "",
  };
}

function normalizeCreditAccounts(arr: unknown): CreditAccount[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((a) => normalizeCreditAccount(a as Partial<CreditAccount>));
}

function normalizeCreditTransactions(arr: unknown): CreditTransaction[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) =>
    normalizeCreditTransaction(t as Partial<CreditTransaction>),
  );
}

function loadAccounts(): CreditAccount[] {
  try {
    const saved = localStorage.getItem("fuelpro_credit_accounts");
    if (saved) return normalizeCreditAccounts(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return defaultAccounts();
}

function loadTransactions(): CreditTransaction[] {
  try {
    const saved = localStorage.getItem("fuelpro_credit_tx");
    if (saved) return normalizeCreditTransactions(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

export default function CreditManagement() {
  const location = useLocation();
  const currencySymbol = location.currencySymbol;
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  // Inner sub-tab: Accounts (credit accounts) vs Fleet & Cards vs Reminders
  // (debt payment reminders — formerly the standalone "Fuel Debt Payment
  // Reminder" tab; fleet/corporate fuel cards from Shell Fleet / Pesapal).
  const [activeView, setActiveView] = useState<
    | "accounts"
    | "fleet"
    | "reminders"
    | "statements"
    | "portal"
    | "aging"
    | "pricelists"
  >("accounts");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("credit", setActiveView);
  const [accounts, setAccounts] = useState<CreditAccount[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "credit_accounts",
      stationId,
    );
    if (Array.isArray(cloudCached)) return normalizeCreditAccounts(cloudCached);
    return loadAccounts();
  });
  const [transactions, setTransactions] = useState<CreditTransaction[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "credit_transactions",
      stationId,
    );
    if (Array.isArray(cloudCached))
      return normalizeCreditTransactions(cloudCached);
    return loadTransactions();
  });
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showPay, setShowPay] = useState<string | null>(null);
  const [showPurchase, setShowPurchase] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newAcc, setNewAcc] = useState({
    customerName: "",
    phone: "",
    vehicleReg: "",
    creditLimit: 10000,
    paymentTerms: 30,
    notes: "",
  });
  const [payForm, setPayForm] = useState({ amount: 0, description: "" });
  const [purchaseForm, setPurchaseForm] = useState({
    amount: 0,
    description: "",
  });

  // Race-condition guard: prevents the async cloud-load effect from
  // overwriting local state (saveAcc/saveTx) before the load completes,
  // and prevents the real-time echo from wiping uncommitted local edits.
  // Without this, switching to the tab shows cached data for a glimpse
  // then the cloud load wipes it (the "flash then blank" bug).
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;

  const flagLocalModified = () => {
    localModifiedRef.current = true;
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const recorderName = user?.name || user?.email?.split("@")[0] || "System";

  // Interlink receiver: Live Transaction Monitor calls
  // navigateToTab("credit", <CreditPrefill>) from a completed payment's
  // "Apply to Credit Account" action — open the new-account form pre-filled
  // with the sender + amount so the payment can be recorded as a credit.
  useEffect(() => {
    return onTabPayload("credit", (raw) => {
      const p = (raw || {}) as CreditPrefill;
      if (Object.keys(p).length === 0) return;
      setActiveView("accounts");
      setNewAcc((prev) => ({
        ...prev,
        customerName: p.customerName || prev.customerName,
        phone: p.phone || prev.phone,
      }));
      setPayForm((prev) => ({
        ...prev,
        amount: p.amount ?? prev.amount,
        description: p.amount
          ? `Incoming payment ${p.amount}`
          : prev.description,
      }));
      setShowAdd(true);
    });
  }, []);

  const saveAcc = (a: CreditAccount[]) => {
    flagLocalModified();
    setAccounts(a);
    localStorage.setItem("fuelpro_credit_accounts", JSON.stringify(a));
    if (cloudLoadCompleteRef.current)
      cloudStorageService.set("credit_accounts", a, stationId).catch(() => {});
  };
  const saveTx = (t: CreditTransaction[]) => {
    flagLocalModified();
    setTransactions(t);
    localStorage.setItem("fuelpro_credit_tx", JSON.stringify(t));
    if (cloudLoadCompleteRef.current)
      cloudStorageService
        .set("credit_transactions", t, stationId)
        .catch(() => {});
  };

  // Load from cloud on mount + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      const cloudAccounts = await cloudStorageService.get<CreditAccount[]>(
        "credit_accounts",
        stationId,
      );
      if (!cancelled && cloudAccounts && !localModifiedRef.current)
        setAccounts(normalizeCreditAccounts(cloudAccounts));
      const cloudTx = await cloudStorageService.get<CreditTransaction[]>(
        "credit_transactions",
        stationId,
      );
      if (!cancelled && cloudTx && !localModifiedRef.current)
        setTransactions(normalizeCreditTransactions(cloudTx));
      if (!cancelled) cloudLoadCompleteRef.current = true;
    })();
    // Real-time: when another device updates accounts/transactions, update instantly
    const unsubs = [
      cloudStorageService.subscribe<CreditAccount[]>(
        "credit_accounts",
        stationId,
        (val) => {
          if (!val || localModifiedRef.current) return;
          setAccounts(normalizeCreditAccounts(val));
        },
      ),
      cloudStorageService.subscribe<CreditTransaction[]>(
        "credit_transactions",
        stationId,
        (val) => {
          if (!val || localModifiedRef.current) return;
          setTransactions(normalizeCreditTransactions(val));
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
        .set("credit_accounts", accountsRef.current, stationId)
        .catch(() => {});
      cloudStorageService
        .set("credit_transactions", transactionsRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        (a.customerName || "").toLowerCase().includes(q) ||
        (a.phone || "").includes(q) ||
        (a.vehicleReg || "").toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const totalCredit = accounts.reduce(
    (s, a) => s + (typeof a.creditLimit === "number" ? a.creditLimit : 0),
    0,
  );
  const totalUsed = accounts.reduce(
    (s, a) => s + (typeof a.balanceUsed === "number" ? a.balanceUsed : 0),
    0,
  );
  const overdue = accounts.filter((a) => {
    const balanceUsed = typeof a.balanceUsed === "number" ? a.balanceUsed : 0;
    if (balanceUsed <= 0) return false;
    const lp = a.lastPayment || "";
    const lpTime = lp ? new Date(lp).getTime() : 0;
    if (isNaN(lpTime)) return false;
    const terms = typeof a.paymentTerms === "number" ? a.paymentTerms : 0;
    return new Date().getTime() - lpTime > terms * 86400000;
  });

  const addAccount = () => {
    if (!newAcc.customerName.trim()) {
      showToast("Please enter a customer name");
      return;
    }
    const acc: CreditAccount = {
      id: `ca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...newAcc,
      balanceUsed: 0,
      status: "active",
      totalPayments: 0,
      totalPurchases: 0,
      lastPayment: new Date().toISOString().split("T")[0],
      createdDate: new Date().toISOString().split("T")[0],
    };
    saveAcc([acc, ...accounts]);
    setShowAdd(false);
    showToast(`Credit account created for ${acc.customerName}`);
    setNewAcc({
      customerName: "",
      phone: "",
      vehicleReg: "",
      creditLimit: 10000,
      paymentTerms: 30,
      notes: "",
    });
  };

  const deleteAccount = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    saveAcc(accounts.filter((a) => a.id !== accountId));
    saveTx(transactions.filter((t) => t.accountId !== accountId));
    setDeleteId(null);
    showToast(`Deleted account: ${acc?.customerName || "Unknown"}`);
  };

  const setStatus = (accountId: string, status: CreditAccount["status"]) => {
    saveAcc(accounts.map((a) => (a.id === accountId ? { ...a, status } : a)));
    showToast(`Account status set to ${status}`);
  };

  const addPayment = (accountId: string) => {
    if (payForm.amount <= 0) {
      showToast("Please enter a valid payment amount");
      return;
    }
    const tx: CreditTransaction = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      accountId,
      type: "payment",
      amount: payForm.amount,
      description: payForm.description || "Payment received",
      date: new Date().toISOString(),
      recordedBy: recorderName,
    };
    saveTx([tx, ...transactions]);
    saveAcc(
      accounts.map((a) => {
        const curBalance =
          typeof a.balanceUsed === "number" ? a.balanceUsed : 0;
        const curPayments =
          typeof a.totalPayments === "number" ? a.totalPayments : 0;
        return a.id === accountId
          ? {
              ...a,
              balanceUsed: Math.max(0, curBalance - payForm.amount),
              totalPayments: curPayments + payForm.amount,
              lastPayment: new Date().toISOString().split("T")[0],
            }
          : a;
      }),
    );
    setShowPay(null);
    setPayForm({ amount: 0, description: "" });
    showToast("Payment recorded");
  };

  const addPurchase = (accountId: string) => {
    if (purchaseForm.amount <= 0) {
      showToast("Please enter a valid purchase amount");
      return;
    }
    const tx: CreditTransaction = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      accountId,
      type: "purchase",
      amount: purchaseForm.amount,
      description: purchaseForm.description || "Fuel purchase",
      date: new Date().toISOString(),
      recordedBy: recorderName,
    };
    saveTx([tx, ...transactions]);
    saveAcc(
      accounts.map((a) => {
        const curBalance =
          typeof a.balanceUsed === "number" ? a.balanceUsed : 0;
        const curPurchases =
          typeof a.totalPurchases === "number" ? a.totalPurchases : 0;
        return a.id === accountId
          ? {
              ...a,
              balanceUsed: curBalance + purchaseForm.amount,
              totalPurchases: curPurchases + purchaseForm.amount,
            }
          : a;
      }),
    );
    setShowPurchase(null);
    setPurchaseForm({ amount: 0, description: "" });
    showToast("Purchase recorded on credit");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-pink-100 dark:bg-pink-900/30 rounded-xl">
          <CreditCard size={24} className="text-pink-600 dark:text-pink-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            Credit Management
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
            Manage customer credit, track payments
          </p>
        </div>
      </div>

      {/* Sub-tab switcher: Credit Accounts vs Fleet & Cards vs Debt Payment Reminders */}
      <SubTabBar
        tabs={[
          { id: "accounts", label: "Credit Accounts", icon: CreditCard },
          { id: "fleet", label: "Fleet & Cards", icon: Truck },
          { id: "reminders", label: "Debt Payment Reminders", icon: BellRing },
          { id: "statements", label: "Statements", icon: FileText },
          { id: "portal", label: "Customer Portal", icon: Share },
          { id: "aging", label: "Aging", icon: CalendarClock },
          { id: "pricelists", label: "Price Lists", icon: Tag },
        ]}
        active={activeView}
        onChange={(id) => setActiveView(id as typeof activeView)}
      />

      {activeView === "fleet" ? (
        <div className="space-y-4">
          <FleetCards accounts={accounts} />
          <FleetTelemetry />
          <FarmFuelEquipment />
          <FleetEmissionsTracker />
        </div>
      ) : activeView === "reminders" ? (
        <DebtReminder />
      ) : activeView === "statements" ? (
        <CustomerStatement />
      ) : activeView === "portal" ? (
        <CreditCustomerPortal />
      ) : activeView === "aging" ? (
        <CreditAgingReport />
      ) : activeView === "pricelists" ? (
        <CustomerPriceLists />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Credit Accounts</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                {accounts.length}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500">Total Limit</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {currencySymbol}
                {formatNumber(totalCredit)}
              </p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-600">Balance Used</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {currencySymbol}
                {formatNumber(totalUsed)}
              </p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800">
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle size={12} /> Overdue
              </p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                {overdue.length}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
              />
              <input
                placeholder="Search credit accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white"
              />
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2.5 bg-pink-600 hover:bg-pink-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <Plus size={16} /> New Account
            </button>
          </div>

          {showAdd && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-sm font-semibold dark:text-gray-900 dark:text-white mb-3">
                New Credit Account
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  placeholder="Customer Name *"
                  value={newAcc.customerName}
                  onChange={(e) =>
                    setNewAcc({ ...newAcc, customerName: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Phone"
                  value={newAcc.phone}
                  onChange={(e) =>
                    setNewAcc({ ...newAcc, phone: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Vehicle Reg"
                  value={newAcc.vehicleReg}
                  onChange={(e) =>
                    setNewAcc({ ...newAcc, vehicleReg: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  type="number"
                  placeholder="Credit Limit"
                  value={newAcc.creditLimit ?? ""}
                  onChange={(e) =>
                    setNewAcc({
                      ...newAcc,
                      creditLimit:
                        e.target.value === ""
                          ? 0
                          : parseFloat(e.target.value) || 0,
                    })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  type="number"
                  placeholder="Payment Terms (days)"
                  value={newAcc.paymentTerms}
                  onChange={(e) =>
                    setNewAcc({
                      ...newAcc,
                      paymentTerms: parseInt(e.target.value) || 30,
                    })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                />
                <input
                  placeholder="Notes (optional)"
                  value={newAcc.notes}
                  onChange={(e) =>
                    setNewAcc({ ...newAcc, notes: e.target.value })
                  }
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white sm:col-span-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addAccount}
                    className="px-4 py-2 bg-pink-600 text-gray-900 dark:text-white rounded-lg text-sm"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Accounts */}
          <div className="space-y-3">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <CreditCard size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  No credit accounts yet. Click "New Account" to create one.
                </p>
              </div>
            )}
            {filtered.map((acc) => {
              const balanceUsed =
                typeof acc.balanceUsed === "number" ? acc.balanceUsed : 0;
              const creditLimit =
                typeof acc.creditLimit === "number" ? acc.creditLimit : 0;
              const pct =
                creditLimit > 0 ? (balanceUsed / creditLimit) * 100 : 0;
              const isOver = pct > 90;
              const lp = acc.lastPayment || "";
              const lpTime = lp ? new Date(lp).getTime() : 0;
              const terms =
                typeof acc.paymentTerms === "number" ? acc.paymentTerms : 0;
              const isDue =
                balanceUsed > 0 &&
                !isNaN(lpTime) &&
                new Date().getTime() - lpTime > terms * 86400000;
              return (
                <div
                  key={acc.id}
                  className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm ${isOver || isDue ? "border-red-200 dark:border-red-800" : "border-gray-200 dark:border-gray-700"}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold dark:text-gray-900 dark:text-white">
                          {acc.customerName || ""}
                        </h3>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${acc.status === "active" ? "bg-green-100 text-green-700" : acc.status === "suspended" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                        >
                          {acc.status || "active"}
                        </span>
                        {isDue && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
                            <AlertTriangle size={10} /> Overdue
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {acc.phone || ""} {acc.vehicleReg || ""}
                      </p>
                      {acc.notes && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">
                          {acc.notes}
                        </p>
                      )}
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-500">
                            Used: {currencySymbol}
                            {formatNumber(balanceUsed)}
                          </span>
                          <span className="text-gray-500">
                            Limit: {currencySymbol}
                            {formatNumber(creditLimit)}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                          <div
                            className={`h-full rounded-full ${isOver ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-green-500"}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span
                            className={`font-semibold ${isOver ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                          >
                            Available: {currencySymbol}
                            {formatNumber(
                              Math.max(0, creditLimit - balanceUsed),
                            )}
                          </span>
                          <span className="text-gray-400">
                            {pct.toFixed(0)}% used
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-4">
                      <button
                        onClick={() => setShowPay(acc.id)}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium"
                      >
                        Record Payment
                      </button>
                      {acc.status === "active" && (
                        <button
                          onClick={() => setShowPurchase(acc.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium"
                        >
                          + Purchase
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setHistoryId(historyId === acc.id ? null : acc.id)
                        }
                        className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium flex items-center gap-1"
                        title="View transaction history"
                      >
                        <History size={12} /> History
                      </button>
                      {isDue && (
                        <button
                          onClick={() => setActiveView("reminders")}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium flex items-center gap-1"
                          title="Open Debt Payment Reminders"
                        >
                          <BellRing size={12} /> Send Reminder
                        </button>
                      )}
                      {balanceUsed > 0 && (
                        <button
                          onClick={() =>
                            navigateToTab("livetransaction", {
                              phone: acc.phone || "",
                              amount: balanceUsed,
                              account_reference: acc.customerName || "",
                              transaction_desc: `Credit payment — ${acc.customerName || ""}`,
                              openStkPush: true,
                            } satisfies StkPushPrefill)
                          }
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium flex items-center gap-1"
                          title="Collect outstanding balance via M-PESA STK Push"
                        >
                          <Smartphone size={12} /> Collect via M-PESA
                        </button>
                      )}
                      {balanceUsed > 0 && (
                        <button
                          onClick={() =>
                            navigateToTab("invoice", {
                              customerName: acc.customerName || "",
                              amount: balanceUsed,
                              description: `Outstanding credit balance`,
                            } satisfies InvoicePrefill)
                          }
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium flex items-center gap-1"
                          title="Create an invoice for the outstanding balance"
                        >
                          <FileText size={12} /> Create Invoice
                        </button>
                      )}
                      <select
                        value={acc.status}
                        onChange={(e) =>
                          setStatus(
                            acc.id,
                            e.target.value as CreditAccount["status"],
                          )
                        }
                        className="px-2 py-1 border rounded-lg text-[11px] dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                        title="Change account status"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="blacklisted">Blacklisted</option>
                      </select>
                      <button
                        onClick={() => setDeleteId(acc.id)}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-[11px] font-medium flex items-center gap-1"
                        title="Delete account"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                  {showPay === acc.id && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={payForm.amount || ""}
                        onChange={(e) =>
                          setPayForm({
                            ...payForm,
                            amount: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                      />
                      <input
                        placeholder="Description"
                        value={payForm.description}
                        onChange={(e) =>
                          setPayForm({
                            ...payForm,
                            description: e.target.value,
                          })
                        }
                        className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={() => addPayment(acc.id)}
                        className="px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg text-sm"
                      >
                        Pay
                      </button>
                      <button
                        onClick={() => setShowPay(null)}
                        className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                      >
                        X
                      </button>
                    </div>
                  )}
                  {showPurchase === acc.id && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Purchase amount"
                        value={purchaseForm.amount || ""}
                        onChange={(e) =>
                          setPurchaseForm({
                            ...purchaseForm,
                            amount: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                      />
                      <input
                        placeholder="Description (e.g. 50L Super Petrol)"
                        value={purchaseForm.description}
                        onChange={(e) =>
                          setPurchaseForm({
                            ...purchaseForm,
                            description: e.target.value,
                          })
                        }
                        className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={() => addPurchase(acc.id)}
                        className="px-4 py-2 bg-blue-600 text-gray-900 dark:text-white rounded-lg text-sm"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setShowPurchase(null)}
                        className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                      >
                        X
                      </button>
                    </div>
                  )}
                  {historyId === acc.id && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                        <History size={12} /> Transaction History
                      </h4>
                      {transactions.filter((t) => t.accountId === acc.id)
                        .length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          No transactions recorded yet.
                        </p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {transactions
                            .filter((t) => t.accountId === acc.id)
                            .map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-50 dark:bg-gray-700/50"
                              >
                                <div className="flex-1">
                                  <span
                                    className={`font-medium ${t.type === "payment" ? "text-green-600" : "text-blue-600"}`}
                                  >
                                    {t.type === "payment"
                                      ? "Payment"
                                      : "Purchase"}
                                  </span>{" "}
                                  — {currencySymbol}
                                  {formatNumber(t.amount)}
                                  <span className="text-gray-500 dark:text-gray-400 ml-2">
                                    {t.description || ""}
                                  </span>
                                </div>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {new Date(t.date).toLocaleDateString()} by{" "}
                                  {t.recordedBy || "?"}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-red-500" size={20} />
              <h3 className="text-lg font-semibold dark:text-gray-900 dark:text-white">
                Delete Account?
              </h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              This will permanently delete the credit account and all its
              transaction history. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAccount(deleteId)}
                className="px-4 py-2 bg-red-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-400" />
          {toast}
        </div>
      )}
    </div>
  );
}

function defaultAccounts(): CreditAccount[] {
  return [];
}
