/**
 * ConsoleSettingsSection — global control panel for the Founder Console.
 *
 * Lets the founder configure console-wide behaviour that is itself
 * cloud-backed + real-time synced: audit retention, auto-refresh, category
 * lists for secrets & flags, compact mode, and advanced controls visibility.
 */

import { useState } from "react";
import { Settings, Plus, X } from "lucide-react";
import type {
  ConsoleSettings,
  AuditSeverity,
} from "@/react-app/hooks/useFounderConsoleStore";

interface Props {
  settings: ConsoleSettings;
  lastSync: number;
  onUpdate: (patch: Partial<ConsoleSettings>) => void;
  logAudit: (
    event: string,
    detail: string,
    severity?: AuditSeverity,
    user?: string,
  ) => void;
}

export default function ConsoleSettingsSection({
  settings,
  lastSync,
  onUpdate,
  logAudit,
}: Props) {
  const [newFlagCat, setNewFlagCat] = useState("");
  const [newSecretCat, setNewSecretCat] = useState("");

  const addFlagCat = () => {
    const v = newFlagCat.trim();
    if (!v || settings.flagCategories.includes(v)) return;
    onUpdate({ flagCategories: [...settings.flagCategories, v] });
    logAudit("Console Settings", `Added flag category "${v}"`, "info");
    setNewFlagCat("");
  };
  const removeFlagCat = (c: string) => {
    onUpdate({
      flagCategories: settings.flagCategories.filter((x) => x !== c),
    });
    logAudit("Console Settings", `Removed flag category "${c}"`, "info");
  };
  const addSecretCat = () => {
    const v = newSecretCat.trim();
    if (!v || settings.secretCategories.includes(v)) return;
    onUpdate({ secretCategories: [...settings.secretCategories, v] });
    logAudit("Console Settings", `Added secret category "${v}"`, "info");
    setNewSecretCat("");
  };
  const removeSecretCat = (c: string) => {
    onUpdate({
      secretCategories: settings.secretCategories.filter((x) => x !== c),
    });
    logAudit("Console Settings", `Removed secret category "${c}"`, "info");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-white flex items-center gap-2">
          <Settings size={18} className="text-amber-400" /> Console Settings
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Real-time synced
          </span>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Global controls for the Founder Console — sync to all devices
          instantly
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Behaviour toggles */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-gray-300 mb-4">Behaviour</h3>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Auto-refresh audit log</p>
                <p className="text-[11px] text-gray-500">
                  Stream new audit events in real time
                </p>
              </div>
              <button
                onClick={() =>
                  onUpdate({ autoRefreshAudit: !settings.autoRefreshAudit })
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${settings.autoRefreshAudit ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.autoRefreshAudit ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Compact mode</p>
                <p className="text-[11px] text-gray-500">
                  Tighter spacing in console tables
                </p>
              </div>
              <button
                onClick={() => onUpdate({ compactMode: !settings.compactMode })}
                className={`relative w-11 h-6 rounded-full transition-colors ${settings.compactMode ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.compactMode ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Advanced controls</p>
                <p className="text-[11px] text-gray-500">
                  Show rotate/bulk/export developer actions
                </p>
              </div>
              <button
                onClick={() =>
                  onUpdate({
                    showAdvancedControls: !settings.showAdvancedControls,
                  })
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${settings.showAdvancedControls ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.showAdvancedControls ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Confirm dangerous actions</p>
                <p className="text-[11px] text-gray-500">
                  Require confirmation on deletes/clears
                </p>
              </div>
              <button
                onClick={() =>
                  onUpdate({
                    confirmDangerousActions: !settings.confirmDangerousActions,
                  })
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${settings.confirmDangerousActions ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.confirmDangerousActions ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Email notifications</p>
                <p className="text-[11px] text-gray-500">
                  Email founders on critical events
                </p>
              </div>
              <button
                onClick={() =>
                  onUpdate({
                    emailNotifications: !settings.emailNotifications,
                  })
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${settings.emailNotifications ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.emailNotifications ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </label>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Audit log retention (max entries)
              </label>
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                value={settings.auditRetention}
                onChange={(e) =>
                  onUpdate({ auditRetention: Number(e.target.value) || 500 })
                }
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
          </div>
        </div>

        {/* Advanced config */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-gray-300 mb-4">
            Advanced Configuration
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Console accent color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.accentColor || "#f59e0b"}
                  onChange={(e) => onUpdate({ accentColor: e.target.value })}
                  className="w-12 h-10 rounded cursor-pointer bg-transparent border border-white/10"
                />
                <input
                  value={settings.accentColor || "#f59e0b"}
                  onChange={(e) => onUpdate({ accentColor: e.target.value })}
                  className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500/30"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Default language
              </label>
              <input
                value={settings.defaultLanguage || "en"}
                onChange={(e) => onUpdate({ defaultLanguage: e.target.value })}
                placeholder="en"
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Cloud cache TTL (seconds)
              </label>
              <input
                type="number"
                min={0}
                max={3600}
                value={settings.cacheTtlSec ?? 300}
                onChange={(e) =>
                  onUpdate({ cacheTtlSec: Number(e.target.value) })
                }
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Max API keys per user
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.maxApiKeysPerUser ?? 10}
                onChange={(e) =>
                  onUpdate({ maxApiKeysPerUser: Number(e.target.value) })
                }
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Default webhook timeout (ms)
              </label>
              <input
                type="number"
                min={1000}
                max={60000}
                step={1000}
                value={settings.webhookTimeoutDefaultMs ?? 10000}
                onChange={(e) =>
                  onUpdate({ webhookTimeoutDefaultMs: Number(e.target.value) })
                }
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Flag Categories
            </h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {settings.flagCategories.map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 bg-white/5 rounded text-gray-300"
                >
                  {c}
                  <button
                    onClick={() => removeFlagCat(c)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newFlagCat}
                onChange={(e) => setNewFlagCat(e.target.value)}
                placeholder="Add category..."
                className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <button
                onClick={addFlagCat}
                className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg border border-amber-500/20 fp-icon-only"
                title="Add"
                aria-label="Add"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Secret Categories
            </h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {settings.secretCategories.map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 bg-white/5 rounded text-gray-300"
                >
                  {c}
                  <button
                    onClick={() => removeSecretCat(c)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSecretCat}
                onChange={(e) => setNewSecretCat(e.target.value)}
                placeholder="Add category..."
                className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <button
                onClick={addSecretCat}
                className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg border border-amber-500/20 fp-icon-only"
                title="Add"
                aria-label="Add"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sync status + danger zone */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Sync Status</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-300">Cloud real-time sync active</span>
          {lastSync && (
            <span className="text-gray-500">
              · last sync {new Date(lastSync).toLocaleString()}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          All Founder Console data (secrets, feature flags, audit log, these
          settings) is stored in Supabase{" "}
          <code className="text-gray-400">app_kv</code> and synced to every
          signed-in founder device in real time via Supabase Realtime.
        </p>
      </div>
    </div>
  );
}
