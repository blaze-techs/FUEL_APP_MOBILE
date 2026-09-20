import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { submitEtimsDocument } from "../_lib/etims.js";
function authorized(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  return !!secret && req.headers.get("authorization") === "Bearer " + secret;
}
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request))
    return new Response("Unauthorized", { status: 401 });
  if (!supabaseAdmin)
    return new Response("Server unavailable", { status: 503 });
  const now = new Date().toISOString();
  const { data: docs, error } = await supabaseAdmin
    .from("etims_documents")
    .select("*")
    .in("status", ["pending", "retry"])
    .or("next_retry_at.is.null,next_retry_at.lte." + now)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error)
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  let accepted = 0,
    retried = 0;
  for (const doc of docs || []) {
    const result = await submitEtimsDocument(doc.request_payload);
    const ok =
      result.ok &&
      !["ERROR", "FAILED", "REJECTED"].includes(
        String(result.body?.status || "").toUpperCase(),
      );
    const retryCount = Number(doc.retry_count || 0) + 1;
    if (ok) {
      accepted++;
      await supabaseAdmin
        .from("etims_documents")
        .update({
          status: "accepted",
          kra_reference:
            result.body?.receiptNo ||
            result.body?.invoiceNo ||
            result.body?.data?.receiptNo ||
            null,
          response_payload: result.body,
          submitted_at: now,
          accepted_at: now,
          last_error: null,
        })
        .eq("id", doc.id);
    } else {
      retried++;
      const backoff = Math.min(
        86400,
        60 * Math.pow(2, Math.min(retryCount, 10)),
      );
      await supabaseAdmin
        .from("etims_documents")
        .update({
          status: retryCount >= 10 ? "rejected" : "retry",
          retry_count: retryCount,
          next_retry_at: new Date(Date.now() + backoff * 1000).toISOString(),
          response_payload: result.body,
          last_error: result.body?.message || "HTTP " + result.status,
        })
        .eq("id", doc.id);
    }
  }
  return Response.json({
    success: true,
    processed: (docs || []).length,
    accepted,
    retried,
  });
}
