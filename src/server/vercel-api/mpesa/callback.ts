import { errorResponse, json } from "../_lib/authz.js";
import { callbackMetadata, auditServer } from "../_lib/mpesa.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const payload: any = await request.json();
    const cb = payload?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID)
      throw Object.assign(new Error("Invalid STK callback"), { status: 400 });

    const meta = callbackMetadata(cb.CallbackMetadata?.Item || []);
    const checkout = String(cb.CheckoutRequestID);
    const { data: tx, error: lookupError } = await supabaseAdmin
      .from("payment_transactions")
      .select("*")
      .eq("checkout_request_id", checkout)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!tx) {
      await auditServer(
        null,
        "mpesa.callback.orphan",
        "payment_transaction",
        checkout,
        payload,
      );
      return json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const paid = String(cb.ResultCode) === "0";
    const receipt = meta.MpesaReceiptNumber
      ? String(meta.MpesaReceiptNumber)
      : null;
    const amount = meta.Amount == null ? null : Number(meta.Amount);
    const phone = meta.PhoneNumber == null ? null : String(meta.PhoneNumber);

    if (paid && (!receipt || !Number.isFinite(amount)))
      throw new Error("Successful callback missing receipt or amount");
    if (paid && Math.abs(Number(tx.amount) - Number(amount)) > 0.01) {
      await supabaseAdmin.from("anomaly_events").insert({
        station_id: tx.station_id,
        anomaly_type: "payment_mismatch",
        severity: "critical",
        entity_type: "payment_transaction",
        entity_id: tx.id,
        details: {
          expected_amount: tx.amount,
          callback_amount: amount,
          checkout_request_id: checkout,
        },
      });
    }

    if (receipt) {
      const { data: dup } = await supabaseAdmin
        .from("payment_transactions")
        .select("id")
        .eq("mpesa_receipt", receipt)
        .neq("id", tx.id)
        .maybeSingle();
      if (dup) {
        await supabaseAdmin.from("anomaly_events").insert({
          station_id: tx.station_id,
          anomaly_type: "duplicate_transaction",
          severity: "critical",
          entity_type: "payment_transaction",
          entity_id: tx.id,
          details: { mpesa_receipt: receipt, duplicate_of: dup.id },
        });
        return json({
          ResultCode: 0,
          ResultDesc: "Accepted duplicate for review",
        });
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("payment_transactions")
      .update({
        status: paid ? "confirmed" : "failed",
        result_code: String(cb.ResultCode),
        result_description: String(cb.ResultDesc || ""),
        mpesa_receipt: receipt,
        callback_payload: payload,
        confirmed_at: paid ? new Date().toISOString() : null,
        metadata: {
          ...(tx.metadata || {}),
          callback_amount: amount,
          callback_phone: phone,
        },
      })
      .eq("id", tx.id);
    if (updateError) throw new Error(updateError.message);

    await auditServer(
      tx.station_id,
      "mpesa.callback",
      "payment_transaction",
      tx.id,
      {
        checkout_request_id: checkout,
        result_code: String(cb.ResultCode),
        mpesa_receipt: receipt,
        amount,
      },
    );
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    // Daraja expects a 200 acknowledgement when payload was syntactically valid.
    const response = errorResponse(e);
    return response;
  }
}
