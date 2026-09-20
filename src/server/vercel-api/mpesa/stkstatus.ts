import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import {
  mpesaBaseUrl,
  mpesaConfig,
  mpesaPassword,
  mpesaTimestamp,
  mpesaToken,
} from "../_lib/mpesa.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const checkout = String(body.checkoutRequestId || "");
    if (!checkout)
      throw Object.assign(new Error("checkoutRequestId required"), {
        status: 400,
      });
    const { data: tx, error } = await supabaseAdmin
      .from("payment_transactions")
      .select("*")
      .eq("checkout_request_id", checkout)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tx)
      throw Object.assign(new Error("Transaction not found"), { status: 404 });
    await requirePermission(ctx, tx.station_id, "payment.create");

    if (tx.status !== "pending") {
      return json({ success: true, localTransaction: tx });
    }

    let remote: any = null;
    try {
      const token = await mpesaToken();
      const c = mpesaConfig();
      const timestamp = mpesaTimestamp();
      const res = await fetch(`${mpesaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: c.shortcode,
          Password: mpesaPassword(timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: checkout,
        }),
      });
      remote = await res.json();
    } catch {
      /* callback remains authoritative */
    }
    return json({ success: true, localTransaction: tx, remote });
  } catch (e) {
    return errorResponse(e);
  }
}
