/**
 * FeatureFlagsManagerSection — enhanced cloud-backed Feature Flags panel for
 * the Founder Console.
 *
 * Replaces the inline localStorage-only Flags view with a cloud-backed,
 * real-time synced panel that adds: add/edit/delete custom flag, description +
 * category + environment editing, bulk enable/disable, search, and category
 * filtering.
 */

import { useMemo, useState } from "react";
import {
  ToggleRight,
  Plus,
  X,
  Trash2,
  Search,
  CheckCircle2,
  Zap,
  Edit3,
  Layers,
} from "lucide-react";
import type {
  ConsoleFeatureFlag,
  ConsoleSettings,
  AuditSeverity,
} from "@/react-app/hooks/useFounderConsoleStore";

interface Props {
  flags: ConsoleFeatureFlag[];
  settings: ConsoleSettings;
  onUpsert: (f: ConsoleFeatureFlag) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onBulkSet: (enabled: boolean) => void;
  logAudit: (
    event: string,
    detail: string,
    severity?: AuditSeverity,
    user?: string,
  ) => void;
}

const ENV_LABELS: Record<string, string> = {
  all: "All Envs",
  dev: "Dev",
  staging: "Staging",
  production: "Production",
};

function genId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || `flag_${Date.now().toString(36)}`
  );
}

