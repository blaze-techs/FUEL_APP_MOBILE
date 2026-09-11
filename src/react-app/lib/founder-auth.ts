/**
 * Founder Authentication - Supabase Backend
 *
 * All authentication uses Supabase Auth with proper security.
 * Founder access requires special role in the users table.
 */

import { getSupabaseClient } from "@/supabase/client";

const TOKEN_KEY = "fuelpro_founder_token";
const SESSION_META_KEY = "fuelpro_founder_session_meta";

// Translate Supabase auth-email rate-limit errors into a friendly message.
// Kept in sync with AuthContext's friendlyAuthEmailError.
function friendlyAuthEmailError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("email rate limit") ||
    m.includes("rate limit exceeded") ||
    m.includes("for security purposes, you can only request") ||
    m.includes("you can only request this after") ||
    m.includes("429")
  ) {
    return "Too many emails sent. For security, Supabase limits reset emails to a few per hour. Please wait a few minutes before trying again.";
  }
  return message;
}

export interface FounderLoginResult {
  success: boolean;
  error?: string;
  role?: string;
  userId?: string;
}

export interface FounderCredential {
  username: string;
  authEmail: string;
  uniqueId: string | null;
  displayName: string | null;
  isActive: boolean;
}

/**
 * Resolve a username (or email) to the Supabase auth email used for login.
 * The founder_credentials table maps usernames like "FOUNDER" to real auth
 * emails. If the input is already an email (contains @), it's used as-is
 * for backward compatibility.
 */
async function resolveFounderEmail(
  usernameOrEmail: string,
): Promise<string | null> {
  const client = getSupabaseClient();
  // If it looks like an email, use it directly
  if (usernameOrEmail.includes("@")) return usernameOrEmail;
  // Otherwise look up the founder_credentials table (case-insensitive)
  const { data } = await client
    .from("founder_credentials")
    .select("auth_email")
    .ilike("username", usernameOrEmail.trim())
    .eq("is_active", true)
    .maybeSingle();
  return data?.auth_email ?? null;
}

/** Attempt to log in to Founder panel via Supabase.
 *  Uses special founder/admin credentials stored in Supabase users table.
 *  Username is resolved to an auth email via the founder_credentials table;
 *  if the input is an email it's used directly (backward compat).
 *  NO FALLBACK - requires Supabase to be available. */
export async function loginFounder(
  username: string,
  password: string,
): Promise<FounderLoginResult> {
  // The Supabase client (supabase/client.ts) resolves env vars with hardcoded
  // fallbacks, so it is always configured in this project. Auth proceeds via
  // the client; the gate below is retained only to surface a clear message if
  // the project is ever reconfigured without Supabase.
  try {
    const client = getSupabaseClient();

    // Resolve the username to an auth email (or use as-is if it's an email)
    const authEmail = await resolveFounderEmail(username);
    if (!authEmail) {
      return { success: false, error: "Invalid credentials" };
    }

    // Sign in with Supabase Auth
    const { data, error } = await client.auth.signInWithPassword({
      email: authEmail,
      password,
    });

    if (error) {
      return { success: false, error: "Invalid credentials" };
    }

    // Verify user has founder/admin role in the users table
    const { data: userData, error: userError } = await client
      .from("users")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (userError || !userData) {
      // If users table doesn't exist or user not found, check metadata
      const role = data.user.user_metadata?.role;
      if (role !== "founder" && role !== "admin") {
        await client.auth.signOut();
        return {
          success: false,
          error: "This account does not have Founder access",
        };
      }
    } else {
      if (userData.role !== "founder" && userData.role !== "admin") {
        await client.auth.signOut();
        return {
          success: false,
          error: "This account does not have Founder access",
        };
      }
    }

    const role = userData?.role || data.user.user_metadata?.role || "founder";

    // Store the Supabase session token
    localStorage.setItem(TOKEN_KEY, data.session.access_token);
    localStorage.setItem(
      SESSION_META_KEY,
      JSON.stringify({
        loginTime: Date.now(),
        role,
        username,
        userId: data.user.id,
      }),
    );

    return { success: true, role, userId: data.user.id };
  } catch (err) {
    // NO FALLBACK - return error
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Unable to connect to Supabase",
    };
  }
}

