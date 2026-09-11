import { useState, useEffect, useMemo } from "react";
import {
  Settings,
  Globe,
  Clock,
  DollarSign,
  Save,
  RotateCcw,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";
import { ALL_COUNTRIES } from "@/react-app/lib/world-country-utils";
import { getDetectedCurrency } from "@/react-app/lib/currency";

interface ConfigData {
  siteName: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  language: string;
  maxStations: string;
  sessionTimeout: string;
  itemsPerPage: string;
}

/** Resolve detected country currency/timezone for universal default */
function resolveDetectedConfig(): Partial<ConfigData> {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const p = JSON.parse(saved);
      const cc = (p.currentCountry || p.country || "").toUpperCase();
      if (cc) {
        const c = ALL_COUNTRIES.find((x) => x.code === cc);
        if (c)
          return {
            currency: c.currency,
            timezone:
              p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
      }
    }
  } catch {
    /* */
  }
  return {
    currency: getDetectedCurrency(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

const detected = resolveDetectedConfig();

const DEFAULT_CONFIG: ConfigData = {
  siteName: "FuelPro",
  currency: detected.currency || getDetectedCurrency(),
  timezone: detected.timezone || "UTC",
  dateFormat: "DD/MM/YYYY",
  language: "en",
  maxStations: "10",
  sessionTimeout: "60",
  itemsPerPage: "25",
};

const CONFIG_KEY = "fuelpro_site_config";

/** Get all IANA timezones grouped by continent */
function getGroupedTimezones(): Record<string, string[]> {
  const intlExtended = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const all = intlExtended.supportedValuesOf?.("timeZone") || [
    "UTC",
    "Africa/Nairobi",
    "Africa/Kampala",
    "Africa/Dar_es_Salaam",
    "Africa/Lagos",
    "Africa/Johannesburg",
    "Africa/Accra",
    "Africa/Kigali",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "America/Toronto",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "Asia/Dubai",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
  const groups: Record<string, string[]> = {};
  for (const tz of all) {
    const continent = tz.split("/")[0] || "Other";
    if (!groups[continent]) groups[continent] = [];
    groups[continent].push(tz);
  }
  return groups;
}

/** Searchable timezone selector */
function TimezoneSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useMemo(getGroupedTimezones, []);
  const allZones = useMemo(() => Object.values(groups).flat(), [groups]);
  const filtered = useMemo(() => {
    if (!search.trim()) return allZones;
    const q = search.toLowerCase();
    return allZones.filter((tz) => tz.toLowerCase().includes(q));
  }, [search, allZones]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white hover:bg-white/[0.06] focus:outline-none focus:border-amber-500/30 transition-colors"
      >
        <span className="truncate">{value}</span>
        <ChevronDown
          size={14}
          className={`text-gray-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-[#1c1c1e] border border-white/[0.08] rounded-lg shadow-2xl max-h-64 overflow-y-auto">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezones..."
              className="w-full bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
            />
          </div>
          {filtered.map((tz) => (
            <button
              key={tz}
              type="button"
              onClick={() => {
                onChange(tz);
                setIsOpen(false);
                setSearch("");
              }}
              className={`w-full text-left px-3 py-1 text-xs transition-colors ${tz === value ? "bg-amber-500/10 text-amber-300" : "text-gray-300 hover:bg-white/[0.04]"}`}
            >
              {tz}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ConfigSectionProps {
  logAudit: (
    event: string,
    detail: string,
    severity: "success" | "warning" | "danger" | "info",
  ) => void;
}

function loadConfig(): ConfigData {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

export default function ConfigSection({ logAudit }: ConfigSectionProps) {
  const [config, setConfig] = useState<ConfigData>(loadConfig);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit("Site Config Updated", `Updated site configuration`, "success");
  };

  const handleReset = () => {
    if (!confirm("Reset all settings to defaults?")) return;
    setConfig({ ...DEFAULT_CONFIG });
    localStorage.setItem(CONFIG_KEY, JSON.stringify(DEFAULT_CONFIG));
    logAudit("Site Config Reset", "Settings reset to defaults", "warning");
  };

  const update = (key: keyof ConfigData, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const inputClass =
    "w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30";
  const labelClass = "text-xs text-gray-400 mb-1 block";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Settings size={18} className="text-amber-400" /> Site Configuration
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage global application settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={handleReset}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors flex items-center gap-1"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* General */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white mb-3">General</h3>
          <div>
            <label className={labelClass}>Site Name</label>
            <input
              value={config.siteName}
              onChange={(e) => update("siteName", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <SearchableCountryDropdown
              value={(() => {
                const c = ALL_COUNTRIES.find(
                  (x) => x.currency === config.currency,
                );
                return c?.code || "US";
              })()}
              onChange={(code) => {
                const c = ALL_COUNTRIES.find((x) => x.code === code);
                if (c) update("currency", c.currency);
              }}
              label="Currency Region"
              className="mb-3"
            />
          </div>
          <div>
            <label className={labelClass}>Language</label>
            <select
              value={config.language}
              onChange={(e) => update("language", e.target.value)}
              className={inputClass}
            >
              <option value="en">English</option>
              <option value="sw">Swahili</option>
              <option value="fr">French</option>
            </select>
          </div>
        </div>

        {/* Regional */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white mb-3">Regional</h3>
          <div>
            <label className={labelClass}>Timezone</label>
            <TimezoneSelector
              value={config.timezone}
              onChange={(v) => update("timezone", v)}
            />
          </div>
          <div>
            <label className={labelClass}>Date Format</label>
            <select
              value={config.dateFormat}
              onChange={(e) => update("dateFormat", e.target.value)}
              className={inputClass}
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
        </div>

        {/* Limits */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white mb-3">Limits</h3>
          <div>
            <label className={labelClass}>Max Stations</label>
            <input
              type="number"
              value={config.maxStations}
              onChange={(e) => update("maxStations", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Session Timeout (minutes)</label>
            <input
              type="number"
              value={config.sessionTimeout}
              onChange={(e) => update("sessionTimeout", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Items Per Page</label>
            <input
              type="number"
              value={config.itemsPerPage}
              onChange={(e) => update("itemsPerPage", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Preview */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">Preview</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-white/[0.04]">
              <span className="text-gray-500">Site Name</span>
              <span className="text-white">{config.siteName}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/[0.04]">
              <span className="text-gray-500">Currency</span>
              <span className="text-white">{config.currency}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/[0.04]">
              <span className="text-gray-500">Timezone</span>
              <span className="text-white">{config.timezone}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/[0.04]">
              <span className="text-gray-500">Date Format</span>
              <span className="text-white">{config.dateFormat}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/[0.04]">
              <span className="text-gray-500">Session</span>
              <span className="text-white">{config.sessionTimeout} min</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Max Stations</span>
              <span className="text-white">{config.maxStations}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