export default function FeatureFlagsManagerSection({
  flags,
  settings,
  onUpsert,
  onToggle,
  onDelete,
  onBulkSet,
  logAudit,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterEnv, setFilterEnv] = useState("all");

  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftCategory, setDraftCategory] = useState(
    settings.flagCategories[0] || "Core",
  );
  const [draftEnv, setDraftEnv] =
    useState<ConsoleFeatureFlag["environment"]>("all");
  const [draftRollout, setDraftRollout] = useState(100);
  const [draftDependsOn, setDraftDependsOn] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [copyFromId, setCopyFromId] = useState("");

  const FLAG_TEMPLATES: {
    name: string;
    description: string;
    category: string;
  }[] = [
    {
      name: "New Reporting Module",
      description: "Advanced analytics dashboard",
      category: "Analytics",
    },
    {
      name: "Beta Feature",
      description: "Experimental feature for early adopters",
      category: "Core",
    },
    {
      name: "Maintenance Mode",
      description: "Put the app in read-only mode",
      category: "Operations",
    },
    {
      name: "AI Assistant",
      description: "Enable the AI chat assistant",
      category: "AI",
    },
    {
      name: "Beta Pricing Plan",
      description: "Show new pricing tiers",
      category: "Sales",
    },
    {
      name: "Force Update",
      description: "Require users to update the app",
      category: "Core",
    },
    {
      name: "Debug Logging",
      description: "Enable verbose debug logs",
      category: "Operations",
    },
    {
      name: "Compliance Check",
      description: "Run additional compliance validation",
      category: "Compliance",
    },
  ];

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return flags.filter((f) => {
      const matchesQ =
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q);
      const matchesCat =
        filterCategory === "all" || (f.category || "Core") === filterCategory;
      const matchesEnv =
        filterEnv === "all" || (f.environment || "all") === filterEnv;
      return matchesQ && matchesCat && matchesEnv;
    });
  }, [flags, search, filterCategory, filterEnv]);

  const enabledCount = flags.filter((f) => f.enabled).length;

  const openAdd = () => {
    setEditingId(null);
    setDraftName("");
    setDraftDesc("");
    setDraftCategory(settings.flagCategories[0] || "Core");
    setDraftEnv("all");
    setDraftRollout(100);
    setDraftDependsOn([]);
    setShowAdd(true);
  };

  const openEdit = (f: ConsoleFeatureFlag) => {
    setEditingId(f.id);
    setDraftName(f.name);
    setDraftDesc(f.description);
    setDraftCategory(f.category || "Core");
    setDraftEnv(f.environment || "all");
    setDraftRollout(f.rolloutPercentage ?? 100);
    setDraftDependsOn(f.dependsOn ?? []);
    setShowAdd(true);
  };

  const saveDraft = () => {
    if (!draftName.trim()) return;
    const flag: ConsoleFeatureFlag = {
      id: editingId || genId(draftName),
      name: draftName.trim(),
      description: draftDesc.trim() || "—",
      enabled: editingId
        ? (flags.find((f) => f.id === editingId)?.enabled ?? true)
        : true,
      category: draftCategory,
      environment: draftEnv,
      rolloutPercentage: draftRollout,
      dependsOn: draftDependsOn,
    };
    onUpsert(flag);
    logAudit(
      editingId ? "Flag Updated" : "Flag Created",
      `"${flag.name}" (${draftCategory}, rollout ${draftRollout}%)`,
      "success",
    );
    setShowAdd(false);
    setEditingId(null);
  };

  const applyTemplate = (t: {
    name: string;
    description: string;
    category: string;
  }) => {
    setDraftName(t.name);
    setDraftDesc(t.description);
    setDraftCategory(t.category);
    setDraftRollout(100);
    setDraftDependsOn([]);
    setShowTemplates(false);
    setShowAdd(true);
  };

  const copyFrom = () => {
    const src = flags.find((f) => f.id === copyFromId);
    if (!src) return;
    setDraftName(`${src.name} (copy)`);
    setDraftDesc(src.description);
    setDraftCategory(src.category || "Core");
    setDraftEnv(src.environment || "all");
    setDraftRollout(src.rolloutPercentage ?? 100);
    setDraftDependsOn(src.dependsOn ?? []);
    setCopyFromId("");
    setShowAdd(true);
  };

  const toggleDependsOn = (id: string) =>
    setDraftDependsOn((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );

  const setRollout = (id: string, pct: number) => {
    const f = flags.find((x) => x.id === id);
    if (f) onUpsert({ ...f, rolloutPercentage: pct });
  };

  const envStats = {
    dev: { total: 0, enabled: 0 },
    staging: { total: 0, enabled: 0 },
    production: { total: 0, enabled: 0 },
    all: { total: 0, enabled: 0 },
  } as Record<string, { total: number; enabled: number }>;
  flags.forEach((f) => {
    const env = f.environment || "all";
    envStats[env].total++;
    if (f.enabled) envStats[env].enabled++;
    envStats.all.total++;
    if (f.enabled) envStats.all.enabled++;
  });

  const handleToggle = (f: ConsoleFeatureFlag) => {
    onToggle(f.id);
    logAudit(
      "Feature Flag Toggled",
      `"${f.name}" ${f.enabled ? "disabled" : "enabled"}`,
      f.enabled ? "warning" : "success",
    );
  };

  const handleDelete = (f: ConsoleFeatureFlag) => {
    if (!confirm(`Delete flag "${f.name}"?`)) return;
    onDelete(f.id);
    logAudit("Flag Deleted", `"${f.name}" removed`, "warning");
  };

  const handleBulk = (enabled: boolean) => {
    onBulkSet(enabled);
    logAudit(
      "Flags Bulk Updated",
      `${enabled ? "Enabled" : "Disabled"} all ${flags.length} flags`,
      "success",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <ToggleRight size={18} className="text-amber-400" /> Feature Flags
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-time synced
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Toggle features on/off — changes propagate to all devices instantly
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowCompare((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Layers size={13} /> Env Compare
          </button>
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Plus size={13} /> Templates
          </button>
          <button
            onClick={() => handleBulk(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-300 text-xs rounded-lg transition-colors border border-green-500/20"
          >
            <CheckCircle2 size={13} /> Enable All
          </button>
          <button
            onClick={() => handleBulk(false)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <X size={13} /> Disable All
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg transition-colors border border-amber-500/20 fp-icon-only"
            title="Add"
            aria-label="Add"
          >
            {showAdd ? <X size={14} /> : <Plus size={14} />}{" "}
            {showAdd ? "Cancel" : "Add Flag"}
          </button>
        </div>
      </div>

      {/* Environment comparison view */}
      {showCompare && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Layers size={14} className="text-amber-400" /> Environment
            Comparison
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["all", "dev", "staging", "production"].map((env) => (
              <div
                key={env}
                className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]"
              >
                <p className="text-xs text-gray-400 capitalize">
                  {env === "all" ? "All Envs" : env}
                </p>
                <p className="text-lg text-white font-medium mt-1">
                  {envStats[env].enabled}
                  <span className="text-sm text-gray-500">
                    /{envStats[env].total}
                  </span>
                </p>
                <div className="h-1.5 rounded-full bg-black/30 mt-2 overflow-hidden">
                  <div
                    className="h-full bg-amber-500"
                    style={{
                      width: `${envStats[env].total ? (envStats[env].enabled / envStats[env].total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Templates view */}
      {showTemplates && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">
            Flag Templates — click to apply
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {FLAG_TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => applyTemplate(t)}
                className="text-left p-3 rounded-lg bg-white/[0.03] hover:bg-amber-500/10 border border-white/[0.06] hover:border-amber-500/20 transition-colors"
              >
                <p className="text-sm text-white">{t.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {t.description}
                </p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 mt-1.5 inline-block">
                  {t.category}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={copyFromId}
              onChange={(e) => setCopyFromId(e.target.value)}
              className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white"
            >
              <option value="">Copy from existing flag...</option>
              {flags.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              onClick={copyFrom}
              disabled={!copyFromId}
              className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-40 text-amber-300 text-xs rounded-lg border border-amber-500/20"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Stats + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">
          {enabledCount} of {flags.length} enabled
        </span>
        <div className="flex-1 min-w-[160px] relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flags..."
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
        >
          <option value="all">All categories</option>
          {settings.flagCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filterEnv}
          onChange={(e) => setFilterEnv(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
        >
          <option value="all">All envs</option>
          <option value="dev">Dev</option>
          <option value="staging">Staging</option>
          <option value="production">Production</option>
        </select>
      </div>

      {showAdd && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">
            {editingId ? "Edit Flag" : "New Feature Flag"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Name
              </label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. New Reporting Module"
                disabled={!!editingId}
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Description
              </label>
              <input
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder="What does this flag control?"
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Category
              </label>
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              >
                {settings.flagCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Environment
              </label>
              <select
                value={draftEnv}
                onChange={(e) =>
                  setDraftEnv(
                    e.target.value as ConsoleFeatureFlag["environment"],
                  )
                }
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              >
                <option value="all">All Environments</option>
                <option value="dev">Dev only</option>
                <option value="staging">Staging only</option>
                <option value="production">Production only</option>
              </select>
            </div>
          </div>
          {/* Rollout percentage */}
          <div className="mt-3">
            <label className="text-[11px] text-gray-400 mb-1 block">
              Rollout Percentage: {draftRollout}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={draftRollout}
              onChange={(e) => setDraftRollout(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <p className="text-[10px] text-gray-500 mt-0.5">
              Percentage of users who see this feature when enabled (100% = all
              users)
            </p>
          </div>
          {/* Dependencies */}
          <div className="mt-3">
            <label className="text-[11px] text-gray-400 mb-1 block">
              Dependencies (flags that must be enabled first)
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {flags
                .filter((f) => f.id !== editingId)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => toggleDependsOn(f.id)}
                    className={`px-2 py-0.5 rounded-full text-[11px] ${
                      draftDependsOn.includes(f.id)
                        ? "bg-amber-500 text-black"
                        : "bg-white/5 text-gray-400 hover:bg-white/10"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              {flags.filter((f) => f.id !== editingId).length === 0 && (
                <span className="text-[11px] text-gray-600">
                  No other flags to depend on
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={saveDraft}
              className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg transition-colors border border-amber-500/20"
            >
              {editingId ? "Update Flag" : "Create Flag"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setEditingId(null);
              }}
              className="px-4 py-2 text-gray-400 text-xs rounded-lg hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((f) => (
          <div
            key={f.id}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${f.enabled ? "bg-green-400" : "bg-gray-600"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-white">{f.name}</p>
                  {f.category && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                      {f.category}
                    </span>
                  )}
                  {f.environment && f.environment !== "all" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                      {ENV_LABELS[f.environment] || f.environment}
                    </span>
                  )}
                  {f.rolloutPercentage !== undefined &&
                    f.rolloutPercentage < 100 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">
                        {f.rolloutPercentage}% rollout
                      </span>
                    )}
                  {f.dependsOn && f.dependsOn.length > 0 && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300"
                      title={`Depends on: ${f.dependsOn.map((d) => flags.find((x) => x.id === d)?.name || d).join(", ")}`}
                    >
                      ↳ {f.dependsOn.length} dep
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 truncate">
                  {f.description}
                </p>
                {f.enabled &&
                  f.rolloutPercentage !== undefined &&
                  f.rolloutPercentage < 100 && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={f.rolloutPercentage}
                        onChange={(e) =>
                          setRollout(f.id, Number(e.target.value))
                        }
                        className="w-24 accent-amber-500"
                      />
                      <span className="text-[10px] text-gray-500">
                        {f.rolloutPercentage}%
                      </span>
                    </div>
                  )}
                {f.updatedAt && (
                  <p className="text-[9px] text-gray-600 mt-0.5">
                    Updated {new Date(f.updatedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => openEdit(f)}
                title="Edit flag"
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={() => handleDelete(f)}
                title="Delete flag"
                className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => handleToggle(f)}
                title={f.enabled ? "Disable" : "Enable"}
                className={`relative w-11 h-6 rounded-full transition-colors ${f.enabled ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${f.enabled ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-12 text-center">
            <Zap size={24} className="mx-auto mb-2 text-gray-700" />
            <p className="text-sm text-gray-600">
              {flags.length === 0
                ? "No feature flags configured"
                : "No flags match your filter"}
            </p>
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-600">
        {flags.length} total · {enabledCount} enabled · {filtered.length} shown
        · cloud-synced in real time
      </p>
    </div>
  );
}
