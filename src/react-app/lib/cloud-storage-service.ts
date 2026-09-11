/**
 * Cloud Storage Service — Supabase-backed, cross-device key/value store.
 *
 * Replaces localStorage as the source of truth for business data. Uses the
 * live `app_kv` table (JSONB `data`, `owner_id`, `station_id`, RLS-protected,
 * unlimited size, accessible from any device/browser signed into the same
 * Supabase account). localStorage is kept ONLY as a read-through cache for
 * offline performance — it is never the authoritative store.
 *
 * API is async and intentionally matches the shape callers already use
 * (get / set / delete / getAll), so contexts can adopt it with minimal churn.
 */

import { getSupabaseClient } from "@/supabase/client";
import {
  compressJson,
  decompressAny,
  isCompressedPayload,
} from "@/react-app/lib/compression";

const COLLECTION = "fuel_data";
const CACHE_PREFIX = "fuelpro_cloud_";

type Json =
  Record<string, unknown> | unknown[] | string | number | boolean | null;

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

// ---------------------------------------------------------------------------
// PER-KEY VERSION VECTOR (optimistic concurrency for multi-device writes)
// ---------------------------------------------------------------------------
// When two devices are open at once and both edit the same key, last-writer-
// wins silently overwrites. To prevent this, we remember the `version` (and
// `updated_at`) of the row we last READ, then pass `expected_version` to the
// `upsert_app_kv_versioned` RPC. The RPC only applies the UPDATE when the
// existing row's version matches our expectation; on a mismatch it returns
// the remote value so we can merge and retry. This eliminates the "two
// devices conflict, uncertain which data to rely on" problem.
//
// Map: effective cache key -> { version, updatedAt }.
const knownVersions = new Map<
  string,
  { version: number; updatedAt?: string }
>();

function versionKey(key: string, stationId?: string): string {
  return stationId ? `${key}__${stationId}` : key;
}

/**
 * Build the app_kv row id for a logical key, scoped by user (and optionally
 * by station).
 *
 * CRITICAL: the row id MUST be unique per user (+ station). Earlier versions
 * used the bare key (e.g. "expenses_data") as the id with `onConflict: "id"`,
 * which meant every user sharing that key name overwrote the same row —
 * destroying other users' data and flipping `owner_id` so RLS
 * (`owner_id = auth.uid()`) locked the original owner out of their own data.
 *
 * Scoping by owner_id gives each user an isolated row for the same logical
 * key. Scoping additionally by station_id gives each station its own isolated
 * data set (so a user with multiple stations has independent expenses, prices,
 * suppliers, etc. per station), which is required unless a "Combined View" is
 * explicitly selected.
 *
 * Row id shapes:
 *   - station-scoped: `${key}__${ownerId}__${stationId}`
 *   - user-scoped:    `${key}__${ownerId}`   (legacy / combined-view)
 */
function rowId(key: string, ownerId: string, stationId?: string): string {
  return stationId ? `${key}__${ownerId}__${stationId}` : `${key}__${ownerId}`;
}

/** The legacy user-scoped id (used for backward-compatible reads). */
function userScopedId(key: string, ownerId: string): string {
  return `${key}__${ownerId}`;
}

/**
 * Coerce a value read from the app_kv `data` (JSONB) column into the expected
 * JSON shape. Older versions of set() (and some manual API inserts) stored
 * arrays/objects as a double-encoded JSON STRING inside the JSONB column
 * (e.g. the column held `"[{ ... }]"` instead of `[{ ... }]`). Without this
 * guard, callers that check `Array.isArray(value)` would see `false` for the
 * string and silently discard ALL cloud-synced per-component data (suppliers,
 * expenses, shifts, payroll, etc.) — manifesting as an empty UI even though
 * the data exists in the DB. This helper transparently unwraps such strings
 * so existing rows auto-heal: the next set() repersists the parsed value as
 * proper JSONB, fixing the stored data without any migration script.
 */
function coerceJson<T = Json>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Not JSON — return the original string wrapped as the value.
      return raw as unknown as T;
    }
  }
  return raw as T;
}

/**
 * Read-side adapter: run coerceJson for legacy/double-encoded strings, then
 * transparently decompress any gzip-compressed payload written by set().
 * Returns null only when there is genuinely no value. Existing uncompressed
 * rows pass through unchanged.
 */
function decodeRow<T = Json>(raw: unknown): T | null {
  const coerced = coerceJson<T>(raw);
  if (coerced == null) return null;
  // Handles both the current `{__compressed,c,o}` envelope and the legacy
  // `{__c:1,d,n,z}` envelope (including nested/double-wrapped rows).
  return decompressAny<T>(coerced);
}

/**
 * Merge two values for multi-device conflict resolution. The "local" value is
 * the user's latest edit; "remote" is the newer revision from another device.
 * Strategy:
 *  - Objects: deep-merge, with LOCAL fields winning on conflict (the user's
 *    most recent edit takes precedence), but remote keys the local edit
 *    didn't touch are preserved (so a concurrent edit on another device isn't
 *    lost).
 *  - Arrays of records (objects with an `id` / `key` / `empId` field): union
 *    by id, keeping the element from whichever side has it, and for shared
 *    ids keeping the LOCAL (newer edit) element.
 *  - Arrays of primitives: local wins (the user explicitly set a new list).
 *  - Primitives: local wins (it's the user's latest edit).
 *  - null/undefined remote: local wins; null/undefined local: remote wins.
 */
