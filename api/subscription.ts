/** Production FuelPro subscription billing API using Paystack. */
import type { IncomingMessage, ServerResponse } from "http";
import { authenticate } from "./_lib/authz.js";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

const ORIGINS = new Set(["https://fuel-app-mobile.vercel.app","https://fuel-app-mobile.pages.dev"]);
const PLANS: Record<string,{price:number;yearlyPrice:number|null;currency:string}> = {
  starter:{price:0,yearlyPrice:null,currency:"USD"},
  professional:{price:19,yearlyPrice:190,currency:"USD"},
  business:{price:49,yearlyPrice:490,currency:"USD"},
};

function cors(req:IncomingMessage,res:ServerResponse){const origin=String(req.headers.origin||"");if(ORIGINS.has(origin))res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");}
async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{return new Promise(resolve=>{let data="";req.on("data",c=>{data+=c;if(data.length>256000)req.destroy();});req.on("end",()=>{try{const v=JSON.parse(data||"{}");resolve(v&&typeof v==="object"&&!Array.isArray(v)?v:{});}catch{resolve({});}});req.on("error",()=>resolve({}));});}
function amountFor(planId:string,period:"monthly"|"yearly"){const p=PLANS[planId];if(!p)throw Object.assign(new Error("Unknown subscription plan"),{status:400});return period==="yearly"&&p.yearlyPrice!==null?p.yearlyPrice:p.price;}
function subKey(stationId:string,ownerId:string){return "app_subscription__"+ownerId+"__"+stationId;}
function payKey(stationId:string,ownerId:string){return "app_subscription_payments__"+ownerId+"__"+stationId;}
async function readKv<T>(id:string):Promise<T|null>{if(!supabaseAdmin)throw Object.assign(new Error("Server unavailable"),{status:500});const {data,error}=await supabaseAdmin.from("app_kv").select("data").eq("id",id).maybeSingle();if(error)throw Object.assign(new Error(error.message),{status:500});return (data?.data as T)??null;}
async function writeKv(id:string,ownerId:string,stationId:string,data:unknown){if(!supabaseAdmin)throw Object.assign(new Error("Server unavailable"),{status:500});const {error}=await supabaseAdmin.from("app_kv").upsert({id,owner_id:ownerId,station_id:stationId,collection:"fuel_data",data,updated_at:new Date().toISOString()},{onConflict:"id"});if(error)throw Object.assign(new Error(error.message),{status:500});}
function send(res:ServerResponse,status:number,body:unknown){res.statusCode=status;res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(body));}

async function authorizeStation(stationId:string,userId:string){if(!stationId)throw Object.assign(new Error("stationId is required"),{status:400});if(!supabaseAdmin)throw Object.assign(new Error("Server unavailable"),{status:500});const {data:station,error}=await supabaseAdmin.from("stations").select("owner_id").eq("id",stationId).maybeSingle();if(error)throw Object.assign(new Error(error.message),{status:500});if(station?.owner_id===userId)return;const {data:assignment}=await supabaseAdmin.from("station_role_assignments").select("role").eq("station_id",stationId).eq("user_id",userId).eq("is_active",true).maybeSingle();if(assignment?.role==="owner"||assignment?.role==="manager")return;throw Object.assign(new Error("Only the station owner or manager can manage billing"),{status:403});}

