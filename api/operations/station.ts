import { authenticate,errorResponse,json } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const action=new URL(request.url).searchParams.get("action")||"create";
    const body:any=await request.json();

    if(action==="create"){
      const {data,error}=await supabaseAdmin.from("stations").insert({
        name:String(body.name||"FuelPro Station"),
        location:body.location||null,
        country:body.country||"Kenya",
        currency:body.currency||"KES",
        currency_symbol:body.currencySymbol||"KSh",
        timezone:body.timezone||"Africa/Nairobi",
        owner_id:ctx.userId,
        is_active:true
      }).select("*").single();
      if(error) throw new Error(error.message);
      await supabaseAdmin.from("immutable_audit_log").insert({
        station_id:data.id,user_id:ctx.userId,action:"station.create",entity_type:"station",entity_id:data.id,new_values:data
      }).catch(()=>{});
      return json({success:true,data});
    }

    if(action==="archive"){
      const stationId=String(body.stationId||"");
      const {data:station}=await supabaseAdmin.from("stations").select("owner_id").eq("id",stationId).maybeSingle();
      if(!station || station.owner_id!==ctx.userId) throw Object.assign(new Error("Owner access required"),{status:403});
      const {error}=await supabaseAdmin.from("stations").update({is_active:false}).eq("id",stationId);
      if(error) throw new Error(error.message);
      return json({success:true});
    }

    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
