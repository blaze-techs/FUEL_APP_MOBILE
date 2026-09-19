import { json } from "../_lib/authz.js";
import { auditServer } from "../_lib/mpesa.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) return json({ success: false, error: "Server unavailable" }, 500);

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
      return json({ success: false, error: "Missing PayHero transaction reference" }, 400);
    }

    const status = String(
      body.status ?? body.transaction_status ?? nested.status ?? nested.transaction_status ?? "",
    ).toUpperCase();

    const amountRaw = body.amount ?? nested.amount;
    const amount = amountRaw == null ? null : Number(amountRaw);
    const successful = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID", "SETTLED"].includes(status);
    const failed = ["FAILED", "FAILURE", "CANCELLED", "CANCELED", "REJECTED", "EXPIRED"].includes(status);

    const { data: tx, error: lookupError } = await supabaseAdmin
      .from("payment_transactions")
      .select("*")
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
      await auditServer(null, "payhero.callback.orphan", "payment_transaction", reference, payload);
      return json({ success: true, accepted: true, orphan: true });
    }

    if (successful && (!Number.isFinite(amount) || Math.abs(Number(tx.amount) - Number(amount)) > 0.01)) {
      await supabaseAdmin.from("anomaly_events").insert({
        station_id: tx.station_id,
        anomaly_type: "payment_mismatch",
        severity: "critical",
        entity_type: "payment_transaction",
        entity_id: tx.id,
        details: { provider: "payhero", expected_amount: tx.amount, callback_amount: amount, reference },
      });
      return json({ success: true, accepted: true, mismatch: true });
    }

    if (!successful && !failed) {
      await supabaseAdmin.from("payment_transactions").update({
        callback_payload: payload,
        result_description: status || "PENDING",
        metadata: { ...(tx.metadata || {}), payhero_status: status || "PENDING" },
      }).eq("id", tx.id);
      return json({ success: true, accepted: true, pending: true });
    }

    const receipt = String(
      body.receipt_number ?? body.mpesa_receipt ?? body.receipt ?? nested.receipt_number ?? nested.mpesa_receipt ?? nested.receipt ?? "",
    ).trim() || null;

    const { error: updateError } = await supabaseAdmin
      .from("payment_transactions")
      .update({
        status: successful ? "confirmed" : "failed",
        result_code: String(body.response_code ?? body.result_code ?? status),
        result_description: String(body.message ?? body.result_description ?? status),
        callback_payload: payload,
        confirmed_at: successful ? new Date().toISOString() : null,
        metadata: {
          ...(tx.metadata || {}),
          payhero_status: status,
          ...(amount == null ? {} : { callback_amount: amount }),
          ...(receipt ? { payhero_receipt: receipt } : {}),
        },
      })
      .eq("id", tx.id);

    if (updateError) throw new Error(updateError.message);

    await auditServer(tx.station_id, "payhero.callback", "payment_transaction", tx.id, {
      reference, status, amount, receipt,
    });

    return json({ success: true, accepted: true });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Callback processing failed" }, 500);
  }
}

export async function GET(): Promise<Response> {
  return json({ success: true, service: "fuelpro-payhero-callback" });
}