export default async function handler(req:IncomingMessage,res:ServerResponse):Promise<void>{
  cors(req,res);
  if(req.method==="OPTIONS"){res.statusCode=204;res.end();return;}
  if(req.method!=="POST"){send(res,405,{success:false,error:"POST required"});return;}
  try{
    const authReq=new Request("https://fuelpro.local/api/subscription",{method:"POST",headers:{Authorization:String(req.headers.authorization||"")}});
    const ctx=await authenticate(authReq);
    const body=await readBody(req);
    const action=String(body.action||"");
    const stationId=String(body.stationId||"");
    await authorizeStation(stationId,ctx.userId);
    if(action==="initialize"){
      const planId=String(body.planId||"");const period=body.billingPeriod==="yearly"?"yearly":"monthly";const amount=amountFor(planId,period);
      if(amount<=0)throw Object.assign(new Error("The selected plan does not require payment"),{status:400});
      const secret=process.env.PAYSTACK_SECRET_KEY||"";if(!secret)throw Object.assign(new Error("PAYSTACK_SECRET_KEY is not configured"),{status:503});
      if(!ctx.email)throw Object.assign(new Error("A verified account email is required for card billing"),{status:400});
      const reference="FUELPRO-"+stationId+"-"+crypto.randomUUID();
      const callback=process.env.PAYSTACK_CALLBACK_URL||"https://fuel-app-mobile.vercel.app/";
      const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:ctx.email,amount:Math.round(amount*100),currency:PLANS[planId].currency,reference,callback_url:callback,metadata:{product:"FuelPro",stationId,userId:ctx.userId,planId,billingPeriod:period,expectedAmount:amount}})});
      const data:any=await response.json();if(!response.ok||!data.status||!data.data?.authorization_url)throw Object.assign(new Error(data.message||"Paystack initialization failed"),{status:502});
      const payments=(await readKv<any[]>(payKey(stationId,ctx.userId)))||[];payments.unshift({id:reference,gateway:"card",amount,currency:PLANS[planId].currency,status:"pending",date:new Date().toISOString(),planId,billingPeriod:period,reference});await writeKv(payKey(stationId),ctx.userId,stationId,payments.slice(0,200));
      return send(res,200,{success:true,reference,authorizationUrl:data.data.authorization_url,amount,currency:PLANS[planId].currency});
    }
    if(action==="verify"){
      const reference=String(body.reference||"").trim();if(!reference)throw Object.assign(new Error("reference is required"),{status:400});
      const payments=(await readKv<any[]>(payKey(stationId,ctx.userId)))||[];
      const pending=payments.find((p:any)=>p?.reference===reference);
      if(!pending)throw Object.assign(new Error("Unknown billing reference for this station/account"),{status:404});
      if(pending.status==="success"){
        const existing=await readKv<any>(subKey(stationId,ctx.userId));
        if(existing) return send(res,200,{success:true,subscription:existing,reference});
      }
      const secret=process.env.PAYSTACK_SECRET_KEY||"";if(!secret)throw Object.assign(new Error("PAYSTACK_SECRET_KEY is not configured"),{status:503});
      const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+secret}});
      const data:any=await response.json();if(!response.ok||!data.status||data.data?.status!=="success")throw Object.assign(new Error(data.message||"Payment has not been confirmed"),{status:402});
      const meta=data.data?.metadata||{};if(String(meta.product)!=="FuelPro"||String(meta.stationId)!==stationId||String(meta.userId)!==ctx.userId)throw Object.assign(new Error("Payment metadata does not match this station/account"),{status:403});
      const planId=String(meta.planId||"");const period=meta.billingPeriod==="yearly"?"yearly":"monthly";const expected=amountFor(planId,period);const paid=Number(data.data.amount)/100;if(!Number.isFinite(paid)||Math.abs(paid-expected)>0.01)throw Object.assign(new Error("Verified payment amount does not match the selected plan"),{status:409});
      const now=new Date();const existing=await readKv<any>(subKey(stationId,ctx.userId));const base=existing?.subscriptionPaidUntil&&new Date(existing.subscriptionPaidUntil)>now?new Date(existing.subscriptionPaidUntil):now;const until=new Date(base);if(period==="yearly")until.setFullYear(until.getFullYear()+1);else until.setMonth(until.getMonth()+1);
      const subscription={planId,billingPeriod:period,onTrial:false,trialStartedAt:null,trialEndsAt:null,subscriptionPaidUntil:until.toISOString(),currentPeriodStartedAt:base.toISOString(),hasActiveSubscription:true,subscriptionLapsed:false,createdAt:existing?.createdAt||now.toISOString()};
      await writeKv(subKey(stationId,ctx.userId),ctx.userId,stationId,subscription);
      const next=payments.map(p=>p?.reference===reference?{...p,status:"success",date:now.toISOString()}:p);await writeKv(payKey(stationId),ctx.userId,stationId,next.slice(0,200));
      return send(res,200,{success:true,subscription,reference});
    }
    throw Object.assign(new Error("Unknown subscription action"),{status:400});
  }catch(e){const x:any=e;return send(res,Number(x?.status)||500,{success:false,error:x?.message||"Subscription request failed"});}
}