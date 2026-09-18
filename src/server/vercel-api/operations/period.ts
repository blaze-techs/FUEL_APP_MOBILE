import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw new Error("Server unavailable");
    const ctx=await authenticate(request);
    const body:any=await request.json();
    const action=new URL(request.url).searchParams.get("action")||"lock";
    const stationId=String(body.stationId||"");
    await requirePermission(ctx,stationId,"period.lock");

    if(action==="lock"){
      const start=String(body.periodStart||"");
      const end=String(body.periodEnd||"");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw Object.assign(new Error("periodStart and periodEnd are required"),{status:400});
      const [openShifts,pendingPayments,syncProblems]=await Promise.all([
        supabaseAdmin.from("operational_shifts").select("id",{count:"exact",head:true}).eq("station_id",stationId).in("status",["open","pending_approval","reopened"]).gte("shift_date",start).lte("shift_date",end),
        supabaseAdmin.from("payment_transactions").select("id",{count:"exact",head:true}).eq("station_id",stationId).eq("status","pending").gte("created_at",start).lte("created_at",`${end}T23:59:59.999Z`),
        supabaseAdmin.from("sync_outbox").select("id",{count:"exact",head:true}).eq("station_id",stationId).in("status",["pending","failed","conflict"]).gte("created_at",start).lte("created_at",`${end}T23:59:59.999Z`)
      ]);
      if((openShifts.count||0)>0) throw Object.assign(new Error("Cannot lock period with open or unapproved shifts"),{status:409});
      if((pendingPayments.count||0)>0) throw Object.assign(new Error("Cannot lock period with pending payments"),{status:409});
      if((syncProblems.count||0)>0) throw Object.assign(new Error("Cannot lock period with unresolved sync items"),{status:409});
      const {data,error}=await supabaseAdmin.from("accounting_period_locks").insert({
        station_id:stationId,period_start:start,period_end:end,reason:body.reason||"Month-end close",locked_by:ctx.userId
      }).select("*").single();
      if(error) throw new Error(error.message);
      await supabaseAdmin.from("immutable_audit_log").insert({station_id:stationId,user_id:ctx.userId,action:"period.lock",entity_type:"accounting_period",entity_id:data.id,new_values:data});
      return json({success:true,data});
    }

    if(action==="unlock"){
      const lockId=String(body.lockId||"");
      const {data:lock}=await supabaseAdmin.from("accounting_period_locks").select("*").eq("id",lockId).eq("station_id",stationId).maybeSingle();
      if(!lock) throw Object.assign(new Error("Period lock not found"),{status:404});
      await supabaseAdmin.from("immutable_audit_log").insert({station_id:stationId,user_id:ctx.userId,action:"period.unlock",entity_type:"accounting_period",entity_id:lockId,old_values:lock,new_values:{reason:body.reason||"Authorized reopen"}});
      const {error}=await supabaseAdmin.from("accounting_period_locks").delete().eq("id",lockId);
      if(error) throw new Error(error.message);
      return json({success:true});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
