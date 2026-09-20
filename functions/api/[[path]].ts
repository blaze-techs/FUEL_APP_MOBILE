/**
 * Catch-all relay for the API routes that have no Pages Function of their own.
 *
 * Cloudflare Pages serves `functions/api/*` directly and has no Vercel-style
 * dispatcher, so only the handful of routes with a dedicated Function worked
 * on fuel-app-mobile.pages.dev — /api/system/health, /api/operations/*,
 * /api/cron/*, /api/mpesa/* and the rest returned a bare 404. The Vercel
 * deployment serves the full dispatcher, so unmatched paths are relayed there
 * and the response (including its status and body) is passed straight back.
 *
 * More specific Functions (movies, live-channels, hls-proxy, …) win over this
 * catch-all because Pages matches the most specific route first.
 */

const UPSTREAM = "https://fuel-app-mobile.vercel.app";

async function relay(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${UPSTREAM}${incoming.pathname}${incoming.search}`;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        // Forward the caller's identity/range hints, but drop hop-by-hop and
        // host headers that would confuse the origin.
        accept: request.headers.get("accept") ?? "*/*",
        "content-type": request.headers.get("content-type") ?? "",
        authorization: request.headers.get("authorization") ?? "",
        range: request.headers.get("range") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "FuelPro-Relay",
      },
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
    });

    const headers = new Headers();
    for (const [key, value] of upstream.headers) {
      // `content-encoding`/`content-length` describe the upstream body; the
      // fetch API has already decoded it, so forwarding them corrupts the
      // response.
      if (
        key.toLowerCase() === "content-encoding" ||
        key.toLowerCase() === "content-length" ||
        key.toLowerCase() === "transfer-encoding"
      ) {
        continue;
      }
      headers.set(key, value);
    }
    if (!headers.has("access-control-allow-origin")) {
      headers.set("access-control-allow-origin", "*");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `API relay failed: ${(error as Error).message}`,
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        },
      },
    );
  }
}

export const onRequestGet = ({ request }: { request: Request }) =>
  relay(request);
export const onRequestPost = ({ request }: { request: Request }) =>
  relay(request);
export const onRequestPut = ({ request }: { request: Request }) =>
  relay(request);
export const onRequestPatch = ({ request }: { request: Request }) =>
  relay(request);
export const onRequestDelete = ({ request }: { request: Request }) =>
  relay(request);
export const onRequest = ({ request }: { request: Request }) => relay(request);
