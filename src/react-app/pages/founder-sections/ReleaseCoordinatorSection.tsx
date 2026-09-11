/**
 * ReleaseCoordinatorSection — cloud-backed, real-time release rollout
 * coordinator. Create releases with target % + feature flags, promote
 * via quick percent buttons, pause, rollback, delete.
 */

import { useMemo, useState } from "react";
import {
  Rocket,
  Plus,
  X,
  Trash2,
  Play,
  Pause,
  Undo2,
  TrendingUp,
  Flag,
} from "lucide-react";
import type {
  ReleaseCoordinator,
  ReleaseStatus,
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

const STATUS_STYLES: Record<ReleaseStatus, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  canary: "bg-amber-500/20 text-amber-400",
  rolling: "bg-blue-500/20 text-blue-400",
  live: "bg-green-500/20 text-green-400",
  paused: "bg-orange-500/20 text-orange-400",
  "rolled-back": "bg-red-500/20 text-red-400",
};

const QUICK_PERCENTS = [10, 25, 50, 100];

export default function ReleaseCoordinatorSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [targetPercent, setTargetPercent] = useState(100);
  const [enabledFlags, setEnabledFlags] = useState<string>("");
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const live = store.releases.filter((r) => r.status === "live").length;
    const rolling = store.releases.filter((r) => r.status === "rolling").length;
    const paused = store.releases.filter((r) => r.status === "paused").length;
    const draft = store.releases.filter((r) => r.status === "draft").length;
    return { live, rolling, paused, draft };
  }, [store.releases]);

  const reset = () => {
    setName("");
    setVersion("");
    setDescription("");
    setTargetPercent(100);
    setEnabledFlags("");
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim() || !version.trim()) return;
    const existing = store.releases.find((r) => r.id === editingId);
    const r: ReleaseCoordinator = {
      id: editingId ?? store.uid(),
      name: name.trim(),
      version: version.trim(),
      description: description.trim(),
      status: existing?.status ?? "draft",
      rolloutPercent: existing?.rolloutPercent ?? 0,
      targetPercent,
      enabledFlags: enabledFlags
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      cohortSize: existing?.cohortSize ?? 0,
      affectedUsers: existing?.affectedUsers ?? 0,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      promotedAt: existing?.promotedAt,
      notes: existing?.notes,
    };
    store.upsertRelease(r);
    logAudit(
      editingId ? "Release Updated" : "Release Created",
      `"${r.name}" v${r.version}`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const handleEdit = (r: ReleaseCoordinator) => {
    setEditingId(r.id);
    setName(r.name);
    setVersion(r.version);
    setDescription(r.description);
    setTargetPercent(r.targetPercent);
    setEnabledFlags(r.enabledFlags.join(", "));
    setShowAdd(true);
  };

  const handlePromote = (r: ReleaseCoordinator, percent: number) => {
    store.promoteRelease(r.id, percent);
    logAudit("Release Promoted", `"${r.name}" -> ${percent}%`, "info");
    setPromotingId(null);
  };

  const handlePause = (r: ReleaseCoordinator) => {
    store.pauseRelease(r.id);
    logAudit("Release Paused", `"${r.name}"`, "warning");
  };

  const handleRollback = (r: ReleaseCoordinator) => {
    if (!confirm(`Rollback release "${r.name}"? Rollout returns to 0%.`))
      return;
    store.rollbackRelease(r.id);
    logAudit("Release Rolled Back", `"${r.name}"`, "danger");
  };

  const handleDelete = (r: ReleaseCoordinator) => {
    if (!confirm(`Delete release "${r.name}"?`)) return;
    store.deleteRelease(r.id);
    logAudit("Release Deleted", `"${r.name}"`, "warning");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Rocket}
        title="Release Coordinator"
        subtitle="Gradual rollout management — real-time synced across devices"
        count={store.releases.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Draft" value={stats.draft} color="text-gray-400" />
        <StatCard label="Rolling" value={stats.rolling} color="text-blue-400" />
        <StatCard label="Paused" value={stats.paused} color="text-orange-400" />
        <StatCard label="Live" value={stats.live} color="text-green-400" />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Release
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Release" : "New Release"}
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Checkout v2"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Version">
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="2.1.0"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Redesigned checkout flow"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target rollout %">
              <input
                type="number"
                min={0}
                max={100}
                value={targetPercent}
                onChange={(e) => setTargetPercent(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Feature flags (comma-separated)">
              <input
                value={enabledFlags}
                onChange={(e) => setEnabledFlags(e.target.value)}
                placeholder="new_checkout, express_pay"
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
        {store.releases.length === 0 && (
          <EmptyState icon={Rocket} text="No releases coordinated yet" />
        )}
        {store.releases.map((r) => (
          <div
            key={r.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {r.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                    v{r.version}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
                {r.description && (
                  <p className="text-xs text-gray-400 mt-1">{r.description}</p>
                )}
                <div className="mt-2 flex items-center gap-2 max-w-sm">
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${r.rolloutPercent}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-300 font-mono">
                    {r.rolloutPercent}/{r.targetPercent}%
                  </span>
                </div>
                {r.enabledFlags.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    <Flag size={10} className="text-gray-500" />
                    {r.enabledFlags.map((f) => (
                      <span
                        key={f}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                  <span>Cohort: {r.cohortSize}</span>
                  <span>Users: {r.affectedUsers}</span>
                  <span>Created: {new Date(r.createdAt).toLocaleString()}</span>
                  {r.promotedAt && (
                    <span>
                      Promoted: {new Date(r.promotedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {promotingId === r.id && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-gray-400">
                      Promote to:
                    </span>
                    {QUICK_PERCENTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePromote(r, p)}
                        className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 text-[10px] hover:bg-amber-500/30"
                      >
                        {p}%
                      </button>
                    ))}
                    <button
                      onClick={() => setPromotingId(null)}
                      className="text-[10px] text-gray-500 hover:text-white"
                    >
                      cancel
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn
                  title="Promote"
                  onClick={() =>
                    setPromotingId(promotingId === r.id ? null : r.id)
                  }
                >
                  <TrendingUp size={15} className="text-amber-400" />
                </IconBtn>
                <IconBtn title="Pause" onClick={() => handlePause(r)}>
                  <Pause size={15} className="text-orange-400" />
                </IconBtn>
                <IconBtn title="Rollback" onClick={() => handleRollback(r)}>
                  <Undo2 size={15} className="text-red-400" />
                </IconBtn>
                <IconBtn title="Edit" onClick={() => handleEdit(r)}>
                  <Play size={15} className="text-gray-300" />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(r)}>
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

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
