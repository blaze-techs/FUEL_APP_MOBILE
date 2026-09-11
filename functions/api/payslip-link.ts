/**
 * Cloudflare Pages Function — Payslip short-link resolver (GET /api/payslip-link?code=…).
 * Mirrors api/payslip-link.ts (Vercel). Security: crypto-random code format,
 * expiry server-side, redirect target validated against the Supabase storage
 * origin, naive per-IP rate limit, no-store/nosniff headers. When the Supabase
 * env vars are not yet configured on the Pages project, the request 302-forwards
 * to the Vercel resolver so links always resolve.
 */
import zlib from "node:zlib";

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}
type PagesContext = { request: Request; env: Env };
type PagesFunction<E> = (ctx: PagesContext) => Response | Promise<Response>;

const RATE_LIMIT = 60;
const WINDOW = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function checkRate(ip: string): boolean {
  const now = Date.now();
  const prev = hits.get(ip);
  if (!prev || now > prev.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW });
    return true;
  }
  prev.count += 1;
  return prev.count <= RATE_LIMIT;
}

function htmlPage(code: number, title: string): Response {
  const body = `<!doctype html><html><head><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#0a0e17;color:#e0e6ed;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><div><h1 style="font-size:20px;margin-bottom:8px">${title}</h1><p style="color:#94a3b8;font-size:14px">Ask the station to re-send the payslip link.</p></div></body></html>`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    status: code,
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get("code") || "";
  if (!/^[A-Za-z0-9]{10,16}$/.test(code)) {
    return htmlPage(400, "Invalid payslip link");
  }
  const ip = ctx.request.headers.get("cf-connecting-ip") || "unknown";
  if (!checkRate(ip)) return htmlPage(429, "Too many requests");

  const SUPABASE_URL = ctx.env.SUPABASE_URL || "";
  const SERVICE_KEY = ctx.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Env not set on the Pages project yet — forward to the Vercel resolver
    // (identical behavior; links keep working).
    const fallback = `https://fuel-app-mobile.vercel.app/api/payslip-link?code=${encodeURIComponent(code)}`;
    return new Response(null, {
      status: 302,
      headers: { Location: fallback, "Cache-Control": "no-store" },
    });
  }

  try {
    const filter = `payslip_shortlink_${code}__*`;
    const apiUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
    apiUrl.searchParams.set("id", `like.${filter}`);
    apiUrl.searchParams.set("select", "id,data");
    apiUrl.searchParams.set("limit", "1");
    const resp = await fetch(apiUrl, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!resp.ok) return htmlPage(502, "Link resolution unavailable");
    const rows = (await resp.json()) as { id: string; data: unknown }[];
    if (!rows.length) return htmlPage(404, "Payslip link not found");
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
        // keep raw
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
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
      return htmlPage(410, "This payslip link has expired");
    }
    const target = record.url || "";
    // STRICT redirect allow-list: storage URLs only (no open redirects).
    if (!target.startsWith(`${SUPABASE_URL}/storage/`)) {
      return htmlPage(502, "Link resolution unavailable");
    }
    return new Response("Redirecting — your payslip is loading.", {
      status: 302,
      headers: {
        Location: target,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return htmlPage(500, "Link resolution failed");
  }
};
