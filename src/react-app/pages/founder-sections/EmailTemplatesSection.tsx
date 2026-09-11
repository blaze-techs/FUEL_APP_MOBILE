import { useState } from "react";
import { Mail, Save, Eye, Edit3, CheckCircle2, RefreshCw } from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
const CUR = () => getCurrencySymbol(getDetectedCurrency());

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

const TMPL_KEY = "fuelpro_email_templates";

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "welcome",
    name: "Welcome Email",
    subject: "Welcome to FuelPro",
    body: "Hello {{name}},\n\nWelcome to FuelPro! Your account has been created successfully.\n\nStation: {{station}}\nRole: {{role}}\n\nGet started now.",
    variables: ["name", "station", "role"],
  },
  {
    id: "password-reset",
    name: "Password Reset",
    subject: "Password Reset Request",
    body: "Hello {{name}},\n\nA password reset was requested for your account.\n\nUse this code: {{code}}\n\nIf you did not request this, ignore this email.",
    variables: ["name", "code"],
  },
  {
    id: "invite",
    name: "Invitation",
    subject: "Invitation to Join FuelPro",
    body: "Hello,\n\nYou have been invited to join {{station}} as {{role}}.\n\nClick here to accept: {{link}}\n\nThis invite expires on {{expires}}.",
    variables: ["station", "role", "link", "expires"],
  },
  {
    id: "low-inventory",
    name: "Low Inventory Alert",
    subject: "Low Fuel Inventory Alert",
    body: "Hello {{name}},\n\nFuel level for {{fuelType}} is low at {{station}}.\n\nCurrent level: {{level}} liters\nThreshold: {{threshold}} liters\n\nPlease restock soon.",
    variables: ["name", "station", "fuelType", "level", "threshold"],
  },
  {
    id: "daily-report",
    name: "Daily Report",
    subject: "Daily Sales Report",
    body: "Hello {{name}},\n\nHere is your daily report for {{station}} on {{date}}:\n\nTotal Sales: {{totalSales}}\nTransactions: {{transactions}}\nVolume: {{volume}}L\n\nHave a great day!",
    variables: [
      "name",
      "station",
      "date",
      "totalSales",
      "transactions",
      "volume",
    ],
  },
];

function load(): Template[] {
  try {
    const s = localStorage.getItem(TMPL_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return DEFAULT_TEMPLATES;
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function EmailTemplatesSection({ logAudit }: Props) {
  const [templates, setTemplates] = useState<Template[]>(load);
  const [active, setActive] = useState<Template | null>(null);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  const select = (t: Template) => {
    setActive({ ...t });
    setPreview(false);
    setSaved(false);
  };

  const handleSave = () => {
    if (!active) return;
    const updated = templates.map((t) => (t.id === active.id ? active : t));
    localStorage.setItem(TMPL_KEY, JSON.stringify(updated));
    setTemplates(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit(
      "Email Template Updated",
      `Template "${active.name}" modified`,
      "success",
    );
  };

  const previewBody = (body: string) => {
    return body
      .replace(/{{name}}/g, "John Doe")
      .replace(/{{station}}/g, "Turkana Fuel Station")
      .replace(/{{role}}/g, "Manager")
      .replace(/{{code}}/g, "123456")
      .replace(/{{link}}/g, "https://fuelpro.app/join/abc123")
      .replace(/{{expires}}/g, "2026-05-18")
      .replace(/{{fuelType}}/g, "Petrol")
      .replace(/{{level}}/g, "500")
      .replace(/{{threshold}}/g, "1000")
      .replace(/{{date}}/g, "2026-05-11")
      .replace(/{{totalSales}}/g, `${CUR()} 45,000`)
      .replace(/{{transactions}}/g, "120")
      .replace(/{{volume}}/g, "3,500");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Mail size={18} className="text-cyan-400" /> Email Templates
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Customize email templates with variables
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Template List */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-3 space-y-1">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${active?.id === t.id ? "bg-amber-500/10 border border-amber-500/20" : "hover:bg-white/[0.02]"}`}
            >
              <p className="text-xs text-white font-medium">{t.name}</p>
              <p className="text-[10px] text-gray-500 truncate">{t.subject}</p>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="col-span-2 bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          {active ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white">
                  {active.name}
                </h3>
                <div className="flex items-center gap-2">
                  {saved && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Saved
                    </span>
                  )}
                  <button
                    onClick={() => setPreview(!preview)}
                    className={`px-2 py-1 text-xs rounded border transition-colors flex items-center gap-1 ${preview ? "bg-blue-500/15 border-blue-500/20 text-blue-300" : "bg-white/5 border-white/10 text-gray-400"}`}
                  >
                    <Eye size={10} /> {preview ? "Edit" : "Preview"}
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded border border-amber-500/20 transition-colors flex items-center gap-1"
                  >
                    <Save size={10} /> Save
                  </button>
                </div>
              </div>

              {preview ? (
                <div className="space-y-3">
                  <div className="p-3 bg-black/20 rounded-lg">
                    <p className="text-[10px] text-gray-500 mb-1">Subject</p>
                    <p className="text-sm text-white">{active.subject}</p>
                  </div>
                  <div className="p-3 bg-black/20 rounded-lg whitespace-pre-wrap text-xs text-gray-300 font-mono">
                    {previewBody(active.body)}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">
                      Subject
                    </label>
                    <input
                      value={active.subject}
                      onChange={(e) =>
                        setActive({ ...active, subject: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">
                      Body
                    </label>
                    <textarea
                      value={active.body}
                      onChange={(e) =>
                        setActive({ ...active, body: e.target.value })
                      }
                      rows={10}
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500/30 resize-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {active.variables.map((v) => (
                      <span
                        key={v}
                        className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-300 rounded border border-blue-500/20"
                      >
                        {"{{"}
                        {v}
                        {"}}"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600">
              <Mail size={24} className="mb-2" />
              <p className="text-xs">Select a template to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
