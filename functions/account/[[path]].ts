/**
 * Public customer-account route for Cloudflare Pages.
 *
 * The SPA's own route is `/#/account/<token>` and works everywhere unaided.
 * The clean path `/account/<token>` needs the platform to serve the SPA shell
 * instead of a 404 — Vercel already rewrites non-asset paths to /index.html,
 * but this project's Pages setup ignores `_redirects`, so Pages needs a
 * Function (same reason `functions/site/[[path]].ts` exists).
 *
 * This Function deliberately does NOT verify the token. The document holds a
 * customer's balance and lives in `app_kv` behind RLS, readable only with the
 * service role — a key that must never be present at the edge. Verification
 * happens instead in the client through `/api/customer-portal`, which Pages
 * relays to the Vercel resolver.
 *
 * Consequences, both intentional:
 *  • A MALFORMED token is a definite 404 — it can never resolve, so saying so
 *    is honest and keeps the path out of indexes.
 *  • A WELL-FORMED token gets the shell (200) and the client shows either the
 *    account or the "not available" state. Every response carries
 *    `X-Robots-Tag: noindex`, so a private page is never indexed even though
 *    the edge cannot tell a live link from a dead one.
 */

const TOKEN_RE = /^[A-Za-z0-9]{10,16}$/;

interface Env {
  ASSETS?: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
}

function tokenFromPath(pathname: string): string | null {
  const raw = pathname.replace(/^\/account\/?/, "").replace(/\/+$/, "");
  if (!raw || raw.includes("/")) return null;
  const token = decodeURIComponent(raw);
  return TOKEN_RE.test(token) ? token : null;
}

async function serveShell(
  request: Request,
  env: Env,
  status: number,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache, must-revalidate",
    // Always noindex: this shell can render a customer's private balance.
    "x-robots-tag": "noindex, nofollow",
  };

  if (env?.ASSETS?.fetch) {
    const shell = await env.ASSETS.fetch(new URL("/index.html", origin));
    return new Response(shell.body, { status, headers });
  }

  const upstream = await fetch(`${origin}/index.html`);
  return new Response(upstream.body, { status, headers });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const token = tokenFromPath(new URL(request.url).pathname);
  return serveShell(request, env, token ? 200 : 404);
};
