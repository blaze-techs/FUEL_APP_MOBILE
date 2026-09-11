import { useState, useEffect, useRef, useMemo } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { getCurrencySymbol } from "../lib/currency";
import {
  Wrench,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  Fuel,
  Gauge,
  Droplets,
  Zap,
  Cog,
  Receipt,
  Download,
} from "lucide-react";
import {
  navigateToTab,
  type ExpensePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import GeneratorFuelTracker from "@/react-app/components/GeneratorFuelTracker";
import UtilityTracker from "@/react-app/components/UtilityTracker";
import PowerInterruptionLog from "@/react-app/components/PowerInterruptionLog";
import EnergyMixTracker from "@/react-app/components/EnergyMixTracker";
import BatteryBackupHealth from "@/react-app/components/BatteryBackupHealth";
import HoseReplacementLog from "@/react-app/components/HoseReplacementLog";
import PreventiveChecklists from "@/react-app/components/PreventiveChecklists";

interface MaintenanceRecord {
  id: string;
  equipmentName: string;
  equipmentType:
    "pump" | "tank" | "dispenser" | "generator" | "compressor" | "other";
  stationId: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "scheduled" | "in_progress" | "completed" | "overdue";
  assignedTo: string;
  cost: number;
  scheduledDate: string;
  completedDate?: string;
  nextDueDate: string;
  notes: string;
  createdAt: string;
}

const STORAGE_KEY = "fuelpro_maintenance_v2";

const VALID_EQUIPMENT_TYPES = [
  "pump",
  "tank",
  "dispenser",
  "generator",
  "compressor",
  "other",
] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "overdue",
] as const;

