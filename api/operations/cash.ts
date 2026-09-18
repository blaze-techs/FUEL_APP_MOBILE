import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const action=new URL(request.url).searchParams.get("action")||"";
    const body:any=await request.json();
    const stationId=String(body.stationId||"");
    if(action==="open"){
      await requirePermission(ctx,stationId,"drawer.open");
      const opening=Number(body.openingCash||0);
      if(!Number.isFinite(opening)||opening<0) throw Object.assign(new Error("Invalid opening cash"),{status:400});
      const {data,error}=await supabaseAdmin.from("cash_drawers").insert({
        station_id:stationId,shift_id:body.shiftId||null,opened_by:ctx.userId,opening_cash:opening,status:"open"
      }).select("*").single();
      if(error) throw new Error(error.message);
      return json({success:true,data});
    }
    if(action==="event"){
      await requirePermission(ctx,stationId,"drawer.open");
      const amount=Number(body.amount);
      if(!Number.isFinite(amount)||amount===0) throw Object.assign(new Error("amount must be non-zero"),{status:400});
      const {data,error}=await supabaseAdmin.from("cash_drawer_events").insert({
        drawer_id:body.drawerId,station_id:stationId,event_type:body.eventType,amount,
        reference_type:body.referenceType||null,reference_id:body.referenceId||null,note:body.note||null,created_by:ctx.userId
      }).select("*").single();
      if(error) throw new Error(error.message);
      return json({success:true,data});
    }
    if(action==="close"){
      await requirePermission(ctx,stationId,"drawer.close");
      const {data:drawer,error:lookupError}=await supabaseAdmin.from("cash_drawers").select("*").eq("id",body.drawerId).eq("station_id",stationId).maybeSingle();
      if(lookupError) throw new Error(lookupError.message);
      if(!drawer||drawer.status!=="open") throw Object.assign(new Error("Open drawer not found"),{status:404});
      const {data:events,error:eventError}=await supabaseAdmin.from("cash_drawer_events").select("amount,event_type").eq("drawer_id",drawer.id);
      if(eventError) throw new Error(eventError.message);
      const movement=(events||[]).reduce((sum:number,e:any)=>sum+Number(e.amount||0),0);
      const expected=Number(drawer.opening_cash)+movement;
      const counted=Number(body.countedCash);
      if(!Number.isFinite(counted)||counted<0) throw Object.assign(new Error("Invalid counted cash"),{status:400});
      const variance=Number((counted-expected).toFixed(2));
      const {data,error}=await supabaseAdmin.from("cash_drawers").update({
        status:"closed",closed_by:ctx.userId,closed_at:new Date().toISOString(),
        expected_cash:expected,counted_cash:counted,variance_amount:variance,close_notes:body.notes||null
      }).eq("id",drawer.id).select("*").single();
      if(error) throw new Error(error.message);
      if(Math.abs(variance)>100){
        await supabaseAdmin.from("anomaly_events").insert({
          station_id:stationId,anomaly_type:"large_variance",severity:Math.abs(variance)>5000?"critical":"high",
          entity_type:"cash_drawer",entity_id:drawer.id,details:{expected,counted,variance}
        });
      }
      return json({success:true,data});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
