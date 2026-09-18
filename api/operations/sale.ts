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

      if ((body.paymentStatus || "unpaid") === "paid" && body.createPayment !== false) {
        const paymentMethod = String(body.paymentMethod || "cash").toLowerCase();
        const idempotencyKey = String(body.paymentIdempotencyKey || `${body.idempotencyKey || data.id}:payment`);
        const { error: paymentError } = await supabaseAdmin.from("payment_transactions").insert({
          station_id: body.stationId,
          ledger_sale_id: data.id,
          shift_id: body.shiftId || null,
          provider: paymentMethod,
          provider_reference: body.paymentReference || `${paymentMethod}-${idempotencyKey}`,
          payment_method: paymentMethod,
          amount: Number(data.gross_amount),
          currency: body.currency || "KES",
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
          idempotency_key: idempotencyKey,
          metadata: { source: "canonical-sale-api" }
        });
        if (paymentError && paymentError.code !== "23505") {
          throw new Error(`Sale posted but payment recording failed: ${paymentError.message}`);
        }
      }

      return json({success:true,data});
    }
    if(action==="reverse"){
      const { data:sale }=await supabaseAdmin.from("sales_ledger").select("station_id").eq("id",body.saleId).maybeSingle();
      if(!sale) throw Object.assign(new Error("Sale not found"),{status:404});
      await requirePermission(ctx,sale.station_id,"sale.reverse");
      const { data,error }=await supabaseAdmin.rpc("fuelpro_reverse_sale",{p_sale:body.saleId,p_reason:body.reason||"Reversal",p_idempotency_key:body.idempotencyKey||crypto.randomUUID()});
      if(error) throw Object.assign(new Error(error.message),{status:400});

      const { data: linkedPayments, error: linkedError } = await supabaseAdmin
        .from("payment_transactions")
        .select("id,payment_method,amount,status")
        .eq("ledger_sale_id", body.saleId)
        .eq("status", "confirmed");
      if (linkedError) throw new Error(linkedError.message);

      for (const payment of linkedPayments || []) {
        const { error: reversePaymentError } = await supabaseAdmin
          .from("payment_transactions")
          .update({
            status: "reversed",
            reconciled_at: new Date().toISOString(),
            reconciled_by: ctx.userId,
            metadata: { reversal_sale_id: data.id, reversal_reason: body.reason || "Sale reversal" },
          })
          .eq("id", payment.id);
        if (reversePaymentError) throw new Error(reversePaymentError.message);

        if (String(payment.payment_method).toLowerCase() === "cash") {
          const { data: drawerEvent } = await supabaseAdmin
            .from("cash_drawer_events")
            .select("drawer_id,station_id")
            .eq("reference_type", "payment_transaction")
            .eq("reference_id", payment.id)
            .maybeSingle();
          if (drawerEvent) {
            await supabaseAdmin.from("cash_drawer_events").insert({
              drawer_id: drawerEvent.drawer_id,
              station_id: drawerEvent.station_id,
              event_type: "refund",
              amount: -Number(payment.amount),
              reference_type: "sales_ledger",
              reference_id: data.id,
              note: body.reason || "Sale reversal",
              created_by: ctx.userId,
            });
          }
        }
      }

      return json({success:true,data});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
