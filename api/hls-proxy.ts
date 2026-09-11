/**
 * HLS Proxy
 *
 * Solves the CORS problem: most upstream HLS streams (.m3u8 + .ts segments)
 * do NOT send Access-Control-Allow-Origin headers, so hls.js in the browser
 * cannot fetch them cross-origin. This serverless proxy fetches the stream
 * server-side (no CORS restriction), rewrites playlist URLs to route through
 * the proxy, and returns everything with permissive CORS headers.
 *
 * GET /api/hls-proxy?url=<encoded HLS URL>
 *
 * - .m3u8 playlists: rewritten so all relative + absolute URLs go through
 *   /api/hls-proxy?url=<encoded> (keeps multi-bitrate master playlists working).
 * - .ts / .aac / .mp4 / .key segments: passed through with CORS headers.
 *
 * The client NEVER sees the upstream hostname — all requests go through
 * /api/hls-proxy.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { Readable } from "node:stream";

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

function parseQuery(req: IncomingMessage): Record<string, string | string[]> {
  const fullUrl = req.url || "";
  const searchIdx = fullUrl.indexOf("?");
  if (searchIdx < 0) return {};
  return Object.fromEntries(new URLSearchParams(fullUrl.slice(searchIdx + 1)));
}

/** Rewrite a URL found inside a .m3u8 playlist to route through the proxy. */
function rewritePlaylistUrl(
  rawUrl: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("#")) return rawUrl;

  // Resolve relative URLs against the playlist's own URL
  let absolute: string;
  try {
    absolute = new URL(trimmed, baseUrl).href;
  } catch {
    return rawUrl;
  }

  // Already a proxy URL? Leave it.
  if (absolute.includes("/api/hls-proxy")) return rawUrl;

  return `${proxyOrigin}/api/hls-proxy?url=${encodeURIComponent(absolute)}`;
}

/**
 * Rewrite all URLs in an HLS playlist (.m3u8) to route through the proxy.
 * Handles:
 *  - #EXT-X-KEY URI="..."  (encryption keys)
 *  - #EXT-X-MEDIA URI="..."  (alternate audio/subtitle tracks)
 *  - #EXT-X-STREAM-INF followed by a URL  (master playlist variants)
 *  - Bare segment URLs  (media playlist segments)
 */
function rewritePlaylist(
  content: string,
  playlistUrl: string,
  proxyOrigin: string,
): string {
  const lines = content.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rewrite URI="..." inside tag lines (KEY, MEDIA, etc.)
    if (line.startsWith("#") && line.includes('URI="')) {
      const replaced = line.replace(
        /URI="([^"]+)"/g,
        (_match, url: string) =>
          `URI="${rewritePlaylistUrl(url, playlistUrl, proxyOrigin)}"`,
      );
      out.push(replaced);
      continue;
    }

    // Bare URL line (segment or variant playlist)
    if (!line.startsWith("#") && line.trim()) {
      out.push(rewritePlaylistUrl(line, playlistUrl, proxyOrigin));
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const r = wrapRes(res);
  const query = parseQuery(req);
  (req as ApiRequest).query = query;

  // CORS headers — allow ALL origins (the proxy is read-only, public streams)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const targetUrl = query.url as string;
  if (!targetUrl) {
    res.setHeader("Content-Type", "application/json");
    r.status(400);
    res.end(JSON.stringify({ error: "Missing url parameter" }));
    return;
  }

  // Determine the proxy origin (for rewriting playlist URLs)
  const host = req.headers.host || "fuel-app-mobile.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const proxyOrigin = `${proto}://${host}`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    if (!upstreamRes.ok) {
      r.status(upstreamRes.status);
      res.end();
      return;
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    const isPlaylist =
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegurl") ||
      targetUrl.includes(".m3u8");

    if (isPlaylist) {
      // It's an HLS playlist — rewrite URLs to route through the proxy
      const text = await upstreamRes.text();
      const rewritten = rewritePlaylist(text, targetUrl, proxyOrigin);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "public, max-age=5");
      res.end(rewritten);
    } else {
      // Binary content (segment, MP3, icecast, etc.) — STREAM THROUGH without
      // buffering. Never use arrayBuffer/Buffer.from on the body — live MP3
      // streams are unbounded and buffering them hangs the response forever
      // (root cause of the silent radio dead-stream). Readable.fromWeb
      // converts the WHATWG ReadableStream (fetch body in Node 22) to a
      // Node Readable and pipes it through.
      const body = upstreamRes.body as ReadableStream<Uint8Array> | null;

      // Forward the content-type so the player knows how to decode it
      if (contentType) res.setHeader("Content-Type", contentType);
      // Allow range requests for seeking
      const len = upstreamRes.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      const range = upstreamRes.headers.get("content-range");
      if (range) res.setHeader("Content-Range", range);
      res.setHeader("Accept-Ranges", "bytes");

      if (!body) {
        res.end();
        return;
      }
      Readable.fromWeb(body as ReadableStream).pipe(res);
    }
  } catch (err) {
    console.error("[hls-proxy] error:", err);
    r.status(502);
    res.end();
  }
}
