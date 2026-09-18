import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const url=new URL(request.url);
    const action=url.searchParams.get("action")||"";
    const body:any=await request.json();

    if(action==="open"){
      await requirePermission(ctx,String(body.stationId),"shift.open");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_open_shift",{p_station:body.stationId,p_shift_date:body.shiftDate,p_shift_type:body.shiftType});
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    if(action==="close"){
      const { data:shift }=await supabaseAdmin.from("operational_shifts").select("station_id").eq("id",body.shiftId).maybeSingle();
      if(!shift) throw Object.assign(new Error("Shift not found"),{status:404});
      await requirePermission(ctx,shift.station_id,"shift.close");
      const { data: expectedRows, error: expectedError } = await supabaseAdmin
        .from("canonical_shift_payment_totals")
        .select("payment_method,confirmed_amount,pending_count")
        .eq("shift_id", body.shiftId);
      if (expectedError) throw new Error(expectedError.message);

      const expectedByMethod = new Map(
        (expectedRows || []).map((row:any) => [String(row.payment_method), Number(row.confirmed_amount || 0)]),
      );
      const countedRows = Array.isArray(body.payments) ? body.payments : [];
      const methods = new Set<string>([
        ...Array.from(expectedByMethod.keys()),
        ...countedRows.map((row:any) => String(row.payment_method || "")),
      ]);
      const paymentRows = Array.from(methods).filter(Boolean).map((method) => {
        const counted = countedRows.find((row:any) => String(row.payment_method) === method);
        return {
          payment_method: method,
          expected_amount: expectedByMethod.get(method) || 0,
          counted_amount: Number(counted?.counted_amount ?? counted?.amount ?? 0),
          notes: counted?.notes || null,
        };
      });

      const pendingPayments = (expectedRows || []).reduce((sum:number,row:any)=>sum+Number(row.pending_count||0),0);
      if (pendingPayments > 0) {
        throw Object.assign(new Error(`Cannot close shift with ${pendingPayments} pending payment(s)`),{status:409});
      }

      const { data,error }=await supabaseAdmin.rpc("fuelpro_close_shift",{
        p_shift:body.shiftId,p_meter_rows:body.meters||[],p_payment_rows:paymentRows,p_variance_reason:body.varianceReason||null
      });
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    if(action==="approve"){
      const { data:shift }=await supabaseAdmin.from("operational_shifts").select("station_id").eq("id",body.shiftId).maybeSingle();
      if(!shift) throw Object.assign(new Error("Shift not found"),{status:404});
      await requirePermission(ctx,shift.station_id,"shift.approve");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_approve_shift_variance",{p_shift:body.shiftId,p_reason:body.reason||"Approved"});
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    if(action==="reopen"){
      const { data:shift }=await supabaseAdmin.from("operational_shifts").select("station_id").eq("id",body.shiftId).maybeSingle();
      if(!shift) throw Object.assign(new Error("Shift not found"),{status:404});
      await requirePermission(ctx,shift.station_id,"shift.approve");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_reopen_shift",{p_shift:body.shiftId,p_reason:body.reason||"Reopened"});
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
