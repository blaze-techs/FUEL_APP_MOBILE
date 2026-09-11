import { useState } from "react";
import {
  Wrench,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Clock,
  Globe,
  Save,
  CheckCircle2,
} from "lucide-react";

const MAINT_KEY = "fuelpro_maintenance";

interface MaintConfig {
  enabled: boolean;
  message: string;
  allowFounder: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  autoDisable: boolean;
}

function load(): MaintConfig {
  try {
    const s = localStorage.getItem(MAINT_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return {
    enabled: false,
    message: "FuelPro is under maintenance. We will be back shortly.",
    allowFounder: true,
    scheduledStart: "",
    scheduledEnd: "",
    autoDisable: false,
  };
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function MaintenanceSection({ logAudit }: Props) {
  const [cfg, setCfg] = useState<MaintConfig>(load);
  const [saved, setSaved] = useState(false);

  const update = (k: keyof MaintConfig, v: string | boolean) => {
    setCfg((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(MAINT_KEY, JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      cfg.enabled ? "Maintenance Enabled" : "Maintenance Config Saved",
      `Mode: ${cfg.enabled ? "ON" : "OFF"}`,
      cfg.enabled ? "warning" : "info",
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Wrench size={18} className="text-orange-400" /> Maintenance Mode
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Put FuelPro in maintenance mode
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-4">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-4 bg-white/[0.02] rounded-lg">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${cfg.enabled ? "bg-orange-500/10" : "bg-white/5"}`}
            >
              {cfg.enabled ? (
                <AlertTriangle size={18} className="text-orange-400" />
              ) : (
                <Wrench size={18} className="text-gray-500" />
              )}
            </div>
            <div>
              <p className="text-sm text-white">Maintenance Mode</p>
              <p className="text-xs text-gray-500">
                {cfg.enabled
                  ? "Active - Users will see maintenance page"
                  : "Inactive - App is accessible"}
              </p>
            </div>
          </div>
          <button
            onClick={() => update("enabled", !cfg.enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${cfg.enabled ? "bg-orange-500" : "bg-gray-600"}`}
          >
            <div
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${cfg.enabled ? "translate-x-6" : "translate-x-0.5"}`}
            />
          </button>
        </div>

        {/* Message */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            Maintenance Message
          </label>
          <textarea
            value={cfg.message}
            onChange={(e) => update("message", e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/30 resize-none"
          />
        </div>

        {/* Options */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={cfg.allowFounder}
            onChange={(e) => update("allowFounder", e.target.checked)}
            className="rounded accent-orange-500"
          />
          <span className="text-xs text-gray-400">
            Allow Founder Access during maintenance
          </span>
        </div>

        {/* Schedule */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Clock size={10} /> Scheduled Start
            </label>
            <input
              type="datetime-local"
              value={cfg.scheduledStart}
              onChange={(e) => update("scheduledStart", e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Clock size={10} /> Scheduled End
            </label>
            <input
              type="datetime-local"
              value={cfg.scheduledEnd}
              onChange={(e) => update("scheduledEnd", e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/30"
            />
          </div>
        </div>

        {/* Preview */}
        {cfg.enabled && (
          <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
            <p className="text-xs text-orange-400 font-medium mb-2">Preview</p>
            <div className="text-center py-6">
              <Wrench size={32} className="mx-auto mb-3 text-orange-400" />
              <h3 className="text-sm font-medium text-white mb-1">
                Under Maintenance
              </h3>
              <p className="text-xs text-gray-400">{cfg.message}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
