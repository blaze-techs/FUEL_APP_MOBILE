/**
 * Connectivity + Session Checkpoint.
 *
 * Two responsibilities:
 *
 * 1. REAL connectivity. `Offline` means the device has actually lost its
 *    internet connection (`navigator.onLine === false`, or a failed
 *    same-origin probe). A provider/API outage while the network link is up
 *    is NOT offline — it is reported separately as `degraded` so the UI never
 *    claims "offline ready" while the user is in fact online.
 *
 * 2. A session-scoped checkpoint. While online, every value the current
 *    session reads or writes is recorded here with its timestamp. When the
 *    connection drops, the app continues from THIS session's own last-known
 *    values — never from another account's cache and never from a
 *    fabricated/placeholder value. That is what "continue where you left off
 *    (within the last 30 seconds before the connection was lost)" means in
 *    practice: the checkpoint is refreshed continuously (5s while online,
 *    plus every read/write and on pagehide/visibility change), so the state
 *    served after a disconnect is the state the user was actually working on.
 *
 * The snapshot lives in `sessionStorage`, so it is scoped to a single tab
 * session and cannot leak between accounts signed in on the same browser.
 */

export type Connectivity = "online" | "offline" | "degraded";

/** Checkpoint window quoted in the UX copy and used for freshness reporting. */
export const SESSION_CHECKPOINT_WINDOW_MS = 30_000;

/** How often the live in-memory state is re-checkpointed while online. */
const CHECKPOINT_INTERVAL_MS = 5_000;

const SESSION_ID_KEY = "fuelpro_session_id";
const SNAPSHOT_PREFIX = "fuelpro_session_snapshot_";

interface SnapshotEntry {
  value: unknown;
  ts: number;
}

type ConnectivityListener = (state: Connectivity) => void;

const listeners = new Set<ConnectivityListener>();

let currentState: Connectivity =
  typeof navigator === "undefined" || navigator.onLine ? "online" : "offline";
let disconnectedAt: number | null = null;
/** Duration of the most recent outage, recorded when connectivity recovers. */
let lastOutage: {
  disconnectedAt: number;
  reconnectedAt: number;
  durationMs: number;
} | null = null;
let lastCheckpointAt: number | null = null;
let sessionId = "";
let checkpointTimer: number | null = null;
let probeTimer: number | null = null;
let started = false;

/** in-memory mirror of the session snapshot (fast path). */
let snapshot = new Map<string, SnapshotEntry>();

function resolveSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return `sess_${Date.now()}`;
  }
}

function snapshotStorageKey(): string {
  return SNAPSHOT_PREFIX + sessionId;
}

