/**
 * Public mini-site route for Cloudflare Pages.
 *
 * The SPA uses hash routing, so the app's own route is `/#/site/<slug>` and it
 * works everywhere with no help from the host. The clean path `/site/<slug>`
 * needs the platform to serve the SPA shell instead of a 404 — Vercel does that
 * from `vercel.json`, but this project ignores `_redirects` (verified: `/site/*`
 * and wholesale `/*` rules both still return the static 404 page), so Pages
 * needs a Function for it.
 *
 * The shell is returned with a status that matches reality:
 *   - site published   -> 200 (crawlers may index it)
 *   - site not found   -> 404 (a real 404, so nothing is indexed under
 *                         FuelPro's own URL)
 * Either way the client renders, showing the site or its "not found" state.
 *
 * The published document is read through the bucket's public URL, which is
 * readable anonymously by policy — no key is needed here.
 */

const PROJECT_ID = "ojjscjwatikixlpshmub";
const BUCKET = "fuelpro-files";
const UPSTREAM = "https://fuel-app-mobile.vercel.app";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface Env {
  ASSETS?: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
}

function slugFromPath(pathname: string): string | null {
  const raw = pathname.replace(/^\/site\/?/, "").replace(/\/+$/, "");
  if (!raw || raw.includes("/")) return null;
  const slug = decodeURIComponent(raw).toLowerCase();
  return SLUG_RE.test(slug) ? slug : null;
}

async function isPublished(slug: string): Promise<boolean> {
  const url = `https://${PROJECT_ID}.supabase.co/storage/v1/object/public/${BUCKET}/mini-site/${slug}/site.json`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return false;
    // A valid published doc always carries the slug it was published under.
    const doc = (await res.json()) as { slug?: string } | null;
    return !!doc && typeof doc === "object" && doc.slug === slug;
  } catch {
    // A read failure must not 404 a site that may well exist; assume it does
    // and let the client surface the real state.
    return true;
  }
}

async function serveShell(
  request: Request,
  env: Env,
  status: number,
): Promise<Response> {
  const origin = new URL(request.url).origin;

  // Prefer the deployment's own asset store, so no request leaves the edge.
  if (env?.ASSETS?.fetch) {
    const shell = await env.ASSETS.fetch(new URL("/index.html", origin));
    return new Response(shell.body, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The shell is versioned by its hashed asset references, so revalidate.
        "cache-control": "no-cache, must-revalidate",
      },
    });
  }

  // Fallback: the production origin (never `next()`, which would 404).
  const upstream = await fetch(`${UPSTREAM}/index.html`);
  return new Response(upstream.body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache, must-revalidate",
    },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const slug = slugFromPath(new URL(request.url).pathname);
  if (!slug) return serveShell(request, env, 404);
  return serveShell(request, env, (await isPublished(slug)) ? 200 : 404);
};
