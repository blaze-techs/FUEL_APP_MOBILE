import { authenticate,errorResponse,json } from "../_lib/authz.js";
import { submitEtimsDocument } from "../_lib/etims.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function POST(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw Object.assign(new Error("Server unavailable"),{status:500});
    const ctx=await authenticate(request);
    if(!["founder","admin"].includes(String(ctx.globalRole))) throw Object.assign(new Error("Founder/admin only"),{status:403});
    const { data:docs,error }=await supabaseAdmin.from("etims_documents").select("*")
      .in("status",["pending","retry","rejected"]).lte("next_retry_at",new Date().toISOString()).limit(50);
    if(error) throw new Error(error.message);
    let accepted=0,failed=0;
    for(const doc of docs||[]){
      try{
        const result=await submitEtimsDocument(doc.request_payload);
        const ok=result.ok;
        await supabaseAdmin.from("etims_documents").update({
          status:ok?"accepted":"retry",response_payload:result.body,retry_count:(doc.retry_count||0)+1,
          submitted_at:new Date().toISOString(),accepted_at:ok?new Date().toISOString():null,
          next_retry_at:ok?null:new Date(Date.now()+15*60*1000).toISOString(),
          last_error:ok?null:(result.body?.message||`HTTP ${result.status}`)
        }).eq("id",doc.id);
        if(ok) accepted++;
        else failed++;
      }catch(err:any){
        failed++;
        await supabaseAdmin.from("etims_documents").update({status:"retry",retry_count:(doc.retry_count||0)+1,next_retry_at:new Date(Date.now()+15*60*1000).toISOString(),last_error:err?.message||"Retry failed"}).eq("id",doc.id);
      }
    }
    return json({success:true,processed:(docs||[]).length,accepted,failed});
  }catch(e){return errorResponse(e);}
}
