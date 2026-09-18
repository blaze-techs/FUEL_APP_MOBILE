/**
 * /api/fuel-local
 *
 * Returns hyper-local fuel prices for the caller's GPS coordinates.
 * Delegates to the fuel-engine (reverse-geocode → cache → web search →
 * AI parse → PostGIS nearest-neighbour fallback).
 *
 * Query params:
 *   lat  (required) — latitude
 *   lon  (required) — longitude
 *
 * Response 200: LocalFuelPrices JSON
 * Response 400: missing/invalid coords
 * Response 500: engine error (no data available for the region)
 *
 * All third-party keys (Supabase service role, Serper, Groq/OpenRouter)
 * stay server-side. The client only sees the parsed result.
 */

import { getLocalFuelPrices } from "./_lib/fuel-engine.js";

// CORS headers — allow the Cloudflare Pages mirror (and any origin) to call
// this endpoint cross-origin. Without these, the browser blocks the fetch.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Missing or invalid 'lat' / 'lon' query parameters.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }

  try {
    const data = await getLocalFuelPrices(lat, lon);
    return new Response(
      JSON.stringify({
        success: true,
        // Expose the resolved village/town name under both `locationName`
        // (what the frontend reads) and `location` (the engine's field).
        ...data,
        locationName: data.location,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Brief CDN cache (5 min) keyed by lat/lon — the engine itself has a
          // 14-day DB cache, this just absorbs burst traffic for the same spot.
          "Cache-Control": "public, max-age=300, s-maxage=300",
          ...CORS_HEADERS,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message, lat, lon }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }
}

// Handle CORS preflight requests from cross-origin hosts (e.g. Cloudflare).
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
