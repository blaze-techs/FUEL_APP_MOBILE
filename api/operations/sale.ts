import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const url=new URL(request.url);
    const action=url.searchParams.get("action")||"";
    const body:any=await request.json();

    if(action==="post"){
      await requirePermission(ctx,String(body.stationId),"sale.create");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_post_sale",{
        p_station:body.stationId,p_shift:body.shiftId||null,p_nozzle:body.nozzleId||null,
        p_litres:Number(body.litres),p_unit_price:Number(body.unitPrice),p_tax:Number(body.taxAmount||0),
        p_payment_status:body.paymentStatus||"unpaid",p_customer:body.customerId||null,p_vehicle:body.vehicleRef||null,
        p_receipt:body.receiptNumber||null,p_external_ref:body.externalReference||null,
        p_idempotency_key:body.idempotencyKey||crypto.randomUUID(),p_metadata:body.metadata||{}
      });
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    if(action==="reverse"){
      const { data:sale }=await supabaseAdmin.from("sales_ledger").select("station_id").eq("id",body.saleId).maybeSingle();
      if(!sale) throw Object.assign(new Error("Sale not found"),{status:404});
      await requirePermission(ctx,sale.station_id,"sale.reverse");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_reverse_sale",{p_sale:body.saleId,p_reason:body.reason||"Reversal",p_idempotency_key:body.idempotencyKey||crypto.randomUUID()});
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json({success:true,data});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
