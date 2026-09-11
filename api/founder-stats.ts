/**
 * /api/founder-stats
 *
 * Returns the global list of users + stations for the Founder Console.
 *
 * The founder panel runs in a Supabase-only SPA whose tRPC client has no
 * backend (every procedure is a runtime no-op returning null), so the
 * "All Users" / "All Stations" counts were always 0. This endpoint fills
 * that gap: it uses the service_role key to read across ALL owners (RLS
 * would otherwise scope each user to their own rows), but ONLY after
 * verifying the caller's Supabase Auth JWT belongs to a founder/admin in
 * the `users` table.
 *
 * Request:
 *   Authorization: Bearer <supabase access_token>
 *
 * Response 200: { success, users: AppUser[], stations: StationRecord[] }
 * Response 401/403: not authenticated / not a founder
 *
 * The service_role key stays server-side (process.env); it is never in the
 * client bundle.
 */

import { supabaseAdmin } from "./_lib/supabase-admin.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

export async function GET(request: Request): Promise<Response> {
  // 1) Authenticate the caller via their Supabase access token.
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return json({ success: false, error: "Not authenticated" }, 401);
  }
  if (!supabaseAdmin) {
    return json(
      {
        success: false,
        error: "Server not configured (missing service role key)",
      },
      500,
    );
  }

  // Verify the JWT and resolve the auth uid. We use the admin client's
  // auth.getUser(token) — it validates the token against Supabase Auth.
  const {
    data: { user },
    error: userErr,
  } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !user) {
    return json({ success: false, error: "Invalid or expired token" }, 401);
  }

  // 2) Authorize: the caller must be a founder/admin in the `users` table.
  const { data: callerRow, error: callerErr } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const callerRole =
    callerRow?.role || (user.user_metadata?.role as string | undefined);
  if (callerErr || (callerRole !== "founder" && callerRole !== "admin")) {
    return json(
      { success: false, error: "This account does not have Founder access" },
      403,
    );
  }

  // 3) Fetch ALL users. The `profiles` table holds every signed-up user
  //    (created by the handle_new_user trigger on auth.users INSERT). The
  //    `users` table holds founder/admin role bindings only. A regular user
  //    who signs up has a profiles row but NO users row — so querying only
  //    `users` would miss them entirely from the Founder Console.
  //    We use profiles as the base (all users) and LEFT JOIN users for role.
  const { data: profilesRows, error: profilesErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email, name, username, unique_id, created_at")
    .order("created_at", { ascending: false });

  const { data: usersRows, error: usersErr } = await supabaseAdmin
    .from("users")
    .select("id, email, name, role, created_at, last_sign_in_at");

  // Build a role map from the users table (founder/admin bindings).
  const roleById = new Map<string, string>();
  for (const u of usersRows || []) {
    roleById.set(String(u.id), u.role || "user");
  }

  // Build the unified users list: every profile, enriched with role +
  // last_sign_in_at from the users table where available.
  const lastSignInById = new Map<string, string>();
  for (const u of usersRows || []) {
    if (u.last_sign_in_at) {
      lastSignInById.set(String(u.id), u.last_sign_in_at);
    }
  }

  const users = (profilesRows || []).map((p: any) => {
    return {
      id: p.id,
      email: p.email || "",
      name: p.name || "Unknown",
      role: roleById.get(String(p.id)) || "user",
      createdAt: p.created_at,
      lastSignInAt: lastSignInById.get(String(p.id)) || null,
    };
  });

  // 4) Fetch ALL stations (service_role bypasses the per-owner RLS).
  const { data: stationsRows, error: stationsErr } = await supabaseAdmin
    .from("stations")
    .select(
      "id, name, owner_id, created_by, location, created_at, updated_at, code, currency, country",
    )
    .order("created_at", { ascending: false });

  if (stationsErr) {
    return json({ success: false, error: stationsErr.message, users }, 500);
  }
  if (profilesErr) {
    // Non-fatal: return stations with whatever users we have.
    console.warn("[founder-stats] profiles query error:", profilesErr.message);
  }
  if (usersErr) {
    // Non-fatal: role bindings unavailable; all users default to "user".
    console.warn("[founder-stats] users query error:", usersErr.message);
  }

  const ownerNameById = new Map<string, string>();
  for (const u of users) {
    ownerNameById.set(String(u.id), u.name);
  }

  // 5) Fetch revenue per station from sales_enhanced (sum of total_amount).
  //    service_role bypasses RLS so we get cross-owner totals.
  //    Note: sales_enhanced has no currency column; we use the station's currency.
  const { data: revenueRows, error: revenueErr } = await supabaseAdmin
    .from("sales_enhanced")
    .select("station_id, total_amount");

  // Build a map: station_id -> totalRevenue
  const revenueByStation = new Map<string, number>();
  if (!revenueErr && revenueRows) {
    for (const r of revenueRows) {
      const sid = String(r.station_id);
      const existing = revenueByStation.get(sid) || 0;
      revenueByStation.set(sid, existing + (Number(r.total_amount) || 0));
    }
  } else if (revenueErr) {
    console.warn(
      "[founder-stats] sales_enhanced query error:",
      revenueErr.message,
    );
  }

  // Also fetch from legacy sales table (total column) as fallback
  const { data: legacySalesRows, error: legacySalesErr } = await supabaseAdmin
    .from("sales")
    .select("station_id, total");

  if (!legacySalesErr && legacySalesRows) {
    for (const r of legacySalesRows) {
      const sid = String(r.station_id);
      const existing = revenueByStation.get(sid) || 0;
      revenueByStation.set(sid, existing + (Number(r.total) || 0));
    }
  }

  const stations = (stationsRows || []).map((s: any) => {
    const sid = String(s.id);
    return {
      id: s.id,
      name: s.name || "Unnamed Station",
      ownerId: s.owner_id || s.created_by || "",
      ownerName:
        ownerNameById.get(String(s.owner_id || s.created_by)) || "Owner",
      location: s.location || "Unknown",
      members: 1,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      code: s.code || "",
      currency: s.currency || "USD",
      country: s.country || "",
      revenue: revenueByStation.get(sid) || 0,
    };
  });

  // Compute total revenue across all stations.
  const totalRevenue = stations.reduce((sum, s) => sum + (s.revenue || 0), 0);

  // 6) Sales analytics: byFuelType, totalSales, avgSale.
  //    Fetch sale_items (fuel_type, quantity, total_price) across all stations
  //    (service_role bypasses RLS). Fall back to sales_enhanced if sale_items
  //    is empty or doesn't exist.
  const byFuelTypeMap = new Map<string, { liters: number; revenue: number }>();

  const { data: saleItemsRows, error: saleItemsErr } = await supabaseAdmin
    .from("sale_items")
    .select("fuel_type, quantity, total_price");

  if (!saleItemsErr && saleItemsRows) {
    for (const si of saleItemsRows) {
      const ft = String(si.fuel_type || "Other");
      const qty = Number(si.quantity) || 0;
      const amt = Number(si.total_price) || 0;
      const existing = byFuelTypeMap.get(ft) || { liters: 0, revenue: 0 };
      existing.liters += qty;
      existing.revenue += amt;
      byFuelTypeMap.set(ft, existing);
    }
  }

  // Also aggregate from sales_enhanced for totalSales count.
  const { count: salesCount, error: salesCountErr } = await supabaseAdmin
    .from("sales_enhanced")
    .select("*", { count: "exact", head: true });

  const totalSales = salesCountErr ? 0 : salesCount || 0;
  const avgSale = totalSales > 0 ? totalRevenue / totalSales : 0;

  const byFuelType = Array.from(byFuelTypeMap.entries()).map(
    ([fuelType, data]) => ({
      fuelType,
      liters: data.liters,
      revenue: data.revenue,
    }),
  );

  return json(
    {
      success: true,
      users,
      stations,
      totalRevenue,
      // Analytics data for the Analytics section
      analytics: {
        totalRevenue,
        totalSales,
        avgSale,
        byFuelType,
        stationCount: stations.length,
      },
    },
    200,
    // 60s CDN cache — founder stats don't need to be real-time to the second.
    { "Cache-Control": "no-store" },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
