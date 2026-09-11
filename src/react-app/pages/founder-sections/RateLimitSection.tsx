import { useState } from "react";
import {
  Shield,
  Save,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  Globe,
} from "lucide-react";

interface RateConfig {
  loginAttempts: number;
  loginWindow: number;
  apiRequests: number;
  apiWindow: number;
  inviteMaxUses: number;
  inviteExpiryDays: number;
  maxStationsPerUser: number;
  maxTeamMembers: number;
  sessionTimeout: number;
  passwordMinLength: number;
  requireStrongPassword: boolean;
  lockoutDuration: number;
}

const RATE_KEY = "fuelpro_rate_limits";

const DEFAULT: RateConfig = {
  loginAttempts: 5,
  loginWindow: 15,
  apiRequests: 100,
  apiWindow: 60,
  inviteMaxUses: 5,
  inviteExpiryDays: 7,
  maxStationsPerUser: 10,
  maxTeamMembers: 50,
  sessionTimeout: 60,
  passwordMinLength: 8,
  requireStrongPassword: true,
  lockoutDuration: 15,
};

function load(): RateConfig {
  try {
    const s = localStorage.getItem(RATE_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return { ...DEFAULT };
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function RateLimitSection({ logAudit }: Props) {
  const [cfg, setCfg] = useState<RateConfig>(load);
  const [saved, setSaved] = useState(false);

  const update = (k: keyof RateConfig, v: number | boolean) => {
    setCfg((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(RATE_KEY, JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      "Rate Limits Updated",
      "Security limits configuration saved",
      "success",
    );
  };

  const input =
    "w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Shield size={18} className="text-red-400" /> Rate Limiting &
            Security
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure security thresholds and limits
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

      <div className="grid grid-cols-2 gap-4">
        {/* Authentication */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <User size={14} className="text-blue-400" /> Authentication
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Login Attempts
            </label>
            <input
              type="number"
              value={cfg.loginAttempts}
              onChange={(e) => update("loginAttempts", Number(e.target.value))}
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Lockout Window (minutes)
            </label>
            <input
              type="number"
              value={cfg.loginWindow}
              onChange={(e) => update("loginWindow", Number(e.target.value))}
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Lockout Duration (minutes)
            </label>
            <input
              type="number"
              value={cfg.lockoutDuration}
              onChange={(e) =>
                update("lockoutDuration", Number(e.target.value))
              }
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Password Min Length
            </label>
            <input
              type="number"
              value={cfg.passwordMinLength}
              onChange={(e) =>
                update("passwordMinLength", Number(e.target.value))
              }
              className={input}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.requireStrongPassword}
              onChange={(e) =>
                update("requireStrongPassword", e.target.checked)
              }
              className="rounded accent-amber-500"
            />
            <span className="text-xs text-gray-400">
              Require strong passwords
            </span>
          </div>
        </div>

        {/* API */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Globe size={14} className="text-green-400" /> API
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Requests per Window
            </label>
            <input
              type="number"
              value={cfg.apiRequests}
              onChange={(e) => update("apiRequests", Number(e.target.value))}
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Window (seconds)
            </label>
            <input
              type="number"
              value={cfg.apiWindow}
              onChange={(e) => update("apiWindow", Number(e.target.value))}
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Session Timeout (minutes)
            </label>
            <input
              type="number"
              value={cfg.sessionTimeout}
              onChange={(e) => update("sessionTimeout", Number(e.target.value))}
              className={input}
            />
          </div>
        </div>

        {/* Invites */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Clock size={14} className="text-purple-400" /> Invites
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Uses per Invite
            </label>
            <input
              type="number"
              value={cfg.inviteMaxUses}
              onChange={(e) => update("inviteMaxUses", Number(e.target.value))}
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Invite Expiry (days)
            </label>
            <input
              type="number"
              value={cfg.inviteExpiryDays}
              onChange={(e) =>
                update("inviteExpiryDays", Number(e.target.value))
              }
              className={input}
            />
          </div>
        </div>

        {/* Limits */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Shield size={14} className="text-red-400" /> Resource Limits
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Stations per User
            </label>
            <input
              type="number"
              value={cfg.maxStationsPerUser}
              onChange={(e) =>
                update("maxStationsPerUser", Number(e.target.value))
              }
              className={input}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Team Members
            </label>
            <input
              type="number"
              value={cfg.maxTeamMembers}
              onChange={(e) => update("maxTeamMembers", Number(e.target.value))}
              className={input}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
