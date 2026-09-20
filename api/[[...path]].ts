import type { IncomingMessage, ServerResponse } from "node:http";
import * as route0 from "../src/server/vercel-api/operations/reconciliation.js";
import * as route1 from "../src/server/vercel-api/cron/monthly-fuel-sync.js";
import * as route2 from "../src/server/vercel-api/operations/anomalies.js";
import * as route3 from "../src/server/vercel-api/operations/suppliers.js";
import * as route4 from "../src/server/vercel-api/game-catalog-proxy.js";
import * as route5 from "../src/server/vercel-api/operations/payment.js";
import * as route6 from "../src/server/vercel-api/operations/station.js";
import * as route7 from "../src/server/vercel-api/operations/credit.js";
import * as route8 from "../src/server/vercel-api/operations/drawer.js";
import * as route9 from "../src/server/vercel-api/operations/period.js";
import * as route10 from "../src/server/vercel-api/reports/canonical.js";
import * as route11 from "../src/server/vercel-api/operations/pumps.js";
import * as route12 from "../src/server/vercel-api/operations/roles.js";
import * as route13 from "../src/server/vercel-api/operations/shift.js";
import * as route14 from "../src/server/vercel-api/cron/etims-sync.js";
import * as route15 from "../src/server/vercel-api/mpesa/stkstatus.js";
import * as route16 from "../src/server/vercel-api/operations/cash.js";
import * as route17 from "../src/server/vercel-api/operations/rbac.js";
import * as route18 from "../src/server/vercel-api/operations/sale.js";
import * as route19 from "../src/server/vercel-api/operations/sync.js";
import * as route20 from "../src/server/vercel-api/operations/tank.js";
import * as route21 from "../src/server/vercel-api/mpesa/callback.js";
import * as route22 from "../src/server/vercel-api/etims/invoice.js";
import * as route23 from "../src/server/vercel-api/founder-admin.js";
import * as route24 from "../src/server/vercel-api/founder-stats.js";
import * as route25 from "../src/server/vercel-api/live-channels.js";
import * as route26 from "../src/server/vercel-api/mpesa/stkpush.js";
import * as route27 from "../src/server/vercel-api/system/health.js";
import * as route28 from "../src/server/vercel-api/integrations.js";
import * as route29 from "../src/server/vercel-api/payslip-link.js";
import * as route30 from "../src/server/vercel-api/subscription.js";
import * as route31 from "../src/server/vercel-api/etims/retry.js";
import * as route32 from "../src/server/vercel-api/fuel-prices.js";
import * as route33 from "../src/server/vercel-api/movie-embed.js";
import * as route34 from "../src/server/vercel-api/fuel-local.js";
import * as route35 from "../src/server/vercel-api/sync/apply.js";
import * as route36 from "../src/server/vercel-api/hls-proxy.js";
import * as route37 from "../src/server/vercel-api/movies.js";
import * as route38 from "../src/server/vercel-api/quenq-embed/[[...path]].js";
import * as route39 from "../src/server/vercel-api/game-embed/[[...path]].js";
import * as route40 from "../src/server/vercel-api/pump-mapping/[action].js";
import * as route41 from "../src/server/vercel-api/domain/verify.js";
import * as route42 from "../src/server/vercel-api/payhero/stkpush.js";

