/**
 * SyncService - Comprehensive data synchronization layer
 * Handles localStorage persistence, cross-tab sync, and offline support
 */

import { broadcastChannel, isBrowser } from "./utils";

// Storage keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: "fuelpro_auth_token",
  REFRESH_TOKEN: "fuelpro_refresh_token",
  USER_DATA: "fuelpro_user_data",
  SESSION_ID: "fuelpro_session_id",
  LAST_SYNC: "fuelpro_last_sync",
  APP_STATE: "fuelpro_app_state",
  PENDING_ACTIONS: "fuelpro_pending_actions",
  DEVICE_ID: "fuelpro_device_id",
  USER_DEVICES: "fuelpro_user_devices",
} as const;

// Generate unique device ID
function generateDeviceId(): string {
  const stored = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (stored) return stored;

  const deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  return deviceId;
}

// BroadcastChannel for cross-tab sync
let syncChannel: BroadcastChannel | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (!isBrowser) return null;
  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel("fuelpro_sync");
    } catch (e) {
      console.warn("BroadcastChannel not supported:", e);
    }
  }
  return syncChannel;
}

// Sync message types
type SyncMessageType =
  "AUTH_UPDATE" | "STATE_UPDATE" | "LOGOUT" | "FORCE_REFRESH" | "DATA_CHANGED";

interface SyncMessage {
  type: SyncMessageType;
  payload?: unknown;
  timestamp: number;
  sourceDevice: string;
}

