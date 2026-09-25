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

function json(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function miss(res: ServerResponse): void {
  json(res, 404, { success: false, reason: "not_found" });
}

function decode(value: unknown): unknown {
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
    } catch {}
  }
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch {}
  }
  return data;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    json(res, 405, { success: false, reason: "method_not_allowed" });
    return;
  }

  const ip =
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!checkRate(ip)) {
    json(res, 429, { success: false, reason: "rate_limited" });
    return;
  }

  const token = new URL(req.url || "/", "http://localhost").searchParams.get("token") || "";
  if (!/^[A-Za-z0-9]{10,16}$/.test(token)) {
    json(res, 400, { success: false, reason: "invalid_token" });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    json(res, 503, { success: false, reason: "unavailable" });
    return;
  }

  try {
    const apiUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
    apiUrl.searchParams.set("id", `like.external_mini_site_${token}__*`);
    apiUrl.searchParams.set("select", "id,data");
    apiUrl.searchParams.set("limit", "5");
    const response = await fetch(apiUrl, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!response.ok) {
      json(res, 502, { success: false, reason: "unavailable" });
      return;
    }

    const rows = (await response.json()) as { id: string; data: unknown }[];
    let doc: { token?: string; expiresAt?: string } | null = null;
    for (const row of rows) {
      const candidate = decode(row.data) as
        | { token?: string; expiresAt?: string }
        | null;
      if (candidate?.token === token) {
        doc = candidate;
        break;
      }
    }
    if (!doc) {
      miss(res);
      return;
    }
    if (doc.expiresAt && Date.parse(doc.expiresAt) < Date.now()) {
      json(res, 410, { success: false, reason: "expired" });
      return;
    }
    json(res, 200, { success: true, document: doc });
  } catch {
    json(res, 500, { success: false, reason: "error" });
  }
}
