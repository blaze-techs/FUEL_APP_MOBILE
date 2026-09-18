import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw new Error("Server unavailable");
    const ctx=await authenticate(request);
    const body:any=await request.json();
    const stationId=String(body.stationId||"");
    await requirePermission(ctx,stationId,"payment.create");
    const amount=Number(body.amount);
    if(!Number.isFinite(amount)||amount<=0) throw Object.assign(new Error("Payment amount must be greater than zero"),{status:400});
    const method=String(body.paymentMethod||"cash").toLowerCase();
    if(!["cash","card","bank","credit","voucher","other"].includes(method)) throw Object.assign(new Error("Unsupported payment method"),{status:400});
    const idempotencyKey=String(body.idempotencyKey||crypto.randomUUID());
    const provider=String(body.provider||method);
    const providerReference=String(body.providerReference||`${provider}-${idempotencyKey}`);

    const {data:existing}=await supabaseAdmin.from("payment_transactions")
      .select("*").eq("station_id",stationId).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existing) return json({success:true,duplicate:true,data:existing});

    if(body.saleId){
      const {data:sale,error:saleError}=await supabaseAdmin.from("sales_ledger")
        .select("id,station_id,shift_id,gross_amount").eq("id",body.saleId).maybeSingle();
      if(saleError||!sale) throw Object.assign(new Error(saleError?.message||"Canonical sale not found"),{status:404});
      if(sale.station_id!==stationId) throw Object.assign(new Error("Sale belongs to another station"),{status:409});
      body.shiftId=body.shiftId||sale.shift_id;
    }

    const {data,error}=await supabaseAdmin.from("payment_transactions").insert({
      station_id:stationId,ledger_sale_id:body.saleId||null,shift_id:body.shiftId||null,
      provider,provider_reference:providerReference,payment_method:method,amount,
      currency:body.currency||"KES",status:body.status||"confirmed",
      customer_phone:body.customerPhone||null,idempotency_key:idempotencyKey,
      confirmed_at:(body.status||"confirmed")==="confirmed"?new Date().toISOString():null,
      metadata:body.metadata||{}
    }).select("*").single();
    if(error) throw Object.assign(new Error(error.message),{status:409});

    if(method==="cash" && body.drawerId){
      const {error:cashError}=await supabaseAdmin.from("cash_drawer_events").insert({
        drawer_id:body.drawerId,station_id:stationId,event_type:"sale",amount,
        reference_type:"payment_transaction",reference_id:data.id,
        note:body.note||"Canonical cash sale",created_by:ctx.userId
      });
      if(cashError) throw new Error(cashError.message);
    }
    return json({success:true,data});
  }catch(e){return errorResponse(e);}
}