/** Send a password-reset email (Supabase email-link recovery flow).
 *  The user clicks the link, lands on /reset-password, and sets a new
 *  password. This is the cross-device "forgot password" path.
 *  Username is resolved to an auth email via founder_credentials. */
export async function requestPasswordReset(
  emailOrUsername: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getSupabaseClient();
    const email = await resolveFounderEmail(emailOrUsername);
    if (!email) {
      return { success: false, error: "Username not found" };
    }
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#/reset-password`,
    });
    if (error) {
      return { success: false, error: friendlyAuthEmailError(error.message) };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthEmailError(
        err instanceof Error ? err.message : "Unable to send reset email",
      ),
    };
  }
}

/** Change the signed-in founder's password via Supabase Auth (not
 *  localStorage). This works cross-device because Supabase Auth is the
 *  source of truth for passwords. */
export async function changeFounderPassword(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (newPassword.length < 8) {
      return {
        success: false,
        error: "Password must be at least 8 characters",
      };
    }
    const client = getSupabaseClient();
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: error.message };
    }
    // Record the timestamp on the profiles table (cross-device audit).
    const {
      data: { session },
    } = await client.auth.getSession();
    if (session?.user) {
      await client
        .from("profiles")
        .update({ last_password_change: new Date().toISOString() })
        .eq("id", session.user.id);
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to change password",
    };
  }
}

/** Load the founder's 2FA config from the cloud (profiles table) so it is
 *  consistent across all devices. Returns null if 2FA is not enabled. */
export async function loadFounder2FA(
  userId: string,
): Promise<{ enabled: boolean; secret: string | null }> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("profiles")
      .select("two_factor_enabled, two_factor_secret")
      .eq("id", userId)
      .single();
    if (error || !data) return { enabled: false, secret: null };
    return {
      enabled: !!data.two_factor_enabled,
      secret: data.two_factor_secret || null,
    };
  } catch {
    return { enabled: false, secret: null };
  }
}

/** Save the founder's 2FA config to the cloud (profiles table). */
export async function saveFounder2FA(
  userId: string,
  enabled: boolean,
  secret: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from("profiles")
      .update({
        two_factor_enabled: enabled,
        two_factor_secret: secret,
      })
      .eq("id", userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to save 2FA",
    };
  }
}

/** Get the founder's unique identifier (short human-friendly id) from the
 *  profiles table. Falls back to the Supabase auth uid. */
export async function getFounderUniqueId(
  userId: string,
): Promise<string | null> {
  try {
    const client = getSupabaseClient();
    const { data } = await client
      .from("profiles")
      .select("unique_id")
      .eq("id", userId)
      .single();
    return data?.unique_id || userId.slice(0, 8);
  } catch {
    return userId.slice(0, 8);
  }
}

/** Get the currently stored auth token. */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Check if founder session exists and is valid. */
export function hasFounderSession(): boolean {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const metaRaw = localStorage.getItem(SESSION_META_KEY);
    if (!token || !metaRaw) return false;

    const meta = JSON.parse(metaRaw);
    if (meta.role !== "founder" && meta.role !== "admin") return false;

    // Check if session is not expired (7 days)
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - meta.loginTime < maxAgeMs;
  } catch {
    return false;
  }
}

/** End founder session. */
export function endFounderSession(): void {
  // Sign out from Supabase
  try {
    const client = getSupabaseClient();
    client.auth.signOut();
  } catch {
    // Ignore errors on logout
  }

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_META_KEY);
}

// Backwards compatibility aliases
export const founderLogin = loginFounder;
export const getFounderToken = getAuthToken;
export const endFounderSessionLegacy = endFounderSession;
export function isLoggedIn(): boolean {
  return hasFounderSession();
}

/** Verify founder token with Supabase. */
export async function verifyFounderToken(): Promise<boolean> {
  if (!hasFounderSession()) return false;

  try {
    const client = getSupabaseClient();
    const result = await client.auth.getSession();
    const session = result.data.session;

    if (result.error || !session) return false;

    // Verify user still exists and has founder role
    const { data: userData } = await client
      .from("users")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (userData?.role === "founder" || userData?.role === "admin") {
      return true;
    }

    return hasFounderSession(); // Fall back to local check
  } catch {
    return hasFounderSession();
  }
}

