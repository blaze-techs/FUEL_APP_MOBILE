/**
 * /api/founder-admin?action=grant|setpw|lookup
 *
 * Consolidated server-side endpoint for Founder Access administration:
 *   ?action=grant   — create/resolve auth user, set password, set founder
 *                     role, upsert profile (grant Founder Access to email)
 *   ?action=setpw   — set password for a uid
 *   ?action=lookup  — resolve email -> uid
 *
 * Security: the caller must be an authenticated founder (Bearer token
 * verified against Supabase Auth + users table role check). The service_role
 * key stays server-side (never in the client bundle).
 *
 * POST body depends on action (see below).
 */

import { supabaseAdmin } from "./_lib/supabase-admin.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

async function json(
  body: Record<string, unknown>,
  status = 200,
): Promise<Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Verify the caller is a founder/admin via their Bearer token. */
async function isFounder(
  token: string,
): Promise<{ ok: boolean; uid?: string }> {
  if (!token || !supabaseAdmin) return { ok: false };
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (error || !user?.id) return { ok: false };
    const { data: rows } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id);
    if (rows?.some((r) => r.role === "founder" || r.role === "admin")) {
      return { ok: true, uid: user.id };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Resolve a Supabase auth uid by email (case-insensitive). */
async function lookupUidByEmail(email: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const target = email.trim().toLowerCase();
  // The admin listUsers API has no server-side email filter, so page through
  // and match client-side (admin context, small user base).
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!supabaseAdmin) {
      return json(
        { success: false, error: "Server is not configured (missing key)" },
        500,
      );
    }

    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const founder = await isFounder(token);
    if (!founder.ok) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    const body = (await request.json()) as Record<string, string | null>;

    if (action === "lookup") {
      const email = body.email;
      if (!email) return json({ uid: null, error: "email required" }, 400);
      const uid = await lookupUidByEmail(email);
      return json({ uid });
    }

    if (action === "setpw") {
      const uid = body.uid;
      const password = body.password;
      if (!uid || !password) {
        return json(
          { success: false, error: "uid and password required" },
          400,
        );
      }
      if (password.length < 8) {
        return json(
          { success: false, error: "Password must be at least 8 characters" },
          400,
        );
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
        password,
        email_confirm: true,
      });
      if (error) {
        return json({ success: false, error: error.message });
      }
      return json({ success: true });
    }

    if (action === "grant") {
      const email = body.email;
      const password = body.password;
      const uniqueId = body.uniqueId ?? null;
      const username = body.username ?? null;
      if (!email || !password) {
        return json(
          { success: false, error: "email and password required" },
          400,
        );
      }
      if (password.length < 8) {
        return json(
          { success: false, error: "Password must be at least 8 characters" },
          400,
        );
      }

      let uid = await lookupUidByEmail(email);
      let created = false;
      if (!uid) {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) {
          return json({
            success: false,
            error: error?.message || "Could not create the auth account",
          });
        }
        uid = data.user.id;
        created = true;
      } else {
        await supabaseAdmin.auth.admin.updateUserById(uid, {
          password,
          email_confirm: true,
        });
      }
      if (!uid) {
        return json({
          success: false,
          error: "Could not find or create the auth account",
        });
      }

      const { error: roleError } = await supabaseAdmin.from("users").upsert(
        {
          id: uid,
          email,
          role: "founder",
          created_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (roleError) {
        return json({
          success: false,
          error: "Account ready but could not set founder role",
          uid,
        });
      }

      try {
        await supabaseAdmin
          .from("profiles")
          .upsert(
            { id: uid, email, unique_id: uniqueId, username },
            { onConflict: "id" },
          );
      } catch {
        // Profile upsert is best-effort — the account + role are the grant.
      }
      return json({ success: true, uid, created });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (err) {
    return json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Server error",
      },
      500,
    );
  }
}
