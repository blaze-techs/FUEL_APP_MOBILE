// Cross-Device Sync Engine for FuelPro
// Uses BroadcastChannel (same-browser) + IndexedDB (offline persistence) + Export/Import (cross-device)
// Designed for low-bandwidth, offline-first fuel station operations

const SYNC_DB = "fuelpro-sync";
const SYNC_STORE = "sync_queue";
const SYNC_META = "sync_meta";
const BROADCAST_KEY = "fuelpro_broadcast";

export interface SyncItem {
  id: string;
  collection: string;
  operation: "create" | "update" | "delete";
  data: any;
  timestamp: number;
  deviceId: string;
  synced: boolean;
}

interface SyncState {
  lastSync: number;
  deviceId: string;
  pendingCount: number;
  isOnline: boolean;
}

// Unique device identifier
function getDeviceId(): string {
  let id = localStorage.getItem("fuelpro_device_id");
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("fuelpro_device_id", id);
  }
  return id;
}

// Open IndexedDB for sync queue
async function openSyncDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SYNC_META)) {
        db.createObjectStore(SYNC_META, { keyPath: "key" });
      }
    };
  });
}

// Queue a mutation for sync
export async function queueMutation(
  collection: string,
  operation: "create" | "update" | "delete",
  data: any,
): Promise<string> {
  const db = await openSyncDB();
  const id = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const item: SyncItem = {
    id,
    collection,
    operation,
    data,
    timestamp: Date.now(),
    deviceId: getDeviceId(),
    synced: false,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, "readwrite");
    const store = tx.objectStore(SYNC_STORE);
    const req = store.add(item);
    req.onsuccess = () => {
      // Broadcast to other tabs
      broadcastMutation(item);
      resolve(id);
    };
    req.onerror = () => reject(req.error);
  });
}

// Get pending sync queue
export async function getPendingQueue(): Promise<SyncItem[]> {
  const db = await openSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, "readonly");
    const store = tx.objectStore(SYNC_STORE);
    const req = store.openCursor();
    const items: SyncItem[] = [];
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        if (!cursor.value.synced) items.push(cursor.value);
        cursor.continue();
      } else {
        items.sort((a, b) => a.timestamp - b.timestamp);
        resolve(items);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Mark item as synced
export async function markSynced(id: string): Promise<void> {
  const db = await openSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, "readwrite");
    const store = tx.objectStore(SYNC_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      if (item) {
        item.synced = true;
        store.put(item);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Clear old synced items
export async function cleanupSynced(
  olderThanMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const db = await openSyncDB();
  const cutoff = Date.now() - olderThanMs;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, "readwrite");
    const store = tx.objectStore(SYNC_STORE);
    const req = store.openCursor();
    let cleared = 0;
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        if (cursor.value.synced && cursor.value.timestamp < cutoff) {
          store.delete(cursor.value.id);
          cleared++;
        }
        cursor.continue();
      } else {
        resolve(cleared);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// BroadcastChannel for instant cross-tab sync
let bc: BroadcastChannel | null = null;
try {
  bc = new BroadcastChannel(BROADCAST_KEY);
} catch {
  /* BroadcastChannel not supported */
}

function broadcastMutation(item: SyncItem): void {
  if (bc) {
    bc.postMessage({ type: "mutation", item });
  }
  // Fallback: localStorage event
  try {
    localStorage.setItem(
      "fuelpro_sync_ping",
      JSON.stringify({ ts: Date.now(), id: item.id }),
    );
  } catch {
    /* */
  }
}

// Subscribe to cross-tab mutations
export function onMutation(callback: (item: SyncItem) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === "mutation" && e.data?.item) {
      const item = e.data.item as SyncItem;
      // Ignore own mutations
      if (item.deviceId !== getDeviceId()) {
        callback(item);
      }
    }
  };

  const storageHandler = (e: StorageEvent) => {
    if (e.key === "fuelpro_sync_ping") {
      // Trigger a refresh from IndexedDB
      getPendingQueue()
        .then((queue) => {
          queue.forEach((item) => {
            if (item.deviceId !== getDeviceId()) callback(item);
          });
        })
        .catch((err) => console.warn("[syncEngine] async op failed:", err));
    }
  };

  if (bc) bc.addEventListener("message", handler);
  window.addEventListener("storage", storageHandler);

  return () => {
    if (bc) bc.removeEventListener("message", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

// Export all data for cross-device transfer
export async function exportAllData(): Promise<string> {
  const data: Record<string, any> = {};

  // Collect all localStorage items
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("fuelpro_")) {
      try {
        data[key] = JSON.parse(localStorage.getItem(key)!);
      } catch {
        data[key] = localStorage.getItem(key);
      }
    }
  }

  // Collect IndexedDB documents
  try {
    const db = await openSyncDB();
    const tx = db.transaction(SYNC_STORE, "readonly");
    const store = tx.objectStore(SYNC_STORE);
    const req = store.getAll();
    const items = await new Promise<any[]>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    data["_sync_queue"] = items;
  } catch {
    /* */
  }

  return JSON.stringify(data, null, 2);
}

// Import data from another device
export async function importAllData(
  jsonString: string,
): Promise<{ imported: number; errors: number }> {
  let imported = 0;
  let errors = 0;

  try {
    const data = JSON.parse(jsonString);
    for (const [key, value] of Object.entries(data)) {
      if (key === "_sync_queue") continue; // Don't import sync queue
      if (key.startsWith("fuelpro_")) {
        try {
          if (typeof value === "string") {
            localStorage.setItem(key, value);
          } else {
            localStorage.setItem(key, JSON.stringify(value));
          }
          imported++;
        } catch {
          errors++;
        }
      }
    }
  } catch {
    errors++;
  }

  return { imported, errors };
}

// Get sync status
export async function getSyncState(): Promise<SyncState> {
  const pending = await getPendingQueue();
  return {
    lastSync: Number(localStorage.getItem("fuelpro_last_sync") || "0"),
    deviceId: getDeviceId(),
    pendingCount: pending.length,
    isOnline: navigator.onLine,
  };
}

// Sync Monitor - tracks all sync activity
export class SyncMonitor {
  private listeners: Set<(state: SyncState) => void> = new Set();
  private interval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number = 5000) {
    this.stop();
    this.interval = setInterval(async () => {
      const state = await getSyncState();
      this.listeners.forEach((cb) => cb(state));
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  subscribe(callback: (state: SyncState) => void): () => void {
    this.listeners.add(callback);
    // Initial call
    getSyncState()
      .then((state) => callback(state))
      .catch((err) => console.warn("[syncEngine] async op failed:", err));
    return () => this.listeners.delete(callback);
  }
}

export const syncMonitor = new SyncMonitor();
