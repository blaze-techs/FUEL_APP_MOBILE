/**
 * Payslip short-link resolver (Vercel serverless, GET).
 *
 * GET /api/payslip-link?code=<12-char base62>
 *   -> 302 redirect to the raw storage URL (only ever resolved here)
 *   -> 410 "link expired" HTML when expiresAt passed
 *   -> 404 for unknown codes, 400 for malformed codes
 *
 * Security:
 * - Crypto-random code format enforced (10-16 base62 chars).
 * - Naive per-IP rate limiting (per-instance) deters scanning.
 * - The raw URL is only resolved server-side; lookup happens with the
 *   service role (bypasses RLS) so an anonymous recipient can resolve.
 * - The redirect target is validated against the Supabase storage origin —
 *   no open-redirect abuse possible.
 * - Responses are no-store + nosniff.
 */
import type { IncomingMessage, ServerResponse } from "http";
import zlib from "node:zlib";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ─── naive per-IP rate limit (per-instance; denies scanning brute-forces) ──
const RATE_LIMIT = 60; // requests per window
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
  if (prev.count > RATE_LIMIT) return false;
  return true;
}

interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
}

function htmlPage(res: ApiResponse, code: number, title: string): void {
  res.status(code);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html><head><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#0a0e17;color:#e0e6ed;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><div><h1 style="font-size:20px;margin-bottom:8px">${title}</h1><p style="color:#94a3b8;font-size:14px">Ask the station to re-send the payslip link.</p></div></body></html>`,
  );
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
    htmlPage(wrapRes, 405, "Method not allowed");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const ip =
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!checkRate(ip)) {
    htmlPage(wrapRes, 429, "Too many requests");
    return;
  }

  // Parse ?code=
  const url = new URL(req.url || "/", "http://localhost");
  const code = url.searchParams.get("code") || "";
  if (!/^[A-Za-z0-9]{10,16}$/.test(code)) {
    htmlPage(wrapRes, 400, "Invalid payslip link");
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    htmlPage(wrapRes, 503, "Link resolution unavailable");
    return;
  }

  try {
    const filter = `payslip_shortlink_${code}__*`;
    const apiUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
    apiUrl.searchParams.set("id", `like.${filter}`);
    apiUrl.searchParams.set("select", "id,data");
    apiUrl.searchParams.set("limit", "1");
    const resp = await fetch(apiUrl, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!resp.ok) {
      htmlPage(wrapRes, 502, "Link resolution unavailable");
      return;
    }
    const rows = (await resp.json()) as { id: string; data: unknown }[];
    if (!rows.length) {
      htmlPage(wrapRes, 404, "Payslip link not found");
      return;
    }
    // Decompress the value if it used the `{__compressed,c}` envelope.
    let data: unknown = rows[0].data;
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
        // uncompressed legacy value — keep as-is
      }
    }
    if (data && typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        /* keep */
      }
    }
    const record = (data || {}) as {
      url?: string;
      employeeName?: string;
      periodLabel?: string;
      expiresAt?: string;
    };
    // Expired?
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
      htmlPage(wrapRes, 410, "This payslip link has expired");
      return;
    }
    const target = record.url || "";
    // STRICT redirect allow-list: only resolve URLs belonging to our storage
    // bucket (avoids open-redirect abuse if app_kv is tampered with).
    if (!target.startsWith(`${SUPABASE_URL}/storage/`)) {
      htmlPage(wrapRes, 502, "Link resolution unavailable");
      return;
    }
    res.statusCode = 302;
    res.setHeader("Location", target);
    res.end("Redirecting — your payslip is loading.");
  } catch {
    htmlPage(wrapRes, 500, "Link resolution failed");
  }
}
