import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const url = new URL(request.url);
    const stationId = String(url.searchParams.get("stationId") || "");
    await requirePermission(ctx, stationId, "report.read");
    const [sales, payments, drawers, shifts, anomalies, sync] =
      await Promise.all([
        supabaseAdmin
          .from("canonical_station_daily_summary")
          .select("*")
          .eq("station_id", stationId)
          .order("business_date", { ascending: false })
          .limit(31),
        supabaseAdmin
          .from("payment_transactions")
          .select(
            "id,amount,status,payment_method,provider_reference,created_at",
          )
          .eq("station_id", stationId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabaseAdmin
          .from("cash_drawers")
          .select("*")
          .eq("station_id", stationId)
          .order("opened_at", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from("operational_shifts")
          .select("*,operational_shift_meters(*)")
          .eq("station_id", stationId)
          .order("shift_date", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from("anomaly_events")
          .select("*")
          .eq("station_id", stationId)
          .eq("status", "open")
          .order("detected_at", { ascending: false })
          .limit(100),
        supabaseAdmin
          .from("sync_outbox")
          .select("status", { count: "exact" })
          .eq("station_id", stationId)
          .in("status", ["pending", "failed", "conflict"]),
      ]);
    for (const q of [sales, payments, drawers, shifts, anomalies, sync])
      if (q.error) throw new Error(q.error.message);
    return json({
      success: true,
      data: {
        daily: sales.data,
        payments: payments.data,
        drawers: drawers.data,
        shifts: shifts.data,
        anomalies: anomalies.data,
        syncExceptions: sync.count || 0,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
