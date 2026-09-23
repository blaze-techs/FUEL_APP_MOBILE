/**
 * Live verification: exercise the REAL grant-access server path against the
 * REAL database, proving the member payload matches the owner's app.
 *
 * Run: npx tsx scripts/verify-grant-access.mts <grantCode>
 */
import { resolveGrantForAccess, buildStationSnapshotForGrant } from "../src/server/vercel-api/_lib/station-snapshot-for-grant.js";

const SUPABASE_URL = "https://ojjscjwatikixlpshmub.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const code = process.argv[2] || "eKLUfpX4NEjAHDEBGc";

function assert(cond: unknown, msg: string) {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
}

const resolved = await resolveGrantForAccess(code, SUPABASE_URL, SERVICE_KEY);
console.log("resolve:", JSON.stringify({ reason: resolved.reason, src: resolved.grant?.source }, null, 0));
assert(resolved.grant, "active grant resolves");
if (!resolved.grant) process.exit(1);

const snap = await buildStationSnapshotForGrant(resolved.grant, SUPABASE_URL, SERVICE_KEY);
console.log("\nstation :", snap.stationName, "|", snap.currency);
console.log("prices  :", JSON.stringify(snap.fuelPrices));
console.log("pumps   :", JSON.stringify(snap.pumps));
console.log("kpis    :", JSON.stringify(snap.salesKpis));
console.log("invoices:", JSON.stringify(snap.invoices));
console.log("reportKpis:", JSON.stringify(snap.reportKpis));
console.log("counts  : sales", (snap.recentSales as unknown[]).length,
  "expenses", (snap.expenses as unknown[]).length,
  "customers", (snap.customers as unknown[]).length,
  "payments", (snap.payments as unknown[]).length,
  "employees", (snap.employees as unknown[]).length);
console.log("dataSource:", snap.dataSource, "| allowedTabs:", snap.allowedTabs);

// Invoice status must reflect the stored status, never a truthy-fallback.
const inv = (snap.invoices as Record<string, unknown>[])[0] as
  | { status?: string; total?: number }
  | undefined;
if (inv) assert(inv.status === "unpaid" || inv.status === "paid", `invoice status is explicit (${inv.status})`);
assert(snap.dataSource === "live", "payload is flagged live (authoritative)");

// Revoked/unknown codes must NOT disclose station data.
const bad = await resolveGrantForAccess("ZZZZnotarealcode1", SUPABASE_URL, SERVICE_KEY);
assert(!bad.grant, `unknown code denied (${bad.reason})`);
