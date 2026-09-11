/**
 * LocalizationSection — cloud-backed, real-time language/i18n management.
 * CRUD languages, set active/default, coverage % tracking, search.
 */

import { useState } from "react";
import { Languages, Plus, X, Trash2, CheckCircle2, Star } from "lucide-react";
import type {
  LocalizationLanguage,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import {
  SectionHeader,
  Field,
  IconBtn,
  EmptyState,
} from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function LocalizationSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nativeName, setNativeName] = useState("");
  const [coverage, setCoverage] = useState(0);

  const reset = () => {
    setCode("");
    setName("");
    setNativeName("");
    setCoverage(0);
  };

  const save = () => {
    if (!code.trim() || !name.trim()) return;
    const l: LocalizationLanguage = {
      id: code.trim().toLowerCase(),
      code: code.trim().toLowerCase(),
      name: name.trim(),
      nativeName: nativeName.trim() || name.trim(),
      active: true,
      isDefault: false,
      coverage,
      createdAt: new Date().toISOString(),
    };
    store.upsertLanguage(l);
    logAudit("Language Added", `${l.code} (${l.name})`, "success");
    reset();
    setShowAdd(false);
  };

  const handleDelete = (l: LocalizationLanguage) => {
    if (l.isDefault) {
      alert(
        "Cannot delete the default language. Set another as default first.",
      );
      return;
    }
    store.deleteLanguage(l.id);
    logAudit("Language Deleted", l.code, "warning");
  };

  const setDefault = (l: LocalizationLanguage) => {
    store.setDefaultLanguage(l.id);
    logAudit("Default Language Set", l.code, "info");
  };

  const updateCoverage = (id: string, value: number) => {
    const lang = store.languages.find((x) => x.id === id);
    if (lang) store.upsertLanguage({ ...lang, coverage: value });
  };

  const activeCount = store.languages.filter((l) => l.active).length;
  const avgCoverage = store.languages.length
    ? Math.round(
        store.languages.reduce((s, l) => s + l.coverage, 0) /
          store.languages.length,
      )
    : 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Languages}
        title="Localization"
        subtitle="Manage supported languages — real-time synced"
        count={store.languages.length}
        right={
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-white/5 text-gray-400">
              {activeCount} active
            </span>
            <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400">
              {avgCoverage}% avg
            </span>
          </div>
        }
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Language
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New Language</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code (ISO)">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="fr"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="French"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Native name">
              <input
                value={nativeName}
                onChange={(e) => setNativeName(e.target.value)}
                placeholder="Français"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <Field label={`Coverage: ${coverage}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={coverage}
              onChange={(e) => setCoverage(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.languages.length === 0 && (
          <EmptyState icon={Languages} text="No languages configured" />
        )}
        {store.languages.map((l) => (
          <div
            key={l.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm text-white font-mono">{l.code}</code>
                  <span className="text-sm text-gray-300">{l.name}</span>
                  <span className="text-xs text-gray-500">
                    ({l.nativeName})
                  </span>
                  {l.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex items-center gap-1">
                      <Star size={10} /> Default
                    </span>
                  )}
                  {l.active ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Active
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-black/30 overflow-hidden">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${l.coverage}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-400 w-10">
                      {l.coverage}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={l.coverage}
                      onChange={(e) =>
                        updateCoverage(l.id, Number(e.target.value))
                      }
                      className="w-24 accent-amber-500"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!l.isDefault && (
                  <IconBtn title="Set default" onClick={() => setDefault(l)}>
                    <Star size={15} className="text-gray-400" />
                  </IconBtn>
                )}
                <IconBtn
                  title={l.active ? "Deactivate" : "Activate"}
                  onClick={() => store.toggleLanguage(l.id)}
                >
                  <Languages
                    size={15}
                    className={l.active ? "text-amber-400" : "text-gray-500"}
                  />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(l)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
