/**
 * ScheduledJobsSection — cloud-backed, real-time scheduled job viewer.
 * List jobs with cron schedule, enable/disable, run-now, view last run
 * status + duration, add/edit/delete custom jobs.
 */

import { useState } from "react";
import {
  Clock,
  Plus,
  X,
  Trash2,
  Play,
  Zap,
  CheckCircle2,
  XCircle,
  Loader,
} from "lucide-react";
import type {
  ScheduledJob,
  JobStatus,
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
  JobStatus,
  { color: string; icon?: React.ReactNode }
> = {
  idle: { color: "bg-gray-500/20 text-gray-400" },
  running: {
    color: "bg-blue-500/20 text-blue-400",
    icon: <Loader size={10} className="animate-spin" />,
  },
  success: {
    color: "bg-green-500/20 text-green-400",
    icon: <CheckCircle2 size={10} />,
  },
  failed: { color: "bg-red-500/20 text-red-400", icon: <XCircle size={10} /> },
  disabled: { color: "bg-gray-500/20 text-gray-400" },
};

export default function ScheduledJobsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("0 0 * * *");
  const [endpoint, setEndpoint] = useState("/api/cron/");

  const reset = () => {
    setName("");
    setDescription("");
    setSchedule("0 0 * * *");
    setEndpoint("/api/cron/");
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim() || !endpoint.trim()) return;
    const existing = store.jobs.find((j) => j.id === editingId);
    const job: ScheduledJob = {
      id:
        editingId ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      name: name.trim(),
      description: description.trim(),
      schedule,
      enabled: existing?.enabled ?? true,
      lastStatus: existing?.lastStatus ?? "idle",
      lastRun: existing?.lastRun,
      lastDurationMs: existing?.lastDurationMs,
      endpoint: endpoint.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.upsertJob(job);
    logAudit(
      editingId ? "Job Updated" : "Job Created",
      `"${job.name}"`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const runNow = async (j: ScheduledJob) => {
    store.runJobNow(j.id);
    logAudit("Job Run Triggered", `"${j.name}"`, "info");
    const start = performance.now();
    try {
      const res = await fetch(j.endpoint, { method: "POST" }).catch(() => null);
      const duration = Math.round(performance.now() - start);
      const ok = res && res.ok;
      store.finishJob(j.id, ok ? "success" : "failed", duration);
      logAudit(
        "Job Finished",
        `"${j.name}" ${ok ? "OK" : "FAILED"} (${duration}ms)`,
        ok ? "success" : "danger",
      );
    } catch {
      const duration = Math.round(performance.now() - start);
      store.finishJob(j.id, "failed", duration);
      logAudit("Job Failed", `"${j.name}"`, "danger");
    }
  };

  const handleDelete = (j: ScheduledJob) => {
    if (!confirm(`Delete job "${j.name}"?`)) return;
    store.deleteJob(j.id);
    logAudit("Job Deleted", `"${j.name}"`, "warning");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Clock}
        title="Scheduled Jobs"
        subtitle="View and trigger cron jobs — real-time synced"
        count={store.jobs.length}
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Job
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Job" : "New Scheduled Job"}
            </h3>
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
              placeholder="Daily report"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this job does"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cron schedule">
              <input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 0 * * *"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
            <Field label="Endpoint">
              <input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="/api/cron/..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              {editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.jobs.length === 0 && (
          <EmptyState icon={Clock} text="No scheduled jobs" />
        )}
        {store.jobs.map((j) => {
          const st = STATUS_STYLES[j.lastStatus];
          return (
            <div
              key={j.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {j.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${st.color}`}
                    >
                      {st.icon}
                      {j.lastStatus}
                    </span>
                    {j.enabled && <Zap size={12} className="text-amber-400" />}
                  </div>
                  {j.description && (
                    <p className="text-xs text-gray-400 mt-1">
                      {j.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500 font-mono">
                    <span>⏰ {j.schedule}</span>
                    <span>→ {j.endpoint}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                    {j.lastRun && (
                      <span>
                        Last run: {new Date(j.lastRun).toLocaleString()}
                      </span>
                    )}
                    {j.lastDurationMs !== undefined && (
                      <span>Duration: {j.lastDurationMs}ms</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn title="Run now" onClick={() => runNow(j)}>
                    <Play size={15} className="text-green-400" />
                  </IconBtn>
                  <IconBtn
                    title={j.enabled ? "Disable" : "Enable"}
                    onClick={() => store.toggleJob(j.id)}
                  >
                    <Zap
                      size={15}
                      className={j.enabled ? "text-amber-400" : "text-gray-500"}
                    />
                  </IconBtn>
                  <IconBtn title="Delete" onClick={() => handleDelete(j)}>
                    <Trash2 size={15} className="text-red-400" />
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
