import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const action=new URL(request.url).searchParams.get("action")||"";
    const body:any=await request.json();
    const stationId=String(body.stationId||"");
    await requirePermission(ctx,stationId,"station.write");
    if(action==="map"){
      const {data,error}=await supabaseAdmin.from("pump_nozzles").upsert({
        id:body.nozzleId||undefined,station_id:stationId,pump_id:body.pumpId,fuel_type_id:body.fuelTypeId,
        nozzle_code:String(body.nozzleCode),display_name:body.displayName||null,is_active:body.isActive!==false
      },body.nozzleId?{onConflict:"id"}:{onConflict:"station_id,pump_id,nozzle_code"}).select("*").single();
      if(error) throw new Error(error.message);
      return json({success:true,data});
    }
    if(action==="price"){
      const price=Number(body.pricePerLiter);
      if(!Number.isFinite(price)||price<0) throw Object.assign(new Error("Invalid price"),{status:400});
      const now=body.validFrom||new Date().toISOString();
      await supabaseAdmin.from("nozzle_price_history").update({valid_to:now}).eq("nozzle_id",body.nozzleId).is("valid_to",null);
      const {data,error}=await supabaseAdmin.from("nozzle_price_history").insert({
        station_id:stationId,nozzle_id:body.nozzleId,price_per_liter:price,currency:body.currency||"KES",
        valid_from:now,source:body.source||"manual",approved_by:ctx.userId
      }).select("*").single();
      if(error) throw new Error(error.message);
      return json({success:true,data});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
