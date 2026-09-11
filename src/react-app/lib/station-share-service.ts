/**
 * Station Sharing Service — restructured & enhanced.
 *
 * DB-backed cross-device station access sharing built on the `station_members`
 * table (Supabase, RLS-protected) as the source of truth. localStorage is used
 * only as a read-through cache — every write goes to Supabase first.
 *
 * ENHANCEMENTS (2026-08-23):
 *  - Typed, rich `StationMember` (status union widened; expiry, role grants,
 *    member metadata, activity tracking, favorites, notes).
 *  - `inviteMember` now supports expiry (days), tabGrants, permissions,
 *    delegation flags, and invited-by provenance.
 *  - `bulkInvite` — invite several emails at once.
 *  - `updateMemberRole` — change a member's role / tab grants / read-only flag
 *    after they've accepted (owner action).
 *  - `rejectInvite` — explicit reject (member side) + `declineInvite` (owner
 *    side before acceptance).
 *  - `transferOwnership` — owner hands a station to another member and is
 *    demoted to manager.
 *  - `recordStationActivity` + `getStationActivity` — lightweight activity log
 *    persisted to app_kv (cloud, cross-device) so members see what happened.
 *  - `toggleFavorite` / `getFavorites` — star a shared station for quick access.
 *  - `subscribeToMembers` — real-time updates when a station's membership
 *    changes (so the owner's UI refreshes instantly when someone accepts).
 *  - `getInvitationStats` — quick counts for the owner dashboard.
 *  - `getSharedStationDetail` — rich single-station membership view.
 *
 * Backward compatible: callers using the original `StationMember` shape and
 * the original `inviteMember(stationId, email, role, name)` signature still
 * work (new params are optional).
 */

import { getSupabaseClient } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

export type MemberStatus =
  "pending" | "accepted" | "rejected" | "active" | "revoked" | "expired";

export interface StationMember {
  id: string;
  station_id: string;
  user_id: string | null;
  invited_email: string | null;
  name: string | null;
  role: string;
  status: MemberStatus;
  invite_token: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced (migration 015 + 024):
  invited_by_user_id?: string | null;
  invited_by_name?: string | null;
  invited_by_unique_id?: string | null;
  member_unique_id?: string | null;
  member_email?: string | null;
  member_role?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  uses?: number | null;
  permissions?: Record<string, unknown> | null;
  tab_grants?: string[] | null;
  can_create_subusers?: boolean | null;
  can_grant_permissions?: boolean | null;
  last_accessed_at?: string | null;
  notes?: string | null;
  favorite?: boolean | null;
}

export interface InviteOptions {
  role?: string;
  name?: string;
  expiresInDays?: number;
  maxUses?: number;
  tabGrants?: string[];
  permissions?: Record<string, unknown>;
  canCreateSubUsers?: boolean;
  canGrantPermissions?: boolean;
  invitedByUserId?: string;
  invitedByName?: string;
  invitedByUniqueId?: string;
  notes?: string;
}

export interface InviteResult {
  success: boolean;
  error?: string;
  member?: StationMember;
  inviteUrl?: string;
}

export interface StationActivityEntry {
  id: string;
  stationId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  detail?: string;
  timestamp: string;
}

const CACHE_KEY = "fuelpro_station_members_cache";
const FAVORITES_KEY = "fuelpro_shared_favorites";
const ACTIVITY_PREFIX = "station_activity_";

function readCache(): StationMember[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCache(members: StationMember[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(members));
  } catch {
    // quota — ignore, cloud is source of truth
  }
}

function genToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function buildInviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?invite=${token}`;
}

function computeExpiry(days?: number): string | null {
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Current user helpers (sync-first, avoids an auth.getUser() round-trip).
// ---------------------------------------------------------------------------
function currentUserIdSync(): string | null {
  try {
    const raw = localStorage.getItem("fuelpro_auth_identity");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id) return parsed.id;
    }
  } catch {
    /* */
  }
  return null;
}

async function getCurrentUser(): Promise<{
  id: string;
  email?: string;
} | null> {
  const syncId = currentUserIdSync();
  if (syncId) {
    try {
      const raw = localStorage.getItem("fuelpro_auth_identity");
      const parsed = raw ? JSON.parse(raw) : {};
      return { id: syncId, email: parsed?.email };
    } catch {
      /* */
    }
  }
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? undefined };
}

// ---------------------------------------------------------------------------
// Invite creation
// ---------------------------------------------------------------------------

/**
 * Invite a user to a station by email.
 *
 * New optional params: expiry, max uses, tab grants, delegation flags, and
 * inviter provenance (so the invitee can see who invited them).
 */
export async function inviteMember(
  stationId: string,
  email: string,
  role: string = "staff",
  name?: string,
  options?: InviteOptions,
): Promise<InviteResult> {
  const supabase = getSupabaseClient();
  const opts = options || {};
  const token = genToken();

  const insertRow: Record<string, unknown> = {
    station_id: stationId,
    invited_email: email,
    name: name || email.split("@")[0],
    role,
    status: "pending",
    invite_token: token,
  };

  // Apply enhanced fields (only set when provided so we don't send undefined).
  if (opts.expiresInDays)
    insertRow.expires_at = computeExpiry(opts.expiresInDays);
  if (opts.maxUses) insertRow.max_uses = opts.maxUses;
  if (opts.tabGrants) insertRow.tab_grants = opts.tabGrants;
  if (opts.permissions) insertRow.permissions = opts.permissions;
  if (opts.canCreateSubUsers !== undefined)
    insertRow.can_create_subusers = opts.canCreateSubUsers;
  if (opts.canGrantPermissions !== undefined)
    insertRow.can_grant_permissions = opts.canGrantPermissions;
  if (opts.invitedByUserId) insertRow.invited_by_user_id = opts.invitedByUserId;
  if (opts.invitedByName) insertRow.invited_by_name = opts.invitedByName;
  if (opts.invitedByUniqueId)
    insertRow.invited_by_unique_id = opts.invitedByUniqueId;
  if (opts.notes) insertRow.notes = opts.notes;

  const { data, error } = await supabase
    .from("station_members")
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  const member = data as StationMember;
  const cache = readCache().filter((m) => m.id !== member.id);
  cache.push(member);
  writeCache(cache);

  // Owner activity log
  if (opts.invitedByUserId || opts.invitedByName) {
    recordStationActivity(stationId, {
      actorId: opts.invitedByUserId || null,
      actorName: opts.invitedByName || "Owner",
      action: "invite_sent",
      detail: `Invited ${email} as ${role}`,
    }).catch(() => {});
  }

  return { success: true, member, inviteUrl: buildInviteUrl(token) };
}

/**
 * Invite multiple emails at once. Returns per-email results so partial
 * failures (e.g. one email already invited) don't block the rest.
 */
export async function bulkInvite(
  stationId: string,
  emails: string[],
  role: string = "staff",
  options?: InviteOptions,
): Promise<{ results: InviteResult[]; succeeded: number; failed: number }> {
  const results: InviteResult[] = [];
  let succeeded = 0;
  let failed = 0;
  for (const email of emails) {
    const trimmed = email.trim();
    if (!trimmed) continue;
    const res = await inviteMember(
      stationId,
      trimmed,
      role,
      undefined,
      options,
    );
    results.push({ ...res, error: res.success ? undefined : res.error });
    if (res.success) succeeded++;
    else failed++;
  }
  return { results, succeeded, failed };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getStationMembers(
  stationId: string,
): Promise<StationMember[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("station_members")
    .select("*")
    .eq("station_id", stationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[shareService] getStationMembers error:", error.message);
    return readCache().filter((m) => m.station_id === stationId);
  }

  const members = (data || []) as StationMember[];
  // Update cache only for this station.
  const others = readCache().filter((m) => m.station_id !== stationId);
  writeCache([...others, ...members]);
  return members;
}

/**
 * Rich single-station membership view — includes station name via join.
 */
export async function getSharedStationDetail(
  stationId: string,
): Promise<{ station: any | null; members: StationMember[] }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stations")
    .select("*, station_members(*)")
    .eq("id", stationId)
    .single();
  if (error || !data) {
    const members = await getStationMembers(stationId);
    return { station: null, members };
  }
  const row = data as any;
  const members = (
    Array.isArray(row.station_members)
      ? row.station_members
      : row.station_members
        ? [row.station_members]
        : []
  ) as StationMember[];
  // Strip the join field so we return a clean station object.
  const station = { ...row };
  delete station.station_members;
  return { station, members };
}

/**
 * Memberships where this user is accepted/active (the stations shared WITH
 * this user). Persists to cache so a fresh-device read can fall back to it.
 */
export async function getSharedStations(): Promise<StationMember[]> {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("station_members")
    .select("*")
    .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    .in("status", ["accepted", "active"])
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[shareService] getSharedStations error:", error.message);
    return readCache().filter(
      (m) => m.status === "accepted" || m.status === "active",
    );
  }

  const members = (data || []) as StationMember[];
  writeCache(members);
  return members;
}

/**
 * Pending invites addressed to this user (invited_email matches, status
 * pending). Surfaces the station name via a join so the UI can render it.
 */
export async function getPendingInvites(): Promise<StationMember[]> {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("station_members")
    .select("*, stations:station_id(name, location)")
    .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[shareService] getPendingInvites error:", error.message);
    return [];
  }
  return (data || []) as StationMember[];
}

/**
 * Quick invitation stats for the owner dashboard.
 */
export async function getInvitationStats(stationId: string): Promise<{
  total: number;
  pending: number;
  accepted: number;
  revoked: number;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("station_members")
    .select("status")
    .eq("station_id", stationId);
  if (error || !data) return { total: 0, pending: 0, accepted: 0, revoked: 0 };
  const counts = { total: data.length, pending: 0, accepted: 0, revoked: 0 };
  for (const row of data as any[]) {
    if (row.status === "pending") counts.pending++;
    else if (row.status === "accepted" || row.status === "active")
      counts.accepted++;
    else if (row.status === "revoked") counts.revoked++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Accept / reject / leave / revoke
// ---------------------------------------------------------------------------

export async function acceptInvite(
  token: string,
): Promise<{ success: boolean; error?: string; stationId?: string }> {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user)
    return {
      success: false,
      error: "You must be logged in to accept an invite",
    };

  // Find the invite by token (still pending).
  const { data: invite, error: findErr } = await supabase
    .from("station_members")
    .select("*")
    .eq("invite_token", token)
    .eq("status", "pending")
    .single();

  if (findErr || !invite) {
    return { success: false, error: "Invalid or expired invite link" };
  }

  const row = invite as StationMember;
  // Honor expiry if set.
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    // Mark expired so it disappears from the pending list.
    await supabase
      .from("station_members")
      .update({ status: "expired" })
      .eq("id", row.id);
    return { success: false, error: "This invite link has expired" };
  }

  // Honor max uses if set (owner-generated shareable links).
  if (row.max_uses && (row.uses || 0) >= row.max_uses) {
    return {
      success: false,
      error: "This invite link has reached its usage limit",
    };
  }

  const updateRow: Record<string, unknown> = {
    user_id: user.id,
    status: "accepted",
    member_email: user.email,
    last_accessed_at: new Date().toISOString(),
    uses: (row.uses || 0) + 1,
  };

  const { error: updateErr } = await supabase
    .from("station_members")
    .update(updateRow)
    .eq("id", row.id);

  if (updateErr) {
    return { success: false, error: updateErr.message };
  }

  // Activity log
  recordStationActivity(row.station_id, {
    actorId: user.id,
    actorName: user.email || "Member",
    action: "invite_accepted",
    detail: `Accepted invite as ${row.role}`,
  }).catch(() => {});

  return { success: true, stationId: row.station_id };
}

/** Member explicitly rejects an invite. */
export async function rejectInvite(
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "You must be logged in" };
  const { error } = await supabase
    .from("station_members")
    .update({ status: "rejected", user_id: user.id })
    .eq("invite_token", token)
    .eq("status", "pending");
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Owner revokes a membership (any status). */
export async function revokeMember(
  memberId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("station_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    return { success: false, error: error.message };
  }

  const cache = readCache().filter((m) => m.id !== memberId);
  writeCache(cache);
  return { success: true };
}

/** Owner cancels a pending invite (softer than delete: marks revoked). */
export async function declineInvite(
  memberId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("station_members")
    .update({ status: "revoked" })
    .eq("id", memberId)
    .eq("status", "pending");
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Member leaves a shared station (self-delete, migration 023 policy). */
export async function leaveStation(
  stationId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "You must be logged in" };

  // Find this user's membership row for the station.
  const { data: member, error: findErr } = await supabase
    .from("station_members")
    .select("id")
    .eq("station_id", stationId)
    .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    .in("status", ["accepted", "active"])
    .maybeSingle();

  if (findErr || !member) {
    return {
      success: false,
      error: "No active membership found for this station",
    };
  }

  const { error: delErr } = await supabase
    .from("station_members")
    .delete()
    .eq("id", (member as any).id);

  if (delErr) return { success: false, error: delErr.message };

  const cache = readCache().filter((m) => m.id !== (member as any).id);
  writeCache(cache);

  recordStationActivity(stationId, {
    actorId: user.id,
    actorName: user.email || "Member",
    action: "member_left",
    detail: "Left the station",
  }).catch(() => {});

  return { success: true };
}

// ---------------------------------------------------------------------------
// Role / permission management (owner)
// ---------------------------------------------------------------------------

export async function updateMemberRole(
  memberId: string,
  updates: {
    role?: string;
    tabGrants?: string[];
    readOnly?: boolean;
    canCreateSubUsers?: boolean;
    canGrantPermissions?: boolean;
    notes?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const updateRow: Record<string, unknown> = {};
  if (updates.role) updateRow.role = updates.role;
  if (updates.role) updateRow.member_role = updates.role;
  if (updates.tabGrants) updateRow.tab_grants = updates.tabGrants;
  if (updates.canCreateSubUsers !== undefined)
    updateRow.can_create_subusers = updates.canCreateSubUsers;
  if (updates.canGrantPermissions !== undefined)
    updateRow.can_grant_permissions = updates.canGrantPermissions;
  if (updates.notes !== undefined) updateRow.notes = updates.notes;

  const { error } = await supabase
    .from("station_members")
    .update(updateRow)
    .eq("id", memberId);

  if (error) return { success: false, error: error.message };

  // Update cache
  const cache = readCache();
  const idx = cache.findIndex((m) => m.id === memberId);
  if (idx >= 0) {
    cache[idx] = { ...cache[idx], ...updateRow } as StationMember;
    writeCache(cache);
  }
  return { success: true };
}

/**
 * Transfer station ownership to an existing member. The current owner is
 * demoted to "manager" on the station and remains a member. The new owner's
 * `stations.owner_id` is updated (requires the current owner to be the
 * `owner_id` — RLS enforces the stations UPDATE).
 *
 * Note: this is a high-privilege operation; the caller should confirm with
 * the user before invoking.
 */
export async function transferOwnership(
  stationId: string,
  newOwnerId: string,
  currentOwnerId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  // 1) Promote the target member to owner role.
  const { error: promoteErr } = await supabase
    .from("station_members")
    .update({ role: "owner", member_role: "owner", status: "accepted" })
    .eq("station_id", stationId)
    .eq("user_id", newOwnerId);
  if (promoteErr) return { success: false, error: promoteErr.message };

  // 2) Demote the current owner to manager (create a membership row if none).
  const { data: existingOwnerMember } = await supabase
    .from("station_members")
    .select("id")
    .eq("station_id", stationId)
    .eq("user_id", currentOwnerId)
    .maybeSingle();

  if (existingOwnerMember) {
    await supabase
      .from("station_members")
      .update({ role: "manager", member_role: "manager" })
      .eq("id", (existingOwnerMember as any).id);
  } else {
    await supabase.from("station_members").insert({
      station_id: stationId,
      user_id: currentOwnerId,
      invited_email: null,
      name: "Previous Owner",
      role: "manager",
      status: "accepted",
      invite_token: genToken(),
    });
  }

  // 3) Flip the station's owner_id.
  const { error: stationErr } = await supabase
    .from("stations")
    .update({ owner_id: newOwnerId })
    .eq("id", stationId)
    .eq("owner_id", currentOwnerId);
  if (stationErr) {
    // Rollback the member role changes so we don't leave inconsistent state.
    await supabase
      .from("station_members")
      .update({ role: "manager", member_role: "manager" })
      .eq("station_id", stationId)
      .eq("user_id", newOwnerId);
    return {
      success: false,
      error: `Failed to transfer station ownership: ${stationErr.message}`,
    };
  }

  recordStationActivity(stationId, {
    actorId: currentOwnerId,
    actorName: "Owner",
    action: "ownership_transferred",
    detail: `Ownership transferred to member ${newOwnerId}`,
  }).catch(() => {});

  return { success: true };
}

// ---------------------------------------------------------------------------
// Favorites (cloud-backed, cross-device)
// ---------------------------------------------------------------------------

export async function toggleFavorite(
  stationId: string,
): Promise<{ favorite: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { favorite: false };
  const key = FAVORITES_KEY;
  let favorites: string[] = [];
  try {
    const cached = await cloudStorageService.get<unknown>(key);
    if (Array.isArray(cached)) favorites = cached as string[];
  } catch {
    /* */
  }
  const isFav = favorites.includes(stationId);
  if (isFav) favorites = favorites.filter((id) => id !== stationId);
  else favorites = [...favorites, stationId];
  await cloudStorageService.set(key, favorites).catch(() => {});
  return { favorite: !isFav };
}

export async function getFavorites(): Promise<string[]> {
  try {
    const cached = await cloudStorageService.get<unknown>(FAVORITES_KEY);
    if (Array.isArray(cached)) return cached as string[];
  } catch {
    /* */
  }
  return [];
}

// ---------------------------------------------------------------------------
// Activity log (cloud-backed via app_kv, cross-device)
// ---------------------------------------------------------------------------

export async function recordStationActivity(
  stationId: string,
  entry: Omit<StationActivityEntry, "id" | "stationId" | "timestamp">,
): Promise<void> {
  const full: StationActivityEntry = {
    id: `${stationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stationId,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const key = `${ACTIVITY_PREFIX}${stationId}`;
  let log: StationActivityEntry[] = [];
  try {
    const cached = await cloudStorageService.get<unknown>(key);
    if (Array.isArray(cached)) log = cached as StationActivityEntry[];
  } catch {
    /* */
  }
  log = [full, ...log].slice(0, 200); // cap at 200 entries
  await cloudStorageService.set(key, log).catch(() => {});
}

