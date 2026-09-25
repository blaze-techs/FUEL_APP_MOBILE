import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: `upsert_app_kv_versioned` must exist under EXACTLY ONE signature
// across the whole migration history.
//
// The bug this pins: app_kv.station_id is UUID, but the function was first
// created with `p_station_id text` (020, re-applied by the sync-hardening
// migration, then 041). A later migration recreated it with `p_station_id uuid`
// — and CREATE OR REPLACE only replaces a function with an IDENTICAL argument
// list, so the uuid version was added as a SECOND overload rather than
// replacing the first.
//
// Two overloads differing in one argument type are unresolvable by PostgREST:
//
//   PGRST203: Could not choose the best candidate function between ...
//
// Every app_kv write failed, and because cloud_storage_service.set() treats an
// RPC error as a sync-safety failure (queue instead of last-writer-wins
// fallback), the entire cloud-sync path went dark with no visible error. Two
// overloads is therefore a silent, total data-loss class of bug — it must fail
// CI rather than be discovered in production.

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Every `create [or replace] function ... upsert_app_kv_versioned(...)`. */
function readMigrations(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
    }));
}

describe("upsert_app_kv_versioned has a single resolvable signature", () => {
  const migrations = readMigrations();

  // Historical migrations legitimately declared the text parameter; the net
  // state after the whole history is what must be single-signature. So this
  // asserts the LAST declaration is uuid — a future migration that re-adds a
  // text variant without dropping it would violate this.

  /** Declarations in migration order, with the station-id type that was used. */
  function declarations(): Array<{ file: string; stationIdType: string }> {
    const out: Array<{ file: string; stationIdType: string }> = [];
    for (const { file, sql } of migrations) {
      const decls =
        sql.match(
          /create\s+(?:or\s+replace\s+)?function\s+public\.upsert_app_kv_versioned\s*\(([\s\S]*?)\)\s*returns/gi,
        ) || [];
      for (const decl of decls) {
        const m = decl.match(/p_station_id\s+(\w+)/i);
        out.push({ file, stationIdType: (m?.[1] || "").toLowerCase() });
      }
    }
    return out;
  }

  it("ultimately declares p_station_id as uuid (matching app_kv.station_id)", () => {
    const decls = declarations();
    expect(
      decls.length,
      "expected the function to be declared",
    ).toBeGreaterThan(0);
    // The surviving definition must match the column type, or a plain
    // `p_station_id => '<uuid string>'` call has no unambiguous candidate.
    expect(decls[decls.length - 1].stationIdType).toBe("uuid");
  });

  it("drops the text overload after the last text declaration", () => {
    const decls = declarations();
    const lastTextIdx = decls.map((d) => d.stationIdType).lastIndexOf("text");
    if (lastTextIdx === -1) return; // nothing to reconcile

    const lastTextFile = decls[lastTextIdx].file;
    // The drop must live in a migration that sorts strictly AFTER the final
    // text declaration, otherwise it runs too early and the overload survives.
    const dropFiles = migrations
      .filter((m) =>
        /drop\s+function\s+if\s+exists\s+public\.upsert_app_kv_versioned\s*\(\s*text\s*,\s*uuid\s*,\s*text\s*,/i.test(
          m.sql,
        ),
      )
      .map((m) => m.file);
    expect(
      dropFiles.some((f) => f > lastTextFile),
      `a drop for the text overload must run after ${lastTextFile} (found: ${
        dropFiles.join(", ") || "none"
      }) — otherwise PostgREST sees two candidates and every cloud write fails`,
    ).toBe(true);
  });

  it("grants the exact uuid signature, not an argument-less form", () => {
    const all = migrations.map((m) => m.sql).join("\n");
    // `GRANT ... ON FUNCTION f()` resolves by argument types, so a bare `()`
    // targets a different (or non-existent) overload and leaves the RPC
    // unexecutable despite the grant appearing to succeed.
    expect(all).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.upsert_app_kv_versioned\s*\(\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*,\s*bigint\s*\)\s+to\s+authenticated/i,
    );
    expect(all).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.upsert_app_kv_versioned\s*\(\s*\)/i,
    );
  });
});
