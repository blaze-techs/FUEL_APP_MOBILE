import { useState } from "react";
import {
  Bell,
  Mail,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  Save,
  CheckCircle2,
} from "lucide-react";

interface NotifConfig {
  salesAlerts: boolean;
  lowInventory: boolean;
  paymentReceived: boolean;
  employeeActivity: boolean;
  systemUpdates: boolean;
  securityAlerts: boolean;
  dailyDigest: boolean;
  weeklyReport: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

const NOTIF_KEY = "fuelpro_notification_config";

const DEFAULT: NotifConfig = {
  salesAlerts: true,
  lowInventory: true,
  paymentReceived: true,
  employeeActivity: false,
  systemUpdates: true,
  securityAlerts: true,
  dailyDigest: false,
  weeklyReport: true,
  smsEnabled: false,
  pushEnabled: true,
};

function load(): NotifConfig {
  try {
    const s = localStorage.getItem(NOTIF_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* ignore */
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

export default function NotificationsSection({ logAudit }: Props) {
  const [cfg, setCfg] = useState<NotifConfig>(load);
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof NotifConfig) => {
    setCfg((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      "Notification Config Saved",
      "Notification preferences updated",
      "success",
    );
  };

  const items: {
    key: keyof NotifConfig;
    label: string;
    desc: string;
    icon: any;
    color: string;
  }[] = [
    {
      key: "salesAlerts",
      label: "Sales Alerts",
      desc: "Get notified of every sale",
      icon: Bell,
      color: "text-amber-400",
    },
    {
      key: "lowInventory",
      label: "Low Inventory",
      desc: "Alert when fuel levels are low",
      icon: Bell,
      color: "text-red-400",
    },
    {
      key: "paymentReceived",
      label: "Payments",
      desc: "M-PESA and other payments",
      icon: Bell,
      color: "text-green-400",
    },
    {
      key: "employeeActivity",
      label: "Employee Activity",
      desc: "Staff actions and logins",
      icon: Bell,
      color: "text-blue-400",
    },
    {
      key: "systemUpdates",
      label: "System Updates",
      desc: "New features and patches",
      icon: Bell,
      color: "text-purple-400",
    },
    {
      key: "securityAlerts",
      label: "Security Alerts",
      desc: "Login attempts and breaches",
      icon: Bell,
      color: "text-red-400",
    },
    {
      key: "dailyDigest",
      label: "Daily Digest",
      desc: "Summary email every day",
      icon: Mail,
      color: "text-blue-400",
    },
    {
      key: "weeklyReport",
      label: "Weekly Report",
      desc: "Weekly analytics report",
      icon: Mail,
      color: "text-emerald-400",
    },
    {
      key: "smsEnabled",
      label: "SMS Notifications",
      desc: "Send alerts via SMS",
      icon: MessageSquare,
      color: "text-green-400",
    },
    {
      key: "pushEnabled",
      label: "Push Notifications",
      desc: "Browser push notifications",
      icon: Bell,
      color: "text-amber-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Bell size={18} className="text-amber-400" /> Notifications
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure notification preferences
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

      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div
            key={it.key}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center">
                <it.icon size={14} className={it.color} />
              </div>
              <div>
                <p className="text-sm text-white">{it.label}</p>
                <p className="text-[10px] text-gray-500">{it.desc}</p>
              </div>
            </div>
            <button
              onClick={() => toggle(it.key)}
              className={`relative w-10 h-5.5 rounded-full transition-colors ${cfg[it.key] ? "bg-green-500" : "bg-gray-600"}`}
            >
              <div
                className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${cfg[it.key] ? "translate-x-5" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
