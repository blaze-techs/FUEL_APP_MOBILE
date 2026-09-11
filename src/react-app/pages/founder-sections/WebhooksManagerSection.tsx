/**
 * WebhooksManagerSection — cloud-backed, real-time webhook management for the
 * Founder Console. CRUD webhooks, pick events, configure retry/timeout,
 * rotate signing secret, enable/disable, test-send, and view last status.
 */

import { useMemo, useState } from "react";
import {
  Webhook,
  Plus,
  X,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  Send,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Zap,
} from "lucide-react";
import type {
  WebhookConfig,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function WebhooksManagerSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(3);
  const [retryDelayMs, setRetryDelayMs] = useState(1000);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [revealedSecrets, setRevealedSecrets] = useState<
    Record<string, boolean>
  >({});
  const [copied, setCopied] = useState("");

  const filtered = useMemo(
    () =>
      store.webhooks.filter(
        (w) =>
          w.name.toLowerCase().includes(search.toLowerCase()) ||
          w.url.toLowerCase().includes(search.toLowerCase()),
      ),
    [store.webhooks, search],
  );

  const resetForm = () => {
    setName("");
    setUrl("");
    setSecret("");
    setEvents([]);
    setRetryCount(3);
    setRetryDelayMs(1000);
    setTimeoutMs(10000);
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim() || !url.trim()) return;
    const id = editingId ?? `${Date.now().toString(36)}`;
    const wh: WebhookConfig = {
      id,
      name: name.trim(),
      url: url.trim(),
      events,
      active: true,
      secret: secret || store.randomKey("whsec"),
      retryCount,
      retryDelayMs,
      timeoutMs,
      createdAt: editingId
        ? (store.webhooks.find((w) => w.id === editingId)?.createdAt ??
          new Date().toISOString())
        : new Date().toISOString(),
    };
    store.upsertWebhook(wh);
    logAudit(
      editingId ? "Webhook Updated" : "Webhook Created",
      `"${wh.name}" -> ${wh.url}`,
      "success",
    );
    resetForm();
    setShowAdd(false);
  };

  const handleEdit = (w: WebhookConfig) => {
    setEditingId(w.id);
    setName(w.name);
    setUrl(w.url);
    setSecret(w.secret);
    setEvents(w.events);
    setRetryCount(w.retryCount);
    setRetryDelayMs(w.retryDelayMs);
    setTimeoutMs(w.timeoutMs);
    setShowAdd(true);
  };

  const handleDelete = (w: WebhookConfig) => {
    if (!confirm(`Delete webhook "${w.name}"?`)) return;
    store.deleteWebhook(w.id);
    logAudit("Webhook Deleted", `"${w.name}"`, "warning");
  };

  const testSend = async (w: WebhookConfig) => {
    store.recordWebhookTrigger(w.id, "pending");
    logAudit("Webhook Test Sent", `"${w.name}"`, "info");
    try {
      const res = await fetch(w.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "test.ping",
          timestamp: new Date().toISOString(),
          source: "founder-console",
        }),
        signal: AbortSignal.timeout(w.timeoutMs || 10000),
      }).catch(() => null);
      store.recordWebhookTrigger(w.id, res && res.ok ? "success" : "failed");
      logAudit(
        "Webhook Test Result",
        `"${w.name}" ${res && res.ok ? "OK" : "FAILED"}`,
        res && res.ok ? "success" : "danger",
      );
    } catch {
      store.recordWebhookTrigger(w.id, "failed");
      logAudit("Webhook Test Failed", `"${w.name}"`, "danger");
    }
  };

  const toggleEvent = (ev: string) =>
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );

  const copySecret = (w: WebhookConfig) => {
    navigator.clipboard?.writeText(w.secret);
    setCopied(w.id);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Webhook}
        title="Webhooks"
        subtitle="Real-time event delivery — synced across all founder devices"
        count={store.webhooks.length}
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
            placeholder="Search webhooks..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Webhook
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Webhook" : "New Webhook"}
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My integration"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="URL">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <Field label="Signing Secret (leave blank to auto-generate)">
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="auto-generated"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Retries">
              <input
                type="number"
                value={retryCount}
                onChange={(e) => setRetryCount(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Retry delay (ms)">
              <input
                type="number"
                value={retryDelayMs}
                onChange={(e) => setRetryDelayMs(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Timeout (ms)">
              <input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">Events to deliver</p>
            <div className="flex flex-wrap gap-2">
              {store.DEFAULT_WEBHOOK_EVENTS.map((ev) => (
                <button
                  key={ev}
                  onClick={() => toggleEvent(ev)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono ${
                    events.includes(ev)
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {ev}
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
          <EmptyState icon={Webhook} text="No webhooks configured" />
        )}
        {filtered.map((w) => (
          <div
            key={w.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {w.name}
                  </span>
                  <StatusBadge active={w.active} status={w.lastStatus} />
                </div>
                <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {w.url}
                </p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {w.events.map((ev) => (
                    <span
                      key={ev}
                      className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-gray-400 font-mono"
                    >
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Test send" onClick={() => testSend(w)}>
                  <Send size={15} />
                </IconBtn>
                <IconBtn title="Edit" onClick={() => handleEdit(w)}>
                  <RefreshCw size={15} />
                </IconBtn>
                <IconBtn
                  title={w.active ? "Disable" : "Enable"}
                  onClick={() => store.toggleWebhook(w.id)}
                >
                  <Zap
                    size={15}
                    className={w.active ? "text-amber-400" : "text-gray-500"}
                  />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(w)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
              <span>Retries: {w.retryCount}</span>
              <span>Delay: {w.retryDelayMs}ms</span>
              <span>Timeout: {w.timeoutMs}ms</span>
              {w.lastTriggered && (
                <span>Last: {new Date(w.lastTriggered).toLocaleString()}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 text-[11px] text-gray-400 font-mono truncate px-2 py-1 rounded bg-black/30">
                {revealedSecrets[w.id] ? w.secret : store.maskValue(w.secret)}
              </code>
              <button
                onClick={() =>
                  setRevealedSecrets((p) => ({ ...p, [w.id]: !p[w.id] }))
                }
                className="text-gray-400 hover:text-white"
              >
                {revealedSecrets[w.id] ? (
                  <EyeOff size={14} />
                ) : (
                  <Eye size={14} />
                )}
              </button>
              <button
                onClick={() => copySecret(w)}
                className="text-gray-400 hover:text-white"
              >
                {copied === w.id ? (
                  <CheckCircle2 size={14} className="text-green-400" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
              <button
                onClick={() => {
                  store.rotateWebhookSecret(w.id);
                  logAudit("Webhook Secret Rotated", `"${w.name}"`, "warning");
                }}
                className="text-[11px] px-2 py-1 rounded bg-white/5 text-gray-300 hover:bg-white/10"
              >
                Rotate
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── shared UI helpers (local) ─── */
export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  count,
  right,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Icon size={20} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            {title}
            {count !== undefined && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400">
                {count}
              </span>
            )}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function StatusBadge({
  active,
  status,
}: {
  active: boolean;
  status?: "success" | "failed" | "pending";
}) {
  if (!active)
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
        Disabled
      </span>
    );
  if (status === "success")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
        <CheckCircle2 size={10} /> OK
      </span>
    );
  if (status === "failed")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
        <XCircle size={10} /> Failed
      </span>
    );
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
      Active
    </span>
  );
}

export function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon: Icon,
  text,
}: {
  icon: React.ElementType;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 py-12 flex flex-col items-center text-gray-500">
      <Icon size={32} className="mb-2 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
