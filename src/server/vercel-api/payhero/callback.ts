import { json } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) return json({ success: false, error: "Server unavailable" }, 500);
    const payload: any = await request.json();
    const data = payload?.data || payload?.payment || payload;
    const reference = String(
      data?.external_reference || data?.externalReference || data?.request_id ||
      data?.reference || data?.merchant_reference || data?.CheckoutRequestID || data?.checkout_request_id || ""
    );
    const checkout = String(data?.CheckoutRequestID || data?.checkout_request_id || data?.request_id || "");
    if (!reference && !checkout) return json({ success: false, error: "Missing PayHero transaction reference" }, 400);

    let query = supabaseAdmin.from("payment_transactions").select("*").eq("provider", "payhero");
    const { data: tx } = reference
      ? await query.eq("idempotency_key", reference).maybeSingle()
      : await query.eq("checkout_request_id", checkout).maybeSingle();

    if (!tx) return json({ success: true, accepted: true });

    const value = String(data?.status || data?.transaction_status || payload?.status || "").toLowerCase();
    const paid = ["success", "successful", "completed", "complete", "paid", "confirmed"].includes(value);
    const failed = ["failed", "failure", "cancelled", "canceled", "reversed", "declined"].includes(value);
    const status = paid ? "confirmed" : failed ? "failed" : "pending";

    await supabaseAdmin.from("payment_transactions").update({
      status,
      result_description: String(data?.message || data?.status || payload?.message || ""),
      confirmed_at: paid ? new Date().toISOString() : null,
      callback_payload: payload,
      metadata: { ...(tx.metadata || {}), callback: payload },
    }).eq("id", tx.id);

    return json({ success: true, accepted: true });
  } catch {
    return json({ success: false, error: "Callback processing failed" }, 500);
  }
}