export function mergeValues<T>(remote: T | null, local: T): T {
  if (remote == null) return local;
  if (local == null) return remote;

  // Never merge compression envelopes as if they were data — decode both
  // sides to plain values first, otherwise the object-merge branch would
  // produce a corrupt hybrid ({staff:[], ..., __compressed:true, c:...}).
  if (
    isCompressedPayload(remote) ||
    isCompressedPayload(local) ||
    (typeof remote === "object" &&
      remote !== null &&
      (remote as Record<string, unknown>).__c === 1) ||
    (typeof local === "object" &&
      local !== null &&
      (local as Record<string, unknown>).__c === 1)
  ) {
    const r = decompressAny(remote);
    const l = decompressAny(local);
    if (r == null) return (l ?? local) as T;
    if (l == null) return r as T;
    return mergeValues(r as T, l as T);
  }

  if (Array.isArray(remote) && Array.isArray(local)) {
    // Array-of-records union by id.
    const allItems = [...remote, ...local];
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v);
    if (allItems.every(isRecord)) {
      const idKey = allItems
        .map((r) =>
          Object.keys(r).find((k) => /^(id|key|empId|uid|uid)$/i.test(k)),
        )
        .find(Boolean);
      if (idKey) {
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of remote as Record<string, unknown>[]) {
          const id = String(r[idKey] ?? "");
          if (id) byId.set(id, r);
        }
        // Local entries override remote (newer edit) for the same id.
        for (const r of local as Record<string, unknown>[]) {
          const id = String(r[idKey] ?? "");
          if (id) byId.set(id, r);
          else byId.set(`__noid_${Date.now()}_${Math.random()}`, r);
        }
        return Array.from(byId.values()) as T;
      }
    }
    // Arrays of primitives or unidentifiable records: local wins.
    return local;
  }

  if (
    typeof remote === "object" &&
    typeof local === "object" &&
    !Array.isArray(remote) &&
    !Array.isArray(local)
  ) {
    const merged: Record<string, unknown> = {
      ...(remote as Record<string, unknown>),
    };
    for (const [k, v] of Object.entries(local as Record<string, unknown>)) {
      // Local value wins, but if both are objects, deep-merge to preserve
      // concurrent remote sub-edits.
      const rv = merged[k];
      if (
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        typeof rv === "object" &&
        rv !== null &&
        !Array.isArray(rv)
      ) {
        merged[k] = mergeValues(
          rv as Record<string, unknown>,
          v as Record<string, unknown>,
        );
      } else {
        merged[k] = v;
      }
    }
    return merged as T;
  }

  // Primitives: local (user's latest edit) wins.
  return local;
}

/**
 * Current authenticated user id, or null.
 *
 * SYNCHRONOUS FAST-PATH: reads from localStorage (`fuelpro_auth_identity`,
 * written by AuthContext on login) BEFORE making any network call. This
 * eliminates the 200-500ms `auth.getUser()` round-trip that previously
 * blocked EVERY `get()`/`set()` call — the single biggest source of latency
 * in the entire data-loading pipeline. Falls back to the Supabase client
 * only when localStorage doesn't have it (first render before AuthContext
 * persists).
 */
let cachedUserId: string | null = null;
let userIdCacheTs = 0;
const USER_ID_CACHE_TTL = 30_000; // 30 seconds

function readUserIdFromStorage(): string | null {
  try {
    const raw = localStorage.getItem("fuelpro_auth_identity");
    if (raw) {
      const identity = JSON.parse(raw);
      if (identity?.id) return identity.id;
    }
  } catch {
    // ignore
  }
  return null;
}

async function currentUserId(): Promise<string | null> {
  // 1. In-memory cache (fastest).
  if (cachedUserId && Date.now() - userIdCacheTs < USER_ID_CACHE_TTL) {
    return cachedUserId;
  }
  // 2. localStorage (synchronous, no network).
  const stored = readUserIdFromStorage();
  if (stored) {
    cachedUserId = stored;
    userIdCacheTs = Date.now();
    return stored;
  }
  // 3. Supabase client (network call, slowest).
  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getUser();
    const id = data.user?.id ?? null;
    if (id) {
      cachedUserId = id;
      userIdCacheTs = Date.now();
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * SYNCHRONOUS user id — for instant renders. Reads from the in-memory cache
 * or localStorage. Returns null if no user is known yet (first paint before
 * AuthContext persists). Callers that need a definitive answer should still
 * use the async `currentUserId()`.
 */
function currentUserIdSync(): string | null {
  if (cachedUserId && Date.now() - userIdCacheTs < USER_ID_CACHE_TTL) {
    return cachedUserId;
  }
  return readUserIdFromStorage();
}

/** Read-through cache helper. */
function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(value));
  } catch {
    // Cache is best-effort; ignore quota errors.
  }
}

