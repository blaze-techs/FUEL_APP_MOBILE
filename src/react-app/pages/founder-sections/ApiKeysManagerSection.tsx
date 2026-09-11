/**
 * ApiKeysManagerSection — cloud-backed, real-time API key management.
 * CRUD keys, scope picker, rate limit, expiry, reveal/mask, copy, rotate,
 * enable/disable, usage stats.
 */

import { useMemo, useState } from "react";
import {
  Key,
  Plus,
  X,
  Trash2,
  Search,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
  Zap,
  Clock,
} from "lucide-react";
import type {
  ApiKeyConfig,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import {
  SectionHeader,
  Field,
  StatusBadge,
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

export default function ApiKeysManagerSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState(60);
  const [expiresAt, setExpiresAt] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  const filtered = useMemo(
    () =>
      store.apiKeys.filter((k) =>
        k.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [store.apiKeys, search],
  );

  const reset = () => {
    setName("");
    setScopes([]);
    setRateLimit(60);
    setExpiresAt("");
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim()) return;
    const id = editingId ?? store.uid();
    const existing = store.apiKeys.find((k) => k.id === editingId);
    const ak: ApiKeyConfig = {
      id,
      name: name.trim(),
      key: existing?.key ?? store.randomKey("fpa"),
      scopes,
      rateLimitPerMin: rateLimit,
      expiresAt: expiresAt || undefined,
      active: true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      usageCount: existing?.usageCount ?? 0,
    };
    store.upsertApiKey(ak);
    logAudit(
      editingId ? "API Key Updated" : "API Key Created",
      `"${ak.name}"`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const handleDelete = (k: ApiKeyConfig) => {
    if (!confirm(`Revoke API key "${k.name}"?`)) return;
    store.deleteApiKey(k.id);
    logAudit("API Key Revoked", `"${k.name}"`, "danger");
  };

  const toggleScope = (s: string) =>
    setScopes((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  const copyKey = (k: ApiKeyConfig) => {
    navigator.clipboard?.writeText(k.key);
    setCopied(k.id);
    store.recordApiKeyUsage(k.id);
    setTimeout(() => setCopied(""), 2000);
  };

  const isExpired = (k: ApiKeyConfig) =>
    k.expiresAt ? new Date(k.expiresAt) < new Date() : false;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Key}
        title="API Keys"
        subtitle="Manage programmatic access keys — real-time synced"
        count={store.apiKeys.length}
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
            placeholder="Search keys..."
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
          <Plus size={16} /> New Key
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit API Key" : "New API Key"}
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
              placeholder="Production server"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate limit (req/min)">
              <input
                type="number"
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Expires (optional)">
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">Scopes</p>
            <div className="flex flex-wrap gap-2">
              {store.DEFAULT_API_SCOPES.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleScope(s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono ${
                    scopes.includes(s)
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
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
        {filtered.length === 0 && (
          <EmptyState icon={Key} text="No API keys issued" />
        )}
        {filtered.map((k) => {
          const expired = isExpired(k);
          return (
            <div
              key={k.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {k.name}
                    </span>
                    {expired ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                        <Clock size={10} /> Expired
                      </span>
                    ) : (
                      <StatusBadge active={k.active} />
                    )}
                    {k.expiresAt && !expired && (
                      <span className="text-[10px] text-gray-500">
                        expires {new Date(k.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <code className="flex-1 text-[11px] text-gray-400 font-mono truncate px-2 py-1 rounded bg-black/30">
                      {revealed[k.id] ? k.key : store.maskValue(k.key)}
                    </code>
                    <button
                      onClick={() =>
                        setRevealed((p) => ({ ...p, [k.id]: !p[k.id] }))
                      }
                      className="text-gray-400 hover:text-white"
                    >
                      {revealed[k.id] ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => copyKey(k)}
                      className="text-gray-400 hover:text-white"
                    >
                      {copied === k.id ? (
                        <CheckCircle2 size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {k.scopes.map((s) => (
                      <span
                        key={s}
                        className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-gray-400 font-mono"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn
                    title="Rotate"
                    onClick={() => {
                      store.rotateApiKey(k.id);
                      logAudit("API Key Rotated", `"${k.name}"`, "warning");
                    }}
                  >
                    <RefreshCwIcon />
                  </IconBtn>
                  <IconBtn
                    title={k.active ? "Disable" : "Enable"}
                    onClick={() => store.toggleApiKey(k.id)}
                  >
                    <Zap
                      size={15}
                      className={k.active ? "text-amber-400" : "text-gray-500"}
                    />
                  </IconBtn>
                  <IconBtn title="Revoke" onClick={() => handleDelete(k)}>
                    <Trash2 size={15} className="text-red-400" />
                  </IconBtn>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                <span>Rate: {k.rateLimitPerMin}/min</span>
                <span>Usage: {k.usageCount}</span>
                {k.lastUsed && (
                  <span>
                    Last used: {new Date(k.lastUsed).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RefreshCwIcon() {
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
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
