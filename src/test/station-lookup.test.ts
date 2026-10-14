/**
 * Station lookup contracts.
 *
 * A team member must be able to FIND their station by name or code. The legacy
 * `lookup_station` RPC selected `station_name` (the column is `name`), so every
 * call failed with 42703 and the UI always said "No stations found by search."
 * These tests pin the corrected column reference and the server-side lookup
 * path that replaced it as the primary.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const ENDPOINT = read("src/server/vercel-api/station-lookup.ts");
const SERVICE = read("src/react-app/lib/station-access-code-service.ts");
const DISPATCHER = read("api/[[...path]].ts");

const migrationDir = resolve(root, "supabase/migrations");
const fixMigration = readdirSync(migrationDir).find((f) =>
  f.includes("fix_lookup_station_column"),
);

describe("station lookup — server endpoint", () => {
  it("is registered in the Vercel dispatcher", () => {
    expect(DISPATCHER).toMatch(/station-lookup\.js/);
    expect(DISPATCHER).toMatch(/\^\/api\/station-lookup/);
  });

  it("reads stations with the service role and returns only non-PII fields", () => {
    expect(ENDPOINT).toMatch(/supabaseAdmin/);
    expect(ENDPOINT).toMatch(/select\("id, owner_id, name, code"\)/);
    // Never leak address/phone/email/tax data.
    for (const leaked of ["address", "phone", "email", "kra_pin", "tax_rate"]) {
      expect(ENDPOINT).not.toMatch(new RegExp(`select\\([^)]*${leaked}`, "i"));
    }
  });

  it("searches both code and name and escapes LIKE metacharacters", () => {
    expect(ENDPOINT).toMatch(/ilike\("code"/);
    expect(ENDPOINT).toMatch(/ilike\("name"/);
    expect(ENDPOINT).toMatch(/escapeLike/);
    expect(ENDPOINT).toMatch(/\[\\\\%_\]/);
  });
});

describe("station lookup — client prefers the endpoint", () => {
  it("calls /api/station-lookup before the RPC", () => {
    const apiIdx = SERVICE.indexOf("lookupStationViaApi(q)");
    const rpcIdx = SERVICE.indexOf('rpc("lookup_station"');
    expect(apiIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeLessThan(rpcIdx);
  });
});

describe("station lookup — RPC column reference", () => {
  it("ships a corrective migration using the real `name` column", () => {
    expect(fixMigration).toBeTruthy();
    const sql = read(`supabase/migrations/${fixMigration}`);
    expect(sql).toMatch(/s\.name/);
    expect(sql).not.toMatch(/s\.station_name/);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(
      /grant execute on function lookup_station\(text\) to anon/i,
    );
  });
});
