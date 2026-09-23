/**
 * Integrations API (Cloudflare Pages Function)
 *
 * Thin relay to the Vercel deployment's /api/integrations endpoint. The real
 * integration handlers live in api/_lib/integrations-core.ts (Vercel) —
 * Cloudflare Pages Functions cannot import across the functions/ boundary,
 * and the institutions (Safaricom Daraja, KRA eTIMS, Twilio, etc.) are all
 * normal APIs that Vercel's network reaches reliably. Relaying keeps ONE
 * implementation while giving pages.dev visitors a same-origin path.
 *
 * POST /api/integrations?action=<action>
 */
interface Env {
  [key: string]: unknown;
}

const UPSTREAM = "https://fuel-app-mobile.vercel.app/api/integrations";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function relay(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  if (!action) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing action parameter" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
  try {
    // Forward the caller's Authorization header. Without it every
    // authenticated action (PayHero STK, KRA eTIMS, bulk SMS/email, webhooks)
    // relayed through pages.dev reached Vercel unauthenticated and failed 401.
    const auth =
      request.headers.get("authorization") ||
      request.headers.get("Authorization") ||
      "";
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (auth) upstreamHeaders["Authorization"] = auth;

    const upstream = await fetch(
      `${UPSTREAM}?action=${encodeURIComponent(action)}`,
      {
        method: request.method,
        headers: upstreamHeaders,
        body: request.method === "POST" ? await request.text() : undefined,
      },
    );
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Integration relay failed: ${(e as Error).message}`,
      }),
      { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) =>
  relay(context.request);
export const onRequestGet: PagesFunction<Env> = async (context) =>
  relay(context.request);
export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