function clearCache(key: string): void {
  try {
    localStorage.removeItem(cacheKey(key));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// OFFLINE WRITE QUEUE
// ---------------------------------------------------------------------------
// When `set()`/`delete()` fail because the network is unavailable (or the
// Supabase session expired), the operation is appended to a durable queue in
// localStorage. A single global listener (window online event + visibility
// change + periodic retry) flushes the queue once connectivity is restored so
// offline edits are never lost — they reach the cloud automatically as soon as
// the device is back online.
//
// The queue stores the LAST write per logical key (coalescing rapid edits so a
// user typing into a price field offline doesn't queue 50 writes — only the
// final value matters). Deletions are stored as `{ op: "delete" }`.

const OFFLINE_QUEUE_KEY = "fuelpro_offline_queue_v1";

type QueuedOp =
  | {
      op: "set";
      key: string;
      value: Json;
      stationId?: string;
      ts: number;
    }
  | {
      op: "delete";
      key: string;
      stationId?: string;
      ts: number;
    };

function readQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOp[]): void {
  try {
    // Cap the queue size to avoid unbounded growth (keep the most recent 200
    // ops — coalescing means this is per-key, not per-keystroke).
    const capped = q.slice(-200);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(capped));
  } catch {
    /* ignore quota */
  }
}

/** Coalesce: replace any existing op for the same key+station, then append. */
function enqueueSet(
  key: string,
  value: Json,
  stationId: string | undefined,
): void {
  const q = readQueue().filter(
    (op) => !(op.key === key && op.stationId === stationId),
  );
  q.push({ op: "set", key, value, stationId, ts: Date.now() });
  writeQueue(q);
}

function enqueueDelete(key: string, stationId: string | undefined): void {
  const q = readQueue().filter(
    (op) => !(op.key === key && op.stationId === stationId),
  );
  q.push({ op: "delete", key, stationId, ts: Date.now() });
  writeQueue(q);
}

function removeQueuedOp(op: QueuedOp): void {
  const q = readQueue().filter(
    (o) =>
      !(o.key === op.key && o.stationId === op.stationId && o.ts === op.ts),
  );
  writeQueue(q);
}

/** Whether there are pending offline writes awaiting sync. */
function hasPendingOfflineOps(): boolean {
  return readQueue().length > 0;
}

class CloudStorageService {
  private memoryCache = new Map<string, { value: unknown; ts: number }>();
  private memTtlMs = 60_000; // 60 seconds — data rarely changes faster than this

  /** Synchronous current-user id (in-memory cache / localStorage). */
  currentUserIdSync(): string | null {
    return currentUserIdSync();
  }

  /**
   * EGRESS-SAVING KILL SWITCH for Supabase Realtime subscriptions.
   *
   * Supabase Free plan counts Realtime messages toward a quota (2,000,000 /
   * month on the org). With 30+ components each opening a realtime channel on
   * app_kv, every cross-device write fans out to ~30 subscribed channels —
   * each message counts. Under sustained multi-device usage this hits the cap
   * (observed 96%+). When `realtimeEnabled` is `false`, `subscribe()` /
   * `subscribeToStation()` return a no-op unsubscribe and open NO channels,
   * so Realtime message count drops to ~0. Cross-device sync then relies on
   * the periodic read-through cache + manual refresh instead.
   *
   * Persisted in localStorage (`fuelpro_realtime_disabled`) so the user's
   * choice survives reloads. Toggled from the Data Manager "Storage & Egress"
   * panel. Default: ENABLED (instant cross-device sync is a core feature).
   */
  // Realtime is OFF by default to stay within the Supabase Free-plan
  // Realtime message quota (org was >170% over). Users can re-enable it via
  // the Data Manager "Storage & Egress" panel / General Settings. Cross-device
  // data still syncs through the read-through cache + manual refresh.
  private realtimeEnabled = (() => {
    try {
      return localStorage.getItem("fuelpro_realtime_enabled") === "1";
    } catch {
      return false;
    }
  })();

  /** Toggle Realtime subscriptions on/off (egress-saver). */
  setRealtimeEnabled(enabled: boolean): void {
    this.realtimeEnabled = enabled;
    try {
      if (enabled) {
        localStorage.setItem("fuelpro_realtime_enabled", "1");
      } else {
        localStorage.removeItem("fuelpro_realtime_enabled");
      }
    } catch {
      /* ignore quota errors */
    }
  }

  isRealtimeEnabled(): boolean {
    return this.realtimeEnabled;
  }

  // -------------------------------------------------------------------------
  // SHARED-CHANNEL MULTIPLEXER (egress saver)
  // -------------------------------------------------------------------------
  // Supabase bills Realtime MESSAGES, and each open channel generates
  // presence + system messages on top of data messages. Before this
  // multiplexer, every `subscribe(key)` opened its OWN channel
  // (`app_kv:<scopedId>`), so 30 components = 30 channels = ~30x the
  // overhead. Now all per-key subscriptions for the SAME owner share ONE
  // channel (`app_kv:mux:<ownerId>`) that listens to every app_kv row for
  // that owner (filter `owner_id=eq.<ownerId>`). The single channel's
  // callback fans the payload out to the registered per-key callbacks by
  // matching the row id. Net effect: 30 channels -> 1 channel, a ~30x
  // reduction in non-data Realtime messages for a typical session.
  private muxChannel: ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null = null;
  private muxCallbacks = new Map<
    string,
    Set<(value: unknown, rowId: string) => void>
  >();
  /** Wildcard callbacks that receive EVERY row change for the owner (used by
   *  subscribeToStation). Sharing the mux channel avoids a 2nd open channel. */
  private muxWildcardCallbacks = new Set<
    (value: unknown, rowId: string) => void
  >();
  private muxOwnerId: string | null = null;
  private muxStarting = false;

