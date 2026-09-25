/**
 * Customer account link resolver (Vercel serverless, GET).
 *
 * GET /api/customer-portal?token=<12-char base62>
 *   -> 200 { success: true, document }   when live
 *   -> 410 { success: false, reason: "expired" }
 *   -> 404 for unknown/revoked tokens, 400 for malformed ones
 *
 * Why a resolver exists at all: the document holds a named customer's balance,
 * so unlike the station mini site it must NOT sit in the publicly-readable
 * bucket where anyone could enumerate it. It lives in `app_kv` (owner-scoped,
 * RLS-guarded) and is read here with the service role, which means the expiry
 * and revocation checks cannot be bypassed by fetching storage directly.
 *
 * The lookup is by TOKEN ALONE — the caller has no session, so the owner id is
 * unknown. Row ids are `<prefix><token>__<ownerId>`, and the `like.` filter
 * matches that suffix, so no owner id is needed to resolve a link.
 *
 * Security:
 * - token shape is validated before any query (10–16 base62 chars)
 * - naive per-IP rate limiting (per-instance) deters scanning
 * - responses are no-store + nosniff, so a shared cache never holds a balance
 * - a miss returns the same shape as a revoked link, so the endpoint does not
 *   reveal whether a token ever existed
 */
import type { IncomingMessage, ServerResponse } from "http";
import zlib from "node:zlib";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function checkRate(ip: string): boolean {
  const now = Date.now();
  const prev = hits.get(ip);
  if (!prev || now > prev.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  prev.count += 1;
  return prev.count <= RATE_LIMIT;
}

interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
}

function json(res: ApiResponse, code: number, body: unknown): void {
  res.status(code);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

/** Neutral miss: identical for "never existed" and "revoked". */
function miss(res: ApiResponse): void {
  json(res, 404, { success: false, reason: "not_found" });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const wrapRes = res as ApiResponse;
  wrapRes.status = (code: number) => {
    res.statusCode = code;
    return wrapRes;
  };

  if (req.method !== "GET") {
    json(wrapRes, 405, { success: false, reason: "method_not_allowed" });
    return;
  }

  const ip =
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!checkRate(ip)) {
    json(wrapRes, 429, { success: false, reason: "rate_limited" });
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const token = url.searchParams.get("token") || "";
  if (!/^[A-Za-z0-9]{10,16}$/.test(token)) {
    json(wrapRes, 400, { success: false, reason: "invalid_token" });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    json(wrapRes, 503, { success: false, reason: "unavailable" });
    return;
  }

  try {
    // The token is base62 (no underscore), and the meta row is
    // `<prefix><token>_meta__…`, so the `__` in this filter matches the
    // document row only — never the meta row.
    //
    // NOTE: in a PostgREST `like.` pattern `_` is a single-character wildcard,
    // so this filter can in principle match a sibling row. It is therefore only
    // a cheap index lookup; the decoded document's own `token` field below is
    // the authoritative check, which is why more than one row is fetched.
    const apiUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
    apiUrl.searchParams.set("id", `like.customer_portal_${token}__*`);
    apiUrl.searchParams.set("select", "id,data");
    apiUrl.searchParams.set("limit", "5");
    const resp = await fetch(apiUrl, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!resp.ok) {
      json(wrapRes, 502, { success: false, reason: "unavailable" });
      return;
    }
    const rows = (await resp.json()) as { id: string; data: unknown }[];
    if (!rows.length) {
      miss(wrapRes);
      return;
    }

    /** Decode one stored value (compressed envelope or plain JSON). */
    const decode = (value: unknown): unknown => {
      let data: unknown = value;
      if (
        data &&
        typeof data === "object" &&
        (data as { __compressed?: boolean }).__compressed === true &&
        typeof (data as { c?: unknown }).c === "string"
      ) {
        try {
          data = JSON.parse(
            zlib
              .gunzipSync(Buffer.from((data as { c: string }).c, "base64"))
              .toString(),
          );
        } catch {
          /* legacy uncompressed value — keep as-is */
        }
      }
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          /* keep */
        }
      }
      return data;
    };

    // Select the row whose own `token` field matches — the authoritative check.
    let doc: { token?: string; expiresAt?: string } | null = null;
    for (const row of rows) {
      const candidate = decode(row.data) as {
        token?: string;
        expiresAt?: string;
      } | null;
      if (candidate && candidate.token === token) {
        doc = candidate;
        break;
      }
    }
    if (!doc) {
      miss(wrapRes);
      return;
    }
    if (doc.expiresAt && Date.parse(doc.expiresAt) < Date.now()) {
      json(wrapRes, 410, { success: false, reason: "expired" });
      return;
    }

    json(wrapRes, 200, { success: true, document: doc });
  } catch {
    json(wrapRes, 500, { success: false, reason: "error" });
  }
}
