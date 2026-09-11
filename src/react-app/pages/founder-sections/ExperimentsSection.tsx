/**
 * ExperimentsSection — cloud-backed, real-time A/B experiment management.
 * CRUD experiments with variants, traffic-split weights, metric, status
 * (draft/running/paused/completed), start/end dates.
 */

import { useState } from "react";
import {
  FlaskConical,
  Plus,
  X,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  Copy,
} from "lucide-react";
import type {
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
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

const STATUS_STYLES: Record<ExperimentStatus, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  running: "bg-green-500/20 text-green-400",
  paused: "bg-amber-500/20 text-amber-400",
  completed: "bg-blue-500/20 text-blue-400",
};

export default function ExperimentsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metric, setMetric] = useState("");
  const [variants, setVariants] = useState<ExperimentVariant[]>([
    { id: "control", name: "Control", weight: 50 },
    { id: "variant_a", name: "Variant A", weight: 50 },
  ]);

  const reset = () => {
    setName("");
    setDescription("");
    setMetric("");
    setVariants([
      { id: "control", name: "Control", weight: 50 },
      { id: "variant_a", name: "Variant A", weight: 50 },
    ]);
    setEditingId(null);
  };

  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);

  const save = () => {
    if (!name.trim()) return;
    const existing = store.experiments.find((e) => e.id === editingId);
    const e: Experiment = {
      id: editingId ?? `exp_${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      status: existing?.status ?? "draft",
      variants,
      metric: metric.trim() || "conversion_rate",
      startDate: existing?.startDate,
      endDate: existing?.endDate,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.upsertExperiment(e);
    logAudit(
      editingId ? "Experiment Updated" : "Experiment Created",
      `"${e.name}"`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const updateVariantWeight = (id: string, weight: number) =>
    setVariants((p) =>
      p.map((v) =>
        v.id === id ? { ...v, weight: Math.max(0, Math.min(100, weight)) } : v,
      ),
    );

  const updateVariantName = (id: string, n: string) =>
    setVariants((p) => p.map((v) => (v.id === id ? { ...v, name: n } : v)));

  const addVariant = () =>
    setVariants((p) => [
      ...p,
      {
        id: `variant_${Date.now().toString(36)}`,
        name: `Variant ${p.length}`,
        weight: 0,
      },
    ]);

  const removeVariant = (id: string) =>
    setVariants((p) => p.filter((v) => v.id !== id));

  const normalizeWeights = () => {
    const n = variants.length;
    if (n === 0) return;
    const each = Math.floor(100 / n);
    const remainder = 100 - each * n;
    setVariants(
      variants.map((v, i) => ({
        ...v,
        weight: each + (i === 0 ? remainder : 0),
      })),
    );
  };

  const handleStatus = (e: Experiment, status: ExperimentStatus) => {
    store.setExperimentStatus(e.id, status);
    logAudit("Experiment Status Changed", `"${e.name}" -> ${status}`, "info");
  };

  const handleDelete = (e: Experiment) => {
    if (!confirm(`Delete experiment "${e.name}"?`)) return;
    store.deleteExperiment(e.id);
    logAudit("Experiment Deleted", `"${e.name}"`, "warning");
  };

  const duplicate = (e: Experiment) => {
    store.upsertExperiment({
      ...e,
      id: `exp_${Date.now().toString(36)}`,
      name: `${e.name} (copy)`,
      status: "draft",
      createdAt: new Date().toISOString(),
      startDate: undefined,
      endDate: undefined,
    });
    logAudit("Experiment Duplicated", `"${e.name}"`, "info");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={FlaskConical}
        title="A/B Experiments"
        subtitle="Run controlled experiments with traffic splits — real-time synced"
        count={store.experiments.length}
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Experiment
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Experiment" : "New Experiment"}
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
                placeholder="Checkout button color"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Success metric">
              <input
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                placeholder="conversion_rate"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Testing red vs green CTA"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400">Variants & traffic split</p>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs ${totalWeight === 100 ? "text-green-400" : "text-amber-400"}`}
                >
                  Total: {totalWeight}%
                </span>
                <button
                  onClick={normalizeWeights}
                  className="text-[11px] px-2 py-1 rounded bg-white/5 text-gray-300 hover:bg-white/10"
                >
                  Normalize
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {variants.map((v) => (
                <div key={v.id} className="flex items-center gap-2">
                  <input
                    value={v.name}
                    onChange={(e) => updateVariantName(v.id, e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
                  />
                  <div className="flex items-center gap-2 w-40">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={v.weight}
                      onChange={(e) =>
                        updateVariantWeight(v.id, Number(e.target.value))
                      }
                      className="flex-1 accent-amber-500"
                    />
                    <span className="text-xs text-gray-400 w-10 text-right">
                      {v.weight}%
                    </span>
                  </div>
                  <button
                    onClick={() => removeVariant(v.id)}
                    disabled={variants.length <= 2}
                    className="text-gray-400 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addVariant}
              className="mt-2 flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
            >
              <Plus size={14} /> Add variant
            </button>
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
              disabled={!name.trim()}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-sm font-medium"
            >
              {editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.experiments.length === 0 && (
          <EmptyState icon={FlaskConical} text="No experiments configured" />
        )}
        {store.experiments.map((e) => (
          <div
            key={e.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {e.name}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[e.status]}`}
                  >
                    {e.status}
                  </span>
                </div>
                {e.description && (
                  <p className="text-xs text-gray-400 mt-1">{e.description}</p>
                )}
                <p className="text-[11px] text-gray-500 mt-1">
                  Metric: <code className="font-mono">{e.metric}</code>
                </p>
                <div className="flex gap-1 mt-2 h-3 rounded-full overflow-hidden bg-black/30">
                  {e.variants.map((v, i) => (
                    <div
                      key={v.id}
                      title={`${v.name}: ${v.weight}%`}
                      style={{
                        width: `${v.weight}%`,
                        background: `hsl(${(i * 67) % 360} 70% 50%)`,
                      }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {e.variants.map((v) => (
                    <span key={v.id} className="text-[10px] text-gray-400">
                      {v.name}: {v.weight}%
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                  {e.startDate && (
                    <span>
                      Started: {new Date(e.startDate).toLocaleDateString()}
                    </span>
                  )}
                  {e.endDate && (
                    <span>
                      Ended: {new Date(e.endDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {e.status === "running" ? (
                  <IconBtn
                    title="Pause"
                    onClick={() => handleStatus(e, "paused")}
                  >
                    <Pause size={15} className="text-amber-400" />
                  </IconBtn>
                ) : (
                  <IconBtn
                    title="Start"
                    onClick={() => handleStatus(e, "running")}
                  >
                    <Play size={15} className="text-green-400" />
                  </IconBtn>
                )}
                <IconBtn
                  title="Complete"
                  onClick={() => handleStatus(e, "completed")}
                >
                  <CheckCircle2 size={15} className="text-blue-400" />
                </IconBtn>
                <IconBtn title="Duplicate" onClick={() => duplicate(e)}>
                  <Copy size={15} />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(e)}>
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
