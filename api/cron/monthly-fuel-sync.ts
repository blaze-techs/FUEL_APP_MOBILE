/**
 * /api/cron/monthly-fuel-sync
 *
 * Vercel Cron target (schedule "0 0 1 * *" — 1st of every month at 00:00 UTC,
 * configured in vercel.json). Silently refreshes the top-N most-queried
 * locations in the fuel_prices cache so users always see current prices
 * without each user re-paying the Serper/AI quota.
 *
 * Security: the endpoint only runs when the Authorization header matches
 * `Bearer <CRON_SECRET>`. Vercel Cron automatically injects this header.
 * Manual invocation also works: curl -H "Authorization: Bearer $CRON_SECRET"
 *     https://fuel-app-mobile.vercel.app/api/cron/monthly-fuel-sync
 *
 * Query params (optional, for manual runs):
 *   limit  — number of top locations to refresh (default 50)
 */

import { refreshTopLocations } from "../_lib/fuel-engine.js";

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;

  if (!expected || authHeader !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1),
    200,
  );

  try {
    const updated = await refreshTopLocations(limit);
    return new Response(
      JSON.stringify({
        success: true,
        refreshed: updated,
        limit,
        ranAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
