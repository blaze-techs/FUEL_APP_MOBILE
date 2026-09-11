/**
 * CorsConfigSection — cloud-backed, real-time CORS origin management.
 * CRUD allowed origins, per-origin methods + credentials, wildcard toggle,
 * regex validation, and quick presets (localhost, vercel, cloudflare).
 */

import { useState } from "react";
import { Globe, Plus, X, Trash2, CheckCircle2, XCircle } from "lucide-react";
import type {
  CorsOrigin,
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

const PRESETS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://fuel-app-mobile.vercel.app",
  "https://fuel-app-mobile.pages.dev",
];

function isValidOrigin(origin: string): boolean {
  if (origin === "*") return true;
  try {
    const u = new URL(origin);
    return !!u.protocol && !!u.host;
  } catch {
    return false;
  }
}

export default function CorsConfigSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [origin, setOrigin] = useState("");
  const [allowCredentials, setAllowCredentials] = useState(true);
  const [methods, setMethods] = useState<string[]>([
    ...store.DEFAULT_CORS_METHODS,
  ]);
  const [testOrigin, setTestOrigin] = useState("");
  const [testResult, setTestResult] = useState<null | boolean>(null);

  const toggleMethod = (m: string) =>
    setMethods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  const save = () => {
    if (!origin.trim() || !isValidOrigin(origin.trim())) return;
    const c: CorsOrigin = {
      id: store.uid(),
      origin: origin.trim(),
      allowCredentials,
      allowedMethods: methods,
      createdAt: new Date().toISOString(),
    };
    store.upsertCors(c);
    logAudit("CORS Origin Added", c.origin, "info");
    setOrigin("");
    setAllowCredentials(true);
    setMethods([...store.DEFAULT_CORS_METHODS]);
    setShowAdd(false);
  };

  const handleDelete = (c: CorsOrigin) => {
    store.deleteCors(c.id);
    logAudit("CORS Origin Removed", c.origin, "warning");
  };

  const addPreset = (url: string) => {
    const c: CorsOrigin = {
      id: store.uid(),
      origin: url,
      allowCredentials: true,
      allowedMethods: [...store.DEFAULT_CORS_METHODS],
      createdAt: new Date().toISOString(),
    };
    store.upsertCors(c);
    logAudit("CORS Origin Added", url, "info");
  };

  const runTest = () => {
    if (!testOrigin.trim()) return;
    const match = store.corsOrigins.some(
      (c) =>
        c.origin === "*" ||
        c.origin === testOrigin.trim() ||
        testOrigin.trim().startsWith(c.origin.replace(/\/$/, "")),
    );
    setTestResult(match);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Globe}
        title="CORS Configuration"
        subtitle="Allowed origins for cross-origin requests — real-time synced"
        count={store.corsOrigins.length}
      />

      <div className="rounded-xl bg-white/5 border border-white/10 p-3">
        <p className="text-xs text-gray-400 mb-2">Quick add presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => addPreset(p)}
              disabled={store.corsOrigins.some((c) => c.origin === p)}
              className="px-2.5 py-1 rounded-full text-xs font-mono bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40"
            >
              + {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm text-gray-300">Allowed Origins</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Origin
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New CORS Origin</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="Origin (exact URL or *)">
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://example.com or *"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
            {origin && !isValidOrigin(origin) && (
              <span className="text-[11px] text-red-400 mt-1 block">
                Invalid origin format
              </span>
            )}
          </Field>
          <div>
            <p className="text-xs text-gray-400 mb-2">Allowed methods</p>
            <div className="flex flex-wrap gap-2">
              {store.DEFAULT_CORS_METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => toggleMethod(m)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono ${
                    methods.includes(m)
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={allowCredentials}
              onChange={(e) => setAllowCredentials(e.target.checked)}
              className="accent-amber-500"
            />
            Allow credentials (cookies / Authorization)
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
              disabled={!origin.trim() || !isValidOrigin(origin.trim())}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-sm font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.corsOrigins.length === 0 && (
          <EmptyState icon={Globe} text="No CORS origins configured" />
        )}
        {store.corsOrigins.map((c) => (
          <div
            key={c.id}
            className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <code className="text-sm text-white font-mono">{c.origin}</code>
              <div className="flex flex-wrap gap-1 mt-1">
                {c.allowedMethods.map((m) => (
                  <span
                    key={m}
                    className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-gray-400 font-mono"
                  >
                    {m}
                  </span>
                ))}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Credentials: {c.allowCredentials ? "Yes" : "No"}
              </div>
            </div>
            <IconBtn title="Remove" onClick={() => handleDelete(c)}>
              <Trash2 size={15} className="text-red-400" />
            </IconBtn>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white/5 border border-white/10 p-4">
        <h3 className="text-sm font-medium text-white mb-2">Test Origin</h3>
        <div className="flex gap-2">
          <input
            value={testOrigin}
            onChange={(e) => {
              setTestOrigin(e.target.value);
              setTestResult(null);
            }}
            placeholder="https://test-origin.com"
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
          />
          <button
            onClick={runTest}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            Test
          </button>
        </div>
        {testResult !== null && (
          <div
            className={`mt-2 text-sm flex items-center gap-2 ${testResult ? "text-green-400" : "text-red-400"}`}
          >
            {testResult ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {testResult
              ? "Allowed by configured origins"
              : "Blocked — not in allowed list"}
          </div>
        )}
      </div>
    </div>
  );
}
