import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const action = new URL(request.url).searchParams.get("action") || "";
    const body: any = await request.json();
    const stationId = String(body.stationId || "");
    await requirePermission(ctx, stationId, "station.write");
    if (action === "ensure-map") {
      const fuelCode = String(body.fuelCode || "PMS").toUpperCase();
      let { data: fuel } = await supabaseAdmin
        .from("fuel_types")
        .select("*")
        .eq("code", fuelCode)
        .maybeSingle();
      if (!fuel) {
        const created = await supabaseAdmin
          .from("fuel_types")
          .insert({
            name: body.fuelName || fuelCode,
            code: fuelCode,
            is_active: true,
          })
          .select("*")
          .single();
        if (created.error) throw new Error(created.error.message);
        fuel = created.data;
      }
      const pumpNumber = String(body.pumpNumber || "1");
      let { data: pump } = await supabaseAdmin
        .from("pumps")
        .select("*")
        .eq("station_id", stationId)
        .eq("pump_number", pumpNumber)
        .maybeSingle();
      if (!pump) {
        const created = await supabaseAdmin
          .from("pumps")
          .insert({
            station_id: stationId,
            pump_number: pumpNumber,
            name: body.pumpName || `Pump ${pumpNumber}`,
            fuel_type_id: fuel.id,
            price_per_liter: Number(body.pricePerLiter || 0),
            is_active: true,
          })
          .select("*")
          .single();
        if (created.error) throw new Error(created.error.message);
        pump = created.data;
      }
      const { data, error } = await supabaseAdmin
        .from("pump_nozzles")
        .upsert(
          {
            station_id: stationId,
            pump_id: pump.id,
            fuel_type_id: fuel.id,
            tank_id: body.tankId || null,
            nozzle_code: String(body.nozzleCode || `${pumpNumber}-1`),
            display_name: body.displayName || null,
            is_active: true,
          },
          { onConflict: "station_id,pump_id,nozzle_code" },
        )
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({
        success: true,
        data: { fuelType: fuel, pump, nozzle: data },
      });
    }
    if (action === "map") {
      const { data, error } = await supabaseAdmin
        .from("pump_nozzles")
        .upsert(
          {
            id: body.nozzleId || undefined,
            station_id: stationId,
            pump_id: body.pumpId,
            fuel_type_id: body.fuelTypeId,
            tank_id: body.tankId || null,
            nozzle_code: String(body.nozzleCode),
            display_name: body.displayName || null,
            is_active: body.isActive !== false,
          },
          body.nozzleId
            ? { onConflict: "id" }
            : { onConflict: "station_id,pump_id,nozzle_code" },
        )
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }
    if (action === "price") {
      const { count: activeShiftCount, error: activeShiftError } =
        await supabaseAdmin
          .from("operational_shifts")
          .select("id", { count: "exact", head: true })
          .eq("station_id", stationId)
          .in("status", ["open", "pending_approval", "reopened"]);
      if (activeShiftError) throw new Error(activeShiftError.message);
      if ((activeShiftCount || 0) > 0) {
        throw Object.assign(
          new Error(
            "Close or approve the active shift before changing pump prices; shift prices are snapshotted for reconciliation.",
          ),
          { status: 409 },
        );
      }
      const price = Number(body.pricePerLiter);
      if (!Number.isFinite(price) || price < 0)
        throw Object.assign(new Error("Invalid price"), { status: 400 });
      const now = body.validFrom || new Date().toISOString();
      await supabaseAdmin
        .from("nozzle_price_history")
        .update({ valid_to: now })
        .eq("nozzle_id", body.nozzleId)
        .is("valid_to", null);
      const { data, error } = await supabaseAdmin
        .from("nozzle_price_history")
        .insert({
          station_id: stationId,
          nozzle_id: body.nozzleId,
          price_per_liter: price,
          currency: body.currency || "KES",
          valid_from: now,
          source: body.source || "manual",
          approved_by: ctx.userId,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }
    return json({ success: false, error: "Unknown action" }, 400);
  } catch (e) {
    return errorResponse(e);
  }
}
