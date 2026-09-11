/**
 * useCrossDeviceSync - Hook for cross-device session management
 * Handles session tracking, device management, and real-time sync
 */

import { useCallback, useEffect, useState } from "react";
import { syncService, STORAGE_KEYS } from "../lib/syncService";

interface Device {
  id: string;
  lastActive: number;
  current: boolean;
  name?: string;
  type?: "desktop" | "mobile" | "tablet";
}

interface SessionInfo {
  sessionId: string;
  deviceId: string;
  createdAt: number;
  lastActive: number;
}

/**
 * Hook for managing cross-device sessions
 */
export function useCrossDeviceSync() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(
    null,
  );
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Initialize session on mount
  useEffect(() => {
    // Get or create session
    const existingSession = syncService.getItem<SessionInfo>(
      STORAGE_KEYS.SESSION_ID,
    );
    if (existingSession) {
      setCurrentSession(existingSession);
    } else {
      const newSession: SessionInfo = {
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        deviceId: syncService.getDeviceId(),
        createdAt: Date.now(),
        lastActive: Date.now(),
      };
      syncService.setItem(STORAGE_KEYS.SESSION_ID, newSession);
      setCurrentSession(newSession);
    }

    // Load tracked devices
    const storedDevices = syncService.getTrackedDevices();
    setDevices(storedDevices);

    // Online/offline listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Update last active periodically
    const activityInterval = setInterval(() => {
      updateActivity();
    }, 60000); // Every minute

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(activityInterval);
    };
  }, []);

  // Subscribe to device changes
  useEffect(() => {
    const unsubscribe = syncService.subscribe(
      STORAGE_KEYS.USER_DEVICES,
      (data) => {
        if (Array.isArray(data)) {
          setDevices(data as Device[]);
        }
      },
    );

    return unsubscribe;
  }, []);

  // Update activity timestamp
  const updateActivity = useCallback(() => {
    const session = syncService.getItem<SessionInfo>(STORAGE_KEYS.SESSION_ID);
    if (session) {
      session.lastActive = Date.now();
      syncService.setItem(STORAGE_KEYS.SESSION_ID, session);
      setCurrentSession(session);
    }

    // Update device list
    syncService.trackDevice(session?.sessionId || "unknown");
    const updatedDevices = syncService.getTrackedDevices();
    setDevices(updatedDevices);
  }, []);

  // Track current device
  const trackDevice = useCallback(
    (userId: string) => {
      syncService.trackDevice(userId);
      const updatedDevices = syncService.getTrackedDevices();
      setDevices(updatedDevices);
      updateActivity();
    },
    [updateActivity],
  );

  // Logout from all devices
  const logoutAllDevices = useCallback(async () => {
    // Clear all local data
    syncService.clearLocalData();

    // Broadcast logout to all tabs
    setDevices([]);
    setCurrentSession(null);
  }, []);

  // Get device info
  const getDeviceInfo = useCallback((): Partial<Device> => {
    const ua = navigator.userAgent;
    let type: Device["type"] = "desktop";

    if (/mobile/i.test(ua)) {
      type = "mobile";
    } else if (/tablet|ipad/i.test(ua)) {
      type = "tablet";
    }

    return {
      id: syncService.getDeviceId(),
      type,
      lastActive: Date.now(),
      current: true,
    };
  }, []);

  // Format last active time
  const formatLastActive = useCallback((timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }, []);

  return {
    devices,
    currentSession,
    isOnline,
    trackDevice,
    logoutAllDevices,
    getDeviceInfo,
    formatLastActive,
    updateActivity,
    currentDeviceId: syncService.getDeviceId(),
  };
}

/**
 * Hook for real-time data sync
 */
export function useRealtimeSync<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: {
    interval?: number;
    enabled?: boolean;
    onUpdate?: (data: T) => void;
  } = {},
) {
  const { interval = 30000, enabled = true, onUpdate } = options;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Initial fetch and subscribe to changes
  useEffect(() => {
    if (!enabled) return;

    // Subscribe to sync events
    const unsubscribe = syncService.subscribe(key, (newData) => {
      if (newData !== null) {
        setData(newData as T);
        onUpdate?.(newData as T);
      }
    });

    // Initial fetch
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchFn();
        setData(result);
        syncService.setItem(key, result);
        onUpdate?.(result);
      } catch (err) {
        setError(err as Error);
        // Try to restore from cache
        const cached = syncService.getItem<T>(key);
        if (cached) {
          setData(cached);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Set up polling interval
    const pollInterval = setInterval(fetchData, interval);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, [key, fetchFn, interval, enabled, onUpdate]);

  // Manual refresh
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchFn();
      setData(result);
      syncService.setItem(key, result);
      onUpdate?.(result);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, key, onUpdate]);

  return {
    data,
    isLoading,
    error,
    refresh,
    isStale: !syncService.isDataFresh(key),
  };
}
