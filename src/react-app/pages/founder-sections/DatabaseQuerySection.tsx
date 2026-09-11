/**
 * DatabaseQuerySection — a guarded read-only SQL runner for the Founder
 * Console. Runs SELECT queries against the live Supabase database via the
 * authenticated client (RLS-respecting). Only SELECT statements are allowed;
 * any destructive keyword (INSERT/UPDATE/DELETE/DROP/etc.) is rejected.
 */

import { useState } from "react";
import {
  Database,
  Play,
  Trash2,
  Copy,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { SectionHeader } from "./WebhooksManagerSection";
import { getSupabaseClient } from "@/supabase/client";

interface Props {
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  count: number;
  durationMs: number;
  error?: string;
}

const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "exec",
  "merge",
];

function isReadOnly(sql: string): boolean {
  const lower = sql.toLowerCase();
  // Must start with SELECT or WITH (CTE)
  const trimmed = lower.trim().replace(/^\(/, "");
  if (!trimmed.startsWith("select") && !trimmed.startsWith("with"))
    return false;
  // Reject any forbidden keyword outside of string literals (simple heuristic)
  const withoutStrings = lower
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  return !FORBIDDEN.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(withoutStrings),
  );
}

const SAMPLE_QUERIES = [
  "SELECT count(*) FROM stations;",
  "SELECT id, email, role FROM users LIMIT 10;",
  "SELECT id, key FROM app_kv LIMIT 5;",
  "SELECT count(*) FROM sales;",
];

export default function DatabaseQuerySection({ logAudit }: Props) {
  const [sql, setSql] = useState("SELECT count(*) FROM stations;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    const trimmed = sql.trim().replace(/;$/, "");
    if (!trimmed) return;
    if (!isReadOnly(trimmed)) {
      setResult({
        rows: [],
        count: 0,
        durationMs: 0,
        error:
          "Only read-only SELECT / WITH queries are permitted. Destructive keywords detected.",
      });
      logAudit("SQL Query Rejected", "Destructive keyword detected", "danger");
      return;
    }
    setRunning(true);
    setResult(null);
    const start = performance.now();
    try {
      const client = getSupabaseClient();
      const { data, error, count } = (await client.rpc(
        "exec_sql_select" as never,
        { query_text: trimmed } as never,
      )) as {
        data: Record<string, unknown>[] | null;
        error: { message?: string } | null;
        count: number | null;
      };
      const duration = Math.round(performance.now() - start);
      if (error) {
        // Fallback: not all projects have the RPC. Surface a clear message.
        setResult({
          rows: [],
          count: 0,
          durationMs: duration,
          error: `Query could not run via the safe RPC: ${(error as { message?: string }).message ?? "unknown error"}. Use the Supabase SQL Editor for ad-hoc queries.`,
        });
        logAudit("SQL Query Failed", trimmed.slice(0, 80), "danger");
      } else {
        const rows = (data as Record<string, unknown>[]) ?? [];
        setResult({ rows, count: count ?? rows.length, durationMs: duration });
        logAudit(
          "SQL Query Executed",
          `${trimmed.slice(0, 60)} (${rows.length} rows)`,
          "info",
        );
      }
    } catch (e) {
      const duration = Math.round(performance.now() - start);
      setResult({
        rows: [],
        count: 0,
        durationMs: duration,
        error: e instanceof Error ? e.message : "Unknown error",
      });
      logAudit("SQL Query Error", trimmed.slice(0, 80), "danger");
    } finally {
      setRunning(false);
    }
  };

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard?.writeText(JSON.stringify(result.rows, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const columns = result?.rows?.[0] ? Object.keys(result.rows[0]) : [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Database}
        title="Database Query"
        subtitle="Run read-only SELECT queries against the live database"
      />

      <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2">
        <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300">
          Safety guard: only <code className="font-mono">SELECT</code> /{" "}
          <code className="font-mono">WITH</code> queries are allowed. Any
          destructive keyword (INSERT, UPDATE, DELETE, DROP, etc.) is blocked
          client-side. Queries run RLS-respecting.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            onClick={() => setSql(q)}
            className="px-2.5 py-1 rounded-full text-xs font-mono bg-white/5 text-gray-300 hover:bg-white/10"
          >
            {q}
          </button>
        ))}
      </div>

      <div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-green-400 font-mono resize-none focus:ring-2 focus:ring-amber-500"
          placeholder="SELECT * FROM ..."
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={running || !sql.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-sm font-medium"
        >
          <Play size={16} /> {running ? "Running..." : "Run Query"}
        </button>
        <button
          onClick={() => {
            setSql("");
            setResult(null);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
        >
          <Trash2 size={16} /> Clear
        </button>
      </div>

      {result?.error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {result.error}
        </div>
      )}

      {result && !result.error && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>{result.count} rows</span>
              <span>{result.durationMs}ms</span>
            </div>
            <button
              onClick={copyJson}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
            >
              {copied ? (
                <CheckCircle2 size={14} className="text-green-400" />
              ) : (
                <Copy size={14} />
              )}{" "}
              Copy JSON
            </button>
          </div>
          {result.rows.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No rows returned
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    {columns.map((c) => (
                      <th
                        key={c}
                        className="text-left px-3 py-2 text-gray-400 font-mono"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 100).map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/5 hover:bg-white/5"
                    >
                      {columns.map((c) => (
                        <td
                          key={c}
                          className="px-3 py-1.5 text-gray-300 font-mono align-top"
                        >
                          {typeof row[c] === "object"
                            ? JSON.stringify(row[c])
                            : String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 100 && (
                <p className="text-center text-[11px] text-gray-500 mt-2">
                  Showing first 100 of {result.rows.length} rows
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
