import { supabaseAdmin } from "./supabase-admin.js";

export type AuthContext = {
  userId: string;
  email?: string;
  globalRole?: string | null;
};

export async function authenticate(request: Request): Promise<AuthContext> {
  if (!supabaseAdmin) throw new Error("Supabase admin client unavailable");
  const token = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token)
    throw Object.assign(new Error("Missing bearer token"), { status: 401 });
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user)
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const { data: global } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return {
    userId: user.id,
    email: user.email,
    globalRole: global?.role ?? null,
  };
}

export async function stationRole(
  stationId: string,
  userId: string,
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data: station } = await supabaseAdmin
    .from("stations")
    .select("owner_id")
    .eq("id", stationId)
    .maybeSingle();
  if (station?.owner_id === userId) return "owner";
  const { data: assigned } = await supabaseAdmin
    .from("station_role_assignments")
    .select("role")
    .eq("station_id", stationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (assigned?.role) return assigned.role;
  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("station_id", stationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return member?.role ?? null;
}

export async function requirePermission(
  ctx: AuthContext,
  stationId: string,
  permission: string,
): Promise<string> {
  if (!supabaseAdmin)
    throw Object.assign(new Error("Server unavailable"), { status: 500 });
  if (ctx.globalRole === "founder" || ctx.globalRole === "admin")
    return ctx.globalRole;
  const role = await stationRole(stationId, ctx.userId);
  if (!role)
    throw Object.assign(new Error("No station access"), { status: 403 });
  const { data: rows, error } = await supabaseAdmin
    .from("fuelpro_role_permissions")
    .select("permission")
    .eq("role", role);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (
    !rows?.some((r: any) => r.permission === "*" || r.permission === permission)
  ) {
    throw Object.assign(new Error(`Missing permission: ${permission}`), {
      status: 403,
    });
  }
  return role;
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

export function errorResponse(error: unknown): Response {
  const e = error as any;
  const status = Number(e?.status) || 500;
  return json({ success: false, error: e?.message || "Server error" }, status);
}
