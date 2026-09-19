import { authenticate, errorResponse, json, requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { payHeroCollection } from "../_lib/payhero.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const stationId = String(body.stationId || "");
    if (!stationId) throw Object.assign(new Error("stationId required"), { status: 400 });
    await requirePermission(ctx, stationId, "payment.create");

    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1) throw Object.assign(new Error("amount must be at least KES 1"), { status: 400 });
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
    const { data: existing } = await supabaseAdmin.from("payment_transactions")
      .select("*").eq("station_id", stationId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return json({ success: true, duplicate: true, transactionId: existing.id, checkoutRequestId: existing.checkout_request_id });

    const result: any = await payHeroCollection({
      amount,
      phoneNumber: String(body.phoneNumber || ""),
      externalReference: idempotencyKey,
    });
    const checkout = String(result.CheckoutRequestID || result.checkout_request_id || result.reference || "");
    const providerReference = String(result.reference || result.merchant_reference || checkout);
    if (!checkout) throw Object.assign(new Error("PayHero returned no transaction reference"), { status: 502 });

    const { data: tx, error } = await supabaseAdmin.from("payment_transactions").insert({
      station_id: stationId,
      ledger_sale_id: body.saleId || null,
      shift_id: body.shiftId || null,
      provider: "payhero",
      provider_reference: providerReference,
      checkout_request_id: checkout,
      payment_method: "mpesa",
      amount,
      currency: "KES",
      status: "pending",
      customer_phone: String(body.phoneNumber || ""),
      idempotency_key: idempotencyKey,
      metadata: { requested_by: ctx.userId, external_reference: idempotencyKey, payhero: result },
    }).select("*").single();
    if (error) throw Object.assign(new Error(error.message), { status: 409 });

    return json({ success: true, transactionId: tx.id, checkoutRequestId: checkout, providerReference, status: result.status || "QUEUED" });
  } catch (e) {
    return errorResponse(e);
  }
}
