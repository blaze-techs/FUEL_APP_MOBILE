import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Trash2,
  Search,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

const CLOUD_LEAVE_KEY = "leave_requests_data";
const CLOUD_TYPES_KEY = "leave_types_data";
const STORAGE_LEAVE_KEY = "fuelpro_leave_requests_v2";
const STORAGE_TYPES_KEY = "fuelpro_leave_types_v2";

interface LeaveType {
  id: string;
  name: string;
  entitlementDays: number;
  allowCarryover: boolean;
  createdAt: string;
  stationId: string;
}

interface LeaveRequest {
  id: string;
  employeeName: string;
  employeeId: string;
  typeId: string;
  typeName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  stationId: string;
}

const VALID_LEAVE_STATUSES: LeaveRequest["status"][] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

const STATUS_META: Record<
  LeaveRequest["status"],
  { label: string; cls: string }
> = {
  pending: {
    label: "Pending",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  approved: {
    label: "Approved",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  rejected: {
    label: "Rejected",
    cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
  },
};

function defaultTypes(): LeaveType[] {
  const base = [
    { name: "Annual Leave", entitlementDays: 21, allowCarryover: true },
    { name: "Sick Leave", entitlementDays: 10, allowCarryover: false },
    {
      name: "Maternity / Paternity Leave",
      entitlementDays: 14,
      allowCarryover: false,
    },
  ];
  return base.map((d, i) => ({
    id: `lt_default_${i}`,
    name: d.name,
    entitlementDays: d.entitlementDays,
    allowCarryover: d.allowCarryover,
    createdAt: new Date().toISOString(),
    stationId: "default",
  }));
}

function normalizeLeaveType(
  t: Partial<LeaveType> | null | undefined,
): LeaveType {
  const id =
    t?.id || `lt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: t?.name ?? "",
    entitlementDays:
      typeof t?.entitlementDays === "number" ? t.entitlementDays : 0,
    allowCarryover: t?.allowCarryover !== false,
    createdAt: t?.createdAt ?? new Date().toISOString(),
    stationId: t?.stationId ?? "default",
  };
}

function normalizeTypes(arr: unknown): LeaveType[] {
  if (!Array.isArray(arr)) return defaultTypes();
  const mapped = arr.map((t) => normalizeLeaveType(t as Partial<LeaveType>));
  return mapped.length > 0 ? mapped : defaultTypes();
}

function countDays(start: string, end: string): number {
  if (!start || !end) return 1;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 1;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

function normalizeLeaveRequest(
  r: Partial<LeaveRequest> | null | undefined,
): LeaveRequest {
  const id =
    r?.id || `lr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    employeeName: r?.employeeName ?? "",
    employeeId: r?.employeeId ?? "",
    typeId: r?.typeId ?? "",
    typeName: r?.typeName ?? "",
    startDate: r?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: r?.endDate ?? "",
    days:
      typeof r?.days === "number"
        ? r.days
        : countDays(r?.startDate ?? "", r?.endDate ?? ""),
    reason: r?.reason ?? "",
    status: VALID_LEAVE_STATUSES.includes(r?.status as LeaveRequest["status"])
      ? (r!.status as LeaveRequest["status"])
      : "pending",
    reviewedBy: r?.reviewedBy ?? "",
    reviewedAt: r?.reviewedAt ?? "",
    createdAt: r?.createdAt ?? new Date().toISOString(),
    stationId: r?.stationId ?? "default",
  };
}

function normalizeRequests(arr: unknown): LeaveRequest[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => normalizeLeaveRequest(r as Partial<LeaveRequest>));
}