/** Get authorization header for API calls. */
export function getFounderAuthHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Legacy function - returns empty (Supabase handles credentials) */
export function getFounderCredentials() {
  return {
    username: "",
    password: "",
  };
}

/** Legacy function - validates founder auth using Supabase */
export async function validateFounderAuth(): Promise<{ valid: boolean }> {
  const valid = await verifyFounderToken();
  return { valid };
}

// ─── Founder Credentials Management ──────────────────────────────────────
// The founder_credentials table maps a login username to a Supabase auth
// email + unique_id. The founder can add/edit credentials to grant Founder
// Access to another email or change the login username.

/** List all founder credential mappings (requires founder auth). */
export async function listFounderCredentials(): Promise<FounderCredential[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("founder_credentials")
    .select("username, auth_email, unique_id, display_name, is_active")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r: Record<string, unknown>) => ({
    username: r.username as string,
    authEmail: r.auth_email as string,
    uniqueId: (r.unique_id as string) ?? null,
    displayName: (r.display_name as string) ?? null,
    isActive: (r.is_active as boolean) ?? true,
  }));
}

/** Upsert a founder credential: map `username` -> `authEmail` (+ optional
 *  uniqueId/displayName). Used to grant Founder Access to another email or
 *  change the login username. Requires founder auth (RLS enforces). */
export async function upsertFounderCredential(input: {
  username: string;
  authEmail: string;
  uniqueId?: string | null;
  displayName?: string | null;
  isActive?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getSupabaseClient();
    const { error } = await client.from("founder_credentials").upsert(
      {
        username: input.username.trim(),
        auth_email: input.authEmail.trim(),
        unique_id: input.uniqueId ?? null,
        display_name: input.displayName ?? null,
        is_active: input.isActive ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "username" },
    );
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to save credential",
    };
  }
}

/** Delete a founder credential mapping by username. */
export async function deleteFounderCredential(
  username: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from("founder_credentials")
      .delete()
      .eq("username", username);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to delete",
    };
  }
}

/** Set a password for a founder auth account by uid (admin operation).
 *  Uses the Supabase Auth admin API via the service_role key — this runs
 *  server-side only (api/founder-admin?action=setpw endpoint). The founder can
 *  change their own password via changeFounderPassword (client-side
 *  auth.updateUser); this function is for setting the password of a
 *  DIFFERENT founder account (grant access flow). */
export async function setFounderPasswordForUid(
  uid: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }
  try {
    const token = getAuthToken();
    const res = await fetch("/api/founder-admin?action=setpw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ uid, password: newPassword }),
    });
    const data = await res.json();
    if (!data.success) return { success: false, error: data.error };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to set password",
    };
  }
}

/** Look up a Supabase auth uid by email (admin operation via serverless API).
 *  Used by the grant-access flow to find the auth account for an email. */
export async function getAuthUidByEmail(
  email: string,
): Promise<{ uid: string | null; error?: string }> {
  try {
    const token = getAuthToken();
    const res = await fetch("/api/founder-admin?action=lookup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.error) return { uid: null, error: data.error };
    return { uid: data.uid ?? null };
  } catch (err) {
    return {
      uid: null,
      error: err instanceof Error ? err.message : "Unable to look up uid",
    };
  }
}

/** Grant Founder Access to an email: creates/resolves the auth account,
 *  sets its password, sets the role to founder, and ensures a profiles row
 *  with the unique_id + username. The caller must already be a logged-in
 *  founder (the server endpoint verifies the Bearer token). */
export async function grantFounderAccess(input: {
  email: string;
  password: string;
  uniqueId?: string | null;
  username?: string | null;
}): Promise<{ success: boolean; uid?: string; error?: string }> {
  try {
    if (input.password.length < 8) {
      return {
        success: false,
        error: "Password must be at least 8 characters",
      };
    }
    const token = getAuthToken();
    const res = await fetch("/api/founder-admin?action=grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        uniqueId: input.uniqueId ?? null,
        username: input.username ?? null,
      }),
    });
    const data = await res.json();
    if (!data.success) return { success: false, error: data.error };
    return { success: true, uid: data.uid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to grant access",
    };
  }
}