type RouteDef = { pattern: RegExp; params: Array<{ name: string; kind: string }>; module: Record<string, any>; name: string };
const routes: RouteDef[] = [
  { pattern: new RegExp("^/api/operations/reconciliation/?$"), params: [], module: route0, name: "operations/reconciliation.ts" },
  { pattern: new RegExp("^/api/cron/monthly-fuel-sync/?$"), params: [], module: route1, name: "cron/monthly-fuel-sync.ts" },
  { pattern: new RegExp("^/api/operations/anomalies/?$"), params: [], module: route2, name: "operations/anomalies.ts" },
  { pattern: new RegExp("^/api/operations/suppliers/?$"), params: [], module: route3, name: "operations/suppliers.ts" },
  { pattern: new RegExp("^/api/game-catalog-proxy/?$"), params: [], module: route4, name: "game-catalog-proxy.ts" },
  { pattern: new RegExp("^/api/operations/payment/?$"), params: [], module: route5, name: "operations/payment.ts" },
  { pattern: new RegExp("^/api/operations/station/?$"), params: [], module: route6, name: "operations/station.ts" },
  { pattern: new RegExp("^/api/operations/credit/?$"), params: [], module: route7, name: "operations/credit.ts" },
  { pattern: new RegExp("^/api/operations/drawer/?$"), params: [], module: route8, name: "operations/drawer.ts" },
  { pattern: new RegExp("^/api/operations/period/?$"), params: [], module: route9, name: "operations/period.ts" },
  { pattern: new RegExp("^/api/reports/canonical/?$"), params: [], module: route10, name: "reports/canonical.ts" },
  { pattern: new RegExp("^/api/operations/pumps/?$"), params: [], module: route11, name: "operations/pumps.ts" },
  { pattern: new RegExp("^/api/operations/roles/?$"), params: [], module: route12, name: "operations/roles.ts" },
  { pattern: new RegExp("^/api/operations/shift/?$"), params: [], module: route13, name: "operations/shift.ts" },
  { pattern: new RegExp("^/api/cron/etims-sync/?$"), params: [], module: route14, name: "cron/etims-sync.ts" },
  { pattern: new RegExp("^/api/mpesa/stkstatus/?$"), params: [], module: route15, name: "mpesa/stkstatus.ts" },
  { pattern: new RegExp("^/api/operations/cash/?$"), params: [], module: route16, name: "operations/cash.ts" },
  { pattern: new RegExp("^/api/operations/rbac/?$"), params: [], module: route17, name: "operations/rbac.ts" },
  { pattern: new RegExp("^/api/operations/sale/?$"), params: [], module: route18, name: "operations/sale.ts" },
  { pattern: new RegExp("^/api/operations/sync/?$"), params: [], module: route19, name: "operations/sync.ts" },
  { pattern: new RegExp("^/api/operations/tank/?$"), params: [], module: route20, name: "operations/tank.ts" },
  { pattern: new RegExp("^/api/mpesa/callback/?$"), params: [], module: route21, name: "mpesa/callback.ts" },
  { pattern: new RegExp("^/api/etims/invoice/?$"), params: [], module: route22, name: "etims/invoice.ts" },
  { pattern: new RegExp("^/api/founder-admin/?$"), params: [], module: route23, name: "founder-admin.ts" },
  { pattern: new RegExp("^/api/founder-stats/?$"), params: [], module: route24, name: "founder-stats.ts" },
  { pattern: new RegExp("^/api/live-channels/?$"), params: [], module: route25, name: "live-channels.ts" },
  { pattern: new RegExp("^/api/mpesa/stkpush/?$"), params: [], module: route26, name: "mpesa/stkpush.ts" },
  { pattern: new RegExp("^/api/system/health/?$"), params: [], module: route27, name: "system/health.ts" },
  { pattern: new RegExp("^/api/integrations/?$"), params: [], module: route28, name: "integrations.ts" },
  { pattern: new RegExp("^/api/payslip-link/?$"), params: [], module: route29, name: "payslip-link.ts" },
  { pattern: new RegExp("^/api/subscription/?$"), params: [], module: route30, name: "subscription.ts" },
  { pattern: new RegExp("^/api/etims/retry/?$"), params: [], module: route31, name: "etims/retry.ts" },
  { pattern: new RegExp("^/api/fuel-prices/?$"), params: [], module: route32, name: "fuel-prices.ts" },
  { pattern: new RegExp("^/api/movie-embed/?$"), params: [], module: route33, name: "movie-embed.ts" },
  { pattern: new RegExp("^/api/fuel-local/?$"), params: [], module: route34, name: "fuel-local.ts" },
  { pattern: new RegExp("^/api/sync/apply/?$"), params: [], module: route35, name: "sync/apply.ts" },
  { pattern: new RegExp("^/api/hls-proxy/?$"), params: [], module: route36, name: "hls-proxy.ts" },
  { pattern: new RegExp("^/api/movies/?$"), params: [], module: route37, name: "movies.ts" },
  { pattern: new RegExp("^/api/quenq-embed(?:/(.*))?/?$"), params: [{"name":"path","kind":"optionalCatchAll"}], module: route38, name: "quenq-embed/[[...path]].ts" },
  { pattern: new RegExp("^/api/game-embed(?:/(.*))?/?$"), params: [{"name":"path","kind":"optionalCatchAll"}], module: route39, name: "game-embed/[[...path]].ts" },
  { pattern: new RegExp("^/api/pump-mapping/([^/]+)/?$"), params: [{"name":"action","kind":"single"}], module: route40, name: "pump-mapping/[action].ts" },
  { pattern: new RegExp("^/api/domain/verify/?$"), params: [], module: route41, name: "domain/verify.ts" },
  { pattern: new RegExp("^/api/payhero/stkpush/?$"), params: [], module: route42, name: "payhero/stkpush.ts" },
];

