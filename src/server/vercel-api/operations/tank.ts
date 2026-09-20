import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const action =
      new URL(request.url).searchParams.get("action") || "movement";
    const stationId = String(body.stationId || "");
    await requirePermission(ctx, stationId, "inventory.write");

    if (action === "tank") {
      const capacity = Number(body.capacityLitres);
      if (!Number.isFinite(capacity) || capacity <= 0)
        throw Object.assign(new Error("Tank capacity must be positive"), {
          status: 400,
        });
      const { data, error } = await supabaseAdmin
        .from("fuel_tanks")
        .upsert(
          {
            id: body.tankId || undefined,
            station_id: stationId,
            fuel_type_id: body.fuelTypeId,
            tank_code: String(body.tankCode),
            name: body.name || null,
            capacity_litres: capacity,
            safe_fill_litres:
              body.safeFillLitres == null ? null : Number(body.safeFillLitres),
            is_active: body.isActive !== false,
          },
          body.tankId
            ? { onConflict: "id" }
            : { onConflict: "station_id,tank_code" },
        )
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "movement") {
      const { data, error } = await supabaseAdmin.rpc(
        "fuelpro_post_tank_movement",
        {
          p_station: stationId,
          p_tank: body.tankId,
          p_fuel: body.fuelTypeId,
          p_type: body.movementType,
          p_quantity: Number(body.quantityLitres),
          p_counterparty: body.counterpartyTankId || null,
          p_unit_cost: body.unitCost == null ? null : Number(body.unitCost),
          p_reference_type: body.referenceType || null,
          p_reference_id: body.referenceId || null,
          p_notes: body.notes || null,
          p_idempotency_key: body.idempotencyKey || crypto.randomUUID(),
        },
      );
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
      return json({ success: true, data });
    }
    return json({ success: false, error: "Unknown action" }, 400);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const url = new URL(request.url);
    const stationId = String(url.searchParams.get("stationId") || "");
    await requirePermission(ctx, stationId, "station.read");
    const [tanks, movements] = await Promise.all([
      supabaseAdmin
        .from("canonical_tank_balances")
        .select("*")
        .eq("station_id", stationId),
      supabaseAdmin
        .from("tank_movements")
        .select("*")
        .eq("station_id", stationId)
        .order("created_at", { ascending: false })
        .limit(250),
    ]);
    if (tanks.error) throw new Error(tanks.error.message);
    if (movements.error) throw new Error(movements.error.message);
    return json({
      success: true,
      tanks: tanks.data || [],
      movements: movements.data || [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
