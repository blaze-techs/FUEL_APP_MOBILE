import type { IncomingMessage, ServerResponse } from "node:http";

type RequestLike = IncomingMessage & { body?: unknown };

const SOURCE_URL =
  "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md";
const MAX_CATALOG_BYTES = 2_500_000;
const CACHE_SECONDS = 3600;

/**
 * Public API catalogue endpoint.
 *
 * This exposes the upstream directory as a catalogue, not as a blanket proxy
 * for arbitrary third-party APIs. Providers still require their own terms,
 * credentials, quotas, and purpose-specific integration.
 */
export default async function handler(req: RequestLike, res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Vary", "Accept");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: "GET required" }));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(SOURCE_URL, {
      method: "GET",
      headers: { Accept: "text/plain", "User-Agent": "FuelPro-Public-API-Catalogue" },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      res.statusCode = 502;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, error: "Public API catalogue source is temporarily unavailable" }));
      return;
    }

    const text = await upstream.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) {
      res.statusCode = 502;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, error: "Catalogue source exceeded the permitted size" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.end(req.method === "HEAD" ? undefined : text);
  } catch {
    res.statusCode = 502;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: "Unable to retrieve the public API catalogue" }));
  } finally {
    clearTimeout(timeout);
  }
}