function setQuery(req: IncomingMessage, url: URL, params: Record<string, string>) {
  const query: Record<string, string | string[]> = { ...((req as any).query || {}) };
  url.searchParams.forEach((value, key) => { const previous = query[key]; query[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]; });
  Object.assign(query, params); (req as any).query = query;
}

async function readBody(req: IncomingMessage): Promise<Buffer> { return new Promise((resolve, reject) => { const chunks: Buffer[] = []; req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); }); }
async function sendResponse(res: ServerResponse, response: Response) { res.statusCode = response.status; response.headers.forEach((v,k)=>res.setHeader(k,v)); res.end(Buffer.from(await response.arrayBuffer())); }
async function invokeWeb(mod: Record<string, any>, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://fuelpro.local"); const method = String(req.method || "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  const request = new Request(url, { method, headers: new Headers(req.headers as Record<string,string>), body: body && body.length ? body : undefined });
  const fn = typeof mod[method] === "function" ? mod[method] : typeof mod.default?.fetch === "function" ? mod.default.fetch : typeof mod.default === "function" ? mod.default : null;
  if (!fn) { res.statusCode=405; res.end(JSON.stringify({success:false,error:"Method not allowed"})); return; }
  const out = await fn(request); if (out instanceof Response) return sendResponse(res,out); res.statusCode=200; res.end(out == null ? "" : String(out));
}

async function invokeNode(mod: Record<string, any>, req: IncomingMessage, res: ServerResponse) { const fn = typeof mod.default === "function" ? mod.default : mod.default?.handler; if(typeof fn !== "function") return invokeWeb(mod,req,res); await fn(req,res); }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://fuelpro.local"); const match = routes.find(r => r.pattern.test(url.pathname));
  if (!match) { res.statusCode=404; res.setHeader("Content-Type","application/json"); res.end(JSON.stringify({success:false,error:"API route not found"})); return; }
  const captures = match.pattern.exec(url.pathname)?.slice(1) || []; const params: Record<string,string> = {};
  match.params.forEach((p,i)=>{ const raw=captures[i]||""; params[p.name]=p.kind==="catchAll"||p.kind==="optionalCatchAll"?raw.split("/").filter(Boolean).map(decodeURIComponent).join("/"):decodeURIComponent(raw); });
  setQuery(req,url,params);
  try { const mod=match.module; const web=["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"].some(m=>typeof mod[m]==="function")||typeof mod.default?.fetch==="function"; if(web) await invokeWeb(mod,req,res); else await invokeNode(mod,req,res); }
  catch(error) { if(res.headersSent){res.end();return;} res.statusCode=500; res.setHeader("Content-Type","application/json"); res.end(JSON.stringify({success:false,error:error instanceof Error?error.message:"Internal server error"})); }
}