/**
 * Cloud Sync Layer - FuelPro
 *
 * This module provides a cloud-synced data store backed by Supabase
 * (PostgreSQL + Row Level Security), the app's primary backend.
 * Falls back to localStorage when offline or when a request fails.
 *
 * NOTE: This file previously used Firebase Firestore, but the rest of the
 * app (auth, station/sales data, etc. — see src/supabase/*) already runs on
 * Supabase. That split caused a real bug: the Firestore health-check here
 * failed silently and its error-path referenced an undefined `API_URL`
 * variable, so `checkApiStatus()` always resolved to "No Cloud" even when
 * the app was otherwise online (see BUG_REPORT.md, Bug #1). This rewrite
 * fixes that by checking Supabase directly and removes the dead Firebase
 * dependency here.
 *
 * Collections with a real dedicated Postgres table:
 *   - stations   -> `stations`
 *   - sales      -> `sales`
 *   - users      -> `team_members`
 *   - audit_log  -> `audit_log`
 *
 * Collections without a dedicated table (secrets, feature_flags, config,
 * sales_analytics) are stored in a generic `app_kv` table.
 * See supabase/migrations/002_app_kv.sql — run it once in the Supabase
 * SQL editor if you haven't already (also included in supabase/schema.sql).
 */

import { supabase } from "@/supabase/client";
import { compressJson, decompressAny } from "@/react-app/lib/compression";

// ═══════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════

export enum Collections {
  USERS = "users",
  STATIONS = "stations",
  SALES = "sales",
  AUDIT_LOG = "audit_log",
  SECRETS = "secrets",
  FEATURE_FLAGS = "feature_flags",
  CONFIG = "config",
  SALES_ANALYTICS = "sales_analytics",
}

// Collections backed by a dedicated Postgres table (name matches table name,
// except USERS which maps to team_members)
const DEDICATED_TABLE: Partial<Record<Collections, string>> = {
  [Collections.STATIONS]: "stations",
  [Collections.SALES]: "sales",
  [Collections.USERS]: "team_members",
  [Collections.AUDIT_LOG]: "audit_log",
};

function tableFor(collection: string): string | null {
  return (DEDICATED_TABLE as Record<string, string>)[collection] ?? null;
}

export interface DataRecord {
  id: string;
  collection: string;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  stationId?: string;
}

// ═══════════════════════════════════════════════════
// CRUD OPERATIONS - BACKED BY SUPABASE
// ═══════════════════════════════════════════════════

