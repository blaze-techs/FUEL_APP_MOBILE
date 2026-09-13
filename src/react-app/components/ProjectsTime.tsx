import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Search,
  Clock,
  FolderKanban,
  CalendarClock,
  Users,
  CheckCircle2,
  AlertTriangle,
  Timer,
  DollarSign,
  Pencil,
  Trash2,
  Play,
  Pause,
  X,
  FileText,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import { getCurrencySymbol } from "@/react-app/lib/currency";

const CLOUD_KEY = "projects_data";
const CLOUD_TIMES_KEY = "time_entries_data";
const STORAGE_KEY = "fuelpro_projects_v2";
const STORAGE_TIMES_KEY = "fuelpro_time_entries_v2";

type ProjectStatus = "planned" | "in_progress" | "on_hold" | "completed";
type Priority = "low" | "medium" | "high" | "urgent";
type TimeStatus = "running" | "stopped";

interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  budget: number;
  customerId: string;
  customerName: string;
  team: string[];
  startDate: string;
  dueDate: string;
  estimatedHours: number;
  notes: string;
  createdAt: string;
  stationId: string;
}

interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  hours: number;
  note: string;
  billable: boolean;
  status: TimeStatus;
  startedAt?: string;
  accumulatedMs?: number;
  createdAt: string;
  stationId: string;
}

const VALID_STATUSES: ProjectStatus[] = [
  "planned",
  "in_progress",
  "on_hold",
  "completed",
];
const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  planned: {
    label: "Planned",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
  },
  in_progress: {
    label: "In Progress",
    cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  },
  on_hold: {
    label: "On Hold",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

const PRIORITY_META: Record<Priority, { label: string; cls: string }> = {
  low: {
    label: "Low",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400",
  },
  medium: {
    label: "Medium",
    cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  },
  high: {
    label: "High",
    cls: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300",
  },
  urgent: {
    label: "Urgent",
    cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  },
};

function normalizeProject(p: Partial<Project> | null | undefined): Project {
  const id =
    p?.id || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: p?.name ?? "",
    description: p?.description ?? "",
    status: VALID_STATUSES.includes(p?.status as ProjectStatus)
      ? (p!.status as ProjectStatus)
      : "planned",
    priority: VALID_PRIORITIES.includes(p?.priority as Priority)
      ? (p!.priority as Priority)
      : "medium",
    budget: typeof p?.budget === "number" ? p.budget : 0,
    customerId: p?.customerId ?? "",
    customerName: p?.customerName ?? "",
    team: Array.isArray(p?.team) ? p!.team.map(String) : [],
    startDate: p?.startDate ?? new Date().toISOString().slice(0, 10),
    dueDate: p?.dueDate ?? "",
    estimatedHours:
      typeof p?.estimatedHours === "number" ? p.estimatedHours : 0,
    notes: p?.notes ?? "",
    createdAt: p?.createdAt ?? new Date().toISOString(),
    stationId: p?.stationId ?? "default",
  };
}

function normalizeProjects(arr: unknown): Project[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => normalizeProject(p as Partial<Project>));
}

