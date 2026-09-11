// Multi-Cloud Storage Sync for FuelPro
// Uses Firebase (primary) + Supabase (backup) + localStorage (fallback)
// Auto-switches between providers for maximum reliability

// Import unified cloud storage (includes R2, Upstash, Seafile, Custom API)
export * from "./cloudStorage";
import { swr, invalidateSWR, getSWRStats, cloudStorage } from "./cloudStorage";

// ═══════════════════════════════════════════════════
// PROVIDER 1: Firebase Realtime Database
// ═══════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

let firebaseDB: any = null;

async function initFirebase(): Promise<boolean> {
  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.databaseURL) return false;
  try {
    const { initializeApp } = await import("firebase/app");
    const { getDatabase, ref, set, get, onValue, off } =
      await import("firebase/database");
    const app = initializeApp(FIREBASE_CONFIG);
    firebaseDB = { db: getDatabase(app), ref, set, get, onValue, off };
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════
// PROVIDER 2: Supabase
// ═══════════════════════════════════════════════════

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ojjscjwatikixlpshmub.supabase.co";
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_KEY ||
  "sb_publishable_-uUkeBG1KzESv3O4v90rcw_jY9NxTc4";

let supabaseClient: any = null;

async function initSupabase(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await supabaseClient.from("health").select("*").limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════
// UNIFIED SYNC ENGINE
// ═══════════════════════════════════════════════════

interface SyncRecord {
  id: string;
  collection: string;
  data: any;
  timestamp: number;
  deviceId: string;
  version: number;
}

const STORAGE_KEY = "fuelpro_cloud_data";
const SYNC_QUEUE_KEY = "fuelpro_sync_queue";
const LAST_SYNC_KEY = "fuelpro_last_sync";
const ACTIVE_PROVIDER_KEY = "fuelpro_cloud_provider";

// Device ID
function getDeviceId(): string {
  let id = localStorage.getItem("fuelpro_device_id");
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("fuelpro_device_id", id);
  }
  return id;
}

// Get current active provider
function getActiveProvider(): string {
  return localStorage.getItem(ACTIVE_PROVIDER_KEY) || "local";
}

function setActiveProvider(provider: string): void {
  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
}

// ═══════════════════════════════════════════════════
// SAVE: Write to all available providers
// ═══════════════════════════════════════════════════

export async function cloudSave(
  collection: string,
  id: string,
  data: any,
): Promise<boolean> {
  const record: SyncRecord = {
    id,
    collection,
    data,
    timestamp: Date.now(),
    deviceId: getDeviceId(),
    version: (data._version || 0) + 1,
  };

  // Always save to localStorage (primary)
  const localData = getLocalData();
  if (!localData[collection]) localData[collection] = {};
  localData[collection][id] = record;
  saveLocalData(localData);

  // Queue for cloud sync
  queueForSync(record);

  // Try Firebase
  if (await initFirebase()) {
    try {
      const path = `stations/${getStationId()}/${collection}/${id}`;
      await firebaseDB.set(firebaseDB.ref(firebaseDB.db, path), record);
      setActiveProvider("firebase");
      return true;
    } catch {
      /* fallback */
    }
  }

  // Try Supabase
  if (await initSupabase()) {
    try {
      await supabaseClient.from(collection).upsert({
        id,
        data: record.data,
        timestamp: record.timestamp,
        device_id: record.deviceId,
        station_id: getStationId(),
      });
      setActiveProvider("supabase");
      return true;
    } catch {
      /* fallback */
    }
  }

  return true; // localStorage always succeeds
}

// ═══════════════════════════════════════════════════
// LOAD: Read from best available provider
// ═══════════════════════════════════════════════════

export async function cloudLoad(collection: string, id?: string): Promise<any> {
  const provider = getActiveProvider();

  // Try Firebase first
  if (provider === "firebase" && (await initFirebase())) {
    try {
      const path = id
        ? `stations/${getStationId()}/${collection}/${id}`
        : `stations/${getStationId()}/${collection}`;
      const snapshot = await firebaseDB.get(
        firebaseDB.ref(firebaseDB.db, path),
      );
      if (snapshot.exists()) return id ? snapshot.val()?.data : snapshot.val();
    } catch {
      /* fallback */
    }
  }

  // Try Supabase
  if (provider === "supabase" && (await initSupabase())) {
    try {
      const query = supabaseClient
        .from(collection)
        .select("*")
        .eq("station_id", getStationId());
      if (id) query.eq("id", id);
      const { data, error } = await query.limit(100);
      if (!error && data) return id ? data[0]?.data : data;
    } catch {
      /* fallback */
    }
  }

  // Fallback: localStorage
  const localData = getLocalData();
  if (id) {
    return localData[collection]?.[id]?.data || null;
  }
  return localData[collection] || {};
}

// ═══════════════════════════════════════════════════
// SYNC: Push/pull all data
// ═══════════════════════════════════════════════════

export async function syncAll(): Promise<{
  uploaded: number;
  downloaded: number;
  provider: string;
  errors: string[];
}> {
  const result = {
    uploaded: 0,
    downloaded: 0,
    provider: "local",
    errors: [] as string[],
  };

  // Get all local data
  const localData = getLocalData();
  const queue = getSyncQueue();

  // Try Firebase
  if (await initFirebase()) {
    try {
      for (const record of queue) {
        const path = `stations/${getStationId()}/${record.collection}/${record.id}`;
        await firebaseDB.set(firebaseDB.ref(firebaseDB.db, path), record);
        result.uploaded++;
      }

      // Pull from cloud
      const snapshot = await firebaseDB.get(
        firebaseDB.ref(firebaseDB.db, `stations/${getStationId()}`),
      );
      if (snapshot.exists()) {
        const cloudData = snapshot.val();
        mergeCloudData(localData, cloudData);
        result.downloaded = Object.keys(cloudData).length;
      }

      setActiveProvider("firebase");
      result.provider = "firebase";
      clearSyncQueue();
      return result;
    } catch (e: any) {
      result.errors.push(`Firebase: ${e.message}`);
    }
  }

  // Try Supabase
  if (await initSupabase()) {
    try {
      for (const record of queue) {
        await supabaseClient.from(record.collection).upsert({
          id: record.id,
          data: record.data,
          timestamp: record.timestamp,
          device_id: record.deviceId,
          station_id: getStationId(),
        });
        result.uploaded++;
      }

      const { data: cloudRows } = await supabaseClient
        .from("fuel_data")
        .select("*")
        .eq("station_id", getStationId());
      if (cloudRows) result.downloaded = cloudRows.length;

      setActiveProvider("supabase");
      result.provider = "supabase";
      clearSyncQueue();
      return result;
    } catch (e: any) {
      result.errors.push(`Supabase: ${e.message}`);
    }
  }

  // localStorage only
  clearSyncQueue();
  return result;
}

// ═══════════════════════════════════════════════════
// LOCAL HELPERS
// ═══════════════════════════════════════════════════

function getLocalData(): Record<string, Record<string, SyncRecord>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalData(data: Record<string, Record<string, SyncRecord>>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getSyncQueue(): SyncRecord[] {
  try {
    return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function queueForSync(record: SyncRecord): void {
  const queue = getSyncQueue();
  queue.push(record);
  if (queue.length > 1000) queue.shift(); // Prevent unbounded growth
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

function clearSyncQueue(): void {
  localStorage.setItem(SYNC_QUEUE_KEY, "[]");
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
}

function getStationId(): string {
  try {
    const station = JSON.parse(localStorage.getItem("fuelpro_station") || "{}");
    return station.id || "default";
  } catch {
    return "default";
  }
}

function mergeCloudData(
  local: Record<string, any>,
  cloud: Record<string, any>,
): void {
  for (const [collection, items] of Object.entries(cloud)) {
    if (!local[collection]) local[collection] = {};
    for (const [id, record] of Object.entries(
      items as Record<string, SyncRecord>,
    )) {
      const localRecord = local[collection][id] as SyncRecord | undefined;
      if (
        !localRecord ||
        (record as SyncRecord).timestamp > localRecord.timestamp
      ) {
        local[collection][id] = record;
      }
    }
  }
  saveLocalData(local);
}

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════

export function getCloudStatus(): {
  provider: string;
  deviceId: string;
  lastSync: number;
  pendingSync: number;
  collections: number;
  totalRecords: number;
} {
  const data = getLocalData();
  let totalRecords = 0;
  for (const coll of Object.values(data)) {
    totalRecords += Object.keys(coll).length;
  }

  return {
    provider: getActiveProvider(),
    deviceId: getDeviceId(),
    lastSync: Number(localStorage.getItem(LAST_SYNC_KEY) || "0"),
    pendingSync: getSyncQueue().length,
    collections: Object.keys(data).length,
    totalRecords,
  };
}

// ═══════════════════════════════════════════════════
// RE-EXPORT CLOUD STORAGE FEATURES
// ═══════════════════════════════════════════════════

// Re-export for convenience
export { swr, invalidateSWR, getSWRStats, cloudStorage };
export type { FuelProCloudSync, SyncStatus, CloudConfig } from "./cloudStorage";