function normalizeMaintenanceRecord(
  r: Partial<MaintenanceRecord> | null | undefined,
): MaintenanceRecord {
  const id =
    r?.id || `mt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const equipmentType = (VALID_EQUIPMENT_TYPES as readonly string[]).includes(
    r?.equipmentType as string,
  )
    ? (r!.equipmentType as MaintenanceRecord["equipmentType"])
    : "other";
  const priority = (VALID_PRIORITIES as readonly string[]).includes(
    r?.priority as string,
  )
    ? (r!.priority as MaintenanceRecord["priority"])
    : "medium";
  const status = (VALID_STATUSES as readonly string[]).includes(
    r?.status as string,
  )
    ? (r!.status as MaintenanceRecord["status"])
    : "scheduled";
  return {
    id,
    equipmentName: r?.equipmentName ?? "",
    equipmentType,
    stationId: r?.stationId ?? "default",
    description: r?.description ?? "",
    priority,
    status,
    assignedTo: r?.assignedTo ?? "",
    cost: typeof r?.cost === "number" ? r.cost : 0,
    scheduledDate: r?.scheduledDate ?? "",
    completedDate: r?.completedDate,
    nextDueDate: r?.nextDueDate ?? "",
    notes: r?.notes ?? "",
    createdAt: r?.createdAt ?? new Date().toISOString(),
  };
}

function normalizeMaintenanceRecords(arr: unknown): MaintenanceRecord[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) =>
    normalizeMaintenanceRecord(r as Partial<MaintenanceRecord>),
  );
}

const EQUIPMENT_TYPES = [
  { value: "pump", label: "Fuel Pump", icon: Fuel },
  { value: "tank", label: "Storage Tank", icon: Droplets },
  { value: "dispenser", label: "Dispenser", icon: Gauge },
  { value: "generator", label: "Generator", icon: Zap },
  { value: "compressor", label: "Compressor", icon: Cog },
  { value: "other", label: "Other", icon: Wrench },
] as const;

function loadRecords(): MaintenanceRecord[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeMaintenanceRecords(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

export default function MaintenanceTracker() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  // Resolve currency from the React-context station (not the synchronous
  // localStorage read) so it's correct on fresh devices / multi-currency.
  const currencySymbol = useMemo(
    () =>
      getCurrencySymbol(
        (currentStation as any)?.companyCurrency ||
          (currentStation as any)?.currency,
      ),
    [currentStation],
  );
  const [records, setRecords] = useState<MaintenanceRecord[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "maintenance_records",
      stationId,
    );
    if (Array.isArray(cloudCached))
      return normalizeMaintenanceRecords(cloudCached);
    return loadRecords();
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [formData, setFormData] = useState<Partial<MaintenanceRecord>>({
    equipmentName: "",
    equipmentType: "pump",
    description: "",
    priority: "medium",
    status: "scheduled",
    assignedTo: "",
    cost: 0,
    scheduledDate: "",
    nextDueDate: "",
    notes: "",
  });

  // Prevents the save effect from overwriting cloud data with default state
  // before the initial cloud load completes (cross-device overwrite race).
  const cloudLoadCompleteRef = useRef(false);
  // Echo guard: prevents the real-time subscribe callback from overwriting
  // uncommitted local edits (the cloud write echoes back and wipes state).
  const localModifiedRef = useRef(false);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService
      .set("maintenance_records", records, stationId)
      .catch(() => {});
  }, [records, stationId]);

  // Load from cloud on mount + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const cloudData = await cloudStorageService.get<MaintenanceRecord[]>(
          "maintenance_records",
          stationId,
        );
        if (!cancelled && cloudData && !localModifiedRef.current)
          setRecords(normalizeMaintenanceRecords(cloudData));
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    // Real-time: when another device updates records, update instantly
    const unsubs = [
      cloudStorageService.subscribe<MaintenanceRecord[]>(
        "maintenance_records",
        stationId,
        (val) => {
          if (!val || localModifiedRef.current) return;
          setRecords(normalizeMaintenanceRecords(val));
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
        .set("maintenance_records", recordsRef.current, stationId)
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

  const filtered = records.filter((r) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      (r.equipmentName || "").toLowerCase().includes(term) ||
      (r.description || "").toLowerCase().includes(term) ||
      (r.assignedTo || "").toLowerCase().includes(term);
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    const matchesPriority =
      priorityFilter === "all" || r.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const handleSave = () => {
    if (!formData.equipmentName || !formData.description) {
      showNotification(
        "Equipment name and description are required",
        "warning",
      );
      return;
    }
    localModifiedRef.current = true;
    if (editingId) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === editingId ? ({ ...r, ...formData } as MaintenanceRecord) : r,
        ),
      );
      showNotification("Maintenance record updated");
    } else {
      const newRecord: MaintenanceRecord = {
        ...(formData as MaintenanceRecord),
        id: `mt_${Date.now()}`,
        stationId: "default",
        createdAt: new Date().toISOString(),
      };
      setRecords((prev) => [newRecord, ...prev]);
      showNotification("Maintenance record added");
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this maintenance record?")) {
      localModifiedRef.current = true;
      setRecords((prev) => prev.filter((r) => r.id !== id));
      showNotification("Record deleted");
    }
  };

  const updateStatus = (id: string, newStatus: MaintenanceRecord["status"]) => {
    localModifiedRef.current = true;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: newStatus,
              completedDate:
                newStatus === "completed"
                  ? new Date().toISOString()
                  : r.completedDate,
            }
          : r,
      ),
    );
    showNotification(`Status updated to ${newStatus}`);
  };

  const statusColors: Record<string, string> = {
    scheduled: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    in_progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    overdue: "bg-red-500/10 text-red-600 dark:text-red-400",
  };

  const priorityColors: Record<string, string> = {
    low: "text-gray-500",
    medium: "text-blue-500",
    high: "text-amber-500",
    critical: "text-red-500",
  };

  const priorityIcons: Record<string, string> = {
    low: "↓",
    medium: "→",
    high: "↑",
    critical: "!",
  };

  const stats = {
    total: records.length,
    scheduled: records.filter((r) => r.status === "scheduled").length,
    inProgress: records.filter((r) => r.status === "in_progress").length,
    completed: records.filter((r) => r.status === "completed").length,
    overdue: records.filter((r) => r.status === "overdue").length,
    critical: records.filter(
      (r) => r.priority === "critical" && r.status !== "completed",
    ).length,
  };

  // Cost analytics (defended against NaN/undefined on corrupt cloud records)
  const totalCost = records.reduce(
    (sum, r) =>
      sum +
      (typeof r.cost === "number" && Number.isFinite(r.cost) ? r.cost : 0),
    0,
  );
  const completedCost = records
    .filter((r) => r.status === "completed")
    .reduce(
      (sum, r) =>
        sum +
        (typeof r.cost === "number" && Number.isFinite(r.cost) ? r.cost : 0),
      0,
    );
  const costByType = records.reduce<Record<string, number>>((acc, r) => {
    const c =
      typeof r.cost === "number" && Number.isFinite(r.cost) ? r.cost : 0;
    acc[r.equipmentType] = (acc[r.equipmentType] || 0) + c;
    return acc;
  }, {});
  const fmtCost = (n: number) =>
    `${currencySymbol}${(Number.isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const exportCSV = () => {
    const header = [
      "ID",
      "Equipment Name",
      "Equipment Type",
      "Description",
      "Priority",
      "Status",
      "Assigned To",
      "Cost",
      "Scheduled Date",
      "Completed Date",
      "Next Due Date",
      "Notes",
      "Created At",
    ];
    const esc = (s: unknown) => {
      const str = String(s ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = filtered.map((r) =>
      [
        r.id,
        r.equipmentName,
        r.equipmentType,
        r.description,
        r.priority,
        r.status,
        r.assignedTo,
        r.cost,
        r.scheduledDate,
        r.completedDate || "",
        r.nextDueDate,
        r.notes,
        r.createdAt,
      ]
        .map(esc)
        .join(","),
    );
    const csv = [header.map(esc).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maintenance_records_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification("Exported CSV");
  };

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
            <Wrench size={22} className="text-amber-500" /> Maintenance Tracker
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Equipment maintenance & servicing schedules
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setFormData({
              equipmentName: "",
              equipmentType: "pump",
              description: "",
              priority: "medium",
              status: "scheduled",
              assignedTo: "",
              cost: 0,
              scheduledDate: "",
              nextDueDate: "",
              notes: "",
            });
          }}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
        >
          <Plus size={16} /> New Task
        </button>
      </div>

      {/* Overdue / Critical Alert Banner */}
      {(stats.overdue > 0 || stats.critical > 0) && (
        <div
          className={`mb-4 p-3 rounded-xl border flex items-center justify-between ${
            stats.overdue > 0
              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              : "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
          }`}
        >
          <p
            className={`text-sm font-medium ${
              stats.overdue > 0
                ? "text-red-700 dark:text-red-300"
                : "text-orange-700 dark:text-orange-300"
            }`}
          >
            {stats.overdue > 0
              ? `⚠ ${stats.overdue} overdue maintenance task(s) need immediate attention`
              : `⚠ ${stats.critical} critical priority task(s) pending`}
          </p>
        </div>
      )}

      {/* Cost Analytics */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Total Maintenance Cost</p>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {fmtCost(totalCost)}
            </p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Completed Spend</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {fmtCost(completedCost)}
            </p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Pending Spend</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {fmtCost(totalCost - completedCost)}
            </p>
          </div>
          <div className="bg-gray-100 dark:bg-gray-700/50 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Avg Cost / Task</p>
            <p className="text-lg font-bold text-gray-700 dark:text-gray-300">
              {fmtCost(stats.total > 0 ? totalCost / stats.total : 0)}
            </p>
          </div>
        </div>
      )}

      {Object.keys(costByType).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Spend by Equipment Type
          </h4>
          <div className="space-y-2">
            {Object.entries(costByType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, cost]) => {
                const pct =
                  totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0;
                const label =
                  EQUIPMENT_TYPES.find((t) => t.value === type)?.label || type;
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 w-28 truncate">
                      {label}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-24 text-right">
                      {fmtCost(cost)} ({pct}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <GeneratorFuelTracker />
      <UtilityTracker />
      <PowerInterruptionLog />
      <EnergyMixTracker />
      <BatteryBackupHealth />
      <HoseReplacementLog />
      <PreventiveChecklists />

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          {
            label: "Total",
            value: stats.total,
            color: "text-gray-600 dark:text-gray-500 dark:text-gray-400",
            bg: "bg-gray-100 dark:bg-gray-700/50",
          },
          {
            label: "Scheduled",
            value: stats.scheduled,
            color: "text-blue-600 dark:text-blue-400",
            bg: "bg-blue-50 dark:bg-blue-500/10",
          },
          {
            label: "In Progress",
            value: stats.inProgress,
            color: "text-amber-600 dark:text-amber-400",
            bg: "bg-amber-50 dark:bg-amber-500/10",
          },
          {
            label: "Completed",
            value: stats.completed,
            color: "text-emerald-600 dark:text-emerald-400",
            bg: "bg-emerald-50 dark:bg-emerald-500/10",
          },
          {
            label: "Overdue",
            value: stats.overdue,
            color: "text-red-600 dark:text-red-400",
            bg: "bg-red-50 dark:bg-red-500/10",
          },
          {
            label: "Critical",
            value: stats.critical,
            color: "text-red-600 dark:text-red-400",
            bg: "bg-red-50 dark:bg-red-500/10",
          },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search equipment or technician..."
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-300 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-gray-300 focus:outline-none"
        >
          <option value="all">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export filtered records to CSV"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Records */}
      <div className="space-y-3">
        {filtered.map((record) => {
          const EquipIcon =
            EQUIPMENT_TYPES.find((e) => e.value === record.equipmentType)
              ?.icon || Wrench;
          return (
            <div
              key={record.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all"
            >
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${record.status === "overdue" ? "bg-red-500/10" : record.status === "completed" ? "bg-emerald-500/10" : "bg-amber-500/10"}`}
                    >
                      <EquipIcon
                        size={18}
                        className={
                          record.status === "overdue"
                            ? "text-red-500"
                            : record.status === "completed"
                              ? "text-emerald-500"
                              : "text-amber-500"
                        }
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                        {record.equipmentName}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {(record.description || "").slice(0, 60)}
                        {(record.description || "").length > 60 ? "..." : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[record.status] || statusColors.scheduled}`}
                    >
                      {(record.status || "scheduled").replace("_", " ")}
                    </span>
                    <span
                      className={`text-xs font-bold ${priorityColors[record.priority] || priorityColors.medium}`}
                    >
                      {priorityIcons[record.priority] || priorityIcons.medium}{" "}
                      {record.priority || "medium"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <Clock size={12} /> {record.assignedTo || ""}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <Calendar size={12} />{" "}
                    {new Date(
                      record.scheduledDate || Date.now(),
                    ).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Next:{" "}
                    {new Date(
                      record.nextDueDate || Date.now(),
                    ).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    {currencySymbol} {(record.cost || 0).toLocaleString()}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === record.id ? null : record.id)
                    }
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-lg text-xs text-gray-600 dark:text-gray-300 transition-colors flex items-center gap-1"
                  >
                    {expandedId === record.id ? (
                      <>
                        <ChevronUp size={12} /> Less
                      </>
                    ) : (
                      <>
                        <ChevronDown size={12} /> Details
                      </>
                    )}
                  </button>
                  {record.status === "scheduled" && (
                    <button
                      onClick={() => updateStatus(record.id, "in_progress")}
                      className="px-3 py-1.5 bg-amber-500/10 text-amber-600 rounded-lg text-xs hover:bg-amber-500/20 transition-colors"
                    >
                      Start
                    </button>
                  )}
                  {record.status === "in_progress" && (
                    <button
                      onClick={() => updateStatus(record.id, "completed")}
                      className="px-3 py-1.5 bg-emerald-500/10 text-emerald-600 rounded-lg text-xs hover:bg-emerald-500/20 transition-colors"
                    >
                      Complete
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingId(record.id);
                      setFormData(record);
                      setShowForm(true);
                    }}
                    className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 rounded-lg transition-colors"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    onClick={() =>
                      navigateToTab("expenses", {
                        category: "maintenance",
                        amount: record.cost,
                        description: `Maintenance — ${record.equipmentName} (${record.equipmentType})`,
                        reference: record.id,
                        paymentMethod: "Bank Transfer",
                      } satisfies ExpensePrefill)
                    }
                    disabled={!record.cost || record.cost <= 0}
                    className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg transition-colors disabled:opacity-40"
                    title="Record this maintenance cost as an expense"
                  >
                    <Receipt size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(record.id)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-lg transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {expandedId === record.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <div>
                        <span className="text-gray-500">Full Description:</span>{" "}
                        {record.description || ""}
                      </div>
                      <div>
                        <span className="text-gray-500">Cost:</span>{" "}
                        {currencySymbol} {(record.cost || 0).toLocaleString()}
                      </div>
                      {record.completedDate && (
                        <div>
                          <span className="text-gray-500">Completed:</span>{" "}
                          {new Date(
                            record.completedDate || Date.now(),
                          ).toLocaleDateString()}
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">Next Service:</span>{" "}
                        {new Date(
                          record.nextDueDate || Date.now(),
                        ).toLocaleDateString()}
                      </div>
                      {record.notes && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Notes:</span>{" "}
                          {record.notes}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Wrench size={48} className="mx-auto mb-3 opacity-30" />
          <p>No maintenance records found</p>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  {editingId ? "Edit" : "New"} Maintenance Task
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
                      Equipment Name *
                    </label>
                    <input
                      value={formData.equipmentName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          equipmentName: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Type
                    </label>
                    <select
                      value={formData.equipmentType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          equipmentType: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    >
                      {EQUIPMENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
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
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Priority
                    </label>
                    <select
                      value={formData.priority}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          priority: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    >
                      {["low", "medium", "high", "critical"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          status: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    >
                      {["scheduled", "in_progress", "completed", "overdue"].map(
                        (s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Cost ({currencySymbol})
                    </label>
                    <input
                      type="number"
                      value={formData.cost}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          cost: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Assigned To
                    </label>
                    <input
                      value={formData.assignedTo}
                      onChange={(e) =>
                        setFormData({ ...formData, assignedTo: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Scheduled Date
                    </label>
                    <input
                      type="date"
                      value={formData.scheduledDate}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          scheduledDate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Next Due Date
                  </label>
                  <input
                    type="date"
                    value={formData.nextDueDate}
                    onChange={(e) =>
                      setFormData({ ...formData, nextDueDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-900 dark:text-white"
                  />
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
