import type { IncomingMessage, ServerResponse } from "http";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

interface Res extends ServerResponse { status(code:number):Res; json(body:unknown):void; }
function wrap(res:ServerResponse):Res {
  const r=res as Res; r.status=(c)=>{res.statusCode=c;return r;};
  r.json=(b)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(b));}; return r;
}
async function body(req:IncomingMessage):Promise<Record<string,unknown>> {
  return new Promise(resolve=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>{try{resolve(JSON.parse(s||"{}"))}catch{resolve({})}});req.on("error",()=>resolve({}))});
}
async function auth(req:IncomingMessage) {
  if(!supabaseAdmin) throw new Error("Subscription service is not configured");
  const h=String(req.headers.authorization||""); const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token) throw new Error("Authentication required");
  const {data,error}=await supabaseAdmin.auth.getUser(token);
  if(error||!data.user) throw new Error("Invalid or expired session");
  return data.user;
}
export default async function handler(req:IncomingMessage,res:ServerResponse) {
  const out=wrap(res);
  const origin=String(req.headers.origin||"");
  const allowed=new Set(["https://fuel-app-mobile.vercel.app","https://fuel-app-mobile.pages.dev"]);
  if(allowed.has(origin)) res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Vary","Origin"); res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS"){res.statusCode=204;res.end();return;}
  if(req.method!=="POST"){out.status(405).json({success:false,error:"POST required"});return;}
  try {
    const user=await auth(req); const p=await body(req);
    const action=String(p.action||"");
    const stationId=String(p.stationId||""); const planId=String(p.planId||"");
    const billingPeriod=String(p.billingPeriod||"monthly");
    if(!stationId) return out.status(400).json({success:false,error:"stationId is required"});
    const {data:station,error:stationError}=await supabaseAdmin!.from("stations").select("id,owner_id,currency").eq("id",stationId).maybeSingle();
    if(stationError||!station) return out.status(404).json({success:false,error:"Station not found"});
    if(station.owner_id!==user.id) return out.status(403).json({success:false,error:"Only the station owner can manage subscription billing"});
    const key="app_subscription__"+user.id+"__"+stationId;
    const payKey="app_subscription_payments__"+user.id+"__"+stationId;
    if(action==="initialize") {
      const amount=Number(p.amount); const currency=String(p.currency||station.currency||"KES").toUpperCase();
      if(!planId||!["monthly","yearly"].includes(billingPeriod)||!Number.isFinite(amount)||amount<=0) return out.status(400).json({success:false,error:"Invalid subscription payment"});
      const secret=process.env.PAYSTACK_SECRET_KEY;
      if(!secret) return out.status(503).json({success:false,error:"Card payments are not configured. Add PAYSTACK_SECRET_KEY to the server environment."});
      const email=String(user.email||""); if(!email) return out.status(400).json({success:false,error:"Your account has no billing email"});
      const reference="fuelpro_"+stationId+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
      const callback=process.env.PAYSTACK_CALLBACK_URL||"https://fuel-app-mobile.vercel.app/";
      const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email,amount:Math.round(amount*100),currency,reference,callback_url:callback,metadata:{product:"FuelPro",stationId,planId,billingPeriod,userId:user.id}})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.status!==true) return out.status(502).json({success:false,error:data.message||"Card gateway rejected checkout initialization"});
      const row={id:reference,gateway:"card",amount,currency,status:"pending",date:new Date().toISOString(),planId,billingPeriod,reference};
      const {data:existing}=await supabaseAdmin!.from("app_kv").select("data").eq("id",payKey).maybeSingle();
      const previous=Array.isArray(existing?.data)?existing.data:[];
      const next=[row,...previous].slice(0,200);
      const write=await supabaseAdmin!.from("app_kv").upsert({id:payKey,owner_id:user.id,station_id:stationId,collection:"fuel_data",data:next,updated_at:new Date().toISOString()},{onConflict:"id"});
      if(write.error) return out.status(500).json({success:false,error:"Could not record checkout intent"});
      return out.json({success:true,authorization_url:data.data?.authorization_url,access_code:data.data?.access_code,reference});
    }
    if(action==="verify") {
      const reference=String(p.reference||""); if(!reference) return out.status(400).json({success:false,error:"reference is required"});
      const secret=process.env.PAYSTACK_SECRET_KEY; if(!secret) return out.status(503).json({success:false,error:"Card payments are not configured"});
      const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+secret}});
      const data=await response.json().catch(()=>({})); const tx=data.data;
      if(!response.ok||data.status!==true) return out.status(502).json({success:false,error:data.message||"Card verification failed"});
      const paid=tx?.status==="success";
      if(paid) {
        const meta=tx.metadata||{}; if(String(meta.userId||"")!==user.id||String(meta.stationId||"")!==stationId) return out.status(403).json({success:false,error:"Payment ownership mismatch"});
        const plan=String(meta.planId||""); const bp=String(meta.billingPeriod||"monthly");
        const start=new Date(); const until=new Date(start); until.setMonth(until.getMonth()+(bp==="yearly"?12:1));
        const sub={planId:plan,billingPeriod:bp,onTrial:false,trialStartedAt:null,trialEndsAt:null,subscriptionPaidUntil:until.toISOString(),currentPeriodStartedAt:start.toISOString(),hasActiveSubscription:true,subscriptionLapsed:false,createdAt:start.toISOString()};
        const {error:sw}=await supabaseAdmin!.from("app_kv").upsert({id:key,owner_id:user.id,station_id:stationId,collection:"fuel_data",data:sub,updated_at:new Date().toISOString()},{onConflict:"id"});
        if(sw) return out.status(500).json({success:false,error:"Payment verified but subscription activation failed"});
        const {data:existing}=await supabaseAdmin!.from("app_kv").select("data").eq("id",payKey).maybeSingle();
        const list=Array.isArray(existing?.data)?existing.data:[]; const next=list.map((x:any)=>x?.reference===reference?{...x,status:"success",verifiedAt:new Date().toISOString()}:x);
        await supabaseAdmin!.from("app_kv").upsert({id:payKey,owner_id:user.id,station_id:stationId,collection:"fuel_data",data:next,updated_at:new Date().toISOString()},{onConflict:"id"});
      }
      return out.json({success:paid,status:tx?.status||"pending",reference});
    }
    return out.status(400).json({success:false,error:"Unknown action"});
  } catch(e) { return out.status(401).json({success:false,error:e instanceof Error?e.message:"Subscription request failed"}); }
}