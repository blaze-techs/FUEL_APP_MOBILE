import { authenticate,errorResponse,json,requirePermission } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

function csvCell(v:any){const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
export async function GET(request:Request):Promise<Response>{
  try{
    if(!supabaseAdmin) throw new Error("Server unavailable");
    const ctx=await authenticate(request); const url=new URL(request.url);
    const stationId=String(url.searchParams.get("stationId")||""); const start=url.searchParams.get("start"); const end=url.searchParams.get("end");
    const format=(url.searchParams.get("format")||"json").toLowerCase();
    await requirePermission(ctx,stationId,"report.read");
    let q=supabaseAdmin.from("canonical_station_daily_summary").select("*").eq("station_id",stationId).order("business_date",{ascending:true});
    if(start) q=q.gte("business_date",start); if(end) q=q.lte("business_date",end);
    const {data,error}=await q; if(error) throw new Error(error.message);
    const rows=data||[];
    const totals=rows.reduce((a:any,r:any)=>({litres:a.litres+Number(r.litres||0),gross:a.gross+Number(r.gross_sales||0),tax:a.tax+Number(r.tax_amount||0),net:a.net+Number(r.net_sales||0),sales:a.sales+Number(r.sale_count||0),reversals:a.reversals+Number(r.reversal_count||0)}),{litres:0,gross:0,tax:0,net:0,sales:0,reversals:0});
    if(format==="csv"){
      const header=["Date","Litres","Gross Sales","Tax","Net Sales","Sales","Reversals"];
      const csv=[header.join(","),...rows.map((r:any)=>[r.business_date,r.litres,r.gross_sales,r.tax_amount,r.net_sales,r.sale_count,r.reversal_count].map(csvCell).join(",")),["TOTAL",totals.litres,totals.gross,totals.tax,totals.net,totals.sales,totals.reversals].join(",")].join("\n");
      return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=fuelpro-canonical-report.csv","cache-control":"no-store"}});
    }
    return json({success:true,stationId,start,end,rows,totals,source:"canonical_station_daily_summary"});
  }catch(e){return errorResponse(e);}
}
