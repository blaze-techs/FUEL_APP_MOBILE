import { authenticate, errorResponse, json, requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { mpesaBaseUrl, mpesaConfig, mpesaPassword, mpesaTimestamp, mpesaToken, normalizeKenyanPhone } from "../_lib/mpesa.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    const body:any=await request.json();
    const stationId=String(body.stationId||"");
    if(!stationId) throw Object.assign(new Error("stationId required"),{status:400});
    await requirePermission(ctx,stationId,"payment.create");

    const amount=Math.round(Number(body.amount));
    if(!Number.isFinite(amount)||amount<1) throw Object.assign(new Error("amount must be at least KES 1"),{status:400});
    const phone=normalizeKenyanPhone(body.phoneNumber);
    const accountReference=String(body.accountReference||"FuelPro").slice(0,12);
    const description=String(body.description||"Fuel purchase").slice(0,13);
    const idempotencyKey=String(body.idempotencyKey||crypto.randomUUID());

    const { data:existing }=await supabaseAdmin.from("payment_transactions")
      .select("*").eq("provider","mpesa").eq("metadata->>idempotency_key",idempotencyKey).maybeSingle();
    if(existing) return json({success:true,duplicate:true,checkoutRequestId:existing.checkout_request_id,transactionId:existing.id});

    const token=await mpesaToken();
    const c=mpesaConfig();
    const timestamp=mpesaTimestamp();
    const response=await fetch(`${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({
        BusinessShortCode:c.shortcode,Password:mpesaPassword(timestamp),Timestamp:timestamp,
        TransactionType:"CustomerPayBillOnline",Amount:amount,PartyA:phone,PartyB:c.shortcode,
        PhoneNumber:phone,CallBackURL:c.callbackUrl,AccountReference:accountReference,TransactionDesc:description
      })
    });
    const daraja:any=await response.json();
    if(!response.ok || daraja.ResponseCode!=="0"){
      throw Object.assign(new Error(daraja.errorMessage||daraja.ResponseDescription||"STK Push failed"),{status:502});
    }

    const providerRef=daraja.CheckoutRequestID;
    const { data:tx,error }=await supabaseAdmin.from("payment_transactions").insert({
      station_id:stationId,sale_id:body.saleId||null,provider:"mpesa",provider_reference:providerRef,
      checkout_request_id:providerRef,merchant_request_id:daraja.MerchantRequestID,payment_method:"mpesa",
      amount,currency:"KES",status:"pending",customer_phone:phone,
      metadata:{idempotency_key:idempotencyKey,account_reference:accountReference,requested_by:ctx.userId}
    }).select("*").single();
    if(error) throw Object.assign(new Error(error.message),{status:409});

    return json({success:true,transactionId:tx.id,checkoutRequestId:providerRef,merchantRequestId:daraja.MerchantRequestID,responseDescription:daraja.ResponseDescription,customerMessage:daraja.CustomerMessage});
  }catch(e){return errorResponse(e);}
}
