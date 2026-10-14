/**
 * Public station lookup for member login.
 *
 * A team member signing in with a station-assigned username + password must be
 * able to FIND their station by name or code without knowing the owner UUID and
 * the station UUID. `stations` has owner-scoped RLS (`auth.uid() = owner_id`),
 * so an unauthenticated caller cannot read it directly. This endpoint reads with
 * the service role and returns ONLY the four fields the login flow needs —
 * stationId, ownerId, stationName, code. No address, phone, email, tax id,
 * financial data or other PII is exposed.
 *
 * WHY THIS EXISTS: the legacy `lookup_station(p_query)` RPC selects
 * `s.station_name`, but the column is `name`. Every call therefore failed with
 * Postgres 42703 ("column s.station_name does not exist"), the client swallowed
 * the error, and the UI always reported "No stations found by search." This
 * endpoint is the primary lookup path; the client keeps the RPC and the manual
 * ID entry as fallbacks.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 64;

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

/**
 * Escape LIKE metacharacters so a user typing `%` or `_` searches for those
 * literal characters instead of matching everything. Postgres LIKE treats
 * backslash as the escape character by default.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface StationRow {
  id: string;
  owner_id: string | null;
  name: string | null;
  code: string | null;
}

function toResult(row: StationRow) {
  return {
    stationId: row.id,
    ownerId: row.owner_id,
    stationName: row.name || "",
    code: row.code || "",
  };
}

/** Exact code, then exact name, then partial — then alphabetical. */
function rank(
  a: ReturnType<typeof toResult>,
  b: ReturnType<typeof toResult>,
  q: string,
) {
  const score = (r: ReturnType<typeof toResult>) =>
    r.code.toLowerCase() === q ? 0 : r.stationName.toLowerCase() === q ? 1 : 2;
  return score(a) - score(b) || a.stationName.localeCompare(b.stationName);
}

async function readQuery(req: IncomingMessage): Promise<string> {
  const url = new URL(req.url || "/", "http://fuelpro.local");
  const fromQuery =
    url.searchParams.get("q") || url.searchParams.get("query") || "";
  if (fromQuery) return fromQuery;

  // Also accept a JSON body { q | query } so POST works symmetrically.
  if (String(req.method || "").toUpperCase() !== "POST") return "";
  const body = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
  try {
    const parsed = JSON.parse(body || "{}");
    return String(parsed.q ?? parsed.query ?? "");
  } catch {
    return "";
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }
  if (method !== "GET" && method !== "POST") {
    return json(res, 405, { success: false, error: "Method not allowed" });
  }

  const raw = (await readQuery(req)).trim().slice(0, MAX_QUERY_LENGTH);
  if (!raw) {
    return json(res, 200, { success: true, results: [] });
  }

  if (!supabaseAdmin) {
    // No service role key in this environment — the client falls back to the
    // RPC and then to manual ID entry. Be explicit rather than returning [].
    return json(res, 503, {
      success: false,
      error: "Station lookup is not configured on this deployment.",
      results: [],
    });
  }

  const pattern = `%${escapeLike(raw)}%`;
  const q = raw.toLowerCase();

  try {
    const [byCode, byName] = await Promise.all([
      supabaseAdmin
        .from("stations")
        .select("id, owner_id, name, code")
        .ilike("code", pattern)
        .limit(MAX_RESULTS),
      supabaseAdmin
        .from("stations")
        .select("id, owner_id, name, code")
        .ilike("name", pattern)
        .limit(MAX_RESULTS),
    ]);

    const error = byCode.error || byName.error;
    if (error) {
      console.error("[station-lookup] query failed:", error.message);
      return json(res, 502, {
        success: false,
        error: "Station lookup is temporarily unavailable.",
        results: [],
      });
    }

    const merged = new Map<string, ReturnType<typeof toResult>>();
    for (const row of [...(byCode.data || []), ...(byName.data || [])]) {
      const result = toResult(row as StationRow);
      if (result.ownerId && !merged.has(result.stationId)) {
        merged.set(result.stationId, result);
      }
    }

    const results = [...merged.values()]
      .sort((a, b) => rank(a, b, q))
      .slice(0, MAX_RESULTS);

    return json(res, 200, { success: true, results });
  } catch (e: any) {
    console.error("[station-lookup] unexpected error:", e?.message || e);
    return json(res, 500, {
      success: false,
      error: "Station lookup failed.",
      results: [],
    });
  }
}
