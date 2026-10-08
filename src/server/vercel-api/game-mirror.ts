/**
 * Generic same-origin game mirror — Vercel (Node) handler.
 *
 * Re-serves a frame-blocking game provider through our own origin so the
 * "Video Games" tab can play it in the iframe (no new tab, no redirect).
 * Dispatcher pattern: `^/api/game-mirror(?:/(.*))?/?$`, `path` = `<key>/<rest>`.
 *
 *   GET /api/game-mirror/parkbaron        -> https://parkbaron.com/play
 *   GET /api/game-mirror/parkbaron/assets/x.js -> https://parkbaron.com/play/assets/x.js
 *   GET /api/game-mirror/quenq-static/apps/minecraft/app -> static.quenq.com/…
 *
 * Policies: strips upstream X-Frame-Options/CSP and sets SAMEORIGIN +
 * `frame-ancestors 'self'` (so only our own pages may frame it), forwards the
 * real User-Agent, and rewrites text bodies to stay same-origin.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  mirrorUpstream,
  isKnownMirrorKey,
  mirrorConfig,
  rewriteMirrorBody,
  mirrorRewritable,
} from "./_lib/game-mirror.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
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
  const slash = rawPath.indexOf("/");
  const key = slash === -1 ? rawPath : rawPath.slice(0, slash);
  const rest = slash === -1 ? "" : rawPath.slice(slash + 1);

  if (!key || !isKnownMirrorKey(key)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unknown game mirror key" }));
    return;
  }
  const cfg = mirrorConfig(key)!;

  // Preserve the game's own query string (e.g. `?map=`, cache-bust params).
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k === "path" || k.startsWith("[...")) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.append(k, v);
  }

  const upstream = mirrorUpstream(key, rest, qs.toString());
  if (!upstream) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Bad mirror request" }));
    return;
  }

  try {
    const upstreamRes = await fetch(upstream.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        // Ask for unencoded bytes — some origins send an ENCODED
        // Content-Length while fetch() re-inflates the body, which would
        // truncate the stream if forwarded.
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: cfg.origin + "/",
      },
      redirect: "follow",
    });

    if (!upstreamRes.ok) {
      res.statusCode = upstreamRes.status;
      res.end();
      return;
    }

    // Embedding policy: OUR frame-ancestors + SAMEORIGIN, overriding whatever
    // the upstream sent (we never copy its XFO/CSP).
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://fuel-app-mobile.vercel.app https://fuel-app-mobile.pages.dev",
    );

    const contentType = upstreamRes.headers.get("content-type") || "";

    if (mirrorRewritable(contentType)) {
      const text = await upstreamRes.text();
      const body = rewriteMirrorBody(text, key, cfg, upstream);
      res.setHeader("Content-Type", contentType || "text/html; charset=utf-8");
      res.setHeader(
        "Cache-Control",
        contentType.includes("text/html")
          ? "public, max-age=60"
          : "public, max-age=300",
      );
      res.end(body);
      return;
    }

    // Binary (wasm, images, audio) — stream, never buffer.
    if (contentType) res.setHeader("Content-Type", contentType);
    const upstreamEncoding = upstreamRes.headers.get("content-encoding");
    const len = upstreamRes.headers.get("content-length");
    if (len && !upstreamEncoding) res.setHeader("Content-Length", len);
    const range = upstreamRes.headers.get("content-range");
    if (range) res.setHeader("Content-Range", range);
    if (upstreamRes.headers.get("accept-ranges"))
      res.setHeader("Accept-Ranges", upstreamRes.headers.get("accept-ranges")!);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const body = upstreamRes.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      res.end();
      return;
    }
    Readable.fromWeb(body as ReadableStream).pipe(res);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err).slice(0, 160) }));
  }
}
