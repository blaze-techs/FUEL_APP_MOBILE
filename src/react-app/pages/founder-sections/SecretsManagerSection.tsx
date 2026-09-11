/**
 * SecretsManagerSection — enhanced cloud-backed Secrets panel for the Founder
 * Console.
 *
 * Replaces the inline localStorage-only Secrets view with a cloud-backed,
 * real-time synced panel that adds: live search/filter, category tagging,
 * edit-in-place, rotate-value, export/import JSON, and bulk delete.
 */

import { useMemo, useRef, useState } from "react";
import {
  Key,
  Plus,
  X,
  Save,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  Search,
  Download,
  Upload,
  RefreshCw,
} from "lucide-react";
import type {
  ConsoleSecret,
  ConsoleSettings,
  AuditSeverity,
} from "@/react-app/hooks/useFounderConsoleStore";

interface Props {
  secrets: ConsoleSecret[];
  settings: ConsoleSettings;
  onUpsert: (s: ConsoleSecret) => void;
  onDelete: (key: string) => void;
  onRotate: (key: string) => void;
  logAudit: (
    event: string,
    detail: string,
    severity?: AuditSeverity,
    user?: string,
  ) => void;
}

export default function SecretsManagerSection({
  secrets,
  settings,
  onUpsert,
  onDelete,
  onRotate,
  logAudit,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState(
    settings.secretCategories[0] || "Other",
  );
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newRotationDays, setNewRotationDays] = useState(0);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return secrets.filter((s) => {
      const matchesQ =
        !q ||
        s.key.toLowerCase().includes(q) ||
        (s.category || "").toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q));
      const matchesCat =
        filterCategory === "all" || (s.category || "Other") === filterCategory;
      const matchesTag =
        filterTag === "all" || (s.tags || []).includes(filterTag);
      return matchesQ && matchesCat && matchesTag;
    });
  }, [secrets, search, filterCategory, filterTag]);

  const allTags = useMemo(
    () => Array.from(new Set(secrets.flatMap((s) => s.tags || []))).sort(),
    [secrets],
  );

  const needsRotation = (s: ConsoleSecret) => {
    if (!s.rotationReminderDays || s.rotationReminderDays <= 0) return false;
    const last = s.lastRotated || s.createdAt;
    if (!last) return false;
    const days =
      (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
    return days >= s.rotationReminderDays;
  };

  const isExpired = (s: ConsoleSecret) =>
    s.expiresAt ? new Date(s.expiresAt) < new Date() : false;

  const expiringSoon = (s: ConsoleSecret) => {
    if (!s.expiresAt) return false;
    const days =
      (new Date(s.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 7;
  };

  const allSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.key));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.key)));
    }
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveSecret = () => {
    if (!newKey.trim() || !newValue) return;
    const secret: ConsoleSecret = {
      key: newKey.trim(),
      value: btoa(newValue),
      createdAt: new Date().toISOString(),
      category: newCategory,
      expiresAt: newExpiresAt || undefined,
      tags: newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      rotationReminderDays: newRotationDays > 0 ? newRotationDays : undefined,
    };
    onUpsert(secret);
    logAudit(
      secrets.some((s) => s.key === newKey.trim())
        ? "Secret Updated"
        : "Secret Created",
      `Secret "${newKey.trim()}" (${newCategory})`,
      "success",
    );
    setNewKey("");
    setNewValue("");
    setNewCategory(settings.secretCategories[0] || "Other");
    setNewExpiresAt("");
    setNewTags("");
    setNewRotationDays(0);
    setShowAdd(false);
  };

  const handleDelete = (key: string) => {
    if (!confirm(`Delete secret "${key}"?`)) return;
    onDelete(key);
    logAudit("Secret Deleted", `Secret "${key}" removed`, "warning");
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleRotate = (key: string) => {
    if (!confirm(`Rotate value for "${key}"? The old value will be lost.`))
      return;
    onRotate(key);
    logAudit("Secret Rotated", `Secret "${key}" value rotated`, "success");
  };

  const copyValue = (key: string, encoded: string) => {
    try {
      navigator.clipboard?.writeText(atob(encoded));
    } catch {
      navigator.clipboard?.writeText(encoded);
    }
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  const toggleVisible = (key: string) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const bulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected secret(s)?`)) return;
    selected.forEach((key) => onDelete(key));
    logAudit(
      "Secrets Bulk Deleted",
      `${selected.size} secret(s) removed`,
      "warning",
    );
    setSelected(new Set());
  };

  const exportSecrets = () => {
    const exportable = secrets.map((s) => ({
      key: s.key,
      category: s.category || "Other",
      createdAt: s.createdAt,
      // Export the DECODED value so the file is usable; warn it's sensitive.
      value: (() => {
        try {
          return atob(s.value);
        } catch {
          return s.value;
        }
      })(),
    }));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro-secrets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit(
      "Secrets Exported",
      `${secrets.length} secret(s) exported`,
      "info",
    );
  };

  const importSecrets = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as Array<{
          key: string;
          value: string;
          category?: string;
        }>;
        if (!Array.isArray(parsed)) throw new Error("Invalid format");
        let count = 0;
        parsed.forEach((item) => {
          if (!item.key) return;
          onUpsert({
            key: item.key,
            value: btoa(item.value),
            createdAt: new Date().toISOString(),
            category: item.category || "Other",
          });
          count++;
        });
        logAudit("Secrets Imported", `${count} secret(s) imported`, "success");
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Key size={18} className="text-amber-400" /> Secrets
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-time synced
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Cloud-synced API keys & sensitive values — changes reflect on all
            devices instantly
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportSecrets}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Download size={13} /> Export
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Upload size={13} /> Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={importSecrets}
            className="hidden"
          />
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg transition-colors border border-amber-500/20"
          >
            {showAdd ? <X size={14} /> : <Plus size={14} />}{" "}
            {showAdd ? "Cancel" : "Add Secret"}
          </button>
        </div>
      </div>

      {/* Search + filter + bulk actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keys or categories..."
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
        >
          <option value="all">All categories</option>
          {settings.secretCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
          >
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        {selected.size > 0 && (
          <button
            onClick={bulkDelete}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs rounded-lg transition-colors border border-red-500/20"
          >
            <Trash2 size={13} /> Delete {selected.size}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Key
              </label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="API_KEY_NAME"
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Value
              </label>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Enter value"
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Category
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              >
                {settings.secretCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Expires (optional)
              </label>
              <input
                type="date"
                value={newExpiresAt}
                onChange={(e) => setNewExpiresAt(e.target.value)}
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Tags (comma-separated)
              </label>
              <input
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="production, critical"
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">
                Rotate reminder (days, 0 = off)
              </label>
              <input
                type="number"
                value={newRotationDays}
                onChange={(e) => setNewRotationDays(Number(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
              />
            </div>
          </div>
          <button
            onClick={saveSecret}
            className="mt-3 px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg transition-colors border border-amber-500/20"
          >
            <Save size={13} className="inline mr-1.5" /> Save Secret
          </button>
        </div>
      )}

      <div className="bg-[#161618] border border-white/[0.06] rounded-xl overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-amber-500"
                />
              </th>
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3">
                Key
              </th>
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3">
                Category
              </th>
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3">
                Tags
              </th>
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3">
                Value
              </th>
              <th className="text-left text-[11px] text-gray-500 font-medium px-3 py-3">
                Updated
              </th>
              <th className="text-right text-[11px] text-gray-500 font-medium px-3 py-3 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.key}
                className="border-b border-white/[0.04] hover:bg-white/[0.02]"
              >
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(s.key)}
                    onChange={() => toggleSelect(s.key)}
                    className="accent-amber-500"
                  />
                </td>
                <td className="px-3 py-3">
                  <code className="text-sm text-gray-300 font-mono">
                    {s.key}
                  </code>
                </td>
                <td className="px-3 py-3">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400">
                    {s.category || "Other"}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(s.tags || []).map((t) => (
                      <span
                        key={t}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {visible[s.key] ? (
                    <span className="text-sm text-gray-300 font-mono break-all">
                      {(() => {
                        try {
                          return atob(s.value);
                        } catch {
                          return s.value;
                        }
                      })()}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-600 font-mono tracking-widest">
                      {"•".repeat(24)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-[11px] text-gray-500">
                  {s.updatedAt || s.createdAt
                    ? new Date(s.updatedAt || s.createdAt).toLocaleDateString()
                    : "—"}
                  {s.lastRotated && (
                    <span
                      className="ml-1 text-[9px] text-amber-400/70"
                      title={`Last rotated ${new Date(s.lastRotated).toLocaleString()}`}
                    >
                      ⟳
                    </span>
                  )}
                  {isExpired(s) && (
                    <span className="block text-[9px] text-red-400 mt-0.5">
                      Expired
                    </span>
                  )}
                  {expiringSoon(s) && (
                    <span className="block text-[9px] text-amber-400 mt-0.5">
                      Expires soon
                    </span>
                  )}
                  {needsRotation(s) && (
                    <span
                      className="block text-[9px] text-orange-400 mt-0.5"
                      title={`Rotate every ${s.rotationReminderDays} days`}
                    >
                      Rotation due
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => toggleVisible(s.key)}
                      title="Show/hide value"
                      className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {visible[s.key] ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => copyValue(s.key, s.value)}
                      title="Copy value"
                      className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {copied === s.key ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => handleRotate(s.key)}
                      title="Rotate value (generate new random value)"
                      className="p-1.5 text-gray-500 hover:text-amber-400 transition-colors"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(s.key)}
                      title="Delete"
                      className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-600 py-12">
                  {secrets.length === 0
                    ? "No secrets configured"
                    : "No secrets match your filter"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-600">
        {secrets.length} total · {filtered.length} shown · cloud-synced across
        all devices in real time
      </p>
    </div>
  );
}
