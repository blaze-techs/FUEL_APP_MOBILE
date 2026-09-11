/**
 * useCloudKV — real-time cross-device sync hook for app_kv key/value data.
 *
 * Wraps cloudStorageService with React state. On mount, loads the cloud value.
 * Subscribes to real-time postgres_changes so that when ANY other device writes
 * to the same app_kv row, the state updates INSTANTLY — no polling, no delay.
 *
 * The returned `setData` writes to cloud (which triggers real-time on all
 * other devices subscribed to the same key).
 *
 * Usage:
 *   const { data, setData, loading } = useCloudKV<MyType>("my_key", stationId);
 *
 * On device A: setData({ ... })  → writes to app_kv
 * On device B: data updates instantly via real-time subscription
 */

import { useCallback, useEffect, useRef, useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export function useCloudKV<T>(
  key: string,
  stationId: string | undefined,
  initialValue?: T,
): {
  data: T;
  setData: (value: T | ((prev: T) => T)) => void;
  loading: boolean;
  reload: () => void;
} {
  const [data, setDataState] = useState<T>(initialValue as T);
  const [loading, setLoading] = useState(true);
  const skipNextRemoteRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async () => {
    const cloud = await cloudStorageService.get<T>(key, stationId);
    if (cloud != null) {
      setDataState(cloud);
    } else if (initialValue !== undefined) {
      setDataState(initialValue as T);
    }
    setLoading(false);
  }, [key, stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    load();

    const unsub = cloudStorageService.subscribe<T>(key, stationId, (value) => {
      if (skipNextRemoteRef.current) {
        skipNextRemoteRef.current = false;
        return;
      }
      if (value != null) {
        setDataState(value);
      }
    });

    return () => {
      unsub();
    };
  }, [key, stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setData = useCallback(
    (value: T | ((prev: T) => T)) => {
      const next =
        typeof value === "function"
          ? (value as (prev: T) => T)(dataRef.current)
          : value;
      setDataState(next);
      skipNextRemoteRef.current = true;
      cloudStorageService.set(key, next, stationId).catch(() => {});
    },
    [key, stationId],
  );

  const reload = useCallback(() => {
    load();
  }, [load]);

  return { data, setData, loading, reload };
}
