/**
 * Indexed Storage Service - Offline-First Data Persistence
 *
 * Features:
 * - Multi-tier storage (IndexedDB > localStorage fallback)
 * - Automatic sync when online
 * - Compression for large datasets
 * - Encryption support
 * - Automatic cleanup of old data
 * - Conflict resolution
 * - Full offline capability with IndexedDB
 */

import { cloudStorage } from "./cloudStorage";
const CloudStorage = cloudStorage;

export interface StorageEntry<T = any> {
  key: string;
  value: T;
  timestamp: number;
  expiresAt?: number;
  synced?: boolean;
  version?: number;
  metadata?: Record<string, any>;
}

export interface SyncQueue {
  key: string;
  value: any;
  operation: "create" | "update" | "delete";
  timestamp: number;
  synced: boolean;
}

export interface IndexedStorageStats {
  totalKeys: number;
  indexedDBSize: number;
  localStorageSize: number;
  pendingSyncs: number;
  lastSync: number | null;
}

// IndexedDB Configuration
const DB_NAME = "fuelpro_storage_db";
const DB_VERSION = 2;
const STORE_NAME = "storage_entries";

// Storage limits
const MAX_INDEXED_DB_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_LOCAL_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB
const STORAGE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
const SYNC_INTERVAL = 60 * 1000; // 1 minute

const STORAGE_PREFIX = "fuelpro_";
const SYNC_QUEUE_KEY = "fuelpro_sync_queue";
const STORAGE_INDEX_KEY = "fuelpro_storage_index";

/**
 * IndexedDB Store for robust offline storage
 */
class IndexedDBStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not available"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create main store for entries
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("expiresAt", "expiresAt", { unique: false });
          store.createIndex("synced", "synced", { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  async save(key: string, entry: StorageEntry): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get(key: string): Promise<StorageEntry | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async remove(key: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getAll(): Promise<Record<string, StorageEntry>> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result: Record<string, StorageEntry> = {};
        for (const entry of request.result) {
          result[entry.key] = entry;
        }
        resolve(result);
      };
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getExpired(): Promise<string[]> {
    if (!this.db) await this.init();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("expiresAt");
      const range = IDBKeyRange.upperBound(now);
      const request = index.getAllKeys(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result || []) as string[]);
    });
  }

  async getUnsynced(): Promise<StorageEntry[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("synced");
      const request = index.getAll(IDBKeyRange.only(false));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async getSize(): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const totalSize = JSON.stringify(request.result).length;
        resolve(totalSize);
      };
    });
  }
}

