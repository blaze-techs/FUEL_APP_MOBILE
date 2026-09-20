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
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    const body: any = await request.json();

    if (action === "open") {
      await requirePermission(ctx, String(body.stationId), "shift.open");
      const { data, error } = await supabaseAdmin.rpc("fuelpro_open_shift", {
        p_station: body.stationId,
        p_shift_date: body.shiftDate,
        p_shift_type: body.shiftType,
      });
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
      return json({ success: true, data });
    }
    if (action === "close") {
      const { data: shift } = await supabaseAdmin
        .from("operational_shifts")
        .select("station_id")
        .eq("id", body.shiftId)
        .maybeSingle();
      if (!shift)
        throw Object.assign(new Error("Shift not found"), { status: 404 });
      await requirePermission(ctx, shift.station_id, "shift.close");
      const [
        { data: expectedRows, error: expectedError },
        { data: nozzleSales, error: nozzleSalesError },
        { data: priceSnapshots, error: snapshotError },
      ] = await Promise.all([
        supabaseAdmin
          .from("canonical_shift_payment_totals")
          .select("payment_method,confirmed_amount,pending_count")
          .eq("shift_id", body.shiftId),
        supabaseAdmin
          .from("canonical_shift_nozzle_sales")
          .select("nozzle_id,gross_amount")
          .eq("shift_id", body.shiftId),
        supabaseAdmin
          .from("operational_shift_price_snapshots")
          .select("nozzle_id,price_per_liter")
          .eq("shift_id", body.shiftId),
      ]);
      if (expectedError) throw new Error(expectedError.message);
      if (nozzleSalesError) throw new Error(nozzleSalesError.message);
      if (snapshotError) throw new Error(snapshotError.message);

      const actualByNozzle = new Map(
        (nozzleSales || []).map((row: any) => [
          String(row.nozzle_id),
          Number(row.gross_amount || 0),
        ]),
      );
      const priceByNozzle = new Map(
        (priceSnapshots || []).map((row: any) => [
          String(row.nozzle_id),
          Number(row.price_per_liter || 0),
        ]),
      );
      const meterRows = (Array.isArray(body.meters) ? body.meters : []).map(
        (row: any) => ({
          ...row,
          price_per_liter:
            priceByNozzle.get(String(row.nozzle_id)) ??
            Number(row.price_per_liter || 0),
          actual_sales: actualByNozzle.get(String(row.nozzle_id)) ?? 0,
        }),
      );

      const expectedByMethod = new Map(
        (expectedRows || []).map((row: any) => [
          String(row.payment_method),
          Number(row.confirmed_amount || 0),
        ]),
      );
      const countedRows = Array.isArray(body.payments) ? body.payments : [];
      const methods = new Set<string>([
        ...Array.from(expectedByMethod.keys()),
        ...countedRows.map((row: any) => String(row.payment_method || "")),
      ]);
      const paymentRows = Array.from(methods)
        .filter(Boolean)
        .map((method) => {
          const counted = countedRows.find(
            (row: any) => String(row.payment_method) === method,
          );
          return {
            payment_method: method,
            expected_amount: expectedByMethod.get(method) || 0,
            counted_amount: Number(
              counted?.counted_amount ?? counted?.amount ?? 0,
            ),
            notes: counted?.notes || null,
          };
        });

      const pendingPayments = (expectedRows || []).reduce(
        (sum: number, row: any) => sum + Number(row.pending_count || 0),
        0,
      );
      if (pendingPayments > 0) {
        throw Object.assign(
          new Error(
            `Cannot close shift with ${pendingPayments} pending payment(s)`,
          ),
          { status: 409 },
        );
      }

      const { data, error } = await supabaseAdmin.rpc("fuelpro_close_shift", {
        p_shift: body.shiftId,
        p_meter_rows: meterRows,
        p_payment_rows: paymentRows,
        p_variance_reason: body.varianceReason || null,
      });
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
      return json({ success: true, data });
    }
    if (action === "approve") {
      const { data: shift } = await supabaseAdmin
        .from("operational_shifts")
        .select("station_id")
        .eq("id", body.shiftId)
        .maybeSingle();
      if (!shift)
        throw Object.assign(new Error("Shift not found"), { status: 404 });
      await requirePermission(ctx, shift.station_id, "shift.approve");
      const { data, error } = await supabaseAdmin.rpc(
        "fuelpro_approve_shift_variance",
        { p_shift: body.shiftId, p_reason: body.reason || "Approved" },
      );
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
      return json({ success: true, data });
    }
    if (action === "reopen") {
      const { data: shift } = await supabaseAdmin
        .from("operational_shifts")
        .select("station_id")
        .eq("id", body.shiftId)
        .maybeSingle();
      if (!shift)
        throw Object.assign(new Error("Shift not found"), { status: 404 });
      await requirePermission(ctx, shift.station_id, "shift.approve");
      const { data, error } = await supabaseAdmin.rpc("fuelpro_reopen_shift", {
        p_shift: body.shiftId,
        p_reason: body.reason || "Reopened",
      });
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
      return json({ success: true, data });
    }
    return json({ success: false, error: "Unknown action" }, 400);
  } catch (e) {
    return errorResponse(e);
  }
}
