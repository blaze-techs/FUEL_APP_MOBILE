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

/**
 * Same-page in-memory pub/sub for useCloudKV keys. Realtime is OFF by
 * default (low-bandwidth mode), so `cloudStorageService.subscribe()` is a
 * no-op — two simultaneously-mounted components sharing one app_kv key
 * would NOT see each other's `setData` until remount. This bus notifies
 * other mounted instances of the same key immediately, so stacked views
 * (e.g. TankMonitor writes tankReadings while TankWaterTrace /
 * TheftAnomalyDetector / ThresholdAlertRules read it in the same tab)
 * stay in sync without relying on realtime.
 */
const kvBus = new Map<string, Set<(value: unknown) => void>>();

export function kvBusKey(key: string, stationId?: string): string {
  return `${key}\u0000${stationId ?? ""}`;
}

export function kvBusSubscribe(
  busKey: string,
  cb: (value: unknown) => void,
): () => void {
  let set = kvBus.get(busKey);
  if (!set) {
    set = new Set();
    kvBus.set(busKey, set);
  }
  set.add(cb);
  return () => {
    const s = kvBus.get(busKey);
    if (s) {
      s.delete(cb);
      if (s.size === 0) kvBus.delete(busKey);
    }
  };
}

export function kvBusPublish(busKey: string, value: unknown): void {
  const s = kvBus.get(busKey);
  if (!s) return;
  for (const cb of s) cb(value);
}

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

    const busKey = kvBusKey(key, stationId);
    const unsubBus = kvBusSubscribe(busKey, (value) => {
      if (skipNextRemoteRef.current) {
        skipNextRemoteRef.current = false;
        return;
      }
      if (value != null) {
        setDataState(value as T);
      }
    });
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
      unsubBus();
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
      kvBusPublish(kvBusKey(key, stationId), next);
    },
    [key, stationId],
  );

  const reload = useCallback(() => {
    load();
  }, [load]);

  return { data, setData, loading, reload };
}
