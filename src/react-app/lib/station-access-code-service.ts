/**
 * Station Access Code Service
 *
 * Allows a station OWNER to create a username + password "access code" linked
 * to a team-member role, so a team member can access the station data WITHOUT
 * signing up for their own account. The owner shares a link
 * (/#/station-access) where the member enters the username + password to gain
 * restricted access (read-only or tab-limited, set by the owner).
 *
 * STORAGE: the dedicated `station_access_codes` Supabase table (migration
 * 021), with RLS so the owner (auth.uid() = owner_id) can CRUD their own
 * codes. The member-side login calls the `verify_access_code` SECURITY
 * DEFINER RPC, which an UNAUTHENTICATED member can invoke to validate
 * credentials across the RLS boundary (the member has no Supabase session).
 *
 * HISTORY: codes were previously stored in app_kv under the owner's owner_id.
 * That broke member login because (a) app_kv RLS (`owner_id = auth.uid()`)
 * blocked the unauthenticated member from reading the owner's row, and
 * (b) app_kv values are now gzip-compressed, so server-side validation was
 * impossible. On first load the owner's existing app_kv codes are migrated
 * into the new table (see `migrateFromAppKv`).
 *
 * SECURITY NOTE: this is a convenience feature for low-sensitivity station
 * data access (shifts, sales, pumps). The password is hashed (SHA-256) before
 * storage and NEVER returned by the verify RPC. It is NOT a replacement for
 * full Supabase Auth. The owner can revoke access at any time.
 */

import { getSupabaseClient } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

const ACCESS_CODES_KEY = "station_access_codes";
const TABLE = "station_access_codes";

export interface StationAccessCode {
  id: string;
  username: string; // must be unique per station
  passwordHash: string; // SHA-256 hex
  memberName: string;
  memberRole: string; // e.g. "Manager", "Cashier", "Attendant"
  // Restrictions: which tabs this member can access. Empty = all tabs.
  allowedTabs: string[];
  // If true, the member can only VIEW data (no edits). Recommended.
  readOnly: boolean;
  enabled: boolean;
  createdAt: number;
  lastAccessedAt: number | null;
  accessCount: number;
}

// A lightweight session for a member who logged in via access code.
export interface StationAccessSession {
  accessCodeId: string;
  memberName: string;
  memberRole: string;
  allowedTabs: string[];
  readOnly: boolean;
  stationId: string;
  stationOwnerId: string; // the owner whose data we're viewing
  loginTime: number;
}

const SESSION_STORAGE_KEY = "fuelpro_station_access_session";

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Map a DB row (snake_case) -> the StationAccessCode shape callers expect.
function rowToCode(r: {
  id: string;
  username: string;
  password_hash: string;
  member_name: string | null;
  member_role: string | null;
  allowed_tabs: unknown;
  read_only: boolean | null;
  enabled: boolean | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number | null;
}): StationAccessCode {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    memberName: r.member_name ?? "",
    memberRole: r.member_role ?? "Staff",
    allowedTabs: Array.isArray(r.allowed_tabs)
      ? (r.allowed_tabs as string[])
      : [],
    readOnly: r.read_only ?? true,
    enabled: r.enabled ?? true,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    lastAccessedAt: r.last_accessed_at
      ? new Date(r.last_accessed_at).getTime()
      : null,
    accessCount: r.access_count ?? 0,
  };
}

/**
 * One-time migration: if the owner has codes in the legacy app_kv blob but
 * none in the new table yet, copy them over so existing access codes keep
 * working. Idempotent (only runs when the table is empty for this station).
 */
