/**
 * Pump Mapping API — consolidated dynamic route.
 *
 * Handles /api/pump-mapping/{chat|export|extract} as ONE Vercel serverless
 * function (the Hobby plan caps deployments at 12 functions; the three
 * separate files pushed the project over the cap). The handler modules
 * (chat.ts / export.ts / extract.ts) are imported as plain modules — they
 * are NOT standalone functions anymore (their files would each create a
 * function, so they live with a leading underscore in _lib).
 */

import { POST as chatPOST, GET as chatGET } from "./_lib/chat.js";
import { POST as exportPOST, GET as exportGET } from "./_lib/export.js";
import { POST as extractPOST, GET as extractGET } from "./_lib/extract.js";

function actionOf(request: Request): string {
  const url = new URL(request.url);
  const segs = url.pathname.split("/").filter(Boolean);
  return (segs[segs.length - 1] || "").toLowerCase();
}

export async function POST(request: Request): Promise<Response> {
  const action = actionOf(request);
  if (action === "chat") return chatPOST(request);
  if (action === "export") return exportPOST(request);
  if (action === "extract") return extractPOST(request);
  return new Response(
    JSON.stringify({ error: `Unknown pump-mapping action: ${action}` }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const action = actionOf(request);
  if (action === "chat") return chatGET();
  if (action === "export") return exportGET();
  if (action === "extract") return extractGET();
  return new Response(
    JSON.stringify({ error: `Unknown pump-mapping action: ${action}` }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}