  /**
   * Get (or lazily start) the single shared owner channel and register a
   * callback for a specific scoped row id. Returns an unsubscribe fn.
   * Falls back to a dedicated channel if the shared channel can't start.
   */
  private async muxSubscribe<T>(
    scopedId: string,
    cacheK: string,
    callback: (value: T | null) => void,
  ): Promise<() => void> {
    const ownerId = await currentUserId();
    if (!ownerId) return () => {};

    // Register the callback keyed by the scoped row id.
    let set = this.muxCallbacks.get(scopedId);
    if (!set) {
      set = new Set();
      this.muxCallbacks.set(scopedId, set);
    }
    const wrapped = (value: unknown, _rowId: string) => callback(value as T);
    set.add(wrapped);

    // Lazily start the shared channel once per owner.
    if (!this.muxChannel) {
      await this.startMuxChannel(ownerId);
    }

    return () => {
      set?.delete(wrapped);
      if (set && set.size === 0) this.muxCallbacks.delete(scopedId);
      this.maybeTearDownMux();
    };
  }

  /** Register a wildcard callback that receives every owner row change. */
  private async muxSubscribeAll<T>(
    callback: (rowId: string, value: T | null) => void,
  ): Promise<() => void> {
    const ownerId = await currentUserId();
    if (!ownerId) return () => {};
    const wrapped = (value: unknown, rowId: string) =>
      callback(rowId, value as T);
    this.muxWildcardCallbacks.add(wrapped);
    if (!this.muxChannel) {
      await this.startMuxChannel(ownerId);
    }
    return () => {
      this.muxWildcardCallbacks.delete(wrapped);
      this.maybeTearDownMux();
    };
  }

  /** Tear down the shared channel when no callbacks remain. */
  private maybeTearDownMux(): void {
    if (
      this.muxCallbacks.size === 0 &&
      this.muxWildcardCallbacks.size === 0 &&
      this.muxChannel
    ) {
      try {
        getSupabaseClient().removeChannel(this.muxChannel);
      } catch {
        /* ignore */
      }
      this.muxChannel = null;
      this.muxOwnerId = null;
    }
  }

