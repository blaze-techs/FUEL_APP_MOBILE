import { useState } from "react";
import {
  Code2,
  Webhook,
  Key,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  Globe,
  CheckCircle2,
  Filter,
  MapPin,
  Building2,
  AlertCircle,
} from "lucide-react";

// ============================================
// REGIONAL CONFIGURATION
// ============================================

// Regional compliance endpoints
export const REGIONAL_COMPLIANCE = {
  KE: {
    name: "Kenya",
    flag: "🇰🇪",
    authority: "KRA",
    endpoint: "https://api.kra.go.ke",
    events: ["kra_sync", "etr_reports", "itm_reports"],
  },
  UG: {
    name: "Uganda",
    flag: "🇺🇬",
    authority: "URA",
    endpoint: "https://api.ura.go.ug",
    events: ["ura_sync", "efris_reports"],
  },
  TZ: {
    name: "Tanzania",
    flag: "🇹🇿",
    authority: "TRA",
    endpoint: "https://api.tra.go.tz",
    events: ["tra_sync", "receipt_reports"],
  },
  NG: {
    name: "Nigeria",
    flag: "🇳🇬",
    authority: "FIRS",
    endpoint: "https://api.firs.gov.ng",
    events: ["firs_sync", "invoice_reports"],
  },
  ZA: {
    name: "South Africa",
    flag: "🇿🇦",
    authority: "SARS",
    endpoint: "https://api.sars.gov.za",
    events: ["sars_sync", "vat_reports"],
  },
  GH: {
    name: "Ghana",
    flag: "🇬🇭",
    authority: "GRA",
    endpoint: "https://api.gra.gov.gh",
    events: ["gra_sync", "tax_reports"],
  },
} as const;

type RegionCode = keyof typeof REGIONAL_COMPLIANCE;

// ============================================
// TYPES
// ============================================

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  lastTriggered: string | null;
  regions: RegionCode[]; // Which regions this webhook applies to
  isCompliance?: boolean; // Is this a compliance webhook
  complianceAuthority?: string; // KRA, URA, TRA, etc.
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
  regions: RegionCode[]; // Which regions this key has access to
  scopes: string[]; // read, write, admin, compliance
}

interface ApiLog {
  id: string;
  keyId: string;
  keyName: string;
  endpoint: string;
  method: string;
  status: number;
  timestamp: string;
  region: RegionCode;
  responseTime: number;
}

// Storage keys
const WEBHOOKS_KEY = "fuelpro_webhooks";
const APIKEYS_KEY = "fuelpro_api_keys";
const API_LOGS_KEY = "fuelpro_api_logs";
const SELECTED_REGION_KEY = "fuelpro_api_section_region";

// ============================================
// DATA LOADING
// ============================================

