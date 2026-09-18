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
        if(i.fuelTypeId){
          const {data:m,error:me}=await supabaseAdmin.from("tank_movements").insert({
            station_id:stationId,fuel_type_id:i.fuelTypeId,movement_type:"delivery",quantity_litres:Number(i.quantity),
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
      if(body.purchaseOrderId) await supabaseAdmin.from("purchase_order_ledger").update({status:"received"}).eq("id",body.purchaseOrderId);
      return json({success:true,data:delivery});
    }
    return json({success:false,error:"Unknown action"},400);
  }catch(e){return errorResponse(e);}
}