  /** Start the single shared owner-wide app_kv channel. */
  private async startMuxChannel(ownerId: string): Promise<void> {
    if (this.muxChannel || this.muxStarting) return;
    if (this.muxOwnerId && this.muxOwnerId !== ownerId) return; // owner changed
    this.muxStarting = true;
    try {
      const client = getSupabaseClient();
      this.muxOwnerId = ownerId;
      this.muxChannel = client
        .channel(`app_kv:mux:${ownerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "app_kv",
            filter: `owner_id=eq.${ownerId}`,
          },
          (payload) => {
            const row =
              payload.eventType === "DELETE"
                ? (payload.old as { id?: string })
                : (payload.new as { id?: string; data?: unknown });
            const id = row?.id ?? "";
            if (!id) return;
            // Invalidate any memory cache entry for this row.
            for (const [ck] of this.memoryCache) {
              if (id.includes(ck.split("__")[0])) {
                this.memoryCache.delete(ck);
              }
            }
            const rawValue = (payload.new as { data?: unknown })?.data ?? null;
            const decoded = rawValue == null ? null : decodeRow(rawValue);
            if (decoded != null) {
              writeCache(id, decoded);
            } else {
              clearCache(id);
            }
            // Fan out to every callback registered for this row id.
            const cbs = this.muxCallbacks.get(id);
            if (cbs) {
              for (const cb of cbs) cb(decoded, id);
            }
            // Fan out to wildcard (subscribeToStation) callbacks.
            if (this.muxWildcardCallbacks.size > 0) {
              for (const cb of this.muxWildcardCallbacks) cb(decoded, id);
            }
          },
        )
        .subscribe();
    } catch {
      this.muxChannel = null;
      this.muxOwnerId = null;
    } finally {
      this.muxStarting = false;
    }
  }

  /** Whether Supabase auth is available (client configured + user signed in). */
  async isAvailable(): Promise<boolean> {
    return (await currentUserId()) !== null;
  }

  /**
   * SYNCHRONOUS cached read — returns data from the in-memory cache or the
   * localStorage read-through cache with ZERO network calls. Use this in
   * useState initializers so the FIRST render shows data instantly (before
   * the async `get()` resolves). Returns null if no cache exists yet.
   *
   * The async `get()` should still be called on mount to sync from cloud,
   * but `getCached()` eliminates the blank-state flash on cross-device login
   * and on every tab switch/navigation.
   */
  getCached<T = Json>(key: string, stationId?: string): T | null {
    const ck = stationId ? `${key}__${stationId}` : key;
    // 1. In-memory cache (instant).
    const mem = this.memoryCache.get(ck);
    if (mem && Date.now() - mem.ts < this.memTtlMs) {
      return mem.value as T;
    }
    // 2. localStorage read-through cache (instant, no network).
    return readCache<T>(ck);
  }

  /** Whether a value is cached (memory or localStorage) for instant access. */
  hasCached(key: string, stationId?: string): boolean {
    return this.getCached(key, stationId) != null;
  }

  /** Clear the in-memory + localStorage cache for a key (forces next get() to
   *  re-fetch from cloud). Used by the Cloud Diagnostics panel. */
  clearCache(key: string, stationId?: string): void {
    const ck = stationId ? `${key}__${stationId}` : key;
    this.memoryCache.delete(ck);
    clearCache(ck);
  }

  /**
   * Get a value from cloud (app_kv). Falls back to the local cache when the
   * network or auth is unavailable so reads never block the UI.
   *
   * When `stationId` is provided, reads the station-scoped row first. If that
   * does not exist, falls back to the user-scoped row (legacy / pre-station
   * data) so existing data migrates transparently on first read. The next
   * `set()` repersists it under the station-scoped id.
   */
  async get<T = Json>(key: string, stationId?: string): Promise<T | null> {
    // Fast memory cache (keyed by the effective cache key).
    const ck = stationId ? `${key}__${stationId}` : key;
    const mem = this.memoryCache.get(ck);
    if (mem && Date.now() - mem.ts < this.memTtlMs) {
      return mem.value as T;
    }

    const ownerId = await currentUserId();
    if (!ownerId) return readCache<T>(ck);

    try {
      const client = getSupabaseClient();
      const scopedId = rowId(key, ownerId, stationId);

      // 1. Station-scoped row (when stationId provided).
      if (stationId) {
        const { data, error } = await client
          .from("app_kv")
          .select("data, version, updated_at")
          .eq("id", scopedId)
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (error) throw error;
        if (data?.data != null) {
          const value = decodeRow<T>(data.data);
          if (value != null) {
            // Record the version we just read so the next set() can do an
            // optimistic-concurrency check (prevents multi-device overwrites).
            knownVersions.set(versionKey(key, stationId), {
              version: (data.version as number) ?? 1,
              updatedAt: data.updated_at as string | undefined,
            });
            this.memoryCache.set(ck, { value, ts: Date.now() });
            writeCache(ck, value);
            // Auto-heal: if the stored row was a double-encoded string,
            // repersist as proper JSONB so future reads skip the parse.
            if (typeof data.data === "string") {
              this.set(key, value, stationId).catch(() => {});
            }
            return value;
          }
        }
      }

      // 2. User-scoped row (legacy / combined-view / pre-station data).
      const usId = userScopedId(key, ownerId);
      const { data: usData, error: usError } = await client
        .from("app_kv")
        .select("data, version, updated_at")
        .eq("id", usId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (usError) throw usError;
      if (usData?.data != null) {
        const value = decodeRow<T>(usData.data);
        if (value != null) {
          knownVersions.set(versionKey(key, stationId), {
            version: (usData.version as number) ?? 1,
            updatedAt: usData.updated_at as string | undefined,
          });
          this.memoryCache.set(ck, { value, ts: Date.now() });
          writeCache(ck, value);
          if (typeof usData.data === "string") {
            // Repersist under the scoped id as proper JSONB.
            this.set(key, value, stationId).catch(() => {});
          }
          return value;
        }
      }

      // 3. Legacy bare-key row (pre-user-scoping). Read once so existing data
      // is not lost; the next set() repersists it under the scoped id.
      if (key !== usId) {
        const { data: legacy } = await client
          .from("app_kv")
          .select("data, version, updated_at")
          .eq("id", key)
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (legacy?.data != null) {
          const value = decodeRow<T>(legacy.data);
          if (value != null) {
            knownVersions.set(versionKey(key, stationId), {
              version: (legacy.version as number) ?? 1,
              updatedAt: legacy.updated_at as string | undefined,
            });
            this.memoryCache.set(ck, { value, ts: Date.now() });
            writeCache(ck, value);
            this.set(key, value, stationId).catch(() => {});
            return value;
          }
        }
      }
      // No cloud row — fall back to cache (e.g. offline-first write not yet synced).
      return readCache<T>(ck);
    } catch (err) {
      console.warn(
        `[CloudStorage] get failed for key="${key}" stationId="${stationId ?? ""}":`,
        err,
      );
      return readCache<T>(ck);
    }
  }

  /**
   * Persist a value to cloud (app_kv) with optimistic concurrency. Also
   * writes the local cache so subsequent reads are instant and offline-capable.
   *
   * MULTI-DEVICE CONFLICT RESOLUTION: this uses the `upsert_app_kv_versioned`
   * RPC so a write only applies when the row's current version matches the
   * version we last READ (via get()). If another device wrote a newer revision
   * in between, the RPC returns `{ ok: false, data: <remote> }` and we MERGE
   * our edit into the remote value (deep-merge objects; for arrays of records,
   * union-by-id keeping the most recent), then retry once. This prevents the
   * "two devices open → uncertain which data to rely on → silent overwrite"
   * problem. When the RPC is unavailable (older DB without migration 020),
   * we fall back to a plain upsert (last-writer-wins) so the app never breaks.
   *
   * When `stationId` is provided, writes the station-scoped row and sets the
   * `station_id` column so station-filtered queries work. The legacy bare-key
   * row (if any) is left in place for combined-view reads; it is NOT deleted.
   */
  async set<T = Json>(
    key: string,
    value: T,
    stationId?: string,
  ): Promise<void> {
    const ck = stationId ? `${key}__${stationId}` : key;
    writeCache(ck, value);
    this.memoryCache.set(ck, { value, ts: Date.now() });

    const ownerId = await currentUserId();
    if (!ownerId) {
      // Unauthenticated — cache locally only, but DO queue so the write
      // reaches the cloud once a session is restored.
      enqueueSet(key, value as unknown as Json, stationId);
      return;
    }

    const scopedId = rowId(key, ownerId, stationId);
    const stored = compressJson(value);
    const expected = knownVersions.get(versionKey(key, stationId));
    const expectedVersion = expected?.version ?? null;

    try {
      const client = getSupabaseClient();
      // Try the versioned conditional upsert (optimistic concurrency).
      const { data: rpcData, error: rpcError } = await client.rpc(
        "upsert_app_kv_versioned",
        {
          p_id: scopedId,
          p_owner_id: ownerId,
          p_station_id: stationId ?? null,
          p_collection: COLLECTION,
          p_data: stored as unknown as Json,
          p_expected_version: expectedVersion,
        },
      );
      if (rpcError) {
        // RPC missing (migration not applied yet) → fall back to plain upsert.
        const { error } = await client.from("app_kv").upsert(
          {
            id: scopedId,
            collection: COLLECTION,
            owner_id: ownerId,
            station_id: stationId ?? null,
            data: stored as unknown as Json,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
        if (error) throw error;
      } else if (rpcData && (rpcData as { ok?: boolean }).ok === false) {
        // CONFLICT: a newer revision exists on another device. Merge our edit
        // into the remote value and retry once with the remote's version.
        const remote = (
          rpcData as {
            data: unknown;
            version: number;
          }
        ).data;
        const remoteVersion = (rpcData as { version: number }).version;
        const remoteValue = decodeRow<T>(remote);
        const merged = mergeValues(remoteValue, value) as T;
        const mergedStored = compressJson(merged);
        // Retry with the remote's version as the new expectation.
        const { data: retryData, error: retryError } = await client.rpc(
          "upsert_app_kv_versioned",
          {
            p_id: scopedId,
            p_owner_id: ownerId,
            p_station_id: stationId ?? null,
            p_collection: COLLECTION,
            p_data: mergedStored as unknown as Json,
            p_expected_version: remoteVersion,
          },
        );
        if (retryError) throw retryError;
        // Record the new version from the retry response so future writes are
        // consistent; update cache + memory to the merged result.
        const retryVersion = (retryData as { version?: number })?.version;
        if (typeof retryVersion === "number") {
          knownVersions.set(versionKey(key, stationId), {
            version: retryVersion,
          });
        }
        writeCache(ck, merged);
        this.memoryCache.set(ck, { value: merged, ts: Date.now() });
      } else {
        // Write applied. Record the new version for the next write.
        const newVersion = (rpcData as { version?: number })?.version;
        if (typeof newVersion === "number") {
          knownVersions.set(versionKey(key, stationId), {
            version: newVersion,
          });
        } else {
          // Fallback: re-read the version to stay consistent.
          const { data: cur } = await client
            .from("app_kv")
            .select("version, updated_at")
            .eq("id", scopedId)
            .maybeSingle();
          if (cur) {
            knownVersions.set(versionKey(key, stationId), {
              version: (cur.version as number) ?? 1,
              updatedAt: cur.updated_at as string | undefined,
            });
          }
        }
      }
      // Success — remove any previously-queued op for this key (it's now live).
      this.dequeueKey(key, stationId);
    } catch (err) {
      // Cloud write failed (network down / RLS / session expired). Queue the
      // write so it is retried automatically when connectivity is restored.
      // The value is already in the local cache so reads keep working.
      console.warn(
        `[CloudStorage] set failed for "${key}", queued for offline retry:`,
        err,
      );
      enqueueSet(key, value as unknown as Json, stationId);
    }
  }

  /** Delete from cloud + cache. */
  async delete(key: string, stationId?: string): Promise<void> {
    const ck = stationId ? `${key}__${stationId}` : key;
    clearCache(ck);
    this.memoryCache.delete(ck);

    const ownerId = await currentUserId();
    if (!ownerId) {
      enqueueDelete(key, stationId);
      return;
    }

    try {
      const client = getSupabaseClient();
      const scopedId = rowId(key, ownerId, stationId);
      const { error } = await client
        .from("app_kv")
        .delete()
        .eq("id", scopedId)
        .eq("owner_id", ownerId);
      if (error) throw error;
      // Also clean up a legacy bare-key row if one exists for this owner.
      if (scopedId !== key) {
        await client
          .from("app_kv")
          .delete()
          .eq("id", key)
          .eq("owner_id", ownerId);
      }
      this.dequeueKey(key, stationId);
    } catch (err) {
      console.warn(
        `[CloudStorage] delete failed for "${key}", queued for offline retry:`,
        err,
      );
      enqueueDelete(key, stationId);
    }
  }

  /** Remove any queued op for a key (called after a successful write). */
  private dequeueKey(key: string, stationId?: string): void {
    const q = readQueue().filter(
      (op) => !(op.key === key && op.stationId === stationId),
    );
    writeQueue(q);
  }

  /**
   * Flush the offline write queue. Called automatically on `online` events,
   * visibility change, and a periodic timer. Each queued op is replayed in
   * order; successfully-applied ops are removed. Returns the number of ops
   * still pending (0 = fully synced).
   *
   * After a successful flush the in-memory cache is invalidated for the
   * affected keys and a `cloudStorageSynced` CustomEvent is dispatched so any
   * listening component re-fetches and re-renders with the now-synced data —
   * this is what makes offline edits "take effect immediately when back
   * online" without requiring a manual refresh.
   */
  async flushOfflineQueue(): Promise<number> {
    const queue = readQueue();
    if (queue.length === 0) return 0;
    // Check connectivity cheaply — if no user session, we can't flush yet.
    const ownerId = await currentUserId();
    if (!ownerId) return queue.length;

    const remaining: QueuedOp[] = [];
    const flushedKeys: Array<{ key: string; stationId?: string }> = [];
    let succeeded = 0;
    for (const op of queue) {
      try {
        const client = getSupabaseClient();
        if (op.op === "set") {
          // Compress the queued value before writing (mirrors set()).
          const stored = compressJson(op.value);
          const scopedId = rowId(op.key, ownerId, op.stationId);
          // Try the versioned RPC; fall back to plain upsert if unavailable.
          const { error: rpcErr } = await client.rpc(
            "upsert_app_kv_versioned",
            {
              p_id: scopedId,
              p_owner_id: ownerId,
              p_station_id: op.stationId ?? null,
              p_collection: COLLECTION,
              p_data: stored as unknown as Json,
              p_expected_version: null,
            },
          );
          if (rpcErr) {
            const { error } = await client.from("app_kv").upsert(
              {
                id: scopedId,
                collection: COLLECTION,
                owner_id: ownerId,
                station_id: op.stationId ?? null,
                data: stored as unknown as Json,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            );
            if (error) throw error;
          }
        } else {
          const scopedId = rowId(op.key, ownerId, op.stationId);
          const { error } = await client
            .from("app_kv")
            .delete()
            .eq("id", scopedId)
            .eq("owner_id", ownerId);
          if (error) throw error;
        }
        succeeded++;
        flushedKeys.push({ key: op.key, stationId: op.stationId });
      } catch {
        // Keep this op in the queue for the next flush attempt.
        remaining.push(op);
      }
    }
    writeQueue(remaining);
    if (succeeded > 0) {
      // Invalidate the memory cache for each flushed key so the next get()
      // reads the freshly-synced cloud value, then notify the UI.
      for (const { key, stationId } of flushedKeys) {
        this.invalidate(key, stationId);
      }
      console.log(
        `[CloudStorage] Flushed ${succeeded} offline write(s); ${remaining.length} still pending.`,
      );
      // Tell any listening component to reload from cloud. This is the bridge
      // between a background flush and the React layer that needs to refresh.
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("cloudStorageSynced", {
              detail: { count: succeeded, keys: flushedKeys },
            }),
          );
        } catch {
          /* ignore */
        }
      }
    }
    return remaining.length;
  }

  /** Number of offline writes awaiting sync (for UI indicators). */
  pendingOfflineOps(): number {
    return readQueue().length;
  }

  /** Whether there are pending offline writes (synchronous, for UI gates). */
  hasOfflineWritesPending(): boolean {
    return hasPendingOfflineOps();
  }

  /**
   * Get all cloud rows for the current user (optionally filtered by collection
   * prefix on the key). Returns a { key: value } map.
   */
  async getAll<T = Json>(prefix?: string): Promise<Record<string, T>> {
    const ownerId = await currentUserId();
    if (!ownerId) return {};

    const suffix = `__${ownerId}`;
    try {
      const client = getSupabaseClient();
      // Only rows owned by this user (RLS also enforces this). The prefix is
      // matched against the logical key, so scope it to the user's rows.
      let query = client
        .from("app_kv")
        .select("id, data")
        .eq("owner_id", ownerId);
      if (prefix) query = query.like("id", `${prefix}%`);
      const { data, error } = await query;
      if (error) throw error;

      const out: Record<string, T> = {};
      for (const row of data ?? []) {
        // Strip the user-scope suffix to recover the logical key callers use.
        const logicalKey = row.id.endsWith(suffix)
          ? row.id.slice(0, -suffix.length)
          : row.id;
        out[logicalKey] = decodeRow<T>(row.data) as T;
      }
      return out;
    } catch (err) {
      console.warn("[cloudStorageService.getAll] failed:", err);
      return {};
    }
  }

  /**
   * One-shot migration: compress ALL of the current user's existing `app_kv`
   * rows in place, so legacy uncompressed rows don't keep consuming DB storage
   * + egress. Walks every row owned by the user and re-upserts any row whose
   * `data` is not already a compressed payload (or is a double-encoded string)
   * — preserving the exact row id, station_id, and collection so RLS + realtime
   * are unaffected. Rows already compressed are skipped (no write, no egress).
   * Idempotent: already-compressed rows are skipped. Failures are non-fatal
   * (the per-row self-heal in get() still catches anything missed).
   */
  async compressAllExistingData(): Promise<{
    scanned: number;
    compressed: number;
    skipped: number;
  }> {
    const ownerId = await currentUserId();
    if (!ownerId) return { scanned: 0, compressed: 0, skipped: 0 };

    let scanned = 0;
    let compressed = 0;
    let skipped = 0;
    try {
      const client = getSupabaseClient();
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const { data, error } = await client
          .from("app_kv")
          .select("id, data, station_id")
          .eq("owner_id", ownerId)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{
          id: string;
          data: unknown;
          station_id: string | null;
        }>;
        if (rows.length === 0) break;
        scanned += rows.length;

        for (const row of rows) {
          const unwrapped = coerceJson<unknown>(row.data);
          // Already a compressed payload (and not a double-encoded string)?
          // Skip — no write, no egress. Steady-state fast path.
          if (
            typeof row.data !== "string" &&
            unwrapped != null &&
            isCompressedPayload(unwrapped)
          ) {
            skipped++;
            continue;
          }
          if (unwrapped == null) {
            skipped++;
            continue;
          }
          // Compress the decoded value and write it back to the SAME row id,
          // preserving station_id + collection so RLS/realtime are unaffected.
          const payload = compressJson(unwrapped) as unknown as Json;
          const { error: upErr } = await client.from("app_kv").upsert(
            {
              id: row.id,
              collection: COLLECTION,
              owner_id: ownerId,
              station_id: row.station_id ?? null,
              data: payload,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
          if (upErr) {
            skipped++;
          } else {
            compressed++;
          }
        }

        if (rows.length < pageSize) break;
        offset += pageSize;
      }
    } catch (err) {
      console.warn(
        "[CloudStorage] compressAllExistingData partial failure:",
        err,
      );
    }
    return { scanned, compressed, skipped };
  }

  /** Drop the in-memory cache (forces next get to hit cloud). */
  invalidate(key?: string, stationId?: string): void {
    if (key) {
      const ck = stationId ? `${key}__${stationId}` : key;
      this.memoryCache.delete(ck);
    } else {
      this.memoryCache.clear();
    }
  }

  /**
   * Subscribe to real-time changes on a cloud key. When another device writes
   * to the same app_kv row, the callback fires INSTANTLY with the new value —
   * no polling, no delay. Returns an unsubscribe function.
   *
   * The subscription listens for UPDATE events on app_kv rows matching the
   * computed row id (scoped by owner + station). On receipt, it invalidates
   * the memory cache (so the next get() reads fresh) and calls the callback
   * with the new data.
   */
  subscribe<T = Json>(
    key: string,
    stationId: string | undefined,
    callback: (value: T | null) => void,
  ): () => void {
    // EGRESS-SAVER: when the user has disabled Realtime (Data Manager →
    // Storage & Egress), open NO channels. Cross-device sync falls back to
    // the read-through cache + manual refresh. This is the single biggest
    // reducer of Supabase Realtime message quota (2M/month on Free plan).
    if (!this.realtimeEnabled) {
      return () => {};
    }
    let active = true;
    let unsubMux: (() => void) | null = null;

    (async () => {
      const ownerId = await currentUserId();
      if (!active || !ownerId) return;

      const ck = stationId ? `${key}__${stationId}` : key;
      const scopedId = rowId(key, ownerId, stationId);

      const cb = (newData: T | null) => {
        if (!active) return;
        if (newData != null) {
          writeCache(ck, newData);
          this.memoryCache.set(ck, { value: newData, ts: Date.now() });
        } else {
          clearCache(ck);
        }
        callback(newData);
      };

      // Use the shared owner channel (1 channel for ALL per-key
      // subscriptions) instead of opening a dedicated channel per key —
      // a major Realtime-message egress reduction.
      unsubMux = await this.muxSubscribe<T>(scopedId, ck, cb);
    })();

    return () => {
      active = false;
      if (unsubMux) unsubMux();
    };
  }

  /**
   * Subscribe to real-time changes on ALL app_kv rows for a station. Useful
   * for the FuelContext compact blob + per-component keys that share a
   * station scope. The callback receives the row id + new data for each
   * changed row.
   */
  subscribeToStation<T = Json>(
    stationId: string | undefined,
    callback: (rowId: string, value: T | null) => void,
  ): () => void {
    // EGRESS-SAVER: respect the global Realtime kill-switch (see subscribe()).
    if (!this.realtimeEnabled) {
      return () => {};
    }
    let active = true;
    let unsubMux: (() => void) | null = null;

    (async () => {
      const ownerId = await currentUserId();
      if (!active || !ownerId) return;

      // Use the shared owner-wide mux channel (wildcard) instead of opening
      // a dedicated per-station channel — one channel for the whole app.
      unsubMux = await this.muxSubscribeAll<T>((rowId, value) => {
        if (!active) return;
        // When a stationId is given, only deliver rows scoped to that station.
        if (stationId && !rowId.includes(stationId)) return;
        callback(rowId, value);
      });
    })();

    return () => {
      active = false;
      if (unsubMux) unsubMux();
    };
  }
}

export const cloudStorageService = new CloudStorageService();
export default cloudStorageService;

// ---------------------------------------------------------------------------
// GLOBAL OFFLINE-QUEUE FLUSH LISTENERS
// ---------------------------------------------------------------------------
// Wire up the browser's connectivity events so the offline write queue is
// flushed automatically as soon as the device comes back online — no user
// action required. This is the core of the "offline edits sync when back
// online" feature. A periodic safety-net timer also retries every 30s in case
// the online event doesn't fire (some mobile browsers are unreliable).

if (typeof window !== "undefined") {
  let flushInFlight = false;
  const safeFlush = () => {
    if (flushInFlight) return;
    flushInFlight = true;
    cloudStorageService
      .flushOfflineQueue()
      .catch(() => {})
      .finally(() => {
        flushInFlight = false;
      });
  };

  // 1. Browser reports connectivity is back. Minimal delay — the session is
  //    usually already valid on a reconnect; flushing immediately is what
  //    makes offline edits "take effect when back online" without lag.
  window.addEventListener("online", () => {
    setTimeout(safeFlush, 500);
  });

  // 2. Tab becomes visible again (user returns to the app after being away).
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") safeFlush();
    });
  }

  // 3. Periodic safety-net retry (some mobile browsers don't fire `online`
  //    reliably, and a session can be restored without a network change).
  setInterval(safeFlush, 30_000);

  // 4. Best-effort flush on page load (handles the case where the user made
  //    offline edits, closed the tab, and reopened later while online).
  setTimeout(safeFlush, 3000);
}
