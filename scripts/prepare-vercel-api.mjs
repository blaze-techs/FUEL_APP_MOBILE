import fs from "node:fs";
import path from "node:path";

if (process.env.VERCEL_BUILD !== "1") {
  console.log("[vercel-api] skipped outside VERCEL_BUILD=1");
  process.exit(0);
}

const root = process.cwd();
const apiDir = path.join(root, "api");
const parkedDir = path.join(root, ".vercel-api-source");

if (!fs.existsSync(apiDir)) throw new Error("[vercel-api] api directory is missing");
if (fs.existsSync(parkedDir)) fs.rmSync(parkedDir, { recursive: true, force: true });

fs.renameSync(apiDir, parkedDir);
fs.mkdirSync(apiDir, { recursive: true });

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      result.push(...walk(full));
    } else if (/\.(ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      result.push(full);
    }
  }
  return result;
}

function makeRoute(file) {
  const rel = path.relative(parkedDir, file).replaceAll(path.sep, "/");
  const routeFile = rel.replace(/\.(ts|js|mjs)$/, "");
  const parts = routeFile.split("/");
  if (parts.at(-1) === "index") parts.pop();
  if (!parts.length || parts.some((p) => p.startsWith("_") || p.startsWith("."))) return null;

  const params = [];
  const regex = ["^/api"];
  for (const part of parts) {
    const optionalCatch = part.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
    const catchAll = part.match(/^\[\.\.\.([^\]]+)\]$/);
    const single = part.match(/^\[([^\.\]]+)\]$/);
    if (optionalCatch) {
      params.push({ name: optionalCatch[1], kind: "optionalCatchAll" });
      regex.push("(?:/(.*))?");
    } else if (catchAll) {
      params.push({ name: catchAll[1], kind: "catchAll" });
      regex.push("/(.+)");
    } else if (single) {
      params.push({ name: single[1], kind: "single" });
      regex.push("/([^/]+)");
    } else {
      regex.push("/" + part.replace(/[.*+?^()|[\\]\\\\]/g, "\\\\$&"));
    }
  }
  regex.push("/?$");
  return {
    rel,
    route: regex.join(""),
    params,
    dynamic: params.some((p) => p.kind !== "single"),
  };
}

const routes = walk(parkedDir)
  .map(makeRoute)
  .filter(Boolean)
  .sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || b.route.length - a.route.length);

if (!routes.length) throw new Error("[vercel-api] no route modules found");

const imports = routes.map((r, i) =>
  'import * as route' + i + ' from "../.vercel-api-source/' +
  r.rel.replace(/\.(ts|js|mjs)$/, "") + '";'
).join("\n");

const table = routes.map((r, i) =>
  '  { pattern: new RegExp(' + JSON.stringify(r.route) + '), params: ' +
  JSON.stringify(r.params) + ', module: route' + i + ', name: ' +
  JSON.stringify(r.rel) + ' },'
).join("\n");

const dispatcher = [
'import type { IncomingMessage, ServerResponse } from "node:http";',
imports,
'',
'type RouteDef = { pattern: RegExp; params: Array<{ name: string; kind: string }>; module: Record<string, any>; name: string };',
'const routes: RouteDef[] = [',
table,
'];',
'',
'function setQuery(req: IncomingMessage, url: URL, params: Record<string, string>) {',
'  const query: Record<string, string | string[]> = {};',
'  url.searchParams.forEach((value, key) => {',
'    const previous = query[key];',
'    if (previous === undefined) query[key] = value;',
'    else query[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];',
'  });',
'  Object.assign(query, params);',
'  (req as any).query = query;',
'}',
'',
'function readBody(req: IncomingMessage): Promise<Buffer> {',
'  return new Promise((resolve, reject) => {',
'    const chunks: Buffer[] = [];',
'    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));',
'    req.on("end", () => resolve(Buffer.concat(chunks)));',
'    req.on("error", reject);',
'  });',
'}',
'',
'async function sendWebResponse(res: ServerResponse, response: Response) {',
'  res.statusCode = response.status;',
'  response.headers.forEach((value, key) => res.setHeader(key, value));',
'  res.end(Buffer.from(await response.arrayBuffer()));',
'}',
'',
'async function invokeWeb(mod: Record<string, any>, req: IncomingMessage, res: ServerResponse) {',
'  const url = new URL(req.url || "/", "http://fuelpro.local");',
'  const method = String(req.method || "GET").toUpperCase();',
'  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);',
'  const request = new Request(url, { method, headers: new Headers(req.headers as Record<string, string>), body: body && body.length ? body : undefined });',
'  const fn = typeof mod[method] === "function" ? mod[method] : typeof mod.default?.fetch === "function" ? mod.default.fetch : typeof mod.default === "function" ? mod.default : null;',
'  if (!fn) { res.statusCode = 405; res.end(JSON.stringify({ success: false, error: "Method not allowed" })); return; }',
'  const response = await fn(request);',
'  if (response instanceof Response) return sendWebResponse(res, response);',
'  res.statusCode = 200;',
'  res.end(response == null ? "" : String(response));',
'}',
'',
'async function invokeNode(mod: Record<string, any>, req: IncomingMessage, res: ServerResponse) {',
'  const fn = typeof mod.default === "function" ? mod.default : mod.default?.handler;',
'  if (typeof fn !== "function") return invokeWeb(mod, req, res);',
'  await fn(req, res);',
'}',
'',
'export default async function handler(req: IncomingMessage, res: ServerResponse) {',
'  const url = new URL(req.url || "/", "http://fuelpro.local");',
'  const match = routes.find((r) => r.pattern.test(url.pathname));',
'  if (!match) { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ success: false, error: "API route not found" })); return; }',
'  const captures = match.pattern.exec(url.pathname)?.slice(1) || [];',
'  const params: Record<string, string> = {};',
'  match.params.forEach((p, i) => {',
'    const raw = captures[i] || "";',
'    params[p.name] = p.kind === "catchAll" || p.kind === "optionalCatchAll" ? raw.split("/").filter(Boolean).map(decodeURIComponent).join("/") : decodeURIComponent(raw);',
'  });',
'  setQuery(req, url, params);',
'  try {',
'    const mod = match.module;',
'    const web = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].some((m) => typeof mod[m] === "function") || typeof mod.default?.fetch === "function";',
'    if (web) await invokeWeb(mod, req, res); else await invokeNode(mod, req, res);',
'  } catch (error) {',
'    if (res.headersSent) { res.end(); return; }',
'    res.statusCode = 500;',
'    res.setHeader("Content-Type", "application/json");',
'    res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal server error" }));',
'  }',
'}'
].join("\n");

fs.writeFileSync(path.join(apiDir, "index.ts"), dispatcher);
console.log("[vercel-api] consolidated " + routes.length + " API route modules into one Vercel Function");