export default function LeaveManagement() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [requests, setRequests] = useState<LeaveRequest[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_LEAVE_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeRequests(cached);
    try {
      const s = localStorage.getItem(STORAGE_LEAVE_KEY);
      if (s) return normalizeRequests(JSON.parse(s));
    } catch {}
    return [];
  });
  const [types, setTypes] = useState<LeaveType[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_TYPES_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeTypes(cached);
    try {
      const s = localStorage.getItem(STORAGE_TYPES_KEY);
      if (s) return normalizeTypes(JSON.parse(s));
    } catch {}
    return defaultTypes();
  });

  const [activeView, setActiveView] = useState<"requests" | "types">(
    "requests",
  );
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<LeaveRequest>>({});
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [typeForm, setTypeForm] = useState<Partial<LeaveType>>({});
  // Refs mirror current data so the cloud-load effect can flush local edits
  // without depending on (and thus re-running on) the data arrays.
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const typesRef = useRef(types);
  typesRef.current = types;

  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagLocalModified = () => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 3000);
  };

  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const [r, t] = await Promise.all([
          cloudStorageService.get<unknown[]>(CLOUD_LEAVE_KEY, stationId),
          cloudStorageService.get<unknown[]>(CLOUD_TYPES_KEY, stationId),
        ]);
        if (cancelled) return;
        if (!localModifiedRef.current) {
          if (r) setRequests(normalizeRequests(r));
          if (t) setTypes(normalizeTypes(t));
        }
      } catch {}
      if (!cancelled) {
        cloudLoadCompleteRef.current = true;
        if (localModifiedRef.current) {
          cloudStorageService
            .set(CLOUD_LEAVE_KEY, requestsRef.current, stationId)
            .catch(() => {});
          cloudStorageService
            .set(CLOUD_TYPES_KEY, typesRef.current, stationId)
            .catch(() => {});
        }
      }
    })();
    const unsubR = cloudStorageService.subscribe<unknown[]>(
      CLOUD_LEAVE_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setRequests(normalizeRequests(val));
      },
    );
    const unsubT = cloudStorageService.subscribe<unknown[]>(
      CLOUD_TYPES_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setTypes(normalizeTypes(val));
      },
    );
    return () => {
      cancelled = true;
      unsubR();
      unsubT();
    };
  }, [user?.id, stationId]);

  useEffect(() => {
    if (!cloudLoadCompleteRef.current) return;
    try {
      localStorage.setItem(STORAGE_LEAVE_KEY, JSON.stringify(requests));
      localStorage.setItem(STORAGE_TYPES_KEY, JSON.stringify(types));
    } catch {}
    cloudStorageService
      .set(CLOUD_LEAVE_KEY, requests, stationId)
      .then(() => {
        localModifiedRef.current = false;
      })
      .catch(() => {});
    cloudStorageService.set(CLOUD_TYPES_KEY, types, stationId).catch(() => {});
  }, [requests, types, stationId]);

  const toast = (message: string, type: "success" | "warning" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const openNewRequest = () => {
    setEditingId(null);
    setForm({
      employeeName: "",
      typeId: types[0]?.id || "",
      typeName: types[0]?.name || "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      reason: "",
    });
    setShowForm(true);
  };

  const openEditRequest = (r: LeaveRequest) => {
    setEditingId(r.id);
    setForm({ ...r });
    setShowForm(true);
  };

  const handleSaveRequest = () => {
    if (!form.employeeName || !form.typeId) {
      toast("Employee and leave type are required", "warning");
      return;
    }
    const t = types.find((x) => x.id === form.typeId);
    const days = countDays(form.startDate || "", form.endDate || "");
    flagLocalModified();
    if (editingId) {
      setRequests(
        requests.map((r) =>
          r.id === editingId
            ? { ...r, ...form, typeName: t?.name || form.typeName || "", days }
            : r,
        ),
      );
      toast("Leave request updated");
    } else {
      const nr = normalizeLeaveRequest({
        ...form,
        employeeId: `emp_${Math.round(Math.random() * 10000)}`,
        typeName: t?.name || form.typeName || "",
        days,
        stationId: stationId || "default",
      });
      setRequests([nr, ...requests]);
      toast("Leave request submitted");
    }
    setShowForm(false);
  };

  const reviewRequest = (id: string, status: "approved" | "rejected") => {
    flagLocalModified();
    setRequests(
      requests.map((r) =>
        r.id === id
          ? {
              ...r,
              status,
              reviewedBy: user?.email || "Owner",
              reviewedAt: new Date().toISOString(),
            }
          : r,
      ),
    );
    toast(status === "approved" ? "Request approved" : "Request rejected");
  };

  const deleteRequest = (id: string) => {
    flagLocalModified();
    setRequests(requests.filter((r) => r.id !== id));
    toast("Request deleted");
  };

  const openNewType = () => {
    setEditingTypeId(null);
    setTypeForm({ name: "", entitlementDays: 10, allowCarryover: false });
    setShowTypeForm(true);
  };

  const openEditType = (t: LeaveType) => {
    setEditingTypeId(t.id);
    setTypeForm({ ...t });
    setShowTypeForm(true);
  };

  const handleSaveType = () => {
    if (!typeForm.name) {
      toast("Leave type name is required", "warning");
      return;
    }
    flagLocalModified();
    if (editingTypeId) {
      setTypes(
        types.map((t) => (t.id === editingTypeId ? { ...t, ...typeForm } : t)),
      );
      toast("Leave type updated");
    } else {
      setTypes([
        ...types,
        normalizeLeaveType({
          ...typeForm,
          id: `lt_${Date.now()}_${Math.round(Math.random() * 100)}`,
          stationId: stationId || "default",
        }),
      ]);
      toast("Leave type added");
    }
    setShowTypeForm(false);
    setTypeForm({});
    setEditingTypeId(null);
  };

  const deleteType = (id: string) => {
    flagLocalModified();
    setTypes(types.filter((t) => t.id !== id));
    setRequests(
      requests.map((r) =>
        r.typeId === id ? { ...r, typeName: "Removed type", typeId: "" } : r,
      ),
    );
    toast("Leave type removed");
  };

  const balances = useMemo(() => {
    const map: Record<
      string,
      {
        employeeName: string;
        byType: Record<string, { used: number; entitlement: number }>;
      }
    > = {};
    for (const r of requests) {
      if (r.status !== "approved" || !r.typeId) continue;
      if (!map[r.employeeName])
        map[r.employeeName] = { employeeName: r.employeeName, byType: {} };
      const ent = types.find((t) => t.id === r.typeId)?.entitlementDays ?? 0;
      const cur = map[r.employeeName].byType[r.typeId] || {
        used: 0,
        entitlement: ent,
      };
      cur.used += r.days;
      cur.entitlement = ent;
      map[r.employeeName].byType[r.typeId] = cur;
    }
    return map;
  }, [requests, types]);

  const filteredRequests = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return requests
      .filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (!q) return true;
        return (
          r.employeeName.toLowerCase().includes(q) ||
          r.typeName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [requests, searchTerm, statusFilter]);

  return (
    <div className="w-full">
      {notification && (
        <div
          className={`mb-3 px-4 py-2.5 rounded-lg text-sm font-medium ${notification.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"}`}
        >
          {notification.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CalendarDays size={20} className="text-amber-500" /> Leave
            Management
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Request, approve and track employee leave balances
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("requests")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === "requests" ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"}`}
          >
            Requests
          </button>
          <button
            onClick={() => setActiveView("types")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === "types" ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"}`}
          >
            Leave Types &amp; Balances
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search employee or leave type..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Statuses</option>
            {VALID_LEAVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          {activeView === "requests" && (
            <button
              onClick={openNewRequest}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Plus size={16} /> New Request
            </button>
          )}
          {activeView === "types" && (
            <button
              onClick={openNewType}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Plus size={16} /> Add Type
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Total Requests
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {requests.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Pending
          </div>
          <div className="text-2xl font-bold text-amber-500">
            {requests.filter((r) => r.status === "pending").length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Approved (days)
          </div>
          <div className="text-2xl font-bold text-emerald-500">
            {requests
              .filter((r) => r.status === "approved")
              .reduce((s, r) => s + r.days, 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Leave Types
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {types.length}
          </div>
        </div>
      </div>

      {activeView === "requests" ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left">Employee</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-left">Dates</th>
                  <th className="px-3 py-2.5 text-center">Days</th>
                  <th className="px-3 py-2.5 text-left">Reason</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredRequests.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-gray-500 dark:text-gray-400"
                    >
                      <Users size={24} className="mx-auto mb-2 opacity-40" /> No
                      leave requests yet.
                    </td>
                  </tr>
                )}
                {filteredRequests.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">
                      {r.employeeName}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                      {r.typeName}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                      {r.startDate} → {r.endDate || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center font-medium text-gray-900 dark:text-white">
                      {r.days}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                      {r.reason || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_META[r.status].cls}`}
                      >
                        {STATUS_META[r.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "pending" && (
                          <>
                            <button
                              onClick={() => reviewRequest(r.id, "approved")}
                              title="Approve"
                              className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-500"
                            >
                              <CheckCircle2 size={14} />
                            </button>
                            <button
                              onClick={() => reviewRequest(r.id, "rejected")}
                              title="Reject"
                              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => openEditRequest(r)}
                          title="Edit"
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteRequest(r.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-500"
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
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              Leave Types
            </h3>
            {types.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between pb-2.5 mb-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {t.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t.entitlementDays} days ·{" "}
                    {t.allowCarryover ? "Carryover allowed" : "No carryover"}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditType(t)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteType(t.id)}
                    className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" /> Live Balances per
              Employee
            </h3>
            {Object.values(balances).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                No approved leave yet — balances appear once requests are
                approved.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.values(balances).map((b) => (
                  <div key={b.employeeName}>
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                      {b.employeeName}
                    </div>
                    {Object.entries(b.byType).map(([typeId, cu]) => (
                      <div
                        key={typeId}
                        className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pb-1"
                      >
                        <span>
                          {types.find((t) => t.id === typeId)?.name || "Type"}
                        </span>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {cu.used}/{cu.entitlement} days used
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? "Edit" : "New"} Leave Request
            </h3>
            <div className="space-y-3">
              <input
                value={form.employeeName || ""}
                onChange={(e) =>
                  setForm({ ...form, employeeName: e.target.value })
                }
                placeholder="Employee name"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <select
                value={form.typeId || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    typeId: e.target.value,
                    typeName:
                      types.find((t) => t.id === e.target.value)?.name || "",
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select leave type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.startDate || ""}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <input
                  type="date"
                  value={form.endDate || ""}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <textarea
                value={form.reason || ""}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Reason"
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              {form.startDate && form.endDate && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Duration: {countDays(form.startDate, form.endDate)} days
                </p>
              )}
              <button
                onClick={handleSaveRequest}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all"
              >
                Save Request
              </button>
            </div>
          </div>
        </div>
      )}

      {showTypeForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowTypeForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingTypeId ? "Edit" : "Add"} Leave Type
            </h3>
            <div className="space-y-3">
              <input
                value={typeForm.name || ""}
                onChange={(e) =>
                  setTypeForm({ ...typeForm, name: e.target.value })
                }
                placeholder="Leave type (e.g. Annual, Sick, Maternity)"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Entitlement (days / year)
              </label>
              <input
                type="number"
                value={typeForm.entitlementDays ?? 10}
                onChange={(e) =>
                  setTypeForm({
                    ...typeForm,
                    entitlementDays: Number(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={!!typeForm.allowCarryover}
                  onChange={(e) =>
                    setTypeForm({
                      ...typeForm,
                      allowCarryover: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Allow carryover
              </label>
              <button
                onClick={handleSaveType}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all"
              >
                Save Type
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
