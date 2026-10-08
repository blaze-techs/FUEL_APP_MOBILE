/**
 * vel.gg (Black Ops Zombies WASM) — same-origin streaming proxy.
 *
 * WHY THIS EXISTS
 * ---------------
 * vel.gg serves a full Black Ops Zombies engine compiled to WebAssembly. It
 * needs `SharedArrayBuffer`, so its pages are cross-origin isolated (COOP
 * same-origin + COEP require-corp). Two hard blockers prevent framing it
 * directly:
 *
 *   1. `Cross-Origin-Resource-Policy: same-origin` on every vel.gg response —
 *      so a cross-origin <iframe> is refused (`ERR_BLOCKED_BY_RESPONSE`).
 *   2. The game's engine + ~136 MB (Boot class) of pack bytes are fetched
 *      relative to the page's own URL, and vel.gg's pack origin (object
 *      storage) only sends `Access-Control-Allow-Origin: https://vel.gg`.
 *
 * This proxy re-serves vel.gg through OUR origin, so the whole thing runs in
 * a same-origin iframe with no redirect and no upstream branding. The game is
 * fully base-relative (`maps.js` derives `BASE` from `import.meta.url`), so
 * serving it under the `/api/velgg/bo1z/` path prefix works unchanged: every
 * asset, worker, manifest and pack request resolves back through this route.
 *
 * ISOLATION
 * ---------
 * The app shell is cross-origin isolated (COOP same-origin + COEP
 * credentialless — see vercel.json / public/_headers). The game iframe is
 * sandboxed (`allow-scripts allow-same-origin`, NO allow-popups /
 * allow-top-navigation) so it cannot redirect the tab. Because this route is
 * same-origin with the isolated parent, it inherits `SharedArrayBuffer` and
 * the engine boots. HTML responses additionally carry COOP+COEP so the
 * document is unambiguously isolated.
 *
 * AD-FREE
 * -------
 * vel.gg has no ad SDK; its only third-party call is an analytics beacon
 * (`telemetry.js` -> `/telemetry`). That ingest endpoint is answered with
 * 204 here so no user data leaves for a third party. Absolute
 * `https://vel.gg` references in HTML/JS are rewritten to this proxy.
 *
 * Routes (dispatcher pattern: `^/api/velgg(?:/(.*))?/?$`):
 *   GET /api/velgg/bo1z/five            -> https://vel.gg/bo1z/five
 *   GET /api/velgg/bo1z/play.js         -> https://vel.gg/bo1z/play.js
 *   GET /api/velgg/bo1z/pack/<path>     -> https://vel.gg/bo1z/pack/<path>  (?part=k forwarded)
 *   GET /api/velgg/bo1z/manifest.json   -> https://vel.gg/bo1z/manifest.json
 */
import { injectWebglShim } from "../../react-app/lib/webgl-capability-shim.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  VELGG_UPSTREAM,
  isAllowedVelggPath,
  isVelggHtmlPath,
  isVelggTelemetryModule,
  isVelggTelemetryEndpoint,
  contentTypeIsHtml,
  isVelggRewritable,
  rewriteVelggBody,
  VELGG_TELEMETRY_STUB,
} from "./_lib/velgg-proxy.js";

interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
}
interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
}

function wrapRes(res: ServerResponse): ApiResponse {
  const r = res as ApiResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  return r;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const r = wrapRes(res);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const query = (req as ApiRequest).query || {};
  const rawPath = String(query.path || "").replace(/^\/+|\/+$/g, "");
  if (!isAllowedVelggPath(rawPath)) {
    r.status(400);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid vel.gg path" }));
    return;
  }

  // Serve the analytics module as a no-op stub (keeps the exports the game
  // imports, sends nothing), and answer the ingest endpoint with 204.
  if (isVelggTelemetryModule(rawPath)) {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(VELGG_TELEMETRY_STUB);
    return;
  }
  if (isVelggTelemetryEndpoint(rawPath)) {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Preserve the game's own query string (pack `?part=k`, worker `?map=`…).
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k === "path" || k.startsWith("[...")) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.append(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const upstreamUrl = `${VELGG_UPSTREAM}/${rawPath}${suffix}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        // Ask for UNENCODED bytes: vel.gg serves pack parts Brotli-encoded
        // with an ENCODED Content-Length, and fetch() re-inflates the body
        // while leaving that length in place — forwarding it truncates the
        // stream (and breaks the engine's per-part SHA-256 check).
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${VELGG_UPSTREAM}/bo1z`,
      },
      redirect: "follow",
    });

    if (!upstreamRes.ok) {
      r.status(upstreamRes.status);
      res.end();
      return;
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    const isHtml = contentTypeIsHtml(contentType) || isVelggHtmlPath(rawPath);

    // Cross-origin isolated document (harmless on sub-resources, required on
    // the game HTML for SharedArrayBuffer).
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

    if (isHtml && isVelggRewritable(contentType || "text/html")) {
      const html = injectWebglShim(rewriteVelggBody(await upstreamRes.text()));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.end(html);
      return;
    }

    if (isVelggRewritable(contentType) && !rawPath.includes("/pack/")) {
      // JS/JSON/manifest: rewrite upstream absolutes, then serve.
      const body = rewriteVelggBody(await upstreamRes.text());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.end(body);
      return;
    }

    // Binary (pack parts, images, audio) — STREAM, never buffer (some files
    // are tens of MB; buffering would blow the function memory + timeout).
    if (contentType) res.setHeader("Content-Type", contentType);
    // The upstream serves pack parts Brotli-encoded and fetch() re-inflates the
    // body while leaving the ENCODED `content-length` header in place. Forwarding
    // that length would truncate the decoded stream, so only pass it through when
    // the upstream did not compress (identity / range responses).
    const upstreamEncoding = upstreamRes.headers.get("content-encoding");
    const len = upstreamRes.headers.get("content-length");
    if (len && !upstreamEncoding) res.setHeader("Content-Length", len);
    const range = upstreamRes.headers.get("content-range");
    if (range) res.setHeader("Content-Range", range);
    if (upstreamRes.headers.get("accept-ranges"))
      res.setHeader("Accept-Ranges", upstreamRes.headers.get("accept-ranges")!);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const body = upstreamRes.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      res.end();
      return;
    }
    Readable.fromWeb(body as ReadableStream).pipe(res);
  } catch (err) {
    console.error("[velgg] proxy error:", err);
    r.status(502);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "vel.gg upstream unreachable" }));
  }
}
