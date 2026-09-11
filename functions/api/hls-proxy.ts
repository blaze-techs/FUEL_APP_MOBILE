/**
 * Cloudflare Pages Function — HLS CORS Proxy
 *
 * Same purpose as /api/hls-proxy.ts (Vercel): upstream HLS streams
 * (.m3u8 + .ts) do NOT send Access-Control-Allow-Origin, so hls.js
 * cannot fetch them cross-origin. This proxy fetches server-side,
 * rewrites playlist URLs to route through the proxy, and returns
 * with permissive CORS headers.
 *
 * Lives at functions/api/hls-proxy.ts → accessible at /api/hls-proxy
 * on Cloudflare Pages (same-origin as the SPA — zero CORS issues).
 *
 * GET /api/hls-proxy?url=<encoded HLS URL>
 */

interface Env {
  // Cloudflare bindings (none needed for this function)
}

/** Rewrite a URL found inside a .m3u8 playlist to route through the proxy. */
function rewritePlaylistUrl(
  rawUrl: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("#")) return rawUrl;

  let absolute: string;
  try {
    absolute = new URL(trimmed, baseUrl).href;
  } catch {
    return rawUrl;
  }

  if (absolute.includes("/api/hls-proxy")) return rawUrl;

  return `${proxyOrigin}/api/hls-proxy?url=${encodeURIComponent(absolute)}`;
}

/** Rewrite all URLs in an HLS playlist (.m3u8) to route through the proxy. */
function rewritePlaylist(
  content: string,
  playlistUrl: string,
  proxyOrigin: string,
): string {
  const lines = content.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("#") && line.includes('URI="')) {
      const replaced = line.replace(
        /URI="([^"]+)"/g,
        (_match, url: string) =>
          `URI="${rewritePlaylistUrl(url, playlistUrl, proxyOrigin)}"`,
      );
      out.push(replaced);
      continue;
    }

    if (!line.startsWith("#") && line.trim()) {
      out.push(rewritePlaylistUrl(line, playlistUrl, proxyOrigin));
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request } = context;

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Determine the proxy origin (for rewriting playlist URLs)
  // Use the request's own origin so rewritten URLs stay same-origin
  const proxyOrigin = `${url.protocol}//${url.host}`;

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
      return new Response(null, {
        status: upstreamRes.status,
        headers: corsHeaders,
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    const isPlaylist =
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegurl") ||
      targetUrl.includes(".m3u8");

    if (isPlaylist) {
      const text = await upstreamRes.text();
      const rewritten = rewritePlaylist(text, targetUrl, proxyOrigin);

      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "public, max-age=5",
          ...corsHeaders,
        },
      });
    } else {
      // Segment / MP3 / icecast / other binary content — STREAM THROUGH
      // (pass the upstream body directly without buffering, so live streams
      // like MP3 radio begin playing immediately instead of hanging forever
      // while awaiting arrayBuffer() on an unbounded live stream).
      const upstreamHeaders = upstreamRes.headers;
      const responseHeaders: Record<string, string> = { ...corsHeaders };

      if (contentType) responseHeaders["Content-Type"] = contentType;
      responseHeaders["Accept-Ranges"] = "bytes";

      const len = upstreamHeaders.get("content-length");
      if (len) responseHeaders["Content-Length"] = len;
      const range = upstreamHeaders.get("content-range");
      if (range) responseHeaders["Content-Range"] = range;

      // Pass the upstream stream through (no internal buffering).
      return new Response(upstreamRes.body, {
        status: 200,
        headers: responseHeaders,
      });
    }
  } catch (err) {
    console.error("[hls-proxy] error:", err);
    return new Response(null, {
      status: 502,
      headers: corsHeaders,
    });
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};
