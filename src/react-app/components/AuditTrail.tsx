import { useState, useEffect, useCallback } from "react";
import {
  logAudit,
  getAuditLog,
  getAuditLogByCategory,
  clearOldAudit,
  type AuditEntry,
} from "@/react-app/services/CloudStorageService";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  ClipboardList,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Database,
  ShoppingCart,
  Settings,
  Shield,
  Package,
  Fuel,
  ArrowUpDown,
  AlertCircle,
  Plus,
} from "lucide-react";

const categoryConfig: Record<
  string,
  { icon: typeof Fuel; color: string; label: string }
> = {
  data: {
    icon: Database,
    color: "text-blue-600 dark:text-blue-400",
    label: "Data",
  },
  sale: {
    icon: ShoppingCart,
    color: "text-green-600 dark:text-green-400",
    label: "Sale",
  },
  payment: {
    icon: ArrowUpDown,
    color: "text-purple-600 dark:text-purple-400",
    label: "Payment",
  },
  inventory: {
    icon: Package,
    color: "text-amber-600 dark:text-amber-400",
    label: "Inventory",
  },
  auth: {
    icon: Shield,
    color: "text-red-600 dark:text-red-400",
    label: "Auth",
  },
  config: {
    icon: Settings,
    color: "text-gray-600 dark:text-gray-500 dark:text-gray-400",
    label: "Config",
  },
  sync: {
    icon: RefreshCw,
    color: "text-cyan-600 dark:text-cyan-400",
    label: "Sync",
  },
};

interface AuditTrailProps {
  stationId: string;
}

export default function AuditTrail({ stationId }: AuditTrailProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [limit, setLimit] = useState(200);
  const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data =
        category === "all"
          ? await getAuditLog(stationId, limit)
          : await getAuditLogByCategory(stationId, category, limit);
      setEntries(data);

      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).getTime();
      const weekStart = todayStart - now.getDay() * 86400000;
      setStats({
        total: data.length,
        today: data.filter((e) => new Date(e.timestamp).getTime() >= todayStart)
          .length,
        thisWeek: data.filter(
          (e) => new Date(e.timestamp).getTime() >= weekStart,
        ).length,
      });
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load audit log");
    }
    setLoading(false);
  }, [stationId, category, limit]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time subscription: new audit entries (logged from ANY tab/device)
  // appear instantly without a manual refresh.
  useEffect(() => {
    const unsub = cloudStorageService.subscribe<AuditEntry[]>(
      "audit_log",
      undefined,
      () => {
        load();
      },
    );
    return unsub;
  }, [load]);

  const filtered = entries.filter(
    (e) =>
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      e.details.toLowerCase().includes(search.toLowerCase()) ||
      (e.user?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  // CSV export with proper escaping (quotes/commas/newlines in details).
  const exportCSV = () => {
    if (filtered.length === 0) {
      toastError("No audit entries to export.");
      return;
    }
    const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = ["Timestamp", "Action", "Category", "User", "Details"];
    const rows = filtered.map((e) => [
      e.timestamp,
      e.action,
      e.category,
      e.user || "-",
      e.details,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(escape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_trail_${stationId}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // "Add Test Entry" — lets the user verify the audit log is working + cloud-synced.
  const addTestEntry = async () => {
    await logAudit({
      stationId,
      action: "Manual Test Entry",
      category: "data",
      user: "You",
      details: `Manual audit test entry created at ${new Date().toLocaleString()}`,
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
            <ClipboardList
              size={24}
              className="text-indigo-600 dark:text-indigo-400"
            />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Audit Trail
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Complete activity log for compliance
              <span className="ml-2 text-green-600 dark:text-green-400">
                • Cloud-synced
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh audit log"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500">Total Events</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            {stats.total}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500">Today</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {stats.today}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500">This Week</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.thisWeek}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {error}
            </p>
            <button
              onClick={() => load()}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-gray-900 dark:text-white text-xs font-medium hover:bg-amber-700 transition-colors"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
          />
          <input
            type="text"
            placeholder="Search audit log..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white"
          aria-label="Filter by category"
        >
          <option value="all">All Categories</option>
          <option value="data">Data</option>
          <option value="sale">Sales</option>
          <option value="payment">Payments</option>
          <option value="inventory">Inventory</option>
          <option value="auth">Auth</option>
          <option value="config">Config</option>
          <option value="sync">Sync</option>
        </select>
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={16} /> Export
        </button>
        {confirmingClear ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              Delete 90+ day entries?
            </span>
            <button
              onClick={async () => {
                await clearOldAudit(90);
                setConfirmingClear(false);
                load();
              }}
              className="px-3 py-2.5 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingClear(true)}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Trash2 size={16} /> Clean Old
          </button>
        )}
        <button
          onClick={addTestEntry}
          className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
          title="Add a test entry to verify cloud sync"
        >
          <Plus size={16} /> Test Entry
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-10">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">User</th>
                <th className="text-left px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const cfg = categoryConfig[e.category] || categoryConfig.data;
                const Icon = cfg.icon;
                return (
                  <tr
                    key={e.id ?? idx}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
                  >
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium dark:text-gray-900 dark:text-white">
                      {e.action}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`flex items-center gap-1 ${cfg.color}`}>
                        <Icon size={12} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {e.user || "System"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-500 dark:text-gray-400 max-w-xs truncate">
                      {e.details}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
            <span className="ml-2 text-sm text-gray-500">
              Loading audit log...
            </span>
          </div>
        )}
        {filtered.length === 0 && !loading && (
          <div className="text-center py-8">
            <ClipboardList
              size={32}
              className="mx-auto text-gray-300 dark:text-gray-600 mb-2"
            />
            <p className="text-sm text-gray-500 mb-3">
              No audit entries found.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Activities are logged automatically as you use the system. You can
              also add a test entry to verify cloud sync.
            </p>
            <button
              onClick={addTestEntry}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} /> Add Test Entry
            </button>
          </div>
        )}
      </div>

      {entries.length >= limit && (
        <div className="text-center">
          <button
            onClick={() => setLimit((l) => l + 200)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Load More (showing {entries.length} of {stats.total})
          </button>
        </div>
      )}
    </div>
  );
}
