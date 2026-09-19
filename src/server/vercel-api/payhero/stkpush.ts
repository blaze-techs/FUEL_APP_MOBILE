import { authenticate, errorResponse, json, requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`PayHero is not configured: ${name}`), { status: 503 });
  return value;
}

function normalizePhone(value: unknown): string {
  const raw = String(value ?? "").replace(/[\s-]/g, "");
  if (/^07\d{8}$/.test(raw) || /^01\d{8}$/.test(raw)) return "254" + raw.slice(1);
  if (/^254[17]\d{8}$/.test(raw)) return raw;
  if (/^\+254[17]\d{8}$/.test(raw)) return raw.slice(1);
  throw Object.assign(new Error("A valid Kenyan M-PESA phone number is required"), { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw Object.assign(new Error("Server unavailable"), { status: 500 });

    const ctx = await authenticate(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const stationId = String(body.stationId || "");
    if (!stationId) throw Object.assign(new Error("stationId required"), { status: 400 });
    await requirePermission(ctx, stationId, "payment.create");

    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1) {
      throw Object.assign(new Error("amount must be at least KES 1"), { status: 400 });
    }

    const phone = normalizePhone(body.phoneNumber);
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
    const externalReference = String(body.externalReference || `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`).slice(0, 50);
    const channelId = env("PAYHERO_CHANNEL_ID");
    const username = env("PAYHERO_API_USERNAME");
    const password = env("PAYHERO_API_PASSWORD");
    const baseUrl = (process.env.PAYHERO_BASE_URL || "https://backend.payhero.co.ke/api/v2").replace(/\/$/, "");
    const provider = process.env.PAYHERO_PROVIDER || "m-pesa";
    const origin = new URL(request.url).origin;
    const callbackUrl = `${origin}/api/payhero/callback`;

    const { data: existing } = await supabaseAdmin
      .from("payment_transactions")
      .select("*")
      .eq("provider", "payhero")
      .eq("metadata->>idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      return json({
        success: true,
        duplicate: true,
        transactionId: existing.id,
        providerReference: existing.provider_reference,
        status: existing.status,
      });
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const response = await fetch(`${baseUrl}/payments/initiate-stk-push`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        phone_number: phone,
        channel_id: channelId,
        provider,
        external_reference: externalReference,
        callback_url: callbackUrl,
      }),
    });

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw Object.assign(
        new Error(String(payload.message || payload.error || "PayHero STK Push failed")),
        { status: 502 },
      );
    }

    const providerReference = String(
      payload.reference ??
      payload.transaction_id ??
      payload.checkout_request_id ??
      payload.CheckoutRequestID ??
      externalReference,
    );

    const { data: tx, error } = await supabaseAdmin
      .from("payment_transactions")
      .insert({
        station_id: stationId,
        ledger_sale_id: body.saleId || null,
        shift_id: body.shiftId || null,
        provider: "payhero",
        provider_reference: providerReference,
        checkout_request_id: providerReference,
        payment_method: "mpesa",
        amount,
        currency: "KES",
        status: "pending",
        customer_phone: phone,
        idempotency_key: idempotencyKey,
        metadata: {
          external_reference: externalReference,
          channel_id: channelId,
          requested_by: ctx.userId,
          callback_url: callbackUrl,
          provider_response: payload,
          idempotency_key: idempotencyKey,
        },
      })
      .select("*")
      .single();

    if (error) throw Object.assign(new Error(error.message), { status: 409 });

    return json({
      success: true,
      transactionId: tx.id,
      providerReference,
      status: tx.status,
      providerResponse: payload,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(): Promise<Response> {
  return json({
    success: true,
    provider: "payhero",
    configured: Boolean(
      process.env.PAYHERO_API_USERNAME &&
      process.env.PAYHERO_API_PASSWORD &&
      process.env.PAYHERO_CHANNEL_ID,
    ),
  });
}
