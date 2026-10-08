/**
 * vel.gg (Black Ops Zombies WASM) — same-origin streaming proxy (Cloudflare
 * Pages Function).
 *
 * Same purpose as the Vercel handler `src/server/vercel-api/velgg.ts`: re-serve
 * vel.gg through our own origin so the "VIDEO GAMES" tab can iframe the real
 * WebAssembly port with no redirect, no upstream branding and no cross-origin
 * CORP block. Cloudflare Pages bundles each Function independently (no
 * cross-file imports), so the helper logic from
 * `src/server/vercel-api/_lib/velgg-proxy.ts` is inlined here — keep in sync.
 *
 * Route: /api/velgg/<bo1z-path>  ->  https://vel.gg/<bo1z-path>
 */

const UPSTREAM = "https://vel.gg";
const ALLOWED_PREFIX = "bo1z";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function isAllowed(rawPath: string): boolean {
  const p = rawPath.replace(/^\/+|\/+$/g, "");
  if (!p) return false;
  if (p !== ALLOWED_PREFIX && !p.startsWith(ALLOWED_PREFIX + "/")) return false;
  if (p.includes("..") || p.includes("//")) return false;
  return true;
}
function isHtmlPath(rawPath: string): boolean {
  const p = rawPath.replace(/^\/+|\/+$/g, "");
  if (p === ALLOWED_PREFIX) return true;
  if (/^bo1z\/[a-z0-9-]+$/.test(p)) return true;
  return /\.html?$/i.test(p);
}
function rewritable(ct: string | null): boolean {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return (
    c.includes("text/html") ||
    c.includes("javascript") ||
    c.includes("ecmascript") ||
    c.includes("application/json")
  );
}
const TELEMETRY_STUB =
  "export function frameStats(){return {};}\n" +
  "export function startTelemetry(){/* analytics disabled */}\n";

function rewriteBody(body: string): string {
  // NOTE: only rewrite ABSOLUTE vel.gg URLs. Blanket-rewriting `/telemetry`
  // corrupts the relative module specifier `./telemetry.js` (it contains the
  // substring) and the whole ES module graph fails to load. The analytics
  // module is served as TELEMETRY_STUB instead.
  return body.replace(/https?:\/\/vel\.gg\//g, "/api/velgg/");
}
function isTelemetryModule(rawPath: string): boolean {
  return /(^|\/)telemetry\.js$/i.test(rawPath.replace(/^\/+|\/+$/g, ""));
}
function isTelemetryEndpoint(rawPath: string): boolean {
  return /(^|\/)telemetry$/i.test(rawPath.replace(/^\/+|\/+$/g, ""));
}

interface Ctx {
  request: Request;
  params: { path?: string | string[] };
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, params } = context;
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const rawPath = (
    Array.isArray(params.path) ? params.path.join("/") : params.path || ""
  ).replace(/^\/+|\/+$/g, "");

  if (!isAllowed(rawPath)) {
    return new Response(JSON.stringify({ error: "Invalid vel.gg path" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (isTelemetryModule(rawPath)) {
    return new Response(TELEMETRY_STUB, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }
  if (isTelemetryEndpoint(rawPath)) {
    return new Response(null, { status: 204, headers: cors });
  }

  const incoming = new URL(request.url);
  const upstreamUrl = `${UPSTREAM}/${rawPath}${incoming.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        // Ask for UNENCODED bytes: vel.gg serves pack parts Brotli-encoded
        // with an ENCODED Content-Length, and the runtime re-inflates the body
        // while leaving that length in place — forwarding it truncates the
        // stream (and breaks the engine's per-part SHA-256 check).
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${UPSTREAM}/bo1z`,
        ...(request.headers.get("range")
          ? { Range: request.headers.get("range") as string }
          : {}),
      },
      redirect: "follow",
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "vel.gg upstream unreachable" }),
      {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }

  const headers = new Headers(cors);
  const ct = upstream.headers.get("content-type");
  // Isolated document (needed on the game HTML for SharedArrayBuffer).
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");

  const isHtml = (ct && ct.includes("text/html")) || isHtmlPath(rawPath);
  if (isHtml && rewritable(ct || "text/html")) {
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=60");
    return new Response(rewriteBody(await upstream.text()), {
      status: upstream.status,
      headers,
    });
  }
  if (rewritable(ct) && !rawPath.includes("/pack/")) {
    if (ct) headers.set("Content-Type", ct);
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(rewriteBody(await upstream.text()), {
      status: upstream.status,
      headers,
    });
  }

  // Binary — stream straight through (never buffer multi-MB pack parts).
  if (ct) headers.set("Content-Type", ct);
  // Pack parts arrive Brotli-encoded; the runtime re-inflates the body but the
  // upstream `content-length` still describes the ENCODED size. Forwarding it
  // would truncate the decoded stream — only pass it when not compressed.
  const upstreamEncoding = upstream.headers.get("content-encoding");
  const len = upstream.headers.get("content-length");
  if (len && !upstreamEncoding) headers.set("Content-Length", len);
  const range = upstream.headers.get("content-range");
  if (range) headers.set("Content-Range", range);
  const ar = upstream.headers.get("accept-ranges");
  if (ar) headers.set("Accept-Ranges", ar);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
};
