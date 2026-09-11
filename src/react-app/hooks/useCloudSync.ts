/**
 * useCloudSync - Cloud-synced data hook for FuelPro
 *
 * This hook provides a complete cloud-synced data layer that:
 * 1. Attempts to sync all data to the backend API
 * 2. Falls back to localStorage only when API is unavailable
 * 3. Queues changes for sync when connection is restored
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkApiStatus,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  Collections,
  getPendingCount,
  queuePendingChange,
  apiRequest,
} from "@/react-app/lib/restApiSync";

// Types
export interface CloudUser {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  lastActive?: string;
}

export interface CloudStation {
  id: string;
  name: string;
  location: string;
  ownerId: string;
  ownerName: string;
  members: number;
  revenue: number;
  createdAt: string;
  lastActive: string;
}

export interface CloudSecret {
  id: string;
  key: string;
  value: string;
  createdAt: string;
}

export interface CloudAuditEntry {
  id: string;
  event: string;
  detail: string;
  user: string;
  severity: "success" | "warning" | "danger" | "info";
  timestamp: string;
}

export interface CloudFeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

interface CloudSyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: number;
  pendingChanges: number;
  error?: string;
}

export function useCloudSync() {
  const [state, setState] = useState<CloudSyncState>({
    isOnline: false,
    isSyncing: false,
    lastSync: 0,
    pendingChanges: 0,
  });

  // Check API status
  const checkConnection = useCallback(async () => {
    const status = await checkApiStatus();
    setState((prev) => ({
      ...prev,
      isOnline: status.connected,
      pendingChanges: getPendingCount(),
      error: status.error,
    }));
    return status.connected;
  }, []);

  // Use ref to avoid stale closures in interval
  const checkConnectionRef = useRef(checkConnection);
  useEffect(() => {
    checkConnectionRef.current = checkConnection;
  }, [checkConnection]);

  // Initial connection check
  useEffect(() => {
    checkConnectionRef.current();

    // Recheck every 30 seconds - use ref to avoid stale closure
    const interval = setInterval(() => checkConnectionRef.current(), 30000);
    return () => clearInterval(interval);
  }, []);

  // Sync all data
  const syncAll = useCallback(async () => {
    setState((prev) => ({ ...prev, isSyncing: true, error: undefined }));

    try {
      const connected = await checkConnection();

      if (!connected) {
        setState((prev) => ({
          ...prev,
          isSyncing: false,
          error: "API unavailable - changes saved locally",
        }));
        return false;
      }

      // Fetch all data from cloud
      await Promise.all([
        listRecords(Collections.USERS),
        listRecords(Collections.STATIONS),
        listRecords(Collections.SECRETS),
        listRecords(Collections.FEATURE_FLAGS),
        listRecords(Collections.AUDIT_LOG, { limit: 100 }),
      ]);

      setState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSync: Date.now(),
        error: undefined,
      }));

      return true;
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isSyncing: false,
        error: err.message,
      }));
      return false;
    }
  }, [checkConnection]);

  return {
    ...state,
    checkConnection,
    syncAll,
  };
}

// Hook for Users
export function useCloudUsers() {
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const { isOnline } = useCloudSync();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      // Use the backend's /api/users endpoint to get all registered users
      const result = await apiRequest<{ users: any[]; pagination?: any }>(
        "GET",
        "/api/users",
      );

      // apiRequest returns the response body directly ({ users: [...] }).
      const userData = result?.users || [];
      if (Array.isArray(userData)) {
        setUsers(
          userData.map((u: any) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
            lastActive: u.lastLoginAt || u.lastActive,
          })) as CloudUser[],
        );
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      setError(err.message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers, isOnline]);

  const addUser = useCallback(
    async (user: Omit<CloudUser, "id" | "createdAt">) => {
      // User creation is handled by the registration flow, not here
      return { success: false, error: "Use registration to create users" };
    },
    [],
  );

  const updateUser = useCallback(
    async (id: string, data: Partial<CloudUser>) => {
      const result = await apiRequest("PUT", `/api/users/${id}`, data);

      if (result.success) {
        setUsers((prev) =>
          prev.map((u) => (u.id === id ? { ...u, ...data } : u)),
        );
        return { success: true };
      }

      return { success: false, error: result.error };
    },
    [],
  );

  return { users, loading, error, fetchUsers, addUser, updateUser };
}

// Hook for Stations
export function useCloudStations() {
  const [stations, setStations] = useState<CloudStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const { isOnline } = useCloudSync();

  const fetchStations = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const result = await listRecords(Collections.STATIONS);

      if (result.success && result.data) {
        setStations(result.data as CloudStation[]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStations();
  }, [fetchStations, isOnline]);

  const addStation = useCallback(
    async (station: Omit<CloudStation, "id" | "createdAt" | "lastActive">) => {
      const result = await createRecord(Collections.STATIONS, station);

      if (result.success) {
        const newStation: CloudStation = {
          ...station,
          id: result.id!,
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
        };
        setStations((prev) => [newStation, ...prev]);
        return { success: true, id: result.id };
      }

      return { success: false, error: result.error };
    },
    [],
  );

  return { stations, loading, error, fetchStations, addStation };
}

// Hook for Audit Log
export function useCloudAuditLog() {
  const [entries, setEntries] = useState<CloudAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useCloudSync();

  const fetchEntries = useCallback(async () => {
    setLoading(true);

    try {
      const result = await listRecords(Collections.AUDIT_LOG, { limit: 100 });

      if (result.success && result.data) {
        setEntries(result.data as CloudAuditEntry[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries, isOnline]);

  const addEntry = useCallback(
    async (
      event: string,
      detail: string,
      user: string = "SYSTEM",
      severity: "success" | "warning" | "danger" | "info" = "info",
    ) => {
      const result = await createRecord(Collections.AUDIT_LOG, {
        event,
        detail,
        user,
        severity,
        timestamp: new Date().toISOString(),
      });

      if (result.success) {
        const newEntry: CloudAuditEntry = {
          id: result.id!,
          event,
          detail,
          user,
          severity,
          timestamp: new Date().toISOString(),
        };
        setEntries((prev) => [newEntry, ...prev]);
        return true;
      }

      // Queue for later sync
      queuePendingChange(Collections.AUDIT_LOG, "create", {
        event,
        detail,
        user,
        severity,
      });
      return true; // Still return true as we saved locally
    },
    [],
  );

  return { entries, loading, fetchEntries, addEntry };
}

// Hook for Secrets
export function useCloudSecrets() {
  const [secrets, setSecrets] = useState<CloudSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useCloudSync();

  const fetchSecrets = useCallback(async () => {
    setLoading(true);

    try {
      const result = await listRecords(Collections.SECRETS);

      if (result.success && result.data) {
        setSecrets(result.data as CloudSecret[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets, isOnline]);

  const addSecret = useCallback(async (key: string, value: string) => {
    const result = await createRecord(Collections.SECRETS, { key, value });

    if (result.success) {
      setSecrets((prev) => [
        {
          id: result.id!,
          key,
          value,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      return { success: true, id: result.id };
    }

    return { success: false, error: result.error };
  }, []);

  const updateSecret = useCallback(async (id: string, value: string) => {
    const result = await updateRecord(Collections.SECRETS, id, { value });

    if (result.success) {
      setSecrets((prev) =>
        prev.map((s) => (s.id === id ? { ...s, value } : s)),
      );
      return { success: true };
    }

    return { success: false, error: result.error };
  }, []);

  const deleteSecret = useCallback(async (id: string) => {
    const result = await deleteRecord(Collections.SECRETS, id);

    if (result.success) {
      setSecrets((prev) => prev.filter((s) => s.id !== id));
      return { success: true };
    }

    return { success: false, error: result.error };
  }, []);

  return {
    secrets,
    loading,
    fetchSecrets,
    addSecret,
    updateSecret,
    deleteSecret,
  };
}

// Hook for Feature Flags
export function useCloudFeatureFlags() {
  const [flags, setFlags] = useState<CloudFeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useCloudSync();

  const fetchFlags = useCallback(async () => {
    setLoading(true);

    try {
      const result = await listRecords(Collections.FEATURE_FLAGS);

      if (result.success && result.data) {
        setFlags(result.data as CloudFeatureFlag[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags, isOnline]);

  const updateFlag = useCallback(async (id: string, enabled: boolean) => {
    const result = await updateRecord(Collections.FEATURE_FLAGS, id, {
      enabled,
    });

    if (result.success) {
      setFlags((prev) =>
        prev.map((f) => (f.id === id ? { ...f, enabled } : f)),
      );
      return { success: true };
    }

    return { success: false, error: result.error };
  }, []);

  return { flags, loading, fetchFlags, updateFlag };
}
