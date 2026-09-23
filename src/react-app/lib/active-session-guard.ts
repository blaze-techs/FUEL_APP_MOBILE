import { getSupabaseClient } from "@/supabase/client";
import { getSessionId, startConnectivity } from "@/react-app/lib/connectivity";

const LOCAL_LEASE_SAFETY_MS = 15_000;
const HEARTBEAT_MS = 20_000;

export type StationWriteLease = {
  granted: boolean;
  sessionId: string;
  fenceToken: number;
  expiresAt?: string | null;
  activeSessionId?: string | null;
};

export class StaleStationSessionError extends Error {
  readonly stationId: string;
  readonly sessionId: string;
  readonly activeSessionId: string | null;
  readonly fenceToken: number | null;
  readonly expiresAt: string | null;

  constructor(stationId: string, result: StationWriteLease) {
    super(
      "This session is no longer the active station session. " +
        "The newer active session remains authoritative; stale offline data " +
        "must not be published automatically.",
    );
    this.name = "StaleStationSessionError";
    this.stationId = stationId;
    this.sessionId = result.sessionId;
    this.activeSessionId = result.activeSessionId ?? null;
    this.fenceToken = Number.isFinite(result.fenceToken)
      ? result.fenceToken
      : null;
    this.expiresAt = result.expiresAt ?? null;
  }
}

const leases = new Map<string, StationWriteLease>();
const blockedUntil = new Map<string, number>();
let heartbeatTimer: number | null = null;
let listenersInstalled = false;

function browserTimer(fn: () => void, ms: number): number | null {
  if (typeof window === "undefined") return null;
  return window.setInterval(fn, ms);
}

function clearHeartbeat(): void {
  if (heartbeatTimer != null && typeof window !== "undefined") {
    window.clearInterval(heartbeatTimer);
  }
  heartbeatTimer = null;
}

async function claim(stationId: string): Promise<StationWriteLease> {
  startConnectivity();
  const sessionId = getSessionId();
  if (!sessionId) {
    throw new Error("FUELPRO_SESSION_ID_UNAVAILABLE");
  }

  const client = getSupabaseClient();
  const { data, error } = await client.rpc("claim_station_active_session", {
    p_station_id: stationId,
    p_session_id: sessionId,
  });

  if (error) throw error;

  const result = (data ?? {}) as StationWriteLease;
  const lease: StationWriteLease = {
    granted: result.granted === true,
    sessionId: String(result.sessionId ?? sessionId),
    fenceToken: Number(result.fence_token ?? result.fenceToken ?? 0),
    expiresAt: result.expires_at ?? result.expiresAt ?? null,
    activeSessionId:
      result.active_session_id ?? result.activeSessionId ?? null,
  };

  if (!lease.granted) {
    leases.delete(stationId);
    const expiry = lease.expiresAt ? Date.parse(lease.expiresAt) : NaN;
    if (Number.isFinite(expiry) && expiry > Date.now()) {
      blockedUntil.set(stationId, expiry);
    }
    throw new StaleStationSessionError(stationId, lease);
  }

  blockedUntil.delete(stationId);
  leases.set(stationId, lease);
  installHeartbeat();
  return lease;
}

function installHeartbeat(): void {
  if (heartbeatTimer != null || typeof window === "undefined") return;

  heartbeatTimer = browserTimer(() => {
    void heartbeatAll();
  }, HEARTBEAT_MS);

  if (!listenersInstalled) {
    listenersInstalled = true;
    window.addEventListener("online", () => void heartbeatAll());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void heartbeatAll();
    });
    window.addEventListener("pagehide", clearHeartbeat);
  }
}

async function heartbeatAll(): Promise<void> {
  if (leases.size === 0) return;
  for (const stationId of [...leases.keys()]) {
    try {
      await claim(stationId);
    } catch (error) {
      // A newer session may have taken over. Remove the local lease so no
      // subsequent write can rely on an old fence token.
      leases.delete(stationId);
      if (error instanceof StaleStationSessionError && error.expiresAt) {
        const expiry = Date.parse(error.expiresAt);
        if (Number.isFinite(expiry) && expiry > Date.now()) {
          blockedUntil.set(stationId, expiry);
        }
      }
    }
  }
  if (leases.size === 0) clearHeartbeat();
}

/**
 * Return the server-issued fence for the current session. A cached lease is
 * safe only inside the short safety window because another session can take
 * ownership after the lease expires. The actual write RPC re-checks the token
 * atomically, so a race cannot publish stale data.
 */
export async function ensureStationWriteLease(
  stationId: string,
): Promise<StationWriteLease> {
  if (!stationId) throw new Error("STATION_REQUIRED");

  const blocked = blockedUntil.get(stationId);
  if (blocked && blocked > Date.now()) {
    const existing = leases.get(stationId);
    const blockedResult: StationWriteLease = {
      granted: false,
      sessionId: existing?.sessionId ?? getSessionId(),
      fenceToken: existing?.fenceToken ?? 0,
      expiresAt: new Date(blocked).toISOString(),
      activeSessionId: null,
    };
    throw new StaleStationSessionError(stationId, blockedResult);
  }
  blockedUntil.delete(stationId);

  const existing = leases.get(stationId);
  if (existing?.granted && existing.expiresAt) {
    const expiresAt = Date.parse(existing.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > LOCAL_LEASE_SAFETY_MS) {
      return existing;
    }
  }

  return claim(stationId);
}

export function getStationWriteLease(
  stationId: string,
): StationWriteLease | null {
  return leases.get(stationId) ?? null;
}

export function clearStationWriteLease(stationId?: string): void {
  if (stationId) {
    leases.delete(stationId);
    blockedUntil.delete(stationId);
  } else {
    leases.clear();
    blockedUntil.clear();
  }
  if (leases.size === 0) clearHeartbeat();
}

export function activeStationLeaseCount(): number {
  return leases.size;
}
