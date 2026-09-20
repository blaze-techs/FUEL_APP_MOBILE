import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const url = new URL(request.url);
    const stationId = String(url.searchParams.get("stationId") || "");
    await requirePermission(ctx, stationId, "report.read");
    const { data, error } = await supabaseAdmin
      .from("anomaly_events")
      .select("*")
      .eq("station_id", stationId)
      .order("detected_at", { ascending: false })
      .limit(250);
    if (error) throw new Error(error.message);
    return json({ success: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const stationId = String(body.stationId || "");
    await requirePermission(ctx, stationId, "audit.read");
    const status = String(body.status || "acknowledged");
    if (!["acknowledged", "resolved", "false_positive"].includes(status))
      throw Object.assign(new Error("Invalid status"), { status: 400 });
    const patch: any = { status };
    if (status === "resolved" || status === "false_positive") {
      patch.resolved_by = ctx.userId;
      patch.resolved_at = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin
      .from("anomaly_events")
      .update(patch)
      .eq("id", body.anomalyId)
      .eq("station_id", stationId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return json({ success: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
