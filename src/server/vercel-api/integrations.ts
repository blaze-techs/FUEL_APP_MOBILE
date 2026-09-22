/**
 * Production integration dispatcher.
 *
 * All browser-originated integration calls require a valid Supabase session
 * and station-scoped permission. Provider credentials are accepted only for
 * the authenticated station owner/operator and are never treated as a
 * substitute for application authentication.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { dispatchIntegration } from "./_lib/integrations-core.js";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

function wrapRes(res: ServerResponse): ApiResponse {
  const r = res as ApiResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  return r;
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = String(req.headers.origin || "");
  const allowed = new Set([
    "https://fuel-app-mobile.vercel.app",
    "https://fuel-app-mobile.pages.dev",
  ]);
  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 512_000) {
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(data || "{}");
        resolve(
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {},
        );
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function authenticateBearer(req: IncomingMessage): Promise<string> {
  if (!supabaseAdmin)
    throw Object.assign(new Error("Server unavailable"), { status: 500 });
  const raw = String(req.headers.authorization || "");
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  if (!token)
    throw Object.assign(new Error("Missing bearer token"), { status: 401 });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return data.user.id;
}

async function requireStationAccess(
  userId: string,
  body: Record<string, unknown>,
  action: string,
): Promise<void> {
  const stationId = String(body.stationId || body.station_id || "").trim();

  // Public, non-mutating health ping does not require station scope.
  if (action === "ping") return;

  if (!stationId) {
    // Connection tests do not mutate station data, so they can be authenticated
    // with the user's session alone. For operational sends, infer the station
    // only when the user has exactly one accessible station; otherwise the
    // caller must supply stationId to avoid cross-station ambiguity.
    if (
      [
        "mpesa-connection-test",
        "kra-etims-init",
        "kopokopo-pull",
        // Bug reports describe the app, not one station. They are owned by the
        // authenticated user, so requiring a station would make reporting fail
        // for anyone whose account has more than one station.
        "bug-report",
      ].includes(action)
    ) {
      return;
    }
    if (!supabaseAdmin) {
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    }
    const [{ data: owned }, { data: assigned }] = await Promise.all([
      supabaseAdmin.from("stations").select("id").eq("owner_id", userId),
      supabaseAdmin
        .from("station_role_assignments")
        .select("station_id")
        .eq("user_id", userId)
        .eq("is_active", true),
    ]);
    const ids = new Set<string>([
      ...(owned || []).map((r: any) => String(r.id)),
      ...(assigned || []).map((r: any) => String(r.station_id)),
    ]);
    if (ids.size === 1) {
      body.stationId = [...ids][0];
      return;
    }
    throw Object.assign(
      new Error("stationId is required when the account has multiple stations"),
      { status: 400 },
    );
  }

  if (!supabaseAdmin) {
    throw Object.assign(new Error("Server unavailable"), { status: 500 });
  }

  const { data: station, error: stationError } = await supabaseAdmin
    .from("stations")
    .select("owner_id")
    .eq("id", stationId)
    .maybeSingle();

  if (stationError) {
    throw Object.assign(new Error(stationError.message), { status: 500 });
  }

  if (station?.owner_id === userId) return;

  const { data: assignment } = await supabaseAdmin
    .from("station_role_assignments")
    .select("role")
    .eq("station_id", stationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (assignment?.role) return;

  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("station_id", stationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!member?.role) {
    throw Object.assign(new Error("No access to this station"), {
      status: 403,
    });
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const out = wrapRes(res);
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    out.status(405).json({ success: false, error: "POST required" });
    return;
  }

  const qs = Object.fromEntries(
    new URLSearchParams((req.url || "").split("?")[1] || ""),
  );
  const action = String(qs.action || "").trim();
  const body = await readBody(req);

  if (!action) {
    out.status(400).json({ success: false, error: "Missing action parameter" });
    return;
  }

  try {
    const userId = await authenticateBearer(req);
    await requireStationAccess(userId, body, action);

    // Never allow the browser to impersonate another application user.
    body.authenticatedUserId = userId;

    const result = await dispatchIntegration(action, body);

    // PayHero STK requests become canonical payment ledger records immediately.
    // The provider callback then reconciles the same row asynchronously.
    if (action === "payhero-stk-push" && result.success && supabaseAdmin) {
      const stationId = String(body.stationId || "").trim();
      const amount = Number(body.amount);
      const idempotencyKey = String(body.idempotencyKey || "").trim();
      const reference = String(
        result.reference ||
          result.merchant_reference ||
          result.checkout_request_id ||
          "",
      ).trim();

      if (stationId && Number.isFinite(amount) && amount > 0 && reference) {
        const { data: existing } = await supabaseAdmin
          .from("payment_transactions")
          .select("id")
          .eq("station_id", stationId)
          .eq("idempotency_key", idempotencyKey || reference)
          .maybeSingle();

        if (!existing) {
          const { error: insertError } = await supabaseAdmin
            .from("payment_transactions")
            .insert({
              station_id: stationId,
              ledger_sale_id: body.saleId || null,
              shift_id: body.shiftId || null,
              provider: "payhero",
              provider_reference: reference,
              checkout_request_id: String(
                result.checkout_request_id || reference,
              ),
              payment_method: "payhero",
              amount,
              currency: "KES",
              status: "pending",
              customer_phone: String(body.phoneNumber || ""),
              idempotency_key: idempotencyKey || reference,
              metadata: {
                external_reference: reference,
                account_reference: body.accountReference || null,
                requested_by: userId,
              },
            });

          if (insertError) {
            out.status(409).json({
              success: false,
              error: `PayHero request succeeded but payment ledger recording failed: ${insertError.message}`,
              provider: result,
            });
            return;
          }
        }
      }
    }

    out.status(result.success ? 200 : 502).json(result);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    out.status(Number(err.status) || 500).json({
      success: false,
      error: err.message || "Integration request failed",
    });
  }
}