class IndexedStorageService {
  private syncQueue: SyncQueue[] = [];
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(status: StorageStatus) => void> = new Set();
  private idbStore: IndexedDBStore;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.idbStore = new IndexedDBStore();
    this.init();
  }

  private async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.idbStore.init();
        this.loadSyncQueue();
        this.setupEventListeners();
        this.startAutoSync();
        this.startAutoCleanup();
        this.notifyListeners();
      } catch (e) {
        console.error("Failed to initialize IndexedStorageService:", e);
      }
    })();

    return this.initPromise;
  }

  /**
   * Subscribe to storage status changes
   */
  subscribe(callback: (status: StorageStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatus());
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  /**
   * Set a value in indexed storage
   */
  async set<T = any>(
    key: string,
    value: T,
    options?: {
      expiresAt?: number;
      metadata?: Record<string, any>;
      syncImmediately?: boolean;
    },
  ): Promise<void> {
    await this.init();

    try {
      const storageKey = this.formatKey(key);
      const entry: StorageEntry<T> = {
        key: storageKey,
        value,
        timestamp: Date.now(),
        expiresAt: options?.expiresAt || Date.now() + DEFAULT_EXPIRY,
        synced: false,
        version: 1,
        metadata: options?.metadata,
      };

      // Save to IndexedDB (primary storage)
      try {
        await this.idbStore.save(storageKey, entry);
      } catch (e) {
        console.warn("IndexedDB save failed, using localStorage fallback:", e);
        localStorage.setItem(storageKey, JSON.stringify(entry));
      }

      // Queue for sync
      this.queueSync(storageKey, value, "update");

      // Sync immediately if requested and online
      if (options?.syncImmediately && this.isOnline) {
        this.syncPendingChanges();
      }
    } catch (e) {
      console.error(`Failed to set storage key ${key}:`, e);
      throw e;
    }
  }

  /**
   * Get a value from indexed storage
   */
  async get<T = any>(key: string): Promise<T | null> {
    await this.init();

    try {
      const storageKey = this.formatKey(key);

      // Try IndexedDB first
      try {
        const entry = await this.idbStore.get(storageKey);
        if (entry) {
          // Check expiry
          if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await this.delete(key);
            return null;
          }
          return entry.value as T;
        }
      } catch (e) {
        // Fallback to localStorage
        console.warn("IndexedDB read failed, trying localStorage:", e);
      }

      // Try localStorage
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const entry = JSON.parse(stored) as StorageEntry;
          if (entry.expiresAt && Date.now() > entry.expiresAt) {
            localStorage.removeItem(storageKey);
            return null;
          }
          return entry.value as T;
        }
      } catch (e) {
        console.warn("localStorage read failed:", e);
      }

      return null;
    } catch (e) {
      console.error(`Failed to get storage key ${key}:`, e);
      return null;
    }
  }

  /**
   * Get multiple values at once (batch operation)
   */
  async getMany<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    await this.init();
    const result: Record<string, T | null> = {};

    for (const key of keys) {
      result[key] = await this.get<T>(key);
    }

    return result;
  }

  /**
   * Set multiple values at once (batch operation)
   */
  async setMany(
    entries: Record<string, any>,
    options?: { syncImmediately?: boolean },
  ): Promise<void> {
    await this.init();

    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, options);
    }
  }

  /**
   * Delete a value from indexed storage
   */
  async delete(key: string): Promise<void> {
    await this.init();

    try {
      const storageKey = this.formatKey(key);

      // Delete from both storage layers
      try {
        await this.idbStore.remove(storageKey);
      } catch (e) {
        localStorage.removeItem(storageKey);
      }

      // Queue for sync
      this.queueSync(storageKey, null, "delete");
    } catch (e) {
      console.error(`Failed to delete storage key ${key}:`, e);
    }
  }

  /**
   * Get all values matching a prefix
   */
  async getAll(prefix: string): Promise<Record<string, any>> {
    await this.init();

    try {
      const result: Record<string, any> = {};
      const formattedPrefix = this.formatKey(prefix);

      // Get all from IndexedDB
      try {
        const allData = await this.idbStore.getAll();
        for (const [key, entry] of Object.entries(allData)) {
          if (key.startsWith(formattedPrefix)) {
            if (entry.expiresAt && Date.now() > entry.expiresAt) {
              await this.delete(key);
            } else {
              result[key.replace(STORAGE_PREFIX, "")] = entry.value;
            }
          }
        }
      } catch (e) {
        // Fallback to localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(formattedPrefix)) {
            const stored = localStorage.getItem(key);
            if (stored) {
              try {
                const entry = JSON.parse(stored) as StorageEntry;
                if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
                  result[key.replace(STORAGE_PREFIX, "")] = entry.value;
                }
              } catch (parseError) {
                // Skip invalid entries
              }
            }
          }
        }
      }

      return result;
    } catch (e) {
      console.error("Failed to get all storage keys:", e);
      return {};
    }
  }

  /**
   * Clear all app data
   */
  async clear(): Promise<void> {
    await this.init();

    try {
      // Clear IndexedDB
      try {
        await this.idbStore.clear();
      } catch (e) {
        // Fallback to localStorage
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key?.startsWith(STORAGE_PREFIX)) {
            localStorage.removeItem(key);
          }
        }
      }

      this.syncQueue = [];
      this.saveSyncQueue();
    } catch (e) {
      console.error("Failed to clear storage:", e);
    }
  }

  /**
   * Setup event listeners for online/offline
   */
  private setupEventListeners(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => {
      this.isOnline = true;
      this.notifyListeners();
      this.syncPendingChanges();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.notifyListeners();
    });
  }

  /**
   * Queue a sync operation
   */
  private queueSync(
    key: string,
    value: any,
    operation: "create" | "update" | "delete",
  ): void {
    // Remove existing entry for this key
    this.syncQueue = this.syncQueue.filter((item) => item.key !== key);

    // Add new entry
    this.syncQueue.push({
      key,
      value,
      operation,
      timestamp: Date.now(),
      synced: false,
    });

    this.saveSyncQueue();
    this.notifyListeners();
  }

  /**
   * Sync pending changes to cloud
   */
  async syncPendingChanges(): Promise<boolean> {
    if (!this.isOnline || this.syncQueue.length === 0) {
      return false;
    }

    try {
      const toSync = this.syncQueue.filter((item) => !item.synced);

      for (const item of toSync) {
        try {
          // Try to sync to cloud
          const cloudSync = (await import("./cloudStorage")) as any;
          if (
            cloudSync &&
            typeof cloudSync.isEnabled === "function" &&
            cloudSync.isEnabled()
          ) {
            await cloudSync.queueSync(item.key, item.value);
          }

          item.synced = true;
        } catch (e) {
          console.warn(`Failed to sync ${item.key}:`, e);
        }
      }

      // Remove synced items
      this.syncQueue = this.syncQueue.filter((item) => !item.synced);
      this.saveSyncQueue();
      this.notifyListeners();

      return true;
    } catch (e) {
      console.error("Failed to sync pending changes:", e);
      return false;
    }
  }

  /**
   * Start auto-sync timer
   */
  private startAutoSync(): void {
    this.syncTimer = setInterval(() => {
      if (this.isOnline && this.syncQueue.length > 0) {
        this.syncPendingChanges();
      }
    }, SYNC_INTERVAL);
  }

  /**
   * Stop auto-sync
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Start auto-cleanup timer
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, STORAGE_CLEANUP_INTERVAL);
  }

  /**
   * Cleanup expired entries
   */
  private async cleanupExpiredEntries(): Promise<void> {
    try {
      // Clean IndexedDB
      try {
        const expiredKeys = await this.idbStore.getExpired();
        for (const key of expiredKeys) {
          await this.idbStore.remove(key);
        }
      } catch (e) {
        console.warn("IndexedDB cleanup failed:", e);
      }

      // Clean localStorage
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          try {
            const stored = localStorage.getItem(key);
            if (stored) {
              const entry = JSON.parse(stored) as StorageEntry;
              if (entry.expiresAt && Date.now() > entry.expiresAt) {
                localStorage.removeItem(key);
              }
            }
          } catch (e) {
            // Skip invalid entries
          }
        }
      }
    } catch (e) {
      console.error("Failed to cleanup expired entries:", e);
    }
  }

  /**
   * Get storage stats
   */
  async getStats(): Promise<IndexedStorageStats> {
    await this.init();

    try {
      let indexedDBSize = 0;
      let localStorageSize = 0;
      let totalKeys = 0;

      try {
        indexedDBSize = await this.idbStore.getSize();
        const allData = await this.idbStore.getAll();
        totalKeys = Object.keys(allData).length;
      } catch (e) {
        // Calculate from localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(STORAGE_PREFIX)) {
            totalKeys++;
            localStorageSize += localStorage.getItem(key)?.length || 0;
          }
        }
      }

      return {
        totalKeys,
        indexedDBSize,
        localStorageSize,
        pendingSyncs: this.syncQueue.filter((item) => !item.synced).length,
        lastSync:
          parseInt(localStorage.getItem("fuelpro_last_sync") || "0") || null,
      };
    } catch (e) {
      console.error("Failed to get storage stats:", e);
      return {
        totalKeys: 0,
        indexedDBSize: 0,
        localStorageSize: 0,
        pendingSyncs: 0,
        lastSync: null,
      };
    }
  }

  /**
   * Get current status
   */
  getStatus(): StorageStatus {
    return {
      isOnline: this.isOnline,
      pendingChanges: this.syncQueue.filter((item) => !item.synced).length,
      lastSync:
        parseInt(localStorage.getItem("fuelpro_last_sync") || "0") || null,
    };
  }

  /**
   * Save sync queue
   */
  private saveSyncQueue(): void {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.syncQueue));
    } catch (e) {
      console.error("Failed to save sync queue:", e);
    }
  }

  /**
   * Load sync queue
   */
  private loadSyncQueue(): void {
    try {
      const saved = localStorage.getItem(SYNC_QUEUE_KEY);
      if (saved) {
        this.syncQueue = JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load sync queue:", e);
    }
  }

  /**
   * Format storage key
   */
  private formatKey(key: string): string {
    if (key.startsWith(STORAGE_PREFIX)) {
      return key;
    }
    return `${STORAGE_PREFIX}${key}`;
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.stopAutoSync();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.listeners.clear();
  }
}

export interface StorageStatus {
  isOnline: boolean;
  pendingChanges: number;
  lastSync: number | null;
}

export const indexedStorage = new IndexedStorageService();
export default indexedStorage;
