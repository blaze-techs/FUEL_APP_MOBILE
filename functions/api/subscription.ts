interface Env { [key:string]: unknown; }
const UPSTREAM="https://fuel-app-mobile.vercel.app/api/subscription";
function cors(request:Request):HeadersInit{
  const origin=request.headers.get("Origin")||"";
  const h:Record<string,string>={"Vary":"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
  if(origin==="https://fuel-app-mobile.pages.dev"||origin==="https://fuel-app-mobile.vercel.app") h["Access-Control-Allow-Origin"]=origin;
  return h;
}
export const onRequestOptions:PagesFunction<Env>=async ({request})=>new Response(null,{status:204,headers:cors(request)});
export const onRequestPost:PagesFunction<Env>=async ({request})=>{
  try{
    const u=new URL(request.url); const target=UPSTREAM+u.search;
    const upstream=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json","Authorization":request.headers.get("Authorization")||""},body:await request.text()});
    return new Response(await upstream.text(),{status:upstream.status,headers:{"Content-Type":"application/json",...cors(request)}});
  }catch(e){
    return new Response(JSON.stringify({success:false,error:"Subscription relay failed"}),{status:502,headers:{"Content-Type":"application/json",...cors(request)}});
  }
};