import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request); const body:any=await request.json();
    const action=new URL(request.url).searchParams.get("action")||""; const stationId=String(body.stationId||"");
    if(action==="create-po"){
      await requirePermission(ctx,stationId,"purchase.create");
      const items=Array.isArray(body.items)?body.items:[];
      const total=items.reduce((s:number,i:any)=>s+Number(i.quantity||0)*Number(i.unitCost||0),0);
      const {data:po,error}=await supabaseAdmin.from("purchase_order_ledger").insert({
        station_id:stationId,supplier_id:body.supplierId||null,order_number:body.orderNumber||`PO-${Date.now()}`,
        status:body.status||"draft",currency:body.currency||"KES",ordered_amount:total,created_by:ctx.userId
      }).select("*").single(); if(error) throw new Error(error.message);
      if(items.length){
        const {error:itemError}=await supabaseAdmin.from("purchase_order_items_ledger").insert(items.map((i:any)=>({
          purchase_order_id:po.id,product_id:i.productId||null,fuel_type_id:i.fuelTypeId||null,
          description:i.description||"Item",quantity:Number(i.quantity),unit_cost:Number(i.unitCost)
        }))); if(itemError) throw new Error(itemError.message);
      }
      return json({success:true,data:po});
    }
    if(action==="receive"){
      await requirePermission(ctx,stationId,"purchase.receive");
      const {data:delivery,error}=await supabaseAdmin.from("supplier_deliveries").insert({
        station_id:stationId,purchase_order_id:body.purchaseOrderId||null,supplier_id:body.supplierId||null,
        delivery_note:body.deliveryNote||null,tanker_registration:body.tankerRegistration||null,received_by:ctx.userId
      }).select("*").single(); if(error) throw new Error(error.message);
      for(const i of (body.items||[])){
        let tankMovementId:null|string=null, inventoryMovementId:null|string=null;
        if (i.itemId) {
          const { data: poItem, error: poItemError } = await supabaseAdmin
            .from("purchase_order_items_ledger")
            .select("received_quantity,quantity")
            .eq("id", i.itemId)
            .eq("purchase_order_id", body.purchaseOrderId)
            .maybeSingle();
          if (poItemError) throw new Error(poItemError.message);
          if (poItem) {
            const nextReceived = Number(poItem.received_quantity || 0) + Number(i.quantity || 0);
            const { error: receiptUpdateError } = await supabaseAdmin
              .from("purchase_order_items_ledger")
              .update({ received_quantity: nextReceived })
              .eq("id", i.itemId);
            if (receiptUpdateError) throw new Error(receiptUpdateError.message);
          }
        }
        if(i.fuelTypeId){
          const {data:m,error:me}=await supabaseAdmin.from("tank_movements").insert({
            station_id:stationId,fuel_type_id:i.fuelTypeId,tank_id:i.tankId||null,movement_type:"delivery",quantity_litres:Number(i.quantity),
            reference_type:"supplier_delivery",reference_id:delivery.id,unit_cost:i.unitCost??null,created_by:ctx.userId
          }).select("id").single(); if(me) throw new Error(me.message); tankMovementId=m.id;
        } else if(i.productId){
          const {data:m,error:me}=await supabaseAdmin.from("inventory_movements").insert({
            station_id:stationId,product_id:i.productId,movement_type:"purchase",quantity:Number(i.quantity),
            reference_type:"supplier_delivery",reference_id:delivery.id,unit_cost:i.unitCost??null,created_by:ctx.userId
          }).select("id").single(); if(me) throw new Error(me.message); inventoryMovementId=m.id;
        }
        await supabaseAdmin.from("supplier_delivery_items").insert({
          delivery_id:delivery.id,fuel_type_id:i.fuelTypeId||null,product_id:i.productId||null,quantity:Number(i.quantity),
          unit_cost:i.unitCost??null,tank_movement_id:tankMovementId,inventory_movement_id:inventoryMovementId
        });
      }
      if(body.purchaseOrderId) {
        const { data: remaining, error: remainingError } = await supabaseAdmin
          .from("purchase_order_items_ledger")
          .select("quantity,received_quantity")
          .eq("purchase_order_id", body.purchaseOrderId);
        if (remainingError) throw new Error(remainingError.message);
        const fullyReceived = (remaining || []).every((row:any) => Number(row.received_quantity || 0) >= Number(row.quantity || 0));
        await supabaseAdmin.from("purchase_order_ledger")
          .update({status: fullyReceived ? "received" : "part_received"})
          .eq("id",body.purchaseOrderId);
      }
      return json({success:true,data:delivery});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}


export async function GET(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw new Error("Server unavailable");
    const ctx=await authenticate(request);
    const url=new URL(request.url);
    const stationId=String(url.searchParams.get("stationId")||"");
    await requirePermission(ctx,stationId,"station.read");
    let q=supabaseAdmin.from("purchase_order_ledger")
      .select("*,purchase_order_items_ledger(*)")
      .eq("station_id",stationId)
      .order("created_at",{ascending:false});
    const status=url.searchParams.get("status");
    if(status) q=q.eq("status",status);
    const {data:orders,error}=await q;
    if(error) throw new Error(error.message);
    const supplierIds=[...new Set((orders||[]).map((o:any)=>o.supplier_id).filter(Boolean))];
    let suppliers:any[]=[];
    if(supplierIds.length){
      const result=await supabaseAdmin.from("suppliers").select("id,name,email,phone").in("id",supplierIds);
      if(!result.error) suppliers=result.data||[];
    }
    const supplierMap=new Map(suppliers.map((s:any)=>[s.id,s]));
    return json({success:true,data:(orders||[]).map((o:any)=>({
      ...o,
      total_amount:o.ordered_amount,
      purchase_order_items:o.purchase_order_items_ledger||[],
      suppliers:o.supplier_id?supplierMap.get(o.supplier_id)||null:null
    }))});
  }catch(e){return errorResponse(e);}
}