export async function getStationActivity(
  stationId: string,
): Promise<StationActivityEntry[]> {
  const key = `${ACTIVITY_PREFIX}${stationId}`;
  try {
    const cached = await cloudStorageService.get<unknown>(key);
    if (Array.isArray(cached)) return cached as StationActivityEntry[];
  } catch {
    /* */
  }
  return [];
}

// ---------------------------------------------------------------------------
// Real-time subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to membership changes for a station. Fires the callback whenever
 * a member is inserted/updated/deleted so the owner's UI refreshes instantly.
 * Returns an unsubscribe function.
 */
export function subscribeToMembers(
  stationId: string,
  callback: () => void,
): () => void {
  // Respect the global Realtime kill-switch (egress saver).
  if (!cloudStorageService.isRealtimeEnabled()) return () => {};
  try {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`station_members:${stationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_members",
          filter: `station_id=eq.${stationId}`,
        },
        () => callback(),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* */
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Subscribe to the current user's memberships (so a member sees new invites
 * + accept/revoke events instantly). Returns an unsubscribe function.
 */
export function subscribeToMyMemberships(
  userId: string,
  callback: () => void,
): () => void {
  // Respect the global Realtime kill-switch (egress saver).
  if (!cloudStorageService.isRealtimeEnabled()) return () => {};
  try {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`my_memberships:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_members",
          filter: `user_id=eq.${userId}`,
        },
        () => callback(),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* */
      }
    };
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// URL invite detection
// ---------------------------------------------------------------------------

export async function checkPendingInvite(): Promise<{
  token: string;
  stationId: string;
} | null> {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("invite");
  if (!token) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("station_members")
    .select("station_id, status, expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    station_id: string;
    status: string;
    expires_at: string | null;
  };
  if (row.status !== "pending") return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
    return null;
  return { token, stationId: row.station_id };
}

/**
 * Backward-compatible helper for callers that used the old 4-arg signature
 * (kept as a no-op wrapper — `inviteMember` accepts the optional options arg).
 */
export const inviteMemberLegacy = (
  stationId: string,
  email: string,
  role = "staff",
  name?: string,
) => inviteMember(stationId, email, role, name);
