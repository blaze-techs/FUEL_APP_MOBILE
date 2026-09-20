/**
 * React binding for the connectivity + session-checkpoint module.
 *
 * Reports the REAL connection state:
 *  - "online"   → the origin is reachable; sync is live.
 *  - "degraded" → the device has a network link but the app origin did not
 *                 answer (provider outage). Explicitly NOT offline.
 *  - "offline"  → the device actually lost its internet connection.
 *
 * `offlineReady` is therefore false while online, and only true when
 * connectivity is genuinely offline — which is what stops the UI from
 * advertising "Offline ready" as a permanent capability badge.
 */
import { useEffect, useState } from "react";
import {
  getConnectivity,
  getLastCheckpointAt,
  getLastOutage,
  getSessionId,
  isOffline,
  startConnectivity,
  SESSION_CHECKPOINT_WINDOW_MS,
  subscribeConnectivity,
  type Connectivity,
} from "@/react-app/lib/connectivity";

export interface ConnectivityState {
  /** Real connection state. */
  status: Connectivity;
  isOnline: boolean;
  isOffline: boolean;
  isDegraded: boolean;
  /** True only while the connection is genuinely lost. */
  offlineReady: boolean;
  /** ms epoch of the most recent session checkpoint. */
  lastCheckpointAt: number | null;
  /** The most recent completed outage, if one happened this session. */
  lastOutage: { disconnectedAt: number; reconnectedAt: number; durationMs: number } | null;
  sessionId: string;
  checkpointWindowMs: number;
}

export function useConnectivity(): ConnectivityState {
  const [status, setStatus] = useState<Connectivity>(getConnectivity);
  const [lastCheckpointAt, setLastCheckpointAt] = useState<number | null>(
    getLastCheckpointAt,
  );
  const [outage, setOutage] = useState(getLastOutage);

  useEffect(() => {
    startConnectivity();
    const unsub = subscribeConnectivity(setStatus);
    // The checkpoint timestamp moves on a timer; refresh it at a low rate so
    // the UI can show how fresh the resumable state is.
    const tick = window.setInterval(() => {
      setLastCheckpointAt(getLastCheckpointAt());
      setOutage(getLastOutage());
    }, 2000);
    return () => {
      unsub();
      window.clearInterval(tick);
    };
  }, []);

  return {
    status,
    isOnline: status === "online",
    isOffline: status === "offline",
    isDegraded: status === "degraded",
    offlineReady: isOffline(),
    lastCheckpointAt,
    lastOutage: outage,
    sessionId: getSessionId(),
    checkpointWindowMs: SESSION_CHECKPOINT_WINDOW_MS,
  };
}

export default useConnectivity;