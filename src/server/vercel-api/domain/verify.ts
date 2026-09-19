import dns from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

const ALLOWED = new Set([
  "https://fuel-app-mobile.vercel.app",
  "https://fuel-app-mobile.pages.dev",
]);

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function normalizeDomain(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .split("/")[0];
}

function validDomain(domain: string): boolean {
  return domain.length <= 253 &&
    /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

async function auth(req: IncomingMessage): Promise<string> {
  if (!supabaseAdmin) throw Object.assign(new Error("Server unavailable"), { status: 500 });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Missing bearer token"), { status: 401 });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return data.user.id;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(raw || "{}");
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cors(req, res);
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return json(res, 405, { success: false, error: "POST required" });

  try {
    const userId = await auth(req);
    const body = await readBody(req);
    const domain = normalizeDomain(body.domain);
    const stationId = String(body.stationId || "").trim();

    if (!validDomain(domain)) {
      return json(res, 400, { success: false, verified: false, error: "Enter a valid fully-qualified domain name." });
    }

    if (stationId) {
      const { data: station } = await supabaseAdmin!.from("stations").select("owner_id").eq("id", stationId).maybeSingle();
      if (!station) return json(res, 404, { success: false, verified: false, error: "Station not found." });
      if (station.owner_id !== userId) {
        const { data: member } = await supabaseAdmin!
          .from("station_role_assignments")
          .select("role")
          .eq("station_id", stationId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        if (!member?.role) return json(res, 403, { success: false, verified: false, error: "You do not have access to this station." });
      }
    }

    const [cname, a, aaaa] = await Promise.allSettled([
      dns.resolveCname(domain),
      dns.resolve4(domain),
      dns.resolve6(domain),
    ]);

    const cnameRecords = cname.status === "fulfilled" ? cname.value : [];
    const aRecords = a.status === "fulfilled" ? a.value : [];
    const aaaaRecords = aaaa.status === "fulfilled" ? aaaa.value : [];
    const dnsReachable = cnameRecords.length > 0 || aRecords.length > 0 || aaaaRecords.length > 0;

    return json(res, 200, {
      success: true,
      verified: dnsReachable,
      domain,
      dns: { cname: cnameRecords, a: aRecords, aaaa: aaaaRecords },
      message: dnsReachable
        ? "DNS records are visible. Hosting/domain attachment may still be required."
        : "No public DNS record was found for this domain yet.",
    });
  } catch (error) {
    const e = error as { status?: number; message?: string };
    return json(res, e.status || 500, { success: false, verified: false, error: e.message || "Domain verification failed." });
  }
}
