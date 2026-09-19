import { authenticate, errorResponse, json, requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { normalizePayHeroStatus, payHeroTransactionStatus } from "../_lib/payhero.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const checkout = String(body.checkoutRequestId || "");
    if (!checkout) throw Object.assign(new Error("checkoutRequestId required"), { status: 400 });

    const { data: tx, error } = await supabaseAdmin.from("payment_transactions")
      .select("*").eq("checkout_request_id", checkout).eq("provider", "payhero").maybeSingle();
    if (error) throw new Error(error.message);
    if (!tx) throw Object.assign(new Error("PayHero transaction not found"), { status: 404 });
    await requirePermission(ctx, tx.station_id, "payment.create");

    if (tx.status !== "pending") return json({ success: true, localTransaction: tx });

    let remote: any = null;
    try {
      remote = await payHeroTransactionStatus(String(tx.provider_reference || checkout));
      const next = normalizePayHeroStatus(remote);
      if (next !== "pending") {
        await supabaseAdmin.from("payment_transactions").update({
          status: next,
          confirmed_at: next === "confirmed" ? new Date().toISOString() : null,
          metadata: { ...(tx.metadata || {}), status_response: remote },
        }).eq("id", tx.id);
      }
    } catch {
      // Callback remains authoritative; return the current local state.
    }

    const { data: latest } = await supabaseAdmin.from("payment_transactions").select("*").eq("id", tx.id).maybeSingle();
    return json({ success: true, localTransaction: latest || tx, remote });
  } catch (e) {
    return errorResponse(e);
  }
}
