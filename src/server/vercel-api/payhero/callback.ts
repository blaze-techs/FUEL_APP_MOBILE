import { json } from "../_lib/authz.js";

/**
 * PayHero webhook receiver.
 *
 * PayHero sends the final transaction result to the callback URL supplied
 * when the collection is created. This endpoint intentionally does not
 * require a Supabase bearer token: the provider is the caller.
 *
 * The callback is acknowledged after basic payload validation. The client
 * reconciles the transaction through the authenticated PayHero status endpoint,
 * so an unauthenticated webhook can never mutate a station ledger directly.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ success: false, error: "Invalid callback payload" }, 400);
    }

    const body = payload as Record<string, unknown>;
    const reference =
      body.reference ??
      body.CheckoutRequestID ??
      body.checkout_request_id ??
      body.transaction_id ??
      body.request_id ??
      null;

    if (!reference) {
      return json({ success: false, error: "Missing PayHero transaction reference" }, 400);
    }

    // Acknowledge only. Final settlement is performed by the authenticated
    // status poller, which has station/user authorization and idempotency.
    return json({
      success: true,
      accepted: true,
      reference: String(reference),
    });
  } catch {
    return json({ success: false, error: "Callback processing failed" }, 400);
  }
}

export async function GET(): Promise<Response> {
  return json({ success: true, service: "fuelpro-payhero-callback" });
}