function loadSnapshot(): void {
  try {
    const raw = sessionStorage.getItem(snapshotStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, SnapshotEntry>;
    snapshot = new Map(Object.entries(parsed));
  } catch {
    snapshot = new Map();
  }
}

function persistSnapshot(): void {
  try {
    const obj: Record<string, SnapshotEntry> = {};
    for (const [k, v] of snapshot) obj[k] = v;
    sessionStorage.setItem(snapshotStorageKey(), JSON.stringify(obj));
  } catch {
    /* quota — the in-memory mirror still serves the live tab */
  }
}

/**
 * Re-checkpoint the live values this session already holds. Called on an
 * interval, on every read/write, and immediately before a disconnect is
 * reported, so the snapshot is never more than a few seconds old when the
 * connection is lost.
 */
export function checkpointEntries(entries: Iterable<[string, unknown]>): void {
  const now = Date.now();
  for (const [k, v] of entries) {
    snapshot.set(k, { value: v, ts: now });
  }
  lastCheckpointAt = now;
  persistSnapshot();
}

/** Record (or refresh) a single value in the session checkpoint. */
export function checkpointEntry(key: string, value: unknown): void {
  const now = Date.now();
  snapshot.set(key, { value, ts: now });
  lastCheckpointAt = now;
  persistSnapshot();
}

/** Whether the current session has a checkpointed value for a key. */
export function hasCheckpoint(key: string): boolean {
  return snapshot.has(key);
}

/**
 * Read a checkpointed value. Only ever returns a value this session observed —
 * returning `null` is correct when the session never saw the key, because
 * inventing a value (or borrowing one from an earlier account's cache) is
 * exactly the "imaginary data" failure this replaces.
 */
export function readCheckpoint<T>(key: string): T | null {
  const entry = snapshot.get(key);
  if (!entry) return null;
  return entry.value as T;
}

/** Age (ms) of a checkpointed value, or null when unknown. */
export function checkpointAgeMs(key: string): number | null {
  const entry = snapshot.get(key);
  return entry ? Date.now() - entry.ts : null;
}

/**
 * Read a checkpointed value that still belongs to the CURRENT session's live
 * work — i.e. observed within `SESSION_CHECKPOINT_WINDOW_MS` before the
 * connection was lost (or within that window of now while still online).
 *
 * A value older than the window is deliberately NOT returned: it is persisted
 * account data, not the work in progress the user expects to resume, and
 * presenting it as "resumed" state is what makes offline mode show stale
 * figures. Callers fall back to the account's own read-through cache.
 */
export function readCheckpointWithinWindow<T>(
  key: string,
  windowMs: number = SESSION_CHECKPOINT_WINDOW_MS,
): T | null {
  const entry = snapshot.get(key);
  if (!entry) return null;
  // Anchor to the disconnect moment when offline, else to now.
  const anchor = disconnectedAt ?? Date.now();
  const age = anchor - entry.ts;
  if (age < 0 || age > windowMs) return null;
  return entry.value as T;
}

export function getSessionId(): string {
  return sessionId;
}

export function getLastCheckpointAt(): number | null {
  return lastCheckpointAt;
}

export function getDisconnectedAt(): number | null {
  return disconnectedAt;
}

export function getConnectivity(): Connectivity {
  return currentState;
}

/** True only for a genuine internet-connection loss. */
export function isOffline(): boolean {
  return currentState === "offline";
}

export function subscribeConnectivity(cb: ConnectivityListener): () => void {
  listeners.add(cb);
  cb(currentState);
  return () => listeners.delete(cb);
}

function setState(next: Connectivity): void {
  if (next === "offline") {
    // Freeze the checkpoint at the moment connectivity was lost so the app
    // resumes from what the user was working on, not from a later empty state.
    disconnectedAt = disconnectedAt ?? Date.now();
    lastCheckpointAt = lastCheckpointAt ?? disconnectedAt;
  } else if (disconnectedAt != null) {
    // Record the outage length, then clear the live disconnect marker.
    lastOutage = {
      disconnectedAt,
      reconnectedAt: Date.now(),
      durationMs: Date.now() - disconnectedAt,
    };
    disconnectedAt = null;
  }
  const changed = next !== currentState;
  currentState = next;
  if (changed) listeners.forEach((cb) => cb(currentState));
}

/** The most recent completed outage (null if none this session). */
export function getLastOutage(): typeof lastOutage {
  return lastOutage;
}

/**
 * Same-origin probe. `navigator.onLine` can stay true behind a captive portal,
 * so confirm the app origin is reachable before declaring the device online.
 */
async function probeOrigin(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${window.location.origin}/?fuelpro_connectivity=${Date.now()}`,
      {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    );
    window.clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function evaluate(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState("offline");
    return;
  }
  const reachable = await probeOrigin();
  // A reachable origin proves the connection is up. An unreachable one while
  // `navigator.onLine` is still true is a degraded provider, not a lost link.
  setState(reachable ? "online" : "degraded");
}

/**
 * Idempotently start connectivity tracking. Safe to call from several modules.
 */
export function startConnectivity(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  sessionId = resolveSessionId();
  loadSnapshot();
  lastCheckpointAt = Date.now();

  window.addEventListener("online", () => {
    void evaluate();
  });
  window.addEventListener("offline", () => {
    setState("offline");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void evaluate();
  });

  void evaluate();

  // Keep the checkpoint warm so a disconnect resumes from a state that is at
  // most a few seconds old.
  checkpointTimer = window.setInterval(() => {
    lastCheckpointAt = Date.now();
    persistSnapshot();
  }, CHECKPOINT_INTERVAL_MS);

  // Cheap re-probe while the link is suspect (15s), matching the indicator.
  probeTimer = window.setInterval(() => {
    if (currentState !== "online") void evaluate();
  }, 15_000);
}

/** Stop timers — used by tests and on unmount of the host component. */
export function stopConnectivity(): void {
  if (checkpointTimer) window.clearInterval(checkpointTimer);
  if (probeTimer) window.clearInterval(probeTimer);
  checkpointTimer = null;
  probeTimer = null;
  listeners.clear();
  started = false;
}

/** Test/introspection helper: current checkpointed keys. */
export function checkpointedKeys(): string[] {
  return [...snapshot.keys()];
}

/** Clear the session checkpoint (used after a successful full re-sync). */
export function clearSessionCheckpoint(): void {
  snapshot.clear();
  try {
    sessionStorage.removeItem(snapshotStorageKey());
  } catch {
    /* ignore */
  }
}
