/**
 * Generic same-origin game mirror — Cloudflare Pages Function.
 *
 * Same route as the Vercel handler (/api/game-mirror/<key>/<rest>) so the
 * Video Games tab keeps games INSIDE the iframe on both hosts. Cloudflare
 * Pages bundles each function independently, so the registry + rewrite are
 * inlined here. Keep in sync with:
 *   src/react-app/lib/game-mirror-config.ts
 *   src/server/vercel-api/_lib/game-mirror.ts
 */
interface Env {}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface Cfg {
  origin: string;
  assetOrigins?: string[];
  entry: string;
  preservePath: boolean;
}

const GAME_MIRROR: Record<string, Cfg> = {
  parkbaron: {
    origin: "https://parkbaron.com",
    entry: "/play",
    preservePath: true,
  },
  nacht: {
    origin: "https://zombies.bitcoinsapi.com",
    entry: "/",
    preservePath: true,
  },
  "quenq-static": {
    origin: "https://static.quenq.com",
    assetOrigins: ["https://quenq.com"],
    entry: "/",
    preservePath: true,
  },
  quenq: {
    origin: "https://quenq.com",
    assetOrigins: ["https://static.quenq.com"],
    entry: "/",
    preservePath: true,
  },
  iii: {
    origin: "https://iii.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
  },
  vc: {
    origin: "https://vc.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
  },
  xp: {
    origin: "https://xp.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
  },
};

const ASSET_SEGMENTS =
  "assets|media|img|images|js|css|fonts?|static|icons|favicon\\.(?:ico|svg)|site\\.webmanifest|manifest\\.json|robots\\.txt|apple-touch-icon\\.png";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function rewrite(text: string, key: string, cfg: Cfg, up?: URL): string {
  const prefix = `/api/game-mirror/${key}/`;
  let out = text;
  out = out.replace(new RegExp(esc(cfg.origin) + "/", "g"), prefix);
  for (const o of cfg.assetOrigins ?? []) {
    out = out.replace(new RegExp(esc(o) + "/", "g"), prefix);
  }
  out = out.replace(
    new RegExp(`(["'=(])/(?![/])(${ASSET_SEGMENTS})`, "g"),
    `$1${prefix.slice(0, -1)}/$2`,
  );
  // Neutralise the provider's own top-window self-redirect when framed.
  out = out.replace(
    /window\.location\.replace\(\s*(['"])https?:\/\/[^'"]*quenq\.com\1\s*\)/g,
    "void 0",
  );
  const rip = up ? up.pathname.replace(/[^/]*$/, "") : "/";
  const dirHref = `${prefix}${rip.replace(/^\/+/, "")}`.replace(/\/?$/, "/");
  const isHtml = /<!doctype html/i.test(out) || /<html[\s>]/i.test(out);
  if (isHtml && /<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${dirHref}">`);
  }
  return out;
}

const REWRITABLE =
  /text\/html|javascript|ecmascript|application\/json|text\/css|image\/svg|\+json|text\/plain/;

// A framed DOCUMENT inside our COEP:credentialless shell must itself be
// COEP-isolated, or Chrome fails the frame with
// `coep-frame-resource-needs-coep-header` (net::ERR_BLOCKED_BY_RESPONSE).
// CORP alone is not enough for a nested frame — the response must carry COEP.
// This mirrors the velgg route, which is why velgg framed fine but the mirror
// did not. Non-HTML sub-assets only need CORP, but a single header set is
// simpler and safe for both.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

async function serve(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const raw = u.pathname
    .replace(/^\/api\/game-mirror\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  const slash = raw.indexOf("/");
  const key = slash === -1 ? raw : raw.slice(0, slash);
  const rest = slash === -1 ? "" : raw.slice(slash + 1);

  if (!key || !(key in GAME_MIRROR)) {
    return new Response(JSON.stringify({ error: "Unknown game mirror key" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  const cfg = GAME_MIRROR[key];

  let target: string;
  if (!rest) target = cfg.entry;
  else if (cfg.preservePath) target = "/" + rest;
  else target = cfg.entry.replace(/\/+$/, "") + "/" + rest;

  const upstream = new URL(target, cfg.origin);
  // Forward only the game's own query (e.g. `?part=k`); drop our cache-buster.
  const usp = new URLSearchParams(u.search);
  usp.delete("cb");
  upstream.search = usp.toString();

  try {
    const up = await fetch(upstream.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: cfg.origin + "/",
      },
      redirect: "follow",
    });
    if (!up.ok) return new Response(null, { status: up.status, headers: CORS });

    const ctype = up.headers.get("content-type") || "";
    const headers: Record<string, string> = {
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy":
        "frame-ancestors 'self' https://fuel-app-mobile.vercel.app https://fuel-app-mobile.pages.dev",
      ...CORS,
    };

    if (REWRITABLE.test(ctype)) {
      const body = rewrite(await up.text(), key, cfg, upstream);
      headers["Content-Type"] = ctype || "text/html; charset=utf-8";
      headers["Cache-Control"] = ctype.includes("text/html")
        ? "public, max-age=60"
        : "public, max-age=300";
      return new Response(body, { status: 200, headers });
    }

    headers["Content-Type"] = ctype || "application/octet-stream";
    headers["Cache-Control"] = "public, max-age=3600";
    return new Response(up.body, { status: up.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 160) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  serve(context.request);

export const onRequestHead: PagesFunction<Env> = async (context) =>
  serve(context.request);

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