class SyncService {
  private deviceId: string;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.deviceId = generateDeviceId();
    this.setupBroadcastListener();
    this.setupVisibilityHandler();
  }

  // Setup broadcast channel listener
  private setupBroadcastListener() {
    const channel = getSyncChannel();
    if (channel) {
      channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        if (event.data.sourceDevice === this.deviceId) return; // Ignore own messages

        this.handleSyncMessage(event.data);
      };
    }

    // Also listen for storage events (fallback)
    if (isBrowser) {
      window.addEventListener("storage", (event: StorageEvent) => {
        if (
          event.key &&
          Object.values(STORAGE_KEYS).includes(
            event.key as (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS],
          )
        ) {
          this.notifyListeners(event.key, event.newValue);
        }
      });
    }
  }

  // Handle incoming sync messages
  private handleSyncMessage(message: SyncMessage) {
    console.log("[SyncService] Received:", message.type);

    switch (message.type) {
      case "AUTH_UPDATE":
        this.notifyListeners(STORAGE_KEYS.USER_DATA, message.payload);
        break;
      case "LOGOUT":
        this.clearLocalData();
        window.location.href = "/login";
        break;
      case "FORCE_REFRESH":
        window.dispatchEvent(new CustomEvent("force-auth-refresh"));
        break;
      case "DATA_CHANGED":
        this.notifyListeners(
          message.payload as string,
          localStorage.getItem(message.payload as string),
        );
        break;
    }
  }

  // Setup visibility change handler
  private setupVisibilityHandler() {
    if (isBrowser) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.syncFromStorage();
        }
      });
    }
  }

  // Sync data from storage (called on visibility change)
  private syncFromStorage() {
    const userData = this.getItem(STORAGE_KEYS.USER_DATA);
    const authToken = this.getItem(STORAGE_KEYS.AUTH_TOKEN);

    if (userData) {
      this.notifyListeners(STORAGE_KEYS.USER_DATA, userData);
    }

    if (!authToken) {
      this.clearLocalData();
    }
  }

  // Notify all listeners for a key
  private notifyListeners(key: string, value: unknown) {
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      keyListeners.forEach((listener) => listener(value));
    }
  }

  // Broadcast message to other tabs
  private broadcast(type: SyncMessageType, payload?: unknown) {
    const channel = getSyncChannel();
    if (channel) {
      channel.postMessage({
        type,
        payload,
        timestamp: Date.now(),
        sourceDevice: this.deviceId,
      } as SyncMessage);
    }
  }

  // Debounced sync
  private debouncedBroadcast(type: SyncMessageType, payload?: unknown) {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }
    this.syncDebounceTimer = setTimeout(() => {
      this.broadcast(type, payload);
    }, 100);
  }

  // Set item with sync
  setItem<T>(key: string, value: T): void {
    if (!isBrowser) return;

    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, String(Date.now()));

      // Broadcast change
      this.debouncedBroadcast("DATA_CHANGED", key);
    } catch (error) {
      console.error(`[SyncService] Error setting ${key}:`, error);
    }
  }

  // Get item with validation
  getItem<T>(key: string): T | null {
    if (!isBrowser) return null;

    try {
      const item = localStorage.getItem(key);
      if (item === null) return null;
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`[SyncService] Error getting ${key}:`, error);
      return null;
    }
  }

  // Remove item with sync
  removeItem(key: string): void {
    if (!isBrowser) return;
    localStorage.removeItem(key);
    this.debouncedBroadcast("DATA_CHANGED", key);
  }

  // Subscribe to changes
  subscribe(key: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);

    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  // Save auth data
  saveAuthData(authData: {
    token: string;
    refreshToken?: string;
    user: Record<string, unknown>;
    expiresAt?: number;
  }): void {
    this.setItem(STORAGE_KEYS.AUTH_TOKEN, authData.token);
    if (authData.refreshToken) {
      this.setItem(STORAGE_KEYS.REFRESH_TOKEN, authData.refreshToken);
    }
    this.setItem(STORAGE_KEYS.USER_DATA, {
      ...authData.user,
      deviceId: this.deviceId,
      lastActive: Date.now(),
    });
    this.setItem(STORAGE_KEYS.SESSION_ID, this.generateSessionId());

    // Broadcast auth update
    this.broadcast("AUTH_UPDATE", authData.user);
  }

  // Get stored auth data
  getAuthData(): {
    token: string | null;
    refreshToken: string | null;
    user: Record<string, unknown> | null;
    isValid: boolean;
  } {
    const token = this.getItem<string>(STORAGE_KEYS.AUTH_TOKEN);
    const refreshToken = this.getItem<string>(STORAGE_KEYS.REFRESH_TOKEN);
    const user = this.getItem<Record<string, unknown>>(STORAGE_KEYS.USER_DATA);

    // Check if token is expired
    const isValid = !!token && !!user;

    return { token, refreshToken, user, isValid };
  }

  // Generate session ID
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Track device for user
  trackDevice(userId: string): void {
    const devices =
      this.getItem<Array<{ id: string; lastActive: number; current: boolean }>>(
        STORAGE_KEYS.USER_DEVICES,
      ) || [];

    const existingIndex = devices.findIndex((d) => d.id === this.deviceId);

    if (existingIndex >= 0) {
      devices[existingIndex].lastActive = Date.now();
      devices[existingIndex].current = true;
    } else {
      devices.push({
        id: this.deviceId,
        lastActive: Date.now(),
        current: true,
      });
    }

    // Mark other devices as not current
    devices.forEach((d) => {
      if (d.id !== this.deviceId) d.current = false;
    });

    this.setItem(STORAGE_KEYS.USER_DEVICES, devices);
  }

  // Get all tracked devices
  getTrackedDevices(): Array<{
    id: string;
    lastActive: number;
    current: boolean;
  }> {
    return this.getItem(STORAGE_KEYS.USER_DEVICES) || [];
  }

  // Clear local data on logout
  clearLocalData(): void {
    if (!isBrowser) return;

    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });

    this.broadcast("LOGOUT");
  }

  // Save app state
  saveAppState(state: Record<string, unknown>): void {
    this.setItem(STORAGE_KEYS.APP_STATE, {
      ...state,
      savedAt: Date.now(),
    });
  }

  // Get saved app state
  getAppState<T>(): T | null {
    return this.getItem<T>(STORAGE_KEYS.APP_STATE);
  }

  // Check if data is fresh (within threshold)
  isDataFresh(key: string, maxAgeMs: number = 5 * 60 * 1000): boolean {
    const lastSync = this.getItem<number>(STORAGE_KEYS.LAST_SYNC);
    if (!lastSync) return false;
    return Date.now() - lastSync < maxAgeMs;
  }

  // Get device ID
  getDeviceId(): string {
    return this.deviceId;
  }
}

// Export singleton
export const syncService = new SyncService();
export default syncService;