function normalizeProjectTime(
  t: Partial<TimeEntry> | null | undefined,
): TimeEntry {
  const id =
    t?.id || `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    projectId: t?.projectId ?? "",
    projectName: t?.projectName ?? "",
    date: t?.date ?? new Date().toISOString().slice(0, 10),
    hours: typeof t?.hours === "number" ? t.hours : 0,
    note: t?.note ?? "",
    billable: t?.billable !== false,
    status: t?.status === "running" ? "running" : "stopped",
    startedAt: t?.startedAt,
    accumulatedMs:
      typeof t?.accumulatedMs === "number" ? t.accumulatedMs : undefined,
    createdAt: t?.createdAt ?? new Date().toISOString(),
    stationId: t?.stationId ?? "default",
  };
}

function normalizeTimes(arr: unknown): TimeEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => normalizeProjectTime(t as Partial<TimeEntry>));
}

export default function ProjectsTime() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = useMemo(
    () =>
      getCurrencySymbol(
        (currentStation as any)?.companyCurrency ||
          (currentStation as any)?.currency,
      ),
    [currentStation],
  );

  const [projects, setProjects] = useState<Project[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeProjects(cached);
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) return normalizeProjects(JSON.parse(s));
    } catch {}
    return [];
  });
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_TIMES_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeTimes(cached);
    try {
      const s = localStorage.getItem(STORAGE_TIMES_KEY);
      if (s) return normalizeTimes(JSON.parse(s));
    } catch {}
    return [];
  });

  const [activeView, setActiveView] = useState<
    "projects" | "times" | "summary"
  >("projects");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  // 3-ref guard (prevents cross-device overwrite + flash-then-blank)
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const timesRef = useRef(timeEntries);
  timesRef.current = timeEntries;

  const flagLocalModified = () => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 3000);
  };

  // Time-tracking ticker for running entries
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timeEntries.some((t) => t.status === "running")) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [timeEntries]);

  // Cloud load
  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const [p, t] = await Promise.all([
          cloudStorageService.get<unknown[]>(CLOUD_KEY, stationId),
          cloudStorageService.get<unknown[]>(CLOUD_TIMES_KEY, stationId),
        ]);
        if (cancelled) return;
        if (!localModifiedRef.current) {
          if (Array.isArray(p) && p.length > 0)
            setProjects(normalizeProjects(p));
          if (Array.isArray(t) && t.length > 0)
            setTimeEntries(normalizeTimes(t));
        }
      } catch {}
      if (!cancelled) {
        cloudLoadCompleteRef.current = true;
        // Flush any local edits made before load completed
        if (localModifiedRef.current) {
          cloudStorageService
            .set(CLOUD_KEY, projectsRef.current, stationId)
            .catch(() => {});
          cloudStorageService
            .set(CLOUD_TIMES_KEY, timesRef.current, stationId)
            .catch(() => {});
        }
      }
    })();
    const unsubP = cloudStorageService.subscribe<unknown[]>(
      CLOUD_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setProjects(normalizeProjects(val));
      },
    );
    const unsubT = cloudStorageService.subscribe<unknown[]>(
      CLOUD_TIMES_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setTimeEntries(normalizeTimes(val));
      },
    );
    return () => {
      cancelled = true;
      unsubP();
      unsubT();
    };
  }, [user?.id, stationId]);

  // Persistence
  useEffect(() => {
    if (!cloudLoadCompleteRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_TIMES_KEY, JSON.stringify(timeEntries));
    } catch {}
    cloudStorageService
      .set(CLOUD_KEY, projects, stationId)
      .then(() => {
        localModifiedRef.current = false;
      })
      .catch(() => {});
    cloudStorageService
      .set(CLOUD_TIMES_KEY, timeEntries, stationId)
      .catch(() => {});
  }, [projects, timeEntries, user?.id, stationId]);

  const toast = (message: string, type: "success" | "warning" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const [form, setForm] = useState<Partial<Project>>({});
  const openNew = () => {
    setEditingId(null);
    setForm({
      name: "",
      description: "",
      status: "planned",
      priority: "medium",
      budget: 0,
      customerName: "",
      team: [],
      startDate: new Date().toISOString().slice(0, 10),
      dueDate: "",
      estimatedHours: 0,
      notes: "",
    });
    setShowForm(true);
  };
  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({ ...p, team: [...p.team] });
    setShowForm(true);
  };
  const handleSave = () => {
    const realStationId = stationId || "default";
    if (!form.name || !form.name.trim()) {
      toast("Project name is required", "warning");
      return;
    }
    flagLocalModified();
    if (editingId) {
      const updated = projects.map((p) =>
        p.id === editingId
          ? { ...normalizeProject({ ...p, ...form, stationId: realStationId }) }
          : p,
      );
      setProjects(updated);
      toast("Project updated");
    } else {
      const np = normalizeProject({
        ...form,
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        stationId: realStationId,
      });
      setProjects([np, ...projects]);
      toast("Project created");
    }
    setShowForm(false);
  };
  const handleDelete = () => {
    if (!confirmDelete) return;
    flagLocalModified();
    setProjects(projects.filter((p) => p.id !== confirmDelete.id));
    setTimeEntries(timeEntries.filter((t) => t.projectId !== confirmDelete.id));
    toast("Project deleted");
    setConfirmDelete(null);
  };

  // Time tracking
  const [timeForm, setTimeForm] = useState<Partial<TimeEntry>>({});
  const [showTimeForm, setShowTimeForm] = useState(false);
  const [runningTick, setRunningTick] = useState<Record<string, number>>({});

  useEffect(() => {
    const compute = () => {
      const rec: Record<string, number> = {};
      for (const t of timeEntries) {
        if (t.status === "running" && t.startedAt) {
          const base = t.accumulatedMs ?? 0;
          const el = Date.now() - new Date(t.startedAt).getTime();
          rec[t.id] = Math.max(base, base + el);
        }
      }
      setRunningTick(rec);
    };
    compute();
    const iv = setInterval(compute, 500);
    return () => clearInterval(iv);
  }, [timeEntries]);

  const startTimer = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    const active = timeEntries.find((t) => t.status === "running");
    if (active && active.projectId !== projectId) {
      toast("Stop the running timer first", "warning");
      return;
    }
    flagLocalModified();
    if (active) {
      // resume same entry
      setTimeEntries(
        timeEntries.map((t) =>
          t.id === active.id
            ? {
                ...t,
                status: "running" as TimeStatus,
                startedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      return;
    }
    const ne = normalizeProjectTime({
      id: `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      projectName: proj.name,
      date: new Date().toISOString().slice(0, 10),
      hours: 0,
      note: "In progress",
      billable: true,
      status: "running",
      startedAt: new Date().toISOString(),
      stationId: stationId || "default",
    });
    setTimeEntries([ne, ...timeEntries]);
    toast(`Timer started for ${proj.name}`);
  };
  const stopTimer = (entryId: string) => {
    const entry = timeEntries.find((t) => t.id === entryId);
    if (!entry || !entry.startedAt) return;
    const elapsedMs =
      (entry.accumulatedMs ?? 0) +
      (Date.now() - new Date(entry.startedAt).getTime());
    const hours = elapsedMs / 3600000;
    const existing = timeEntries.find(
      (t) => t.projectId === entry.projectId && t.status !== "running",
    );

    flagLocalModified();
    let updated = timeEntries.map((t) => {
      if (t.id !== entryId) return t;
      // If there's a stopped zero-hour entry for the same project, accumulate into it
      const target = timeEntries.find(
        (x) =>
          x.id !== entryId &&
          x.projectId === entry.projectId &&
          x.status === "stopped",
      );
      if (target) {
        return { ...t, status: "stopped" as TimeStatus, startedAt: undefined };
      }
      return {
        ...t,
        status: "stopped" as TimeStatus,
        hours: hours,
        startedAt: undefined,
        accumulatedMs: undefined,
      };
    });
    // Merge running into sibling stopped entry if present
    const target = timeEntries.find(
      (x) =>
        x.id !== entryId &&
        x.projectId === entry.projectId &&
        x.status === "stopped",
    );
    if (target) {
      updated = updated
        .map((t) =>
          t.id === entryId
            ? {
                ...t,
                status: "stopped" as TimeStatus,
                hours: 0,
                startedAt: undefined,
              }
            : t,
        )
        .map((t) =>
          t.id === target.id
            ? {
                ...t,
                hours: (t.hours || 0) + hours,
                status: "stopped" as TimeStatus,
              }
            : t,
        );
    } else {
      updated = updated.map((t) =>
        t.id === entryId
          ? {
              ...t,
              hours: hours,
              status: "stopped" as TimeStatus,
              startedAt: undefined,
              accumulatedMs: undefined,
            }
          : t,
      );
    }
    setTimeEntries(updated);
    toast(`Logged ${hours.toFixed(2)}h on ${entry.projectName}`);
    void existing;
  };
  const openNewTime = (projectId?: string) => {
    setTimeForm({
      projectId: projectId || "",
      date: new Date().toISOString().slice(0, 10),
      hours: 1,
      note: "",
      billable: true,
    });
    setShowTimeForm(true);
  };
  const handleSaveTime = () => {
    if (!timeForm.projectId) {
      toast("Select a project", "warning");
      return;
    }
    const proj = projects.find((p) => p.id === timeForm.projectId);
    flagLocalModified();
    const nt = normalizeProjectTime({
      ...timeForm,
      id: `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectName: proj?.name || "Project",
      hours: Number(timeForm.hours) || 0,
      status: "stopped",
      stationId: stationId || "default",
    });
    setTimeEntries([nt, ...timeEntries]);
    toast(`Logged ${nt.hours.toFixed(2)}h`);
    setShowTimeForm(false);
  };
  const deleteTimeEntry = (id: string) => {
    flagLocalModified();
    setTimeEntries(timeEntries.filter((t) => t.id !== id));
    toast("Time entry deleted");
  };

  // Derived data
  const filteredProjects = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return projects
      .filter((p) => {
        if (statusFilter !== "all" && p.status !== statusFilter) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.status === "completed" && b.status !== "completed") return 1;
        if (a.status !== "completed" && b.status === "completed") return -1;
        return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      });
  }, [projects, searchTerm, statusFilter]);

  const filteredTimes = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return timeEntries
      .filter((t) => {
        if (projectFilter !== "all" && t.projectId !== projectFilter)
          return false;
        if (!q) return true;
        return (
          t.projectName.toLowerCase().includes(q) ||
          t.note.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [timeEntries, projectFilter, searchTerm]);

  const summary = useMemo(() => {
    const billableHours = timeEntries
      .filter((t) => t.billable)
      .reduce((s, t) => s + t.hours, 0);
    const totalHours = timeEntries.reduce((s, t) => s + t.hours, 0);
    const activeProjects = projects.filter(
      (p) => p.status === "in_progress",
    ).length;
    const overdue = projects.filter(
      (p) =>
        p.status !== "completed" &&
        p.dueDate &&
        p.dueDate < new Date().toISOString().slice(0, 10),
    ).length;
    const totalBudget = projects.reduce((s, p) => s + (p.budget || 0), 0);
    return { billableHours, totalHours, activeProjects, overdue, totalBudget };
  }, [projects, timeEntries]);

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FolderKanban size={20} className="text-amber-500" /> Projects &
            Time
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Track client projects, budgets and billable time — Reatech360-style
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("projects")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === "projects" ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"}`}
          >
            Projects
          </button>
          <button
            onClick={() => setActiveView("times")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === "times" ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"}`}
          >
            Time
          </button>
          <button
            onClick={() => setActiveView("summary")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === "summary" ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"}`}
          >
            Summary
          </button>
        </div>
      </div>

      {notification && (
        <div
          className={`mb-3 px-4 py-2.5 rounded-lg text-sm font-medium ${notification.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"}`}
        >
          {notification.message}
        </div>
      )}

      {/* KPI row */}
      {activeView === "projects" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Total Projects
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {projects.length}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Active
            </div>
            <div className="text-2xl font-bold text-blue-500">
              {summary.activeProjects}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Overdue
            </div>
            <div className="text-2xl font-bold text-red-500">
              {summary.overdue}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Total Budget
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {currencySymbol}
              {summary.totalBudget.toLocaleString()}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 col-span-2 sm:col-span-1">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Hours Logged
            </div>
            <div className="text-2xl font-bold text-amber-500">
              {summary.totalHours.toFixed(1)}h
            </div>
          </div>
        </div>
      )}

      {/* Search + actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects / time..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex gap-2">
          {activeView === "projects" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Statuses</option>
              {VALID_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          )}
          {activeView === "times" && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {activeView === "projects" && (
            <button
              onClick={openNew}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Plus size={16} /> New Project
            </button>
          )}
          {activeView === "times" && (
            <button
              onClick={() => openNewTime()}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Plus size={16} /> Log Time
            </button>
          )}
        </div>
      </div>

      {activeView === "projects" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredProjects.length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400">
              <FolderKanban size={40} className="mx-auto mb-3 opacity-40" />
              No projects yet — create your first project to begin tracking.
            </div>
          )}
          {filteredProjects.map((p) => {
            const pTime = timeEntries
              .filter((t) => t.projectId === p.id && t.status === "stopped")
              .reduce((s, t) => s + t.hours, 0);
            const overdue =
              p.status !== "completed" &&
              p.dueDate &&
              p.dueDate < new Date().toISOString().slice(0, 10);
            const pct =
              p.estimatedHours > 0
                ? Math.min(100, Math.round((pTime / p.estimatedHours) * 100))
                : 0;
            const isRunning = timeEntries.some(
              (t) => t.projectId === p.id && t.status === "running",
            );
            return (
              <div
                key={p.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                      {p.name}
                    </h4>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_META[p.status].cls}`}
                      >
                        {STATUS_META[p.status].label}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_META[p.priority].cls}`}
                      >
                        {PRIORITY_META[p.priority].label} priority
                      </span>
                      {overdue && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 flex items-center gap-1">
                          <AlertTriangle size={10} /> Overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                    title="Edit project"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                {p.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
                    {p.description}
                  </p>
                )}
                {p.customerName && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-2">
                    <Users size={12} /> {p.customerName}
                  </div>
                )}
                <div className="mt-auto space-y-2">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <CalendarClock size={12} /> Due {p.dueDate || "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign size={12} /> {currencySymbol}
                      {(p.budget || 0).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      <span>Time vs estimate</span>
                      <span>
                        {pTime.toFixed(1)}h / {p.estimatedHours || 0}h
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {isRunning ? (
                      <button
                        onClick={() => {
                          const run = timeEntries.find(
                            (t) =>
                              t.projectId === p.id && t.status === "running",
                          );
                          if (run) stopTimer(run.id);
                        }}
                        className="flex-1 px-2 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium flex items-center justify-center gap-1"
                      >
                        <Pause size={12} /> Stop
                      </button>
                    ) : (
                      <button
                        onClick={() => startTimer(p.id)}
                        className="flex-1 px-2 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium flex items-center justify-center gap-1"
                      >
                        <Play size={12} /> Start
                      </button>
                    )}
                    <button
                      onClick={() => openNewTime(p.id)}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Clock size={12} /> Log
                    </button>
                    <button
                      onClick={() => setConfirmDelete(p)}
                      className="px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-red-100 dark:bg-white/5 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-500 text-xs"
                      title="Delete project"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeView === "times" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left">Project</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">Hours</th>
                  <th className="px-3 py-2.5 text-center">Billable</th>
                  <th className="px-3 py-2.5 text-left">Note</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredTimes.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-gray-500 dark:text-gray-400"
                    >
                      No time entries yet — start a timer or log hours manually.
                    </td>
                  </tr>
                )}
                {filteredTimes.map((t) => {
                  const elapsedMs = runningTick[t.id];
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-50 dark:hover:bg-white/5"
                    >
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">
                        {t.projectName}
                        {t.status === "running" && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                            LIVE
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                        {t.date || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white">
                        {t.status === "running" && typeof elapsedMs === "number"
                          ? (elapsedMs / 3600000).toFixed(2) + "h"
                          : t.hours.toFixed(2) + "h"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => {
                            flagLocalModified();
                            setTimeEntries(
                              timeEntries.map((x) =>
                                x.id === t.id
                                  ? { ...x, billable: !x.billable }
                                  : x,
                              ),
                            );
                          }}
                          title="Toggle billable"
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${t.billable ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400"}`}
                        >
                          {t.billable ? "Billable" : "Non-bill"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                        {t.note || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {t.status === "running" ? (
                          <button
                            onClick={() => stopTimer(t.id)}
                            className="text-[10px] px-2 py-1 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium"
                          >
                            Stop
                          </button>
                        ) : (
                          <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400">
                            Stopped
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              navigateToTab("invoice", {
                                description: `Time: ${t.projectName}`,
                                amount: 0,
                              })
                            }
                            title="Create invoice for this time"
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                          >
                            <FileText size={14} />
                          </button>
                          <button
                            onClick={() => deleteTimeEntry(t.id)}
                            title="Delete entry"
                            className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === "summary" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <DollarSign size={16} className="text-amber-500" /> Time & Revenue
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">
                  Total hours logged
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {summary.totalHours.toFixed(2)}h
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">
                  Billable hours
                </span>
                <span className="font-medium text-emerald-500">
                  {summary.billableHours.toFixed(2)}h
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">
                  Non-billable hours
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {(summary.totalHours - summary.billableHours).toFixed(2)}h
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-500 dark:text-gray-400">
                  Average billable %
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {summary.totalHours > 0
                    ? Math.round(
                        (summary.billableHours / summary.totalHours) * 100,
                      )
                    : 0}
                  %
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FolderKanban size={16} className="text-amber-500" /> Per-Project
              Hours
            </h3>
            {projects.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                No projects yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {projects.map((p) => {
                  const h = timeEntries
                    .filter(
                      (t) => t.projectId === p.id && t.status === "stopped",
                    )
                    .reduce((s, t) => s + t.hours, 0);
                  const est = p.estimatedHours || 0;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {p.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {STATUS_META[p.status].label} · est {est}h
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {h.toFixed(1)}h
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {est > 0
                            ? `${Math.round((h / est) * 100)}% of estimate`
                            : "—"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 md:col-span-2">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" /> Week at a glance
            </h3>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                const key = d.toISOString().slice(0, 10);
                const label = d.toLocaleDateString(undefined, {
                  weekday: "short",
                });
                const hours = timeEntries
                  .filter((t) => t.date === key)
                  .reduce((s, t) => s + t.hours, 0);
                return (
                  <div
                    key={key}
                    className="bg-gray-50 dark:bg-white/5 rounded-lg p-2 text-center"
                  >
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {label}
                    </div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                      {hours > 0 ? hours.toFixed(1) + "h" : "—"}
                    </div>
                    <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${Math.min(100, hours * 20)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Project form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingId ? "Edit" : "New"} Project
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Project Name *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g. New Service Station Build"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as ProjectStatus,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {VALID_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value as Priority })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {VALID_PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>
                        {PRIORITY_META[pr].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Customer
                  </label>
                  <input
                    value={form.customerName}
                    onChange={(e) =>
                      setForm({ ...form, customerName: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Customer name"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Budget ({currencySymbol})
                  </label>
                  <input
                    type="number"
                    value={form.budget || ""}
                    onChange={(e) =>
                      setForm({ ...form, budget: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) =>
                      setForm({ ...form, dueDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Estimated Hours
                  </label>
                  <input
                    type="number"
                    value={form.estimatedHours || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        estimatedHours: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Team (comma-separated)
                  </label>
                  <input
                    value={(form.team || []).join(", ")}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        team: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="John, Sarah"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <button
                onClick={handleSave}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> Save Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time form modal */}
      {showTimeForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowTimeForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Log Time
              </h3>
              <button
                onClick={() => setShowTimeForm(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Project *
                </label>
                {projects.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Create a project first before logging time.
                  </p>
                ) : (
                  <select
                    value={timeForm.projectId}
                    onChange={(e) =>
                      setTimeForm({ ...timeForm, projectId: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select project...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Date
                  </label>
                  <input
                    type="date"
                    value={timeForm.date}
                    onChange={(e) =>
                      setTimeForm({ ...timeForm, date: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Hours
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={timeForm.hours || ""}
                    onChange={(e) =>
                      setTimeForm({
                        ...timeForm,
                        hours: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Note
                </label>
                <input
                  value={timeForm.note}
                  onChange={(e) =>
                    setTimeForm({ ...timeForm, note: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="What did you work on?"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={timeForm.billable !== false}
                  onChange={(e) =>
                    setTimeForm({ ...timeForm, billable: e.target.checked })
                  }
                  className="rounded"
                />
                Billable (counts toward invoice total)
              </label>
              <button
                onClick={handleSaveTime}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
              >
                <Timer size={16} /> Save Time
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              Delete "{confirmDelete.name}"?
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This also removes its{" "}
              {
                timeEntries.filter((t) => t.projectId === confirmDelete.id)
                  .length
              }{" "}
              time entr
              {timeEntries.filter((t) => t.projectId === confirmDelete.id)
                .length === 1
                ? "y"
                : "ies"}
              .
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
