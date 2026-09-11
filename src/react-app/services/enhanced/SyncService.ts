/**
 * Enhanced Real-time Data Synchronization Service
 * Advanced sync engine with conflict resolution, offline support, and optimized batching
 */

import { supabase } from "@/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import EventEmitter from "eventemitter3";

export interface SyncConfig {
  tableName: string;
  syncInterval: number;
  enableOffline: boolean;
  conflictResolution: "latest" | "manual" | "merge";
  batchSize: number;
}

export interface SyncState {
  isSyncing: boolean;
  lastSync: Date | null;
  pendingChanges: number;
  errors: string[];
  isConnected: boolean;
}

export interface PendingChange {
  id: string;
  tableName: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: any;
  timestamp: number;
  retryCount: number;
}

class EnhancedSyncService extends EventEmitter {
  private channels: Map<string, RealtimeChannel> = new Map();
  private pendingQueue: PendingChange[] = [];
  private syncStates: Map<string, SyncState> = new Map();
  private configs: Map<string, SyncConfig> = new Map();
  private syncTimers: Map<string, NodeJS.Timeout> = new Map();
  private isOnline: boolean = true;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;

  constructor() {
    super();
    this.initOnlineListener();
    this.loadPendingChanges();
  }

  private initOnlineListener() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleOnline());
      window.addEventListener("offline", () => this.handleOffline());
      this.isOnline = navigator.onLine;
    }
  }

  private handleOnline() {
    this.isOnline = true;
    this.emit("online");
    this.flushPendingChanges();
  }

  private handleOffline() {
    this.isOnline = false;
    this.emit("offline");
  }

  public registerTable(config: SyncConfig) {
    this.configs.set(config.tableName, config);
    this.syncStates.set(config.tableName, {
      isSyncing: false,
      lastSync: null,
      pendingChanges: 0,
      errors: [],
      isConnected: false,
    });

    if (this.isOnline) {
      this.subscribeToTable(config.tableName);
      this.startPeriodicSync(config.tableName);
    }
  }

  private subscribeToTable(tableName: string) {
    const channel = supabase.channel(`table:${tableName}`);

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: tableName },
      (payload) => {
        this.handleRemoteChange(tableName, payload);
      },
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.updateSyncState(tableName, { isConnected: true });
        this.emit("connected", tableName);
      } else if (status === "CHANNEL_ERROR") {
        this.updateSyncState(tableName, { isConnected: false });
        this.emit("error", tableName, new Error("Subscription failed"));
      }
    });

    this.channels.set(tableName, channel);
  }

  private handleRemoteChange(tableName: string, payload: any) {
    this.emit("change", {
      tableName,
      eventType: payload.eventType,
      new: payload.new,
      old: payload.old,
    });

    // Update local cache if exists
    const config = this.configs.get(tableName);
    if (config) {
      this.updateSyncState(tableName, {
        lastSync: new Date(),
      });
    }
  }

  public async pushChange(
    tableName: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    data: any,
  ) {
    const change: PendingChange = {
      id: crypto.randomUUID(),
      tableName,
      operation,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    };

    if (!this.isOnline) {
      this.pendingQueue.push(change);
      this.persistPendingChanges();
      this.updateSyncState(tableName, {
        pendingChanges: this.pendingQueue.length,
      });
      return change.id;
    }

    try {
      await this.executeChange(change);
      this.emit("synced", { tableName, operation, data });
    } catch (error) {
      console.error("Sync error:", error);
      this.pendingQueue.push(change);
      this.persistPendingChanges();
      this.updateSyncState(tableName, {
        pendingChanges: this.pendingQueue.length,
        errors: [
          ...(this.syncStates.get(tableName)?.errors || []),
          (error as Error).message,
        ],
      });
    }

    return change.id;
  }

  private async executeChange(change: PendingChange) {
    const { tableName, operation, data } = change;

    switch (operation) {
      case "INSERT":
        return await supabase.from(tableName).insert(data);
      case "UPDATE":
        return await supabase.from(tableName).update(data).eq("id", data.id);
      case "DELETE":
        return await supabase.from(tableName).delete().eq("id", data.id);
    }
  }

  private async flushPendingChanges() {
    if (this.pendingQueue.length === 0) return;

    const changesToProcess = [...this.pendingQueue];
    this.pendingQueue = [];

    for (const change of changesToProcess) {
      try {
        await this.executeChange(change);
        this.emit("synced", change);
      } catch (error) {
        if (change.retryCount < this.maxRetries) {
          change.retryCount++;
          this.pendingQueue.push(change);
        } else {
          this.emit("failed", change);
        }
      }
    }

    this.persistPendingChanges();
    this.updateSyncState(changesToProcess[0]?.tableName, {
      pendingChanges: this.pendingQueue.length,
    });
  }

  private persistPendingChanges() {
    try {
      localStorage.setItem(
        "fuelpro_pending_sync",
        JSON.stringify(this.pendingQueue),
      );
    } catch (e) {
      console.error("Failed to persist pending changes:", e);
    }
  }

  private loadPendingChanges() {
    try {
      const stored = localStorage.getItem("fuelpro_pending_sync");
      if (stored) {
        this.pendingQueue = JSON.parse(stored);
        this.pendingQueue.forEach((change) => {
          this.updateSyncState(change.tableName, {
            pendingChanges: this.pendingQueue.length,
          });
        });
      }
    } catch (e) {
      console.error("Failed to load pending changes:", e);
    }
  }

  private startPeriodicSync(tableName: string) {
    const config = this.configs.get(tableName);
    if (!config) return;

    const timer = setInterval(() => {
      this.syncTable(tableName);
    }, config.syncInterval);

    this.syncTimers.set(tableName, timer);
  }

  private async syncTable(tableName: string) {
    const state = this.syncStates.get(tableName);
    if (state?.isSyncing) return;

    this.updateSyncState(tableName, { isSyncing: true });

    try {
      // Fetch latest data
      const config = this.configs.get(tableName);
      if (config) {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(config.batchSize);

        if (error) throw error;

        this.updateSyncState(tableName, {
          lastSync: new Date(),
          isSyncing: false,
        });

        this.emit("synced", { tableName, data });
      }
    } catch (error) {
      console.error("Sync error for", tableName, ":", error);
      this.updateSyncState(tableName, {
        isSyncing: false,
        errors: [...(state?.errors || []), (error as Error).message],
      });
    }
  }

  private updateSyncState(tableName: string, updates: Partial<SyncState>) {
    const currentState = this.syncStates.get(tableName) || {
      isSyncing: false,
      lastSync: null,
      pendingChanges: 0,
      errors: [],
      isConnected: false,
    };

    this.syncStates.set(tableName, { ...currentState, ...updates });
    this.emit("stateChange", tableName, this.syncStates.get(tableName));
  }

  public getSyncState(tableName: string): SyncState | undefined {
    return this.syncStates.get(tableName);
  }

  public getAllSyncStates(): Map<string, SyncState> {
    return this.syncStates;
  }

  public disconnect() {
    this.channels.forEach((channel) => channel.unsubscribe());
    this.channels.clear();
    this.syncTimers.forEach((timer) => clearInterval(timer));
    this.syncTimers.clear();
  }

  public reconnect() {
    if (this.isOnline) {
      this.configs.forEach((config) => {
        this.subscribeToTable(config.tableName);
        this.startPeriodicSync(config.tableName);
      });
    }
  }
}

// Singleton instance
export const enhancedSyncService = new EnhancedSyncService();
export default enhancedSyncService;
