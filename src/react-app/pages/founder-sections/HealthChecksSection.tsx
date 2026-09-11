/**
 * HealthChecksSection — cloud-backed, real-time uptime monitor management.
 * CRUD monitors (URL, expected status, interval), enable/disable, run a
 * manual check (records latency + up/down status), view last check.
 */

import { useState } from "react";
import {
  HeartPulse,
  Plus,
  X,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  Activity,
} from "lucide-react";
import type {
  HealthCheck,
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

export default function HealthChecksSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [intervalSec, setIntervalSec] = useState(60);

  const reset = () => {
    setName("");
    setUrl("");
    setExpectedStatus(200);
    setIntervalSec(60);
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim() || !url.trim()) return;
    const existing = store.healthChecks.find((h) => h.id === editingId);
    const h: HealthCheck = {
      id: editingId ?? store.uid(),
      name: name.trim(),
      url: url.trim(),
      expectedStatus,
      intervalSec,
      enabled: existing?.enabled ?? true,
      lastChecked: existing?.lastChecked,
      lastStatus: existing?.lastStatus,
      lastLatencyMs: existing?.lastLatencyMs,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.upsertHealthCheck(h);
    logAudit(
      editingId ? "Health Check Updated" : "Health Check Created",
      `"${h.name}"`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const runCheck = async (h: HealthCheck) => {
    const start = performance.now();
    try {
      const res = await fetch(h.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      const latency = Math.round(performance.now() - start);
      const up = res && res.status === h.expectedStatus;
      store.recordHealthCheck(h.id, up ? "up" : "down", latency);
      logAudit(
        "Health Check Ran",
        `"${h.name}" ${up ? "UP" : "DOWN"} (${latency}ms)`,
        up ? "success" : "danger",
      );
    } catch {
      const latency = Math.round(performance.now() - start);
      store.recordHealthCheck(h.id, "down", latency);
      logAudit("Health Check Failed", `"${h.name}"`, "danger");
    }
  };

  const handleDelete = (h: HealthCheck) => {
    store.deleteHealthCheck(h.id);
    logAudit("Health Check Deleted", `"${h.name}"`, "warning");
  };

  const activeCount = store.healthChecks.filter((h) => h.enabled).length;
  const upCount = store.healthChecks.filter(
    (h) => h.lastStatus === "up",
  ).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={HeartPulse}
        title="Health Checks"
        subtitle="Monitor endpoint uptime — real-time synced"
        count={store.healthChecks.length}
        right={
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-green-500/20 text-green-400">
              {upCount} up
            </span>
            <span className="px-2 py-1 rounded bg-white/5 text-gray-400">
              {activeCount} active
            </span>
          </div>
        }
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Monitor
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Monitor" : "New Health Check"}
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
              placeholder="API endpoint"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="URL">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/health"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected status">
              <input
                type="number"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Interval (sec)">
              <input
                type="number"
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
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
        {store.healthChecks.length === 0 && (
          <EmptyState icon={HeartPulse} text="No health monitors configured" />
        )}
        {store.healthChecks.map((h) => (
          <div
            key={h.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {h.name}
                  </span>
                  {h.lastStatus === "up" ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={10} /> UP
                    </span>
                  ) : h.lastStatus === "down" ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                      <XCircle size={10} /> DOWN
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                      Unknown
                    </span>
                  )}
                  {!h.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {h.url}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span>Expects: {h.expectedStatus}</span>
                  <span>Every: {h.intervalSec}s</span>
                  {h.lastLatencyMs !== undefined && (
                    <span>Latency: {h.lastLatencyMs}ms</span>
                  )}
                  {h.lastChecked && (
                    <span>
                      Checked: {new Date(h.lastChecked).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Run check now" onClick={() => runCheck(h)}>
                  <Activity size={15} className="text-green-400" />
                </IconBtn>
                <IconBtn
                  title={h.enabled ? "Disable" : "Enable"}
                  onClick={() => store.toggleHealthCheck(h.id)}
                >
                  <Zap
                    size={15}
                    className={h.enabled ? "text-amber-400" : "text-gray-500"}
                  />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(h)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
