/**
 * MigrationsSection — cloud-backed, real-time DB migration tracker.
 * Add migrations, mark applied, rollback, view status + duration +
 * affected tables + checksum + error. Filter by status with stats.
 */

import { useMemo, useState } from "react";
import {
  Database,
  Plus,
  X,
  CheckCircle2,
  Undo2,
  AlertCircle,
  Table,
} from "lucide-react";
import type {
  MigrationRecord,
  MigrationStatus,
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

const STATUS_STYLES: Record<MigrationStatus, string> = {
  pending: "bg-gray-500/20 text-gray-400",
  applied: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  "rolled-back": "bg-orange-500/20 text-orange-400",
  skipped: "bg-blue-500/20 text-blue-400",
};

const STATUSES: MigrationStatus[] = [
  "pending",
  "applied",
  "failed",
  "rolled-back",
  "skipped",
];

export default function MigrationsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [tablesAffected, setTablesAffected] = useState("");

  const filtered = useMemo(() => {
    return store.migrations.filter(
      (m) => filterStatus === "all" || m.status === filterStatus,
    );
  }, [store.migrations, filterStatus]);

  const stats = useMemo(() => {
    const applied = store.migrations.filter(
      (m) => m.status === "applied",
    ).length;
    const pending = store.migrations.filter(
      (m) => m.status === "pending",
    ).length;
    const failed = store.migrations.filter((m) => m.status === "failed").length;
    return { applied, pending, failed };
  }, [store.migrations]);

  const reset = () => {
    setFilename("");
    setDescription("");
    setTablesAffected("");
  };

  const add = () => {
    if (!filename.trim()) return;
    const m: MigrationRecord = {
      id: store.uid(),
      filename: filename.trim(),
      description: description.trim(),
      status: "pending",
      tablesAffected: tablesAffected
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      checksum: store.randomKey("mig"),
    };
    store.upsertMigration(m);
    logAudit("Migration Added", `"${m.filename}"`, "info");
    reset();
    setShowAdd(false);
  };

  const handleMarkApplied = (m: MigrationRecord) => {
    store.markMigrationApplied(m.id);
    logAudit("Migration Applied", `"${m.filename}"`, "success");
  };

  const handleRollback = (m: MigrationRecord) => {
    if (!confirm(`Rollback migration "${m.filename}"?`)) return;
    store.rollbackMigration(m.id);
    logAudit("Migration Rolled Back", `"${m.filename}"`, "danger");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Database}
        title="Migrations"
        subtitle="Database migration tracking — real-time synced across devices"
        count={store.migrations.length}
      />

      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Applied"
          value={stats.applied}
          color="text-green-400"
        />
        <StatCard label="Pending" value={stats.pending} color="text-gray-400" />
        <StatCard label="Failed" value={stats.failed} color="text-red-400" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Migration
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New Migration</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="Filename">
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="20260812000000_add_users_table.sql"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Creates the users table"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="Tables affected (comma-separated)">
            <input
              value={tablesAffected}
              onChange={(e) => setTablesAffected(e.target.value)}
              placeholder="users, sessions"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
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
              onClick={add}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={Database} text="No migrations recorded" />
        )}
        {filtered.map((m) => (
          <div
            key={m.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white font-mono">
                    {m.filename}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[m.status]}`}
                  >
                    {m.status}
                  </span>
                </div>
                {m.description && (
                  <p className="text-xs text-gray-400 mt-1">{m.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                  {m.appliedAt && (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={10} />{" "}
                      {new Date(m.appliedAt).toLocaleString()}
                    </span>
                  )}
                  {m.durationMs !== undefined && <span>{m.durationMs}ms</span>}
                  {m.checksum && (
                    <span className="font-mono text-gray-600">
                      {m.checksum}
                    </span>
                  )}
                </div>
                {m.tablesAffected.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    <Table size={10} className="text-gray-500" />
                    {m.tablesAffected.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {m.error && (
                  <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={11} /> {m.error}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {m.status !== "applied" && (
                  <IconBtn
                    title="Mark Applied"
                    onClick={() => handleMarkApplied(m)}
                  >
                    <CheckCircle2 size={15} className="text-green-400" />
                  </IconBtn>
                )}
                {m.status === "applied" && (
                  <IconBtn title="Rollback" onClick={() => handleRollback(m)}>
                    <Undo2 size={15} className="text-red-400" />
                  </IconBtn>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
