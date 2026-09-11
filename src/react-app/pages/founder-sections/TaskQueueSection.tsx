/**
 * TaskQueueSection — cloud-backed, real-time background task queue.
 * Enqueue tasks (email/sync/export/import/report/cleanup/custom), set
 * priority + payload + schedule, retry/cancel tasks, clear completed.
 * Filter by status/type with stat cards.
 */

import { useMemo, useState } from "react";
import {
  ListChecks,
  Plus,
  X,
  Search,
  Play,
  Ban,
  CheckCircle2,
  Loader,
  XCircle,
  Clock,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type {
  TaskQueueItem,
  TaskStatus,
  TaskPriority,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import {
  SectionHeader,
  Field,
  IconBtn,
  EmptyState,
} from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const STATUS_STYLES: Record<
  TaskStatus,
  { color: string; icon?: React.ReactNode }
> = {
  queued: { color: "bg-gray-500/20 text-gray-400", icon: <Clock size={10} /> },
  running: {
    color: "bg-blue-500/20 text-blue-400",
    icon: <Loader size={10} className="animate-spin" />,
  },
  completed: {
    color: "bg-green-500/20 text-green-400",
    icon: <CheckCircle2 size={10} />,
  },
  failed: { color: "bg-red-500/20 text-red-400", icon: <XCircle size={10} /> },
  retrying: {
    color: "bg-amber-500/20 text-amber-400",
    icon: <Loader size={10} className="animate-spin" />,
  },
};

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-gray-500/20 text-gray-400",
  normal: "bg-blue-500/20 text-blue-400",
  high: "bg-amber-500/20 text-amber-400",
  critical: "bg-red-500/20 text-red-400",
};

const TYPES: TaskQueueItem["type"][] = [
  "email",
  "sync",
  "export",
  "import",
  "report",
  "cleanup",
  "custom",
];
const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

export default function TaskQueueSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskQueueItem["type"]>("email");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [payload, setPayload] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.taskQueue.filter((t) => {
      const matchesQ =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q);
      const matchesStatus = filterStatus === "all" || t.status === filterStatus;
      const matchesType = filterType === "all" || t.type === filterType;
      return matchesQ && matchesStatus && matchesType;
    });
  }, [store.taskQueue, search, filterStatus, filterType]);

  const stats = useMemo(() => {
    const queued = store.taskQueue.filter((t) => t.status === "queued").length;
    const running = store.taskQueue.filter(
      (t) => t.status === "running",
    ).length;
    const failed = store.taskQueue.filter((t) => t.status === "failed").length;
    const completed = store.taskQueue.filter(
      (t) => t.status === "completed",
    ).length;
    return { queued, running, failed, completed };
  }, [store.taskQueue]);

  const reset = () => {
    setName("");
    setType("email");
    setPriority("normal");
    setPayload("");
    setScheduledFor("");
  };

  const enqueue = () => {
    if (!name.trim()) return;
    store.enqueueTask({
      name: name.trim(),
      type,
      priority,
      payload: payload.trim() || undefined,
      maxAttempts: 3,
      scheduledFor: scheduledFor || undefined,
    });
    logAudit("Task Enqueued", `"${name.trim()}" (${type})`, "info");
    reset();
    setShowAdd(false);
  };

  const handleRetry = (t: TaskQueueItem) => {
    store.retryTask(t.id);
    logAudit("Task Retried", `"${t.name}" (attempt ${t.attempts + 1})`, "info");
  };

  const handleCancel = (t: TaskQueueItem) => {
    if (!confirm(`Cancel task "${t.name}"?`)) return;
    store.cancelTask(t.id);
    logAudit("Task Cancelled", `"${t.name}"`, "warning");
  };

  const handleClearCompleted = () => {
    const n = store.taskQueue.filter((t) => t.status === "completed").length;
    if (n === 0) return;
    if (!confirm(`Clear ${n} completed task(s)?`)) return;
    store.clearCompletedTasks();
    logAudit("Completed Tasks Cleared", `${n} tasks`, "warning");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={ListChecks}
        title="Task Queue"
        subtitle="Background job processing — real-time synced across devices"
        count={store.taskQueue.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Queued"
          value={stats.queued}
          icon={Clock}
          color="text-gray-400"
        />
        <StatCard
          label="Running"
          value={stats.running}
          icon={Loader}
          color="text-blue-400"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={XCircle}
          color="text-red-400"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="text-green-400"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All statuses</option>
          <option value="queued">queued</option>
          <option value="running">running</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="retrying">retrying</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Task
        </button>
        <button
          onClick={handleClearCompleted}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
        >
          <Trash2 size={16} /> Clear Completed
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New Task</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Send weekly report"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as TaskQueueItem["type"])
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Payload (JSON, optional)">
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder='{"key":"value"}'
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <Field label="Scheduled for (optional ISO datetime)">
            <input
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              placeholder="2026-08-12T12:00:00.000Z"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={enqueue}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Enqueue
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={ListChecks} text="No tasks in queue" />
        )}
        {filtered.map((t) => {
          const st = STATUS_STYLES[t.status];
          return (
            <div
              key={t.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {t.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                      {t.type}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${st.color}`}
                    >
                      {st.icon}
                      {t.status}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_STYLES[t.priority]}`}
                    >
                      {t.priority}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden max-w-xs">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-400">
                      {t.progress}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                    <span>
                      Attempts: {t.attempts}/{t.maxAttempts}
                    </span>
                    <span>
                      Created: {new Date(t.createdAt).toLocaleString()}
                    </span>
                    {t.startedAt && (
                      <span>
                        Started: {new Date(t.startedAt).toLocaleString()}
                      </span>
                    )}
                    {t.completedAt && (
                      <span>
                        Done: {new Date(t.completedAt).toLocaleString()}
                      </span>
                    )}
                    {t.scheduledFor && (
                      <span>
                        Scheduled: {new Date(t.scheduledFor).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {t.error && (
                    <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {t.error}
                    </p>
                  )}
                  {t.result && (
                    <p className="text-[11px] text-gray-400 mt-1 break-words">
                      {t.result}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn title="Retry" onClick={() => handleRetry(t)}>
                    <Play size={15} className="text-green-400" />
                  </IconBtn>
                  <IconBtn title="Cancel" onClick={() => handleCancel(t)}>
                    <Ban size={15} className="text-red-400" />
                  </IconBtn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className={color} />
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
