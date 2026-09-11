/**
 * useStationCloud — a reusable hook for station-scoped cloud data.
 *
 * Each Station in a user's account has its own independent data set (expenses,
 * prices, suppliers, shifts, etc.) unless a "Combined View" is explicitly
 * selected. This hook scopes cloud reads/writes by the current station so
 * switching stations loads that station's data, and edits are isolated per
 * station.
 *
 * Cloud storage (Supabase app_kv) is the source of truth — localStorage is
 * only a read-through cache (see cloud-storage-service.ts). Data is never
 * stored solely in localStorage, so it is always available cross-device.
 *
 * Usage:
 *   const { data, setData } = useStationCloud<MyType>("expenses_data", []);
 *
 * `data` is the current station's data (loaded async from cloud). `setData`
 * persists to the station-scoped cloud key immediately (fire-and-forget) and
 * updates local state.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";

export function useStationCloud<T>(
  baseKey: string,
  initialValue: T,
): {
  data: T;
  setData: (value: T | ((prev: T) => T)) => void;
  loading: boolean;
  reload: () => void;
} {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [data, setDataState] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const loadedKeyRef = useRef<string | null>(null);

  // Load from cloud whenever the user or station changes. Cloud is the source
  // of truth; the read-through cache makes this instant on repeat visits.
  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const cloud = await cloudStorageService.get<T>(baseKey, stationId);
      if (cloud != null) {
        setDataState(cloud);
      } else {
        setDataState(initialValue);
      }
    } catch {
      // Cloud unavailable — keep current state (cache may have partial data).
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stationId, baseKey]);

  useEffect(() => {
    const effKey = `${baseKey}::${stationId ?? "user"}::${user?.id ?? "guest"}`;
    // Only reload if the effective key changed (avoids redundant reloads from
    // unrelated re-renders) or on first load.
    if (loadedKeyRef.current === effKey) return;
    loadedKeyRef.current = effKey;
    load();
  }, [load, baseKey, stationId, user]);

  const setData = useCallback(
    (value: T | ((prev: T) => T)) => {
      setDataState((prev) => {
        const next =
          typeof value === "function" ? (value as (p: T) => T)(prev) : value;
        // Persist to the station-scoped cloud key. Fire-and-forget — the local
        // cache + memory cache make subsequent reads instant.
        cloudStorageService.set(baseKey, next, stationId).catch(() => {});
        return next;
      });
    },
    [baseKey, stationId],
  );

  return { data, setData, loading, reload: load };
}