function loadWebhooks(): Webhook[] {
  try {
    const s = localStorage.getItem(WEBHOOKS_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [];
}

function loadApiKeys(): ApiKey[] {
  try {
    const s = localStorage.getItem(APIKEYS_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [];
}

function loadApiLogs(): ApiLog[] {
  try {
    const s = localStorage.getItem(API_LOGS_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [];
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ApiSection({ logAudit }: Props) {
  const [webhooks, setWebhooks] = useState<Webhook[]>(loadWebhooks);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(loadApiKeys);
  const [apiLogs, setApiLogs] = useState<ApiLog[]>(loadApiLogs);
  const [selectedRegion, setSelectedRegion] = useState<RegionCode | "ALL">(
    () => {
      return (localStorage.getItem(SELECTED_REGION_KEY) as RegionCode) || "ALL";
    },
  );
  const [newHookUrl, setNewHookUrl] = useState("");
  const [newHookEvents, setNewHookEvents] = useState<string[]>(["sales"]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRegions, setNewKeyRegions] = useState<RegionCode[]>(["KE"]);
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read"]);
  const [copiedKey, setCopiedKey] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [logsFilter, setLogsFilter] = useState<"ALL" | "success" | "error">(
    "ALL",
  );

  // Save functions
  const saveWebhooks = (w: Webhook[]) => {
    localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(w));
    setWebhooks(w);
  };

  const saveApiKeys = (k: ApiKey[]) => {
    localStorage.setItem(APIKEYS_KEY, JSON.stringify(k));
    setApiKeys(k);
  };

  const saveApiLogs = (l: ApiLog[]) => {
    // Keep only last 1000 logs
    const trimmed = l.slice(-1000);
    localStorage.setItem(API_LOGS_KEY, JSON.stringify(trimmed));
    setApiLogs(trimmed);
  };

  const selectRegion = (region: RegionCode | "ALL") => {
    setSelectedRegion(region);
    if (region !== "ALL") {
      localStorage.setItem(SELECTED_REGION_KEY, region);
    } else {
      localStorage.removeItem(SELECTED_REGION_KEY);
    }
  };

  // Filter webhooks and keys by selected region
  const filteredWebhooks = webhooks.filter(
    (w) => selectedRegion === "ALL" || w.regions.includes(selectedRegion),
  );

  const filteredKeys = apiKeys.filter(
    (k) => selectedRegion === "ALL" || k.regions.includes(selectedRegion),
  );

  const filteredLogs = apiLogs.filter(
    (l) =>
      (selectedRegion === "ALL" || l.region === selectedRegion) &&
      (logsFilter === "ALL" ||
        (logsFilter === "success" && l.status < 400) ||
        (logsFilter === "error" && l.status >= 400)),
  );

  // Webhook functions
  const addWebhook = () => {
    if (!newHookUrl.trim()) return;
    const hook: Webhook = {
      id: `wh_${Date.now()}`,
      url: newHookUrl.trim(),
      events: newHookEvents,
      active: true,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      regions:
        selectedRegion === "ALL"
          ? (Object.keys(REGIONAL_COMPLIANCE) as RegionCode[])
          : [selectedRegion],
    };
    saveWebhooks([...webhooks, hook]);
    setNewHookUrl("");
    setNewHookEvents(["sales"]);
    logAudit(
      "Webhook Created",
      `Webhook added for ${hook.events.join(", ")} in ${hook.regions.length} region(s)`,
      "success",
    );
  };

  const addComplianceWebhook = (region: RegionCode) => {
    const config = REGIONAL_COMPLIANCE[region];
    const hook: Webhook = {
      id: `wh_comp_${region}_${Date.now()}`,
      url: `${config.endpoint}/webhook`,
      events: [...config.events],
      active: true,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      regions: [region],
      isCompliance: true,
      complianceAuthority: config.authority,
    };
    saveWebhooks([...webhooks, hook]);
    logAudit(
      "Compliance Webhook Created",
      `${config.authority} webhook configured for ${config.name}`,
      "success",
    );
  };

  const toggleWebhook = (id: string) => {
    saveWebhooks(
      webhooks.map((w) => (w.id === id ? { ...w, active: !w.active } : w)),
    );
  };

  const deleteWebhook = (id: string) => {
    if (!confirm("Delete this webhook?")) return;
    saveWebhooks(webhooks.filter((w) => w.id !== id));
    logAudit("Webhook Deleted", `Webhook ${id} removed`, "warning");
  };

  // API Key functions
  const addApiKey = () => {
    if (!newKeyName.trim()) return;
    if (newKeyRegions.length === 0) {
      alert("Please select at least one region");
      return;
    }
    const key: ApiKey = {
      id: `ak_${Date.now()}`,
      name: newKeyName.trim(),
      key: `fpk_${btoa(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 32)}`,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      regions: newKeyRegions,
      scopes: newKeyScopes,
    };
    saveApiKeys([...apiKeys, key]);
    setNewKeyName("");
    setNewKeyRegions(["KE"]);
    setNewKeyScopes(["read"]);
    logAudit(
      "API Key Created",
      `Key "${key.name}" generated for ${key.regions.join(", ")} regions`,
      "success",
    );
  };

  const deleteApiKey = (id: string) => {
    if (!confirm("Revoke this API key?")) return;
    saveApiKeys(apiKeys.filter((k) => k.id !== id));
    logAudit("API Key Revoked", `Key ${id} revoked`, "warning");
  };

  const copyKey = (key: string) => {
    navigator.clipboard?.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 2000);
  };

  const toggleRegion = (region: RegionCode) => {
    setNewKeyRegions((prev) =>
      prev.includes(region)
        ? prev.filter((r) => r !== region)
        : [...prev, region],
    );
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  // Event options
  const eventOptions = [
    "sales",
    "inventory",
    "payments",
    "employees",
    "security",
    "system",
    "kra_sync",
    "ura_sync",
    "tra_sync",
    "firs_sync",
    "sars_sync",
  ];

  const scopeOptions = ["read", "write", "admin", "compliance"];

  // Get region flag
  const getRegionFlag = (code: RegionCode) =>
    REGIONAL_COMPLIANCE[code]?.flag || "🌍";

  return (
    <div className="space-y-6">
      {/* Header with Region Selector */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Code2 size={18} className="text-purple-400" /> API & Webhooks
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage API keys, webhooks, and compliance endpoints by region
          </p>
        </div>

        {/* Region Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => selectRegion("ALL")}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                selectedRegion === "ALL"
                  ? "bg-purple-500/30 border-purple-500/50 text-purple-300"
                  : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
              }`}
            >
              ALL
            </button>
            {Object.entries(REGIONAL_COMPLIANCE).map(([code, config]) => (
              <button
                key={code}
                onClick={() => selectRegion(code as RegionCode)}
                className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                  selectedRegion === code
                    ? "bg-purple-500/30 border-purple-500/50 text-purple-300"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
                }`}
              >
                {config.flag} {code}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Key size={14} className="text-amber-400" /> API Keys (
            {filteredKeys.length})
          </h3>
          <span className="text-[10px] text-gray-500">
            {apiKeys.length} total
          </span>
        </div>

        {/* Create Key Form */}
        <div className="space-y-3 mb-4 p-3 bg-white/[0.02] rounded-lg">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g., Production KE, Staging UG)"
            className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
          />

          {/* Region Selection */}
          <div>
            <label className="text-[10px] text-gray-500 mb-1 block">
              Regions (for multi-region select ALL then filter)
            </label>
            <div className="flex flex-wrap gap-1">
              {Object.entries(REGIONAL_COMPLIANCE).map(([code, config]) => (
                <button
                  key={code}
                  onClick={() => toggleRegion(code as RegionCode)}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    newKeyRegions.includes(code as RegionCode)
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                      : "bg-white/5 border-white/10 text-gray-500"
                  }`}
                >
                  {config.flag} {code}
                </button>
              ))}
            </div>
          </div>

          {/* Scope Selection */}
          <div>
            <label className="text-[10px] text-gray-500 mb-1 block">
              Scopes
            </label>
            <div className="flex flex-wrap gap-1">
              {scopeOptions.map((scope) => (
                <button
                  key={scope}
                  onClick={() => toggleScope(scope)}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    newKeyScopes.includes(scope)
                      ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                      : "bg-white/5 border-white/10 text-gray-500"
                  }`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={addApiKey}
            className="w-full px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={12} /> Create Regional Key
          </button>
        </div>

        {/* Keys List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filteredKeys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-white font-medium">{k.name}</p>
                  <span className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500">
                    {k.scopes.join(", ")}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-[10px] text-gray-500 font-mono">
                    {k.key.slice(0, 16)}...
                  </code>
                  <button
                    onClick={() => copyKey(k.key)}
                    className="text-gray-500 hover:text-gray-300"
                  >
                    {copiedKey === k.key ? (
                      <Check size={10} className="text-green-400" />
                    ) : (
                      <Copy size={10} />
                    )}
                  </button>
                </div>
                <div className="flex gap-1 mt-1">
                  {k.regions.map((r) => (
                    <span
                      key={r}
                      className="text-[9px] px-1 py-0.5 bg-white/5 rounded text-gray-500"
                    >
                      {getRegionFlag(r)} {r}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => deleteApiKey(k.id)}
                className="text-gray-500 hover:text-red-400 transition-colors ml-2"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {filteredKeys.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">
              No API keys for{" "}
              {selectedRegion === "ALL" ? "any region" : selectedRegion}
            </p>
          )}
        </div>
      </div>

      {/* Webhooks */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Webhook size={14} className="text-green-400" /> Webhooks (
            {filteredWebhooks.length})
          </h3>
          <span className="text-[10px] text-gray-500">
            {webhooks.length} total
          </span>
        </div>

        {/* Compliance Webhooks Quick Setup */}
        {selectedRegion !== "ALL" && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={12} className="text-blue-400" />
              <span className="text-xs text-blue-300 font-medium">
                Compliance Setup for {REGIONAL_COMPLIANCE[selectedRegion]?.name}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-2">
              Configure {REGIONAL_COMPLIANCE[selectedRegion]?.authority}{" "}
              compliance webhook for {REGIONAL_COMPLIANCE[selectedRegion]?.name}
            </p>
            <button
              onClick={() => addComplianceWebhook(selectedRegion)}
              className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs rounded border border-blue-500/30 transition-colors"
            >
              Configure {REGIONAL_COMPLIANCE[selectedRegion]?.authority} Webhook
            </button>
          </div>
        )}

        {/* Create Webhook Form */}
        <div className="space-y-3 mb-4">
          <input
            value={newHookUrl}
            onChange={(e) => setNewHookUrl(e.target.value)}
            placeholder="https://your-app.com/webhook"
            className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
          />
          <div className="flex flex-wrap gap-2">
            {eventOptions.map((e) => (
              <button
                key={e}
                onClick={() =>
                  setNewHookEvents((prev) =>
                    prev.includes(e)
                      ? prev.filter((x) => x !== e)
                      : [...prev, e],
                  )
                }
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  newHookEvents.includes(e)
                    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                    : "bg-white/5 border-white/10 text-gray-500"
                }`}
              >
                {e}
              </button>
            ))}
            <button
              onClick={addWebhook}
              className="ml-auto px-3 py-1 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors flex items-center gap-1"
            >
              <Plus size={10} /> Add
            </button>
          </div>
        </div>

        {/* Webhooks List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filteredWebhooks.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {w.isCompliance ? (
                    <Building2 size={10} className="text-blue-400" />
                  ) : (
                    <Globe
                      size={10}
                      className={w.active ? "text-green-400" : "text-gray-600"}
                    />
                  )}
                  <p className="text-xs text-white truncate">{w.url}</p>
                  {w.isCompliance && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 rounded text-blue-300">
                      {w.complianceAuthority}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1">
                  {w.events.map((e) => (
                    <span
                      key={e}
                      className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500"
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  {w.regions.map((r) => (
                    <span
                      key={r}
                      className="text-[9px] px-1 py-0.5 bg-white/5 rounded text-gray-500"
                    >
                      {getRegionFlag(r)} {r}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => toggleWebhook(w.id)}
                  className={`w-8 h-4.5 rounded-full transition-colors ${
                    w.active ? "bg-green-500" : "bg-gray-600"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 bg-white rounded-full transition-transform ${
                      w.active ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <button
                  onClick={() => deleteWebhook(w.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {filteredWebhooks.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">
              No webhooks for{" "}
              {selectedRegion === "ALL" ? "any region" : selectedRegion}
            </p>
          )}
        </div>
      </div>

      {/* API Logs */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-sm font-medium text-white flex items-center gap-2"
          >
            <RefreshCw size={14} className="text-gray-400" /> API Logs (
            {filteredLogs.length})
            <span className="text-[10px] text-gray-500">
              ({apiLogs.length} total)
            </span>
          </button>
          {showLogs && (
            <div className="flex gap-1">
              {(["ALL", "success", "error"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLogsFilter(f)}
                  className={`px-2 py-1 text-[10px] rounded ${
                    logsFilter === f
                      ? "bg-white/20 text-white"
                      : "text-gray-500 hover:bg-white/10"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {showLogs && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filteredLogs
              .slice(-50)
              .reverse()
              .map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between text-[10px] p-2 bg-white/[0.02] rounded"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1 rounded ${
                        log.status < 400
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {log.method} {log.status}
                    </span>
                    <span className="text-gray-400 font-mono truncate max-w-[200px]">
                      {log.endpoint}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span>{getRegionFlag(log.region)}</span>
                    <span>{log.responseTime}ms</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            {filteredLogs.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">
                No API logs yet
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
