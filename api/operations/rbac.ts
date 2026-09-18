import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
const roles=new Set(["owner","manager","supervisor","cashier","attendant","accountant","auditor"]);

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const body:any=await request.json();
    const stationId=String(body.stationId||"");
    await requirePermission(ctx,stationId,"station.write");
    const role=String(body.role||"").toLowerCase();
    if(!roles.has(role)) throw Object.assign(new Error("Invalid station role"),{status:400});
    const {data,error}=await supabaseAdmin.from("station_role_assignments").upsert({
      station_id:stationId,user_id:body.userId,role,is_active:body.isActive!==false,granted_by:ctx.userId,granted_at:new Date().toISOString()
    },{onConflict:"station_id,user_id"}).select("*").single();
    if(error) throw new Error(error.message);
    await supabaseAdmin.from("immutable_audit_log").insert({
      station_id:stationId,user_id:ctx.userId,action:"rbac.assign",entity_type:"station_role_assignment",
      entity_id:String(body.userId),new_values:{role,is_active:body.isActive!==false}
    });
    return json({success:true,data});
  }catch(e){return errorResponse(e);}
}
