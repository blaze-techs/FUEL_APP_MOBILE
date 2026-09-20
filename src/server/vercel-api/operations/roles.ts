import {
  authenticate,
  errorResponse,
  json,
  requirePermission,
} from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

const roles = [
  "owner",
  "manager",
  "supervisor",
  "cashier",
  "attendant",
  "accountant",
  "auditor",
] as const;
const roleRank: Record<string, number> = {
  auditor: 10,
  attendant: 20,
  cashier: 30,
  accountant: 40,
  supervisor: 50,
  manager: 60,
  owner: 70,
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

async function authorizeRoleMutation(
  ctx: Awaited<ReturnType<typeof authenticate>>,
  stationId: string,
  targetRole: string,
) {
  const actorRole = await requirePermission(ctx, stationId, "station.write");
  // Only a station owner can grant owner; in normal station operation owner is
  // the highest role and ownership should be transferred through a dedicated
  // ownership workflow, never through a generic role assignment endpoint.
  if (targetRole === "owner") {
    throw Object.assign(
      new Error("Owner cannot be assigned through the role endpoint"),
      { status: 403 },
    );
  }
  if (actorRole !== "founder" && actorRole !== "admin") {
    const actorRank = roleRank[actorRole] ?? 0;
    const targetRank = roleRank[targetRole] ?? 0;
    if (!actorRank || targetRank >= actorRank) {
      throw Object.assign(
        new Error("You may only assign roles below your own role"),
        { status: 403 },
      );
    }
  }
  return actorRole;
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const stationId = clean(new URL(request.url).searchParams.get("stationId"));
    if (!stationId)
      throw Object.assign(new Error("stationId is required"), { status: 400 });
    await requirePermission(ctx, stationId, "station.read");
    const { data, error } = await supabaseAdmin
      .from("station_role_assignments")
      .select("station_id,user_id,role,is_active,granted_at,granted_by")
      .eq("station_id", stationId)
      .eq("is_active", true);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    return json({ success: true, data: data || [] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body = (await request.json()) as Record<string, unknown>;
    const stationId = clean(body.stationId);
    const userId = clean(body.userId);
    const targetRole = clean(body.role).toLowerCase();
    if (!stationId)
      throw Object.assign(new Error("stationId is required"), { status: 400 });
    if (!userId)
      throw Object.assign(new Error("userId is required"), { status: 400 });
    if (!(roles as readonly string[]).includes(targetRole)) {
      throw Object.assign(new Error("Invalid station role"), { status: 400 });
    }

    await authorizeRoleMutation(ctx, stationId, targetRole);

    const { data: targetUser, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !targetUser.user) {
      throw Object.assign(new Error("Target user does not exist"), {
        status: 404,
      });
    }

    // A generic role assignment must never create a second owner or silently
    // reactivate a revoked account without an explicit request.
    if (targetRole === "owner") {
      throw Object.assign(
        new Error("Owner cannot be assigned through the role endpoint"),
        { status: 403 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("station_role_assignments")
      .upsert(
        {
          station_id: stationId,
          user_id: userId,
          role: targetRole,
          is_active: body.isActive !== false,
          granted_by: ctx.userId,
          granted_at: new Date().toISOString(),
        },
        { onConflict: "station_id,user_id" },
      )
      .select("*")
      .single();

    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin)
      throw Object.assign(new Error("Server unavailable"), { status: 500 });
    const ctx = await authenticate(request);
    const body = (await request.json()) as Record<string, unknown>;
    const stationId = clean(body.stationId);
    const userId = clean(body.userId);
    if (!stationId || !userId)
      throw Object.assign(new Error("stationId and userId are required"), {
        status: 400,
      });

    const actorRole = await requirePermission(ctx, stationId, "station.write");
    if (actorRole !== "founder" && actorRole !== "admin") {
      const targetRole = await (async () => {
        const { data } = await supabaseAdmin
          .from("station_role_assignments")
          .select("role")
          .eq("station_id", stationId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        return data?.role ? String(data.role) : null;
      })();
      const actorRank = roleRank[actorRole] ?? 0;
      const targetRank = roleRank[targetRole || ""] ?? 0;
      if (!targetRole || targetRole === "owner" || targetRank >= actorRank) {
        throw Object.assign(
          new Error("You may only revoke roles below your own role"),
          { status: 403 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("station_role_assignments")
      .update({ is_active: false })
      .eq("station_id", stationId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .select("*")
      .maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
