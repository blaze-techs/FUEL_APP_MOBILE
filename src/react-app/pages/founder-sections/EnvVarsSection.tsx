/**
 * EnvVarsSection — cloud-backed, real-time environment variable management.
 * CRUD key/value pairs, mask secret values, categorize, search, export to
 * JSON, import from JSON. Note: these are app-level feature flags/env stored
 * in app_kv, NOT runtime process.env (which cannot be edited from the client).
 */

import { useMemo, useState } from "react";
import {
  Settings,
  Plus,
  X,
  Trash2,
  Search,
  Eye,
  EyeOff,
  Download,
  Upload,
  Copy,
  CheckCircle2,
} from "lucide-react";
import type {
  EnvVar,
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

export default function EnvVarsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [masked, setMasked] = useState(false);
  const [category, setCategory] = useState(store.DEFAULT_ENV_CATEGORIES[0]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  const filtered = useMemo(
    () =>
      store.envVars.filter(
        (e) =>
          e.key.toLowerCase().includes(search.toLowerCase()) ||
          e.category.toLowerCase().includes(search.toLowerCase()),
      ),
    [store.envVars, search],
  );

  const reset = () => {
    setKey("");
    setValue("");
    setMasked(false);
    setCategory(store.DEFAULT_ENV_CATEGORIES[0]);
    setEditingId(null);
  };

  const save = () => {
    if (!key.trim()) return;
    const existing = store.envVars.find((e) => e.id === editingId);
    const e: EnvVar = {
      id: editingId ?? store.uid(),
      key: key.trim().toUpperCase(),
      value: value.trim(),
      masked,
      category,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.upsertEnvVar(e);
    logAudit(
      editingId ? "Env Var Updated" : "Env Var Created",
      e.key,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const handleEdit = (e: EnvVar) => {
    setEditingId(e.id);
    setKey(e.key);
    setValue(e.value);
    setMasked(e.masked);
    setCategory(e.category);
    setShowAdd(true);
  };

  const handleDelete = (e: EnvVar) => {
    store.deleteEnvVar(e.id);
    logAudit("Env Var Deleted", e.key, "warning");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store.envVars, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "env-vars.json";
    a.click();
    URL.revokeObjectURL(url);
    logAudit("Env Vars Exported", `${store.envVars.length} entries`, "info");
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as EnvVar[];
        if (Array.isArray(parsed)) {
          store.bulkImportEnvVars(parsed);
          logAudit("Env Vars Imported", `${parsed.length} entries`, "success");
        }
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  const copyValue = (e: EnvVar) => {
    navigator.clipboard?.writeText(e.value);
    setCopied(e.id);
    setTimeout(() => setCopied(""), 2000);
  };

  const displayValue = (e: EnvVar) =>
    e.masked && !revealed[e.id] ? store.maskValue(e.value) : e.value;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Settings}
        title="Environment Variables"
        subtitle="App-level configuration variables — real-time synced"
        count={store.envVars.length}
        right={
          <div className="flex gap-2">
            <button
              onClick={exportJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
            >
              <Download size={16} /> Export
            </button>
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm cursor-pointer">
              <Upload size={16} /> Import
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && importJson(e.target.files[0])
                }
              />
            </label>
          </div>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search variables..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Variable
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Variable" : "New Variable"}
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="MAX_STATIONS"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono uppercase"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {store.DEFAULT_ENV_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Value">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="my-secret-value"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={masked}
              onChange={(e) => setMasked(e.target.checked)}
              className="accent-amber-500"
            />
            Mask value as secret
          </label>
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
        {filtered.length === 0 && (
          <EmptyState icon={Settings} text="No environment variables" />
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            className="rounded-xl bg-white/5 border border-white/10 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm text-white font-mono">{e.key}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                    {e.category}
                  </span>
                  {e.masked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      Secret
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="flex-1 text-[11px] text-gray-400 font-mono truncate px-2 py-1 rounded bg-black/30">
                    {displayValue(e)}
                  </code>
                  {e.masked && (
                    <button
                      onClick={() =>
                        setRevealed((p) => ({ ...p, [e.id]: !p[e.id] }))
                      }
                      className="text-gray-400 hover:text-white"
                    >
                      {revealed[e.id] ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => copyValue(e)}
                    className="text-gray-400 hover:text-white"
                  >
                    {copied === e.id ? (
                      <CheckCircle2 size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Edit" onClick={() => handleEdit(e)}>
                  <EditIconSmall />
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

function EditIconSmall() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}
