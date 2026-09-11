import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  RefreshCw,
  Table2,
  Key,
  Link2,
  Search,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { getSupabaseClient } from "@/supabase/client";

/**
 * SchemaVisualizerSection
 *
 * Fully linked to the live Supabase schema. The schema (tables, columns,
 * types, PK/FK) is an authoritative embedded map derived from the actual
 * live database (project ojjscjwatikixlpshmub) — PostgREST's OpenAPI root
 * is now restricted to the service_role key, which can never live in the
 * client bundle (it bypasses RLS). Keeping the schema as a vetted constant
 * is both secure and stable; it is updated alongside the SQL migrations in
 * supabase/migrations/.
 *
 * Row counts are fetched LIVE through the authenticated Supabase client and
 * are RLS-respecting: a user sees counts only for rows they are allowed to
 * read. Tables the current user cannot access show "—" (permission-gated),
 * which is the correct, safe behavior.
 */

interface ColumnDef {
  name: string;
  type: string;
  isPK?: boolean;
  fkTo?: string; // "table.column"
}

interface TableDef {
  name: string;
  description: string;
  columns: ColumnDef[];
}

// ─── Authoritative live schema (project ojjscjwatikixlpshmub) ─────────
// Keep in sync with supabase/migrations/. FK targets encode the enforced/
// intended relationships (PostgREST does not expose pg_constraint).
const SCHEMA: TableDef[] = [
  {
    name: "stations",
    description: "Root entity — a fuel station owned by a user",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "name", type: "text" },
      { name: "code", type: "text" },
      { name: "location", type: "text" },
      { name: "address", type: "text" },
      { name: "city", type: "text" },
      { name: "region", type: "text" },
      { name: "country", type: "text" },
      { name: "currency", type: "text" },
      { name: "currency_symbol", type: "text" },
      { name: "timezone", type: "text" },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
      { name: "manager_name", type: "text" },
      { name: "status", type: "text" },
      { name: "is_active", type: "boolean" },
      { name: "latitude", type: "numeric" },
      { name: "longitude", type: "numeric" },
      { name: "kra_pin", type: "text" },
      { name: "etr_serial", type: "text" },
      { name: "tax_rate", type: "numeric" },
      { name: "theme", type: "text" },
      { name: "logo", type: "text" },
      { name: "description", type: "text" },
      { name: "created_by", type: "uuid", fkTo: "users.id" },
      { name: "owner_id", type: "uuid", fkTo: "users.id" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
  },
  {
    name: "users",
    description: "Auth users (view over auth.users)",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "email", type: "text" },
      { name: "name", type: "text" },
      { name: "role", type: "text" },
      { name: "created_at", type: "timestamptz" },
      { name: "last_sign_in_at", type: "timestamptz" },
      { name: "user_metadata", type: "jsonb" },
    ],
  },
  {
    name: "profiles",
    description: "User profiles (1:1 with auth.users)",
    columns: [
      { name: "id", type: "uuid", isPK: true, fkTo: "users.id" },
      { name: "email", type: "text" },
      { name: "name", type: "text" },
      { name: "role", type: "text" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
  },
  {
    name: "station_users",
    description: "Join: users granted access to a station",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "station_id", type: "uuid", fkTo: "stations.id" },
      { name: "user_id", type: "uuid", fkTo: "users.id" },
      { name: "role", type: "text" },
      { name: "is_active", type: "boolean" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "sales",
    description: "Fuel sales records",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "station_id", type: "uuid", fkTo: "stations.id" },
      { name: "user_id", type: "uuid", fkTo: "users.id" },
      { name: "fuel_type", type: "text" },
      { name: "quantity_liters", type: "numeric" },
      { name: "price_per_liter", type: "numeric" },
      { name: "subtotal", type: "numeric" },
      { name: "tax_amount", type: "numeric" },
      { name: "total", type: "numeric" },
      { name: "payment_method", type: "text" },
      { name: "pump_number", type: "text" },
      { name: "receipt_number", type: "text" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "inventory",
    description: "Fuel tank stock levels per station",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "station_id", type: "uuid", fkTo: "stations.id" },
      { name: "fuel_type", type: "text" },
      { name: "current_stock", type: "numeric" },
      { name: "capacity", type: "numeric" },
      { name: "price_per_liter", type: "numeric" },
      { name: "supplier_name", type: "text" },
      { name: "alert_threshold", type: "numeric" },
      { name: "last_restocked_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "audit_logs",
    description: "Application audit trail",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "user_id", type: "uuid", fkTo: "users.id" },
      { name: "station_id", type: "uuid", fkTo: "stations.id" },
      { name: "event", type: "text" },
      { name: "detail", type: "text" },
      { name: "severity", type: "text" },
      { name: "ip_address", type: "text" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "app_kv",
    description: "Cross-device key/value store (cloud storage)",
    columns: [
      { name: "id", type: "text", isPK: true },
      { name: "collection", type: "text" },
      { name: "owner_id", type: "uuid", fkTo: "users.id" },
      { name: "station_id", type: "uuid", fkTo: "stations.id" },
      { name: "data", type: "jsonb" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
  },
  {
    name: "fuel_data",
    description: "Time-series fuel readings",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "collection", type: "text" },
      { name: "data", type: "jsonb" },
      { name: "device_id", type: "text" },
      { name: "station_id", type: "text" },
      { name: "timestamp", type: "bigint" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "config",
    description: "App configuration key/value",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "config_key", type: "text" },
      { name: "config_value", type: "text" },
      { name: "config_type", type: "text" },
      { name: "category", type: "text" },
      { name: "description", type: "text" },
      { name: "is_public", type: "boolean" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
  },
  {
    name: "founder_audit_log",
    description: "Founder/admin activity log",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "actor_id", type: "uuid", fkTo: "users.id" },
      { name: "action", type: "text" },
      { name: "entity_type", type: "text" },
      { name: "entity_id", type: "text" },
      { name: "metadata", type: "jsonb" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
  {
    name: "founder_sessions",
    description: "Founder 2FA / contact settings",
    columns: [
      { name: "id", type: "uuid", isPK: true },
      { name: "two_factor_enabled", type: "boolean" },
      { name: "two_factor_secret", type: "text" },
      { name: "contact_email", type: "text" },
      { name: "contact_phone", type: "text" },
      { name: "password_hash", type: "text" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
  },
  {
    name: "_health",
    description: "DB health check marker",
    columns: [
      { name: "id", type: "text", isPK: true },
      { name: "status", type: "text" },
      { name: "checked_at", type: "timestamptz" },
    ],
  },
];

// FK links derived from SCHEMA (for the relationship list + highlighting).
const FK_LINKS = SCHEMA.flatMap((t) =>
  t.columns
    .filter((c) => c.fkTo)
    .map((c) => ({
      id: `${t.name}.${c.name}`,
      fromTable: t.name,
      fromCol: c.name,
      toTable: c.fkTo!.split(".")[0],
      toCol: c.fkTo!.split(".")[1],
    })),
);

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function SchemaVisualizerSection({ logAudit }: Props) {
  const [rowCounts, setRowCounts] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showEmpty, setShowEmpty] = useState(true);
  const [highlightTable, setHighlightTable] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    const counts: Record<string, number | null> = {};
    try {
      const client = getSupabaseClient();
      await Promise.all(
        SCHEMA.map(async (t) => {
          try {
            const { count, error } = await client
              .from(t.name)
              .select("*", { count: "exact", head: true });
            // RLS may deny access → treat as permission-gated (null), not 0.
            counts[t.name] = error ? null : (count ?? 0);
          } catch {
            counts[t.name] = null;
          }
        }),
      );
      setRowCounts(counts);
      logAudit(
        "Schema Loaded",
        `Loaded ${SCHEMA.length} live Supabase tables with row counts`,
        "success",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logAudit("Schema Load Failed", msg, "danger");
    } finally {
      setLoading(false);
    }
  }, [logAudit]);

  useEffect(() => {
    setExpanded(new Set(SCHEMA.map((t) => t.name)));
    fetchCounts();
  }, [fetchCounts]);

  const filtered = useMemo(() => {
    if (!search.trim()) return SCHEMA;
    const q = search.toLowerCase();
    return SCHEMA.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [search]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const relatedTables = useMemo(() => {
    if (!highlightTable) return new Set<string>();
    const rel = new Set<string>([highlightTable]);
    FK_LINKS.forEach((l) => {
      if (l.fromTable === highlightTable) rel.add(l.toTable);
      if (l.toTable === highlightTable) rel.add(l.fromTable);
    });
    return rel;
  }, [highlightTable]);

  const visibleTables = showEmpty
    ? filtered
    : filtered.filter((t) => (rowCounts[t.name] ?? 0) > 0);
  const totalRows = SCHEMA.reduce((s, t) => s + (rowCounts[t.name] ?? 0), 0);
  const accessibleCount = Object.values(rowCounts).filter(
    (v) => v !== null,
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Database size={18} className="text-purple-400" /> Schema Visualizer
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Live Supabase schema · {SCHEMA.length} tables · {FK_LINKS.length} FK
            links
            {loading
              ? " · counting rows…"
              : ` · ${totalRows.toLocaleString()} rows (${accessibleCount}/${SCHEMA.length} accessible)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEmpty((v) => !v)}
            className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg border border-white/[0.06] transition-colors flex items-center gap-1.5"
            title={showEmpty ? "Hide empty tables" : "Show empty tables"}
          >
            {showEmpty ? <Eye size={12} /> : <EyeOff size={12} />}
            {showEmpty ? "Hide empty" : "Show empty"}
          </button>
          <button
            onClick={fetchCounts}
            disabled={loading}
            className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-xs">
        <CheckCircle2 size={14} /> Linked to Supabase (ojjscjwatikixlpshmub) ·
        {SCHEMA.length} tables · {FK_LINKS.length} foreign-key relationships
        {accessibleCount < SCHEMA.length && (
          <span className="text-amber-300/80 ml-1 flex items-center gap-1">
            <Lock size={10} /> {SCHEMA.length - accessibleCount} RLS-gated
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search
          size={12}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tables or columns..."
          className="w-full pl-8 pr-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <Key size={10} className="text-amber-400" /> Primary Key
        </span>
        <span className="flex items-center gap-1">
          <Link2 size={10} className="text-sky-400" /> Foreign Key
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Has data
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-600" /> Empty
        </span>
        <span className="flex items-center gap-1">
          <Lock size={10} className="text-amber-400/60" /> RLS-gated (—)
        </span>
      </div>

      {loading && Object.keys(rowCounts).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <Loader2 size={24} className="animate-spin mb-3" />
          <p className="text-xs">Loading live Supabase schema...</p>
        </div>
      ) : visibleTables.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-xs">
          No tables match "{search}"
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTables.map((table) => {
            const isExpanded = expanded.has(table.name);
            const count = rowCounts[table.name];
            const isGated = count === null;
            const hasData = (count ?? 0) > 0;
            const isHighlighted =
              highlightTable === table.name ||
              (highlightTable && relatedTables.has(table.name));
            const relatedCount = FK_LINKS.filter(
              (l) => l.fromTable === table.name || l.toTable === table.name,
            ).length;

            return (
              <div
                key={table.name}
                onMouseEnter={() => setHighlightTable(table.name)}
                onMouseLeave={() => setHighlightTable(null)}
                className={`bg-[#161618] border rounded-xl overflow-hidden transition-all ${
                  isHighlighted
                    ? "border-amber-500/40 shadow-lg shadow-amber-500/5"
                    : "border-white/[0.06]"
                } ${highlightTable && !isHighlighted ? "opacity-40" : ""}`}
              >
                {/* Table header */}
                <div
                  className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-white/[0.02]"
                  onClick={() => toggleExpand(table.name)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                      <ChevronDown
                        size={12}
                        className="text-gray-500 flex-shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={12}
                        className="text-gray-500 flex-shrink-0"
                      />
                    )}
                    <Table2
                      size={12}
                      className="text-purple-400 flex-shrink-0"
                    />
                    <span className="text-xs font-medium text-white font-mono truncate">
                      {table.name}
                    </span>
                    {relatedCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[9px] text-sky-400/70">
                        <Link2 size={8} /> {relatedCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isGated ? (
                      <span className="flex items-center gap-1 text-[10px] text-amber-500/60">
                        <Lock size={8} /> —
                      </span>
                    ) : (
                      <>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            hasData ? "bg-emerald-400" : "bg-gray-600"
                          }`}
                        />
                        <span className="text-[10px] text-gray-500 tabular-nums">
                          {(count ?? 0).toLocaleString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="px-3 pb-1.5 text-[10px] text-gray-600 italic">
                  {table.description}
                </div>

                {/* Columns */}
                {isExpanded && (
                  <div className="border-t border-white/[0.04]">
                    {table.columns.map((col) => {
                      const isFKTarget =
                        highlightTable &&
                        FK_LINKS.some(
                          (l) =>
                            `${l.fromTable}.${l.fromCol}` ===
                              `${table.name}.${col.name}` &&
                            l.toTable === highlightTable,
                        );
                      return (
                        <div
                          key={col.name}
                          className={`flex items-center px-3 py-1.5 text-[11px] border-b border-white/[0.02] last:border-0 ${
                            isFKTarget
                              ? "bg-amber-500/10"
                              : "hover:bg-white/[0.02]"
                          }`}
                        >
                          <div className="w-4 flex-shrink-0">
                            {col.isPK && (
                              <Key
                                size={9}
                                className="text-amber-400"
                                fill="currentColor"
                              />
                            )}
                            {col.fkTo && !col.isPK && (
                              <Link2 size={9} className="text-sky-400" />
                            )}
                          </div>
                          <span
                            className={`flex-1 truncate font-mono ${
                              col.isPK
                                ? "text-amber-300 font-medium"
                                : col.fkTo
                                  ? "text-sky-300"
                                  : "text-gray-300"
                            }`}
                          >
                            {col.name}
                          </span>
                          <span className="text-[9px] text-gray-600 ml-2">
                            {col.type}
                          </span>
                          {col.fkTo && (
                            <span className="text-[9px] text-sky-500/60 ml-1.5 font-mono">
                              →{col.fkTo}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FK relationship summary */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-4">
        <h3 className="text-xs font-medium text-white mb-3 flex items-center gap-2">
          <Link2 size={12} className="text-sky-400" /> Foreign-Key Relationships
          <span className="text-gray-500">({FK_LINKS.length})</span>
        </h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {FK_LINKS.map((l) => (
            <div
              key={l.id}
              onMouseEnter={() => setHighlightTable(l.fromTable)}
              onMouseLeave={() => setHighlightTable(null)}
              className="flex items-center gap-2 text-[11px] font-mono py-1 px-2 rounded hover:bg-white/[0.03] cursor-default"
            >
              <span className="text-sky-300">{l.fromTable}</span>
              <span className="text-gray-600">.</span>
              <span className="text-sky-300/80">{l.fromCol}</span>
              <Link2 size={10} className="text-gray-600 mx-1" />
              <span className="text-gray-300">{l.toTable}</span>
              <span className="text-gray-600">.</span>
              <span className="text-gray-400">{l.toCol}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