async function migrateFromAppKvIfNeeded(
  ownerId: string,
  stationId?: string,
): Promise<void> {
  if (!stationId) return;
  try {
    const client = getSupabaseClient();
    // If the table already has rows for this station, nothing to migrate.
    const { count, error: countErr } = await client
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("station_id", stationId);
    if (countErr) return;
    if ((count ?? 0) > 0) return;

    // Read the legacy app_kv blob (decompresses transparently).
    const legacy = await cloudStorageService.get<StationAccessCode[]>(
      ACCESS_CODES_KEY,
      stationId,
    );
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    const rows = legacy.map((c) => ({
      id: c.id,
      station_id: stationId,
      owner_id: ownerId,
      username: c.username.toLowerCase(),
      password_hash: c.passwordHash,
      member_name: c.memberName,
      member_role: c.memberRole,
      allowed_tabs: c.allowedTabs,
      read_only: c.readOnly,
      enabled: c.enabled,
      created_at: new Date(c.createdAt).toISOString(),
      last_accessed_at: c.lastAccessedAt
        ? new Date(c.lastAccessedAt).toISOString()
        : null,
      access_count: c.accessCount,
    }));
    const { error } = await client.from(TABLE).upsert(rows, {
      onConflict: "id",
      ignoreDuplicates: false,
    });
    if (error) {
      console.warn("[access-codes] migration insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[access-codes] migration skipped:", e);
  }
}

export async function getAccessCodes(
  stationId?: string,
): Promise<StationAccessCode[]> {
  if (!stationId) return [];
  try {
    const client = getSupabaseClient();
    const { data: session } = await client.auth.getSession();
    const ownerId = session?.session?.user?.id;
    if (!ownerId) return [];

    // Migrate legacy app_kv codes into the table on first load.
    await migrateFromAppKvIfNeeded(ownerId, stationId);

    const { data, error } = await client
      .from(TABLE)
      .select("*")
      .eq("owner_id", ownerId)
      .eq("station_id", stationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return data.map(rowToCode);
  } catch (e) {
    console.warn("[access-codes] getAccessCodes failed:", e);
    return [];
  }
}

export async function createAccessCode(
  params: {
    username: string;
    password: string;
    memberName: string;
    memberRole: string;
    allowedTabs: string[];
    readOnly: boolean;
  },
  stationId?: string,
): Promise<StationAccessCode> {
  if (!stationId) {
    throw new Error("No station selected.");
  }
  const client = getSupabaseClient();
  const { data: session } = await client.auth.getSession();
  const ownerId = session?.session?.user?.id;
  if (!ownerId) {
    throw new Error("You must be signed in to create an access code.");
  }
  const username = params.username.trim().toLowerCase();
  if (params.password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }

  // Ensure username is unique for this station (the unique index enforces it,
  // but we surface a friendly error before hitting the constraint).
  const { data: existing } = await client
    .from(TABLE)
    .select("id")
    .eq("owner_id", ownerId)
    .eq("station_id", stationId)
    .eq("username", username)
    .maybeSingle();
  if (existing) {
    throw new Error("Username already exists. Choose a different username.");
  }

  const id = `access_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await sha256(params.password);
  const row = {
    id,
    station_id: stationId,
    owner_id: ownerId,
    username,
    password_hash: passwordHash,
    member_name: params.memberName.trim(),
    member_role: params.memberRole,
    allowed_tabs: params.allowedTabs,
    read_only: params.readOnly,
    enabled: true,
  };
  const { error } = await client.from(TABLE).insert(row);
  if (error) {
    if (error.code === "23505") {
      throw new Error("Username already exists. Choose a different username.");
    }
    throw new Error(error.message || "Failed to create access code.");
  }

  // Also mirror to the legacy app_kv blob so any older build still reading
  // from app_kv sees the new code (harmless; the table is now authoritative).
  try {
    const legacy = await cloudStorageService.get<StationAccessCode[]>(
      ACCESS_CODES_KEY,
      stationId,
    );
    const code: StationAccessCode = {
      id,
      username,
      passwordHash,
      memberName: params.memberName.trim(),
      memberRole: params.memberRole,
      allowedTabs: params.allowedTabs,
      readOnly: params.readOnly,
      enabled: true,
      createdAt: Date.now(),
      lastAccessedAt: null,
      accessCount: 0,
    };
    await cloudStorageService.set(
      ACCESS_CODES_KEY,
      [...(Array.isArray(legacy) ? legacy : []), code],
      stationId,
    );
  } catch {
    /* mirroring is best-effort */
  }

  return rowToCode({
    ...row,
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    access_count: 0,
  });
}

export async function deleteAccessCode(
  id: string,
  stationId?: string,
): Promise<void> {
  const client = getSupabaseClient();
  const { data: session } = await client.auth.getSession();
  const ownerId = session?.session?.user?.id;
  if (!ownerId) return;
  const { error } = await client
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);

  // Mirror deletion to the legacy app_kv blob.
  if (stationId) {
    try {
      const legacy = await cloudStorageService.get<StationAccessCode[]>(
        ACCESS_CODES_KEY,
        stationId,
      );
      if (Array.isArray(legacy)) {
        await cloudStorageService.set(
          ACCESS_CODES_KEY,
          legacy.filter((c) => c.id !== id),
          stationId,
        );
      }
    } catch {
      /* best-effort */
    }
  }
}

export async function toggleAccessCode(
  id: string,
  stationId?: string,
): Promise<void> {
  const client = getSupabaseClient();
  const { data: session } = await client.auth.getSession();
  const ownerId = session?.session?.user?.id;
  if (!ownerId) return;
  // Read current enabled state, then flip it.
  const { data, error } = await client
    .from(TABLE)
    .select("enabled")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const { error: updErr } = await client
    .from(TABLE)
    .update({ enabled: !data.enabled })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (updErr) throw new Error(updErr.message);

  // Mirror to legacy app_kv blob.
  if (stationId) {
    try {
      const legacy = await cloudStorageService.get<StationAccessCode[]>(
        ACCESS_CODES_KEY,
        stationId,
      );
      if (Array.isArray(legacy)) {
        await cloudStorageService.set(
          ACCESS_CODES_KEY,
          legacy.map((c) =>
            c.id === id ? { ...c, enabled: !data.enabled } : c,
          ),
          stationId,
        );
      }
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Attempt to log in with a username + password. On success, returns a session
 * and records the access. The `stationOwnerId` is needed to know whose cloud
 * data to load (the member accesses the OWNER's data, not their own).
 *
 * The member has NO Supabase session, so this calls the SECURITY DEFINER RPC
 * `verify_access_code` (callable by anon) which validates the credentials
 * across the RLS boundary. The password hash is NEVER returned.
 *
 * NOTE: because cloudStorageService scopes data by owner_id (RLS), a member
 * logging in via access code CANNOT read the owner's data through the normal
 * RLS path. The StationAccessView page shows a read-only snapshot that the
 * owner publishes to a PUBLIC Supabase Storage object
 * (station-snapshots/<stationId>/snapshot.json).
 */
export async function loginWithAccessCode(
  username: string,
  password: string,
  stationOwnerId: string,
  stationId: string,
): Promise<StationAccessSession> {
  // Strip a leading "supabase_" prefix that some access links include on the
  // owner id — the stored owner_id is a bare UUID.
  const cleanOwnerId = stationOwnerId.replace(/^supabase_/, "").trim();

  const client = getSupabaseClient();
  const { data, error } = await client.rpc("verify_access_code", {
    p_station_id: stationId,
    p_username: username,
    p_password: password,
  });
  if (error) {
    throw new Error(error.message || "Login failed.");
  }
  if (!data) {
    throw new Error(
      "Invalid username or password, or access has been disabled.",
    );
  }
  const result = data as {
    accessCodeId?: string;
    memberName?: string;
    memberRole?: string;
    allowedTabs?: string[];
    readOnly?: boolean;
    stationId?: string;
    locked?: boolean;
    retryAfter?: string;
  };
  // Brute-force lockout: the RPC returns {locked:true, retryAfter:<iso>}
  // instead of null so the user gets a clear "try again later" message and
  // the owner can see the locked state in the Team Manager UI.
  if (result.locked) {
    const mins = result.retryAfter
      ? Math.max(
          1,
          Math.ceil(
            (new Date(result.retryAfter).getTime() - Date.now()) / 60000,
          ),
        )
      : 15;
    throw new Error(
      `Too many failed attempts. This account is locked for ${mins} minute${
        mins === 1 ? "" : "s"
      }. Please try again later or contact the station owner.`,
    );
  }
  if (!result.accessCodeId) {
    throw new Error(
      "Invalid username or password, or access has been disabled.",
    );
  }
  const session: StationAccessSession = {
    accessCodeId: result.accessCodeId,
    memberName: result.memberName,
    memberRole: result.memberRole,
    allowedTabs: Array.isArray(result.allowedTabs) ? result.allowedTabs : [],
    readOnly: result.readOnly,
    stationId: result.stationId || stationId,
    stationOwnerId: cleanOwnerId,
    loginTime: Date.now(),
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getAccessSession(): StationAccessSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StationAccessSession;
  } catch {
    return null;
  }
}

export function clearAccessSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Station lookup — lets a member find their station by code or name WITHOUT
// knowing the owner UUID + station UUID. Powers the "Station Member" login
// mode on the main AuthLogin page.
//
// Calls the `lookup_station(p_query text)` SECURITY DEFINER RPC (migration
// 026), which an UNAUTHENTICATED member can invoke. Returns up to 10 matches
// ranked by exact-code > exact-name > partial. Only stationId/ownerId/
// stationName/code are returned (no PII).
//
// GRACEFUL DEGRADATION: if the RPC doesn't exist yet (migration 026 not
// applied), the RPC call returns a PostgREST error (PGRST202 / 404). In
// that case we return an empty array and the UI falls back to the manual
// ownerId + stationId entry flow.
// ---------------------------------------------------------------------------

export interface StationLookupResult {
  stationId: string;
  ownerId: string;
  stationName: string;
  code?: string;
}

export async function lookupStation(
  query: string,
): Promise<StationLookupResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc("lookup_station", {
      p_query: q,
    });
    if (error) {
      // PGRST202 = function not found (migration 026 not applied yet).
      // Return empty so the UI falls back to manual entry.
      console.warn("[station-lookup] RPC unavailable:", error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as StationLookupResult[];
  } catch (e) {
    console.warn("[station-lookup] failed:", e);
    return [];
  }
}