export async function createRecord(
  collection: string,
  data: Record<string, any>,
  userId?: string,
  stationId?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const id = `${collection}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record: DataRecord = {
    id,
    collection,
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId,
    stationId,
  };

  try {
    const table = tableFor(collection);
    if (table) {
      const { error } = await supabase.from(table).insert({ id, ...data });
      if (error) throw error;
    } else {
      const { error } = await supabase.from("app_kv").upsert({
        id,
        collection,
        owner_id: userId ?? null,
        station_id: stationId ?? null,
        data: compressJson(data) as any,
      });
      if (error) throw error;
    }
    return { success: true, id };
  } catch (err: any) {
    // Fallback to localStorage so the UI keeps working offline
    localStorage.setItem(`fuelpro_${collection}_${id}`, JSON.stringify(record));
    return {
      success: true,
      id,
      error: `Saved locally: ${err?.message ?? "unknown error"}`,
    };
  }
}

export async function getRecord(
  collection: string,
  id: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const table = tableFor(collection);
    if (table) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return { success: true, data };
    } else {
      const { data, error } = await supabase
        .from("app_kv")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return { success: true, data: decompressAny(data?.data) ?? data?.data };
    }
  } catch (err: any) {
    const localData = localStorage.getItem(`fuelpro_${collection}_${id}`);
    if (localData) {
      return { success: true, data: JSON.parse(localData) };
    }
    return { success: false, error: err?.message ?? "Not found" };
  }
}

export async function updateRecord(
  collection: string,
  id: string,
  data: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = tableFor(collection);
    if (table) {
      const { error } = await supabase.from(table).update(data).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("app_kv")
        .update({ data: compressJson(data) as any })
        .eq("id", id);
      if (error) throw error;
    }
    return { success: true };
  } catch (err: any) {
    const existing = localStorage.getItem(`fuelpro_${collection}_${id}`);
    if (existing) {
      const record = JSON.parse(existing);
      record.data = { ...record.data, ...data };
      record.updatedAt = new Date().toISOString();
      localStorage.setItem(
        `fuelpro_${collection}_${id}`,
        JSON.stringify(record),
      );
    }
    return {
      success: true,
      error: `Saved locally: ${err?.message ?? "unknown error"}`,
    };
  }
}

export async function deleteRecord(
  collection: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = tableFor(collection) ?? "app_kv";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    localStorage.removeItem(`fuelpro_${collection}_${id}`);
    return {
      success: true,
      error: `Deleted locally: ${err?.message ?? "unknown error"}`,
    };
  }
}

export async function listRecords(
  collection: string,
  options?: { userId?: string; stationId?: string; limit?: number },
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  try {
    const table = tableFor(collection);
    if (table) {
      let q = supabase.from(table).select("*");
      if (options?.stationId) q = q.eq("station_id", options.stationId);
      if (options?.limit) q = q.limit(options.limit);
      const { data, error } = await q;
      if (error) throw error;
      return { success: true, data: data ?? [] };
    } else {
      let q = supabase.from("app_kv").select("*").eq("collection", collection);
      if (options?.userId) q = q.eq("owner_id", options.userId);
      if (options?.stationId) q = q.eq("station_id", options.stationId);
      if (options?.limit) q = q.limit(options.limit);
      const { data, error } = await q;
      if (error) throw error;
      return {
        success: true,
        data: (data ?? []).map((row) => ({
          id: row.id,
          ...decompressAny(row.data),
        })),
      };
    }
  } catch (err: any) {
    // Fallback to localStorage cache
    const results: any[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`fuelpro_${collection}_`)) {
        const data = localStorage.getItem(key);
        if (data) results.push(JSON.parse(data));
      }
    }
    return {
      success: true,
      data: results,
      error: `Retrieved from local cache: ${err?.message ?? "unknown error"}`,
    };
  }
}

// ═══════════════════════════════════════════════════
// SPECIALIZED STORES
// ═══════════════════════════════════════════════════

export const auditLogStore = {
  async add(
    event: string,
    detail: string,
    user: string,
    severity: string = "info",
  ) {
    return createRecord(Collections.AUDIT_LOG, {
      event,
      detail,
      user,
      severity,
      action: event,
      timestamp: new Date().toISOString(),
    });
  },
  async list(limit = 100) {
    return listRecords(Collections.AUDIT_LOG, { limit });
  },
};

export const userStore = {
  async create(data: any) {
    return createRecord(Collections.USERS, data);
  },
  async update(id: string, data: any) {
    return updateRecord(Collections.USERS, id, data);
  },
  async get(id: string) {
    return getRecord(Collections.USERS, id);
  },
  async list(options?: { limit?: number }) {
    return listRecords(Collections.USERS, options);
  },
};

export const stationStore = {
  async create(data: any, stationId?: string) {
    return createRecord(Collections.STATIONS, data, undefined, stationId);
  },
  async update(id: string, data: any) {
    return updateRecord(Collections.STATIONS, id, data);
  },
  async get(id: string) {
    return getRecord(Collections.STATIONS, id);
  },
  async list(stationId?: string) {
    return listRecords(Collections.STATIONS, { stationId });
  },
};

export const secretsStore = {
  async create(data: { key: string; value: string }) {
    return createRecord(Collections.SECRETS, data);
  },
  async update(id: string, data: { key: string; value: string }) {
    return updateRecord(Collections.SECRETS, id, data);
  },
  async delete(id: string) {
    return deleteRecord(Collections.SECRETS, id);
  },
  async list() {
    return listRecords(Collections.SECRETS);
  },
};

export const featureFlagsStore = {
  async create(data: {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
  }) {
    return createRecord(Collections.FEATURE_FLAGS, data);
  },
  async update(id: string, data: any) {
    return updateRecord(Collections.FEATURE_FLAGS, id, data);
  },
  async list() {
    return listRecords(Collections.FEATURE_FLAGS);
  },
};

export const salesStore = {
  async create(data: any, stationId?: string) {
    return createRecord(Collections.SALES, data, undefined, stationId);
  },
  async list(stationId?: string, limit?: number) {
    return listRecords(Collections.SALES, { stationId, limit });
  },
  async analytics(stationId?: string) {
    return listRecords(Collections.SALES_ANALYTICS, { stationId, limit: 1 });
  },
};

export const configStore = {
  async get(key: string) {
    return getRecord(Collections.CONFIG, key);
  },
  async set(key: string, value: any) {
    const existing = await getRecord(Collections.CONFIG, key);
    if (existing.success) {
      return updateRecord(Collections.CONFIG, key, value);
    }
    return createRecord(Collections.CONFIG, { key, value });
  },
  async list() {
    return listRecords(Collections.CONFIG);
  },
};

// ═══════════════════════════════════════════════════
// STATUS CHECK (fixed: was checking a nonexistent Firestore doc and had
// an undefined `API_URL` fallback that threw silently — see header note)
// ═══════════════════════════════════════════════════

export async function checkApiStatus(): Promise<{
  connected: boolean;
  url: string;
  error?: string;
}> {
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "Supabase";
  try {
    // Lightweight, real connectivity check against a table that always
    // exists in the schema, regardless of whether the caller is signed in
    // (RLS may return 0 rows but that's still a successful connection).
    const { error } = await supabase.from("stations").select("id").limit(1);
    if (error) throw error;
    return { connected: true, url: supabaseUrl };
  } catch (err: any) {
    return {
      connected: false,
      url: supabaseUrl,
      error: err?.message ?? "Unable to reach Supabase",
    };
  }
}

/**
 * apiRequest - small compatibility shim for the couple of call sites
 * (FounderAccess user management) that used to call a REST API that
 * doesn't exist in this project. Backed by the real `team_members` table.
 */
export async function apiRequest<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, any>,
): Promise<T> {
  // /api/users
  if (path === "/api/users" && method === "GET") {
    const { data, error } = await supabase.from("team_members").select("*");
    if (error) throw error;
    return { users: data ?? [] } as unknown as T;
  }
  // /api/users/:id
  const userMatch = path.match(/^\/api\/users\/(.+)$/);
  if (userMatch && method === "PUT") {
    const [, id] = userMatch;
    const { data, error } = await supabase
      .from("team_members")
      .update(body ?? {})
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as T;
  }
  throw new Error(`apiRequest: unsupported route "${method} ${path}"`);
}

// ═══════════════════════════════════════════════════
// OFFLINE QUEUE
// ═══════════════════════════════════════════════════

const PENDING_CHANGES_KEY = "fuelpro_pending_changes";

interface PendingChange {
  id: string;
  collection: string;
  operation: "create" | "update" | "delete";
  data?: any;
  timestamp: number;
}

export function queuePendingChange(
  collection: string,
  operation: "create" | "update" | "delete",
  data?: any,
  localId?: string,
): void {
  const queue = getPendingChanges();
  queue.push({
    id: localId || `${collection}_${Date.now()}`,
    collection,
    operation,
    data,
    timestamp: Date.now(),
  });
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(queue));
}

export function getPendingChanges(): PendingChange[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_CHANGES_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearPendingChanges(): void {
  localStorage.setItem(PENDING_CHANGES_KEY, "[]");
}

export function getPendingCount(): number {
  return getPendingChanges().length;
}
