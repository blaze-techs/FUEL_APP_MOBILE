import { json } from "../_lib/authz.js";
import { auditServer } from "../_lib/mpesa.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      return json({ success: false, error: "Server unavailable" }, 500);

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ success: false, error: "Invalid callback payload" }, 400);
    }

    const body = payload as Record<string, unknown>;
    const nested = (body.data || body.payment || {}) as Record<string, unknown>;
    const reference = String(
      body.reference ??
        body.merchant_reference ??
        body.external_reference ??
        body.checkout_request_id ??
        body.CheckoutRequestID ??
        nested.reference ??
        nested.merchant_reference ??
        nested.external_reference ??
        "",
    ).trim();

    if (!reference) {
      return json(
        { success: false, error: "Missing PayHero transaction reference" },
        400,
      );
    }

    const status = String(
      body.status ??
        body.transaction_status ??
        nested.status ??
        nested.transaction_status ??
        "PENDING",
    ).toUpperCase();

    // The callback is unauthenticated. Store it for observability only; do not
    // settle the canonical payment ledger from an unverified webhook payload.
    // Live Transaction reconciles through the authenticated PayHero status API.
    const { data: tx, error: lookupError } = await supabaseAdmin
      .from("payment_transactions")
      .select("id, station_id, metadata")
      .eq("provider", "payhero")
      .or(
        [
          `provider_reference.eq.${reference}`,
          `metadata->>external_reference.eq.${reference}`,
          `idempotency_key.eq.${reference}`,
        ].join(","),
      )
      .limit(1)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);

    if (!tx) {
      await auditServer(
        null,
        "payhero.callback.orphan",
        "payment_transaction",
        reference,
        payload,
      );
      return json({ success: true, accepted: true, orphan: true });
    }

    const { error: updateError } = await supabaseAdmin
      .from("payment_transactions")
      .update({
        callback_payload: payload,
        metadata: {
          ...(tx.metadata || {}),
          payhero_callback_status: status,
          payhero_callback_received_at: new Date().toISOString(),
        },
      })
      .eq("id", tx.id);

    if (updateError) throw new Error(updateError.message);

    await auditServer(
      tx.station_id,
      "payhero.callback.received",
      "payment_transaction",
      tx.id,
      {
        reference,
        status,
      },
    );
    return json({ success: true, accepted: true });
  } catch (error) {
    return json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Callback processing failed",
      },
      500,
    );
  }
}

export async function GET(): Promise<Response> {
  return json({ success: true, service: "fuelpro-payhero-callback" });
}
