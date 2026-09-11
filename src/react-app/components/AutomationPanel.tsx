/**
 * AutomationPanel.tsx
 *
 * User-facing control panel for the automation "brain". Users can:
 * - Toggle automation reactions (auto-reorder, auto-record stock, auto-refresh)
 * - View the automation event log (what the brain did)
 * - View/fulfill auto-generated reorder suggestions
 * - Adjust thresholds
 *
 * Everything is cloud-backed (automation_prefs + automation_log keys) so
 * settings sync across devices.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Bell,
  RefreshCw,
  ShoppingCart,
  Package,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Activity,
  ArrowRight,
  Warehouse,
} from "lucide-react";
import {
  automation,
  getAutomationPrefs,
  saveAutomationPrefs,
  getAutomationLog,
  clearAutomationLog,
  getAutoReorders,
  fulfillReorder,
  type AutomationPreferences,
  type AutomationLogEntry,
} from "@/react-app/lib/automation-engine";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";

type SubTab = "settings" | "log" | "reorders";

const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: "settings", label: "Settings", icon: Bot },
  { id: "reorders", label: "Auto-Reorders", icon: ShoppingCart },
  { id: "log", label: "Activity Log", icon: Activity },
];

export default function AutomationPanel() {
  const [subTab, setSubTab] = useState<SubTab>("settings");
  const [prefs, setPrefs] = useState<AutomationPreferences | null>(null);
  const [log, setLog] = useState<AutomationLogEntry[]>([]);
  const [reorders, setReorders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [p, l, r] = await Promise.all([
      getAutomationPrefs(),
      getAutomationLog(),
      getAutoReorders(),
    ]);
    setPrefs(p);
    setLog(l);
    setReorders(r.filter((x: any) => x.status === "pending"));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const togglePref = async (key: keyof AutomationPreferences, value: any) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true);
    try {
      await saveAutomationPrefs(updated);
    } finally {
      setSaving(false);
    }
  };

  const toggleNotification = async (key: string, value: boolean) => {
    if (!prefs) return;
    const updated = {
      ...prefs,
      notifications: { ...prefs.notifications, [key]: value },
    };
    setPrefs(updated);
    setSaving(true);
    try {
      await saveAutomationPrefs(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleFulfillReorder = async (id: string, qty: number) => {
    await fulfillReorder(id, qty);
    loadAll();
  };

  const handleClearLog = async () => {
    await clearAutomationLog();
    setLog([]);
  };

  if (loading || !prefs) {
    return (
      <div className="flex justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading automation settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
          <Bot className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Automation Engine</h1>
          <p className="text-gray-400 text-sm mt-1">
            The site's brain — automatically moves data, creates reorders, and
            keeps everything in sync
          </p>
        </div>
        {saving && (
          <span className="ml-auto text-amber-400 text-sm flex items-center gap-1">
            <Loader2 size={14} className="animate-spin" /> Saving...
          </span>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-400">Active Automations</p>
          <p className="text-lg font-bold text-amber-400">
            {
              [
                prefs.autoReorderEnabled,
                prefs.autoRecordStockOnProductEdit,
                prefs.autoRefreshDashboard,
                prefs.autoSyncPricesAcrossTabs,
              ].filter(Boolean).length
            }
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-400">Pending Reorders</p>
          <p className="text-lg font-bold text-blue-400">{reorders.length}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-400">Log Entries</p>
          <p className="text-lg font-bold text-emerald-400">{log.length}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-400">Notifications</p>
          <p className="text-lg font-bold text-purple-400">
            {prefs.notifications
              ? Object.values(prefs.notifications).filter(Boolean).length
              : 0}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${subTab === tab.id ? "bg-amber-500 text-white" : "bg-white/5 text-gray-400 hover:text-white"}`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Settings ── */}
      {subTab === "settings" && (
        <div className="space-y-4 max-w-2xl">
          <ToggleRow
            icon={<ShoppingCart size={18} />}
            label="Auto-Reorder"
            description="Automatically creates reorder suggestions when stock drops below the reorder level"
            value={prefs.autoReorderEnabled}
            onChange={(v) => togglePref("autoReorderEnabled", v)}
          />
          <ToggleRow
            icon={<Package size={18} />}
            label="Auto-Record Stock on Product Edit"
            description="When you edit a product's stock quantity, an inventory transaction audit record is created automatically"
            value={prefs.autoRecordStockOnProductEdit}
            onChange={(v) => togglePref("autoRecordStockOnProductEdit", v)}
          />
          <ToggleRow
            icon={<RefreshCw size={18} />}
            label="Auto-Refresh Dashboard"
            description="Dashboard stats update in real-time when sales or prices change (no page reload needed)"
            value={prefs.autoRefreshDashboard}
            onChange={(v) => togglePref("autoRefreshDashboard", v)}
          />
          <ToggleRow
            icon={<RefreshCw size={18} />}
            label="Auto-Sync Prices Across Tabs"
            description="When a fuel price changes on the Price Board, all other tabs update instantly"
            value={prefs.autoSyncPricesAcrossTabs}
            onChange={(v) => togglePref("autoSyncPricesAcrossTabs", v)}
          />
          <ToggleRow
            icon={<Activity size={18} />}
            label="Auto-Log Shift Totals"
            description="When a shift closes, the totals are automatically logged for reporting"
            value={prefs.autoLogShiftTotals}
            onChange={(v) => togglePref("autoLogShiftTotals", v)}
          />

          {/* Reorder threshold */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <label className="text-white font-medium text-sm block mb-2">
              Reorder Threshold Multiplier
            </label>
            <p className="text-gray-400 text-xs mb-3">
              Multiplies the reorder level. E.g. 1.0 = reorder at the set level,
              0.8 = reorder earlier, 1.5 = reorder later.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={prefs.autoReorderThresholdMultiplier}
                onChange={(e) =>
                  togglePref(
                    "autoReorderThresholdMultiplier",
                    parseFloat(e.target.value),
                  )
                }
                className="flex-1 accent-amber-500"
              />
              <span className="text-white font-medium text-sm w-12 text-right">
                {prefs.autoReorderThresholdMultiplier.toFixed(1)}x
              </span>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-white font-medium text-sm mb-3 flex items-center gap-2">
              <Bell size={16} /> Notifications
            </h3>
            <div className="space-y-2">
              <ToggleRow
                compact
                label="Low Stock Alerts"
                value={prefs.notifications.lowStock}
                onChange={(v) => toggleNotification("lowStock", v)}
              />
              <ToggleRow
                compact
                label="Reorder Created"
                value={prefs.notifications.reorderCreated}
                onChange={(v) => toggleNotification("reorderCreated", v)}
              />
              <ToggleRow
                compact
                label="Price Changes"
                value={prefs.notifications.priceChanges}
                onChange={(v) => toggleNotification("priceChanges", v)}
              />
              <ToggleRow
                compact
                label="Shift Closed"
                value={prefs.notifications.shiftClosed}
                onChange={(v) => toggleNotification("shiftClosed", v)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Auto-Reorders ── */}
      {subTab === "reorders" && (
        <div className="max-w-2xl">
          {reorders.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No pending reorders</p>
              <p className="text-gray-500 text-sm mt-1">
                Reorder suggestions appear automatically when stock drops below
                the threshold
              </p>
              <button
                onClick={() => switchToTab("inventory")}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-sm transition-colors"
              >
                <Warehouse size={16} />
                View Stock Management
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {reorders.map((r: any) => (
                <div
                  key={r.id}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white font-medium">{r.productName}</p>
                    <p className="text-gray-400 text-xs">
                      Current: {r.currentStock} · Reorder level:{" "}
                      {r.reorderLevel} · Suggested: {r.suggestedQty} units
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => switchToTab("suppliers")}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-sm flex items-center gap-2 transition-colors"
                    >
                      Create PO
                    </button>
                    <button
                      onClick={() => handleFulfillReorder(r.id, r.suggestedQty)}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm flex items-center gap-2"
                    >
                      <Package size={16} />
                      Fulfill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Activity Log ── */}
      {subTab === "log" && (
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-400 text-sm">
              {log.length} recent automation action{log.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={handleClearLog}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg text-sm transition-colors"
            >
              <Trash2 size={14} />
              Clear Log
            </button>
          </div>
          {log.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No automation activity yet</p>
              <p className="text-gray-500 text-sm mt-1">
                Actions will appear here as the automation engine processes
                events
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {log.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-start gap-3"
                >
                  <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Activity size={14} className="text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">
                      {entry.eventType}
                    </p>
                    <p className="text-gray-500 text-xs truncate">
                      {entry.summary}
                    </p>
                  </div>
                  <span className="text-gray-500 text-xs flex-shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Toggle row helper ─────────────────────────────────────────────────────

function ToggleRow({
  icon,
  label,
  description,
  value,
  onChange,
  compact,
}: {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-xl ${compact ? "p-3" : "p-4"} flex items-center justify-between`}
    >
      <div className="flex items-center gap-3">
        {icon && !compact && (
          <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center text-gray-400">
            {icon}
          </div>
        )}
        <div>
          <p className="text-white text-sm font-medium">{label}</p>
          {description && !compact && (
            <p className="text-gray-400 text-xs mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="flex-shrink-0"
        title={value ? "Enabled" : "Disabled"}
      >
        {value ? (
          <ToggleRight className="w-10 h-10 text-amber-400" />
        ) : (
          <ToggleLeft className="w-10 h-10 text-gray-600" />
        )}
      </button>
    </div>
  );
}
