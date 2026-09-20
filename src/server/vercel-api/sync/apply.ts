import { authenticate, errorResponse, json } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    await authenticate(request);
    const b: any = await request.json(),
      stationId = String(b.stationId || "");
    if (!stationId || !b.entityType || !b.entityId)
      throw Object.assign(
        new Error("stationId, entityType and entityId are required"),
        { status: 400 },
      );
    const { data, error } = await supabaseAdmin.rpc("fuelpro_sync_apply", {
      p_station: stationId,
      p_entity_type: String(b.entityType),
      p_entity_id: String(b.entityId),
      p_base_version: b.baseVersion == null ? null : Number(b.baseVersion),
      p_payload: b.payload || {},
    });
    if (error) throw Object.assign(new Error(error.message), { status: 409 });
    return json({ success: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
