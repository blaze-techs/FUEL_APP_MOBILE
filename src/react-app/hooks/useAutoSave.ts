/**
 * useAutoSave - Hook for automatic data persistence
 * Saves data to localStorage and syncs across tabs
 */

import { useCallback, useEffect, useRef } from "react";
import { syncService, STORAGE_KEYS } from "../lib/syncService";

interface UseAutoSaveOptions<T> {
  key: string;
  debounceMs?: number;
  onSave?: (data: T) => void;
  onRestore?: (data: T) => void;
}

/**
 * Hook for auto-saving data to localStorage with debouncing
 */
export function useAutoSave<T>({
  key,
  debounceMs = 500,
  onSave,
  onRestore,
}: UseAutoSaveOptions<T>) {
  const dataRef = useRef<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoad = useRef(true);

  // Load initial data
  useEffect(() => {
    const stored = syncService.getItem<T>(key);
    if (stored !== null) {
      dataRef.current = stored;
      onRestore?.(stored);
    }
    isInitialLoad.current = false;
  }, [key, onRestore]);

  // Subscribe to external changes (from other tabs)
  useEffect(() => {
    const unsubscribe = syncService.subscribe(key, (data) => {
      if (!isInitialLoad.current && data !== null) {
        dataRef.current = data as T;
        onRestore?.(data as T);
      }
    });

    return unsubscribe;
  }, [key, onRestore]);

  // Save function with debouncing
  const save = useCallback(
    (data: T) => {
      dataRef.current = data;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce the save
      timeoutRef.current = setTimeout(() => {
        syncService.setItem(key, data);
        onSave?.(data);
      }, debounceMs);
    },
    [key, debounceMs, onSave],
  );

  // Immediate save (no debounce)
  const saveImmediate = useCallback(
    (data: T) => {
      dataRef.current = data;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      syncService.setItem(key, data);
      onSave?.(data);
    },
    [key, onSave],
  );

  // Get current data
  const getData = useCallback((): T | null => {
    return dataRef.current;
  }, []);

  // Clear saved data
  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    syncService.removeItem(key);
    dataRef.current = null;
  }, [key]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    save,
    saveImmediate,
    getData,
    clear,
    data: dataRef.current,
  };
}

/**
 * Hook for persisting form state
 */
export function useFormPersistence<T extends Record<string, unknown>>(
  formKey: string,
  initialData?: T,
) {
  const { save, getData, clear } = useAutoSave<T>({
    key: `${STORAGE_KEYS.APP_STATE}_form_${formKey}`,
  });

  // Load on mount
  const savedData = getData() ?? initialData ?? ({} as T);

  return {
    savedData,
    saveFormData: save,
    clearFormData: clear,
  };
}

/**
 * Hook for persisting user preferences
 */
export function useUserPreferences() {
  const key = `${STORAGE_KEYS.USER_DATA}_preferences`;

  const { save, getData } = useAutoSave<Record<string, unknown>>({
    key,
    debounceMs: 1000,
  });

  const preferences = getData() ?? {};

  const updatePreference = useCallback(
    <K extends string>(key: K, value: unknown) => {
      const current = getData() ?? {};
      save({ ...current, [key]: value } as Record<string, unknown>);
    },
    [getData, save],
  );

  const getPreference = useCallback(
    <K extends string>(prefKey: K): unknown => {
      const current = getData() ?? {};
      return current[prefKey];
    },
    [getData],
  );

  return {
    preferences,
    updatePreference,
    getPreference,
    savePreferences: save,
  };
}
