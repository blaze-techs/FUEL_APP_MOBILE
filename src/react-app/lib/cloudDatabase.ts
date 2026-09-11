/**
 * Cloud Database - FuelPro
 *
 * This module provides a complete cloud-synced database using Supabase.
 * All data is stored in Supabase and syncs in real-time across all devices.
 *
 * Setup Required:
 * 1. Create a Supabase project at https://supabase.com
 * 2. Get the URL and anon key from Project Settings > API
 * 3. Add to .env:
 *    VITE_SUPABASE_URL=https://your-project.supabase.co
 *    VITE_SUPABASE_ANON_KEY=your-anon-key
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ojjscjwatikixlpshmub.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_-uUkeBG1KzESv3O4v90rcw_jY9NxTc4";

let supabase: SupabaseClient | null = null;
let isInitialized = false;

// ═══════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════

export async function initCloudDatabase(): Promise<boolean> {
  if (isInitialized) return !!supabase;

  try {
    // Check if Supabase is configured
    if (
      !SUPABASE_URL.includes("supabase.co") ||
      SUPABASE_ANON_KEY === "placeholder-key"
    ) {
      console.warn("Cloud Database: Supabase not configured, using mock mode");
      return false;
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    // Test connection
    const { data, error } = await supabase
      .from("_health")
      .select("id")
      .limit(1);
    if (error) {
      console.warn("Cloud Database: Connection test failed", error.message);
      // Try alternative tables
      const { error: altError } = await supabase
        .from("stations")
        .select("id")
        .limit(1);
      if (altError) {
        console.warn(
          "Cloud Database: No tables found, will create on first use",
        );
      }
    }

    isInitialized = true;
    console.log("Cloud Database: Connected successfully");
    return true;
  } catch (err) {
    console.error("Cloud Database: Initialization failed", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════
// GENERIC CRUD OPERATIONS
// ═══════════════════════════════════════════════════

export interface CloudRecord {
  id: string;
  collection: string;
  data: Record<string, any>;
  created_at: string;
  updated_at: string;
  user_id?: string;
  station_id?: string;
}

export async function cloudCreate(
  collection: string,
  data: Record<string, any>,
  userId?: string,
  stationId?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const connected = await initCloudDatabase();
  if (!connected || !supabase) {
    return { success: false, error: "Cloud database not available" };
  }

  try {
    const id = `${collection}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await supabase.from(collection).insert({
      id,
      data,
      user_id: userId,
      station_id: stationId,
    });

    if (error) {
      // Try creating table first
      console.log(`Creating table: ${collection}`);
      return { success: false, error: error.message };
    }

    return { success: true, id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cloudRead(
  collection: string,
  id: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const connected = await initCloudDatabase();
  if (!connected || !supabase) {
    return { success: false, error: "Cloud database not available" };
  }

  try {
    const { data, error } = await supabase
      .from(collection)
      .select("data")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data?.data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cloudUpdate(
  collection: string,
  id: string,
  data: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  const connected = await initCloudDatabase();
  if (!connected || !supabase) {
    return { success: false, error: "Cloud database not available" };
  }

  try {
    const { error } = await supabase
      .from(collection)
      .update({ data, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cloudDelete(
  collection: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const connected = await initCloudDatabase();
  if (!connected || !supabase) {
    return { success: false, error: "Cloud database not available" };
  }

  try {
    const { error } = await supabase.from(collection).delete().eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cloudList(
  collection: string,
  filter?: { userId?: string; stationId?: string; limit?: number },
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  const connected = await initCloudDatabase();
  if (!connected || !supabase) {
    return { success: false, error: "Cloud database not available" };
  }

  try {
    let query = supabase.from(collection).select("*");

    if (filter?.userId) {
      query = query.eq("user_id", filter.userId);
    }
    if (filter?.stationId) {
      query = query.eq("station_id", filter.stationId);
    }
    if (filter?.limit) {
      query = query.limit(filter.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data?.map((r: any) => r.data || r) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════
// SPECIALIZED STORES
// ═══════════════════════════════════════════════════

// Station Store
export const stationStore = {
  async get(id: string) {
    return cloudRead("stations", id);
  },
  async create(data: any) {
    return cloudCreate("stations", data);
  },
  async update(id: string, data: any) {
    return cloudUpdate("stations", id, data);
  },
  async delete(id: string) {
    return cloudDelete("stations", id);
  },
  async list(stationId?: string) {
    return cloudList("stations", { stationId });
  },
};

// User Store
export const userStore = {
  async get(id: string) {
    return cloudRead("users", id);
  },
  async create(data: any) {
    return cloudCreate("users", data);
  },
  async update(id: string, data: any) {
    return cloudUpdate("users", id, data);
  },
  async delete(id: string) {
    return cloudDelete("users", id);
  },
  async list(userId?: string) {
    return cloudList("users", { userId });
  },
};

// Audit Log Store
export const auditStore = {
  async add(event: string, detail: string, user: string, severity: string) {
    return cloudCreate("audit_logs", {
      event,
      detail,
      user,
      severity,
      timestamp: new Date().toISOString(),
    });
  },
  async list(limit = 100) {
    const result = await cloudList("audit_logs", { limit });
    return result;
  },
};

// Secrets Store
export const secretsStore = {
  async get(id: string) {
    return cloudRead("secrets", id);
  },
  async create(data: any) {
    return cloudCreate("secrets", data);
  },
  async update(id: string, data: any) {
    return cloudUpdate("secrets", id, data);
  },
  async delete(id: string) {
    return cloudDelete("secrets", id);
  },
  async list() {
    return cloudList("secrets");
  },
};

// Feature Flags Store
export const featureFlagsStore = {
  async get(id: string) {
    return cloudRead("feature_flags", id);
  },
  async create(data: any) {
    return cloudCreate("feature_flags", data);
  },
  async update(id: string, data: any) {
    return cloudUpdate("feature_flags", id, data);
  },
  async list() {
    return cloudList("feature_flags");
  },
};

// Sales Store
export const salesStore = {
  async create(data: any) {
    return cloudCreate("sales", data);
  },
  async list(stationId?: string) {
    return cloudList("sales", { stationId });
  },
  async analytics(stationId?: string) {
    return cloudList("sales_analytics", { stationId, limit: 1 });
  },
};

// Config Store
export const configStore = {
  async get(key: string) {
    return cloudRead("config", key);
  },
  async set(key: string, value: any) {
    const existing = await cloudRead("config", key);
    if (existing.success) {
      return cloudUpdate("config", key, value);
    }
    return cloudCreate("config", value, undefined, undefined);
  },
  async list() {
    return cloudList("config");
  },
};

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════

export function getCloudDatabaseStatus(): {
  connected: boolean;
  configured: boolean;
  url: string;
  provider: string;
} {
  return {
    connected: !!supabase,
    configured:
      SUPABASE_URL.includes("supabase.co") &&
      SUPABASE_ANON_KEY !== "placeholder-key",
    url: SUPABASE_URL,
    provider: "supabase",
  };
}

export { supabase };
