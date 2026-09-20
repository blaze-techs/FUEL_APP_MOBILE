import { createHash } from "node:crypto";
import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
const allowed = new Set([
  "credit_accounts_ledger",
  "cash_drawers",
  "purchase_order_ledger",
  "pump_nozzles",
]);

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) throw new Error("Server unavailable");
    const ctx = await authenticate(request);
    const body: any = await request.json();
    const stationId = String(body.stationId || "");
    await requirePermission(ctx, stationId, "station.write");
    const entityType = String(body.entityType || "");
    const entityId = String(body.entityId || "");
    if (!allowed.has(entityType))
      throw Object.assign(new Error("Entity is not sync-enabled"), {
        status: 400,
      });
    const clientVersion = Number(body.baseVersion || 0);
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());

    const { data: existingOutbox } = await supabaseAdmin
      .from("sync_outbox")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingOutbox)
      return json({ success: true, duplicate: true, outbox: existingOutbox });

    const { data: versionRow } = await supabaseAdmin
      .from("sync_entity_versions")
      .select("*")
      .eq("station_id", stationId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .maybeSingle();
    const serverVersion = Number(versionRow?.version || 0);
    const { data: serverRow } = await supabaseAdmin
      .from(entityType)
      .select("*")
      .eq("id", entityId)
      .maybeSingle();

    const { data: outbox, error: oerr } = await supabaseAdmin
      .from("sync_outbox")
      .insert({
        station_id: stationId,
        device_id: String(body.deviceId || "unknown"),
        idempotency_key: idempotencyKey,
        entity_type: entityType,
        entity_id: /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null,
        operation: body.operation || "update",
        payload: body.payload || {},
        status: "processing",
        base_version: clientVersion,
      })
      .select("*")
      .single();
    if (oerr) throw new Error(oerr.message);

    if (clientVersion !== serverVersion && serverVersion !== 0) {
      const { data: conflict, error: cerr } = await supabaseAdmin
        .from("sync_conflicts")
        .insert({
          station_id: stationId,
          outbox_id: outbox.id,
          entity_type: entityType,
          entity_id: entityId,
          client_version: clientVersion,
          server_version: serverVersion,
          client_payload: body.payload || {},
          server_payload: serverRow || {},
        })
        .select("*")
        .single();
      if (cerr) throw new Error(cerr.message);
      await supabaseAdmin
        .from("sync_outbox")
        .update({
          status: "conflict",
          conflict_id: conflict.id,
          last_error: "Version conflict",
        })
        .eq("id", outbox.id);
      return json(
        {
          success: false,
          conflict: true,
          conflictId: conflict.id,
          serverVersion,
          server: serverRow,
        },
        409,
      );
    }

    let mutation: any;
    if (body.operation === "create")
      mutation = await supabaseAdmin
        .from(entityType)
        .insert({ ...body.payload, id: entityId, station_id: stationId })
        .select("*")
        .single();
    else if (body.operation === "update")
      mutation = await supabaseAdmin
        .from(entityType)
        .update(body.payload || {})
        .eq("id", entityId)
        .eq("station_id", stationId)
        .select("*")
        .single();
    else
      throw Object.assign(
        new Error("Only create/update are supported for mutable sync entities"),
        { status: 400 },
      );
    if (mutation.error) throw new Error(mutation.error.message);

    const next = serverVersion + 1;
    await supabaseAdmin.from("sync_entity_versions").upsert(
      {
        station_id: stationId,
        entity_type: entityType,
        entity_id: entityId,
        version: next,
        payload_hash: hash(mutation.data),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "station_id,entity_type,entity_id" },
    );
    await supabaseAdmin
      .from("sync_outbox")
      .update({
        status: "synced",
        resulting_version: next,
        processed_at: new Date().toISOString(),
      })
      .eq("id", outbox.id);
    return json({ success: true, data: mutation.data, version: next });
  } catch (e) {
    return errorResponse(e);
  }
}
