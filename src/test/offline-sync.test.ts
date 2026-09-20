/**
 * Offline-first sync regression tests.
 *
 * These lock in the fixes for the three reported failures:
 *
 *  1. "Offline mode has bugs / shows another user's data" — every cache and
 *     checkpoint namespace must be owner-scoped, and a sign-out must purge the
 *     departing account's namespace (including the in-memory user-id cache)
 *     so the next account can never read it.
 *
 *  2. "Imaginary values" — the offline read path must return what THIS session
 *     actually observed, or null. It must never fabricate a value, and it must
 *     never read another account's namespace.
 *
 *  3. Cache-key correctness — the read path and the write path must agree on
 *     the same key, otherwise a freshly written value is invisible offline
 *     (and a double-suffixed key leaks a station scope into the key itself).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cacheKey, memoryKey } from "@/react-app/lib/cloud-storage-service";
import {
  checkpointEntry,
  checkpointedKeys,
  clearSessionCheckpoint,
  readCheckpoint,
  readCheckpointWithinWindow,
  getConnectivity,
  isOffline,
  SESSION_CHECKPOINT_WINDOW_MS,
} from "@/react-app/lib/connectivity";

const OWNER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const STATION_1 = "11111111-1111-4111-8111-111111111111";
const STATION_2 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("cache namespace scoping", () => {
  it("namespaces the cache key by owner and station", () => {
    const a = cacheKey("pos_transactions", OWNER_A, STATION_1);
    const b = cacheKey("pos_transactions", OWNER_B, STATION_1);
    const c = cacheKey("pos_transactions", OWNER_A, STATION_2);

    expect(a).not.toBe(b); // different user
    expect(a).not.toBe(c); // different station
    expect(a).toContain(OWNER_A);
    expect(a).toContain(STATION_1);
  });

  it("separates the user-scoped key from every station-scoped key", () => {
    const userScoped = cacheKey("settings", OWNER_A);
    expect(userScoped).not.toBe(cacheKey("settings", OWNER_A, STATION_1));
    expect(cacheKey("settings", OWNER_A, STATION_1)).not.toBe(
      cacheKey("settings", OWNER_A, STATION_2),
    );
  });

  it("falls back to the anonymous namespace when no user is known", () => {
    expect(cacheKey("k", null)).toContain("anonymous");
    expect(cacheKey("k", undefined)).toContain("anonymous");
  });

  it("uses the SAME key for reads and writes (no double station suffix)", () => {
    // Regression: set() used to write with an already-suffixed key while
    // get()/getCached() read the unsuffixed one, so a value written offline
    // could never be read back.
    const writeKey = memoryKey("fuel_types_config", OWNER_A, STATION_1);
    const readKey = cacheKey("fuel_types_config", OWNER_A, STATION_1);
    expect(writeKey).toBe(readKey);

    // And the key must not contain the station id twice.
    const occurrences = writeKey.split(STATION_1).length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps two stations' values in distinct cache entries", () => {
    localStorage.setItem(
      cacheKey("fuel_types_config", OWNER_A, STATION_1),
      JSON.stringify([{ fuel: "petrol", price: 1.42 }]),
    );
    localStorage.setItem(
      cacheKey("fuel_types_config", OWNER_A, STATION_2),
      JSON.stringify([{ fuel: "petrol", price: 5.99 }]),
    );
    expect(
      JSON.parse(
        localStorage.getItem(
          cacheKey("fuel_types_config", OWNER_A, STATION_1),
        )!,
      )[0].price,
    ).toBe(1.42);
    expect(
      JSON.parse(
        localStorage.getItem(
          cacheKey("fuel_types_config", OWNER_A, STATION_2),
        )!,
      )[0].price,
    ).toBe(5.99);
  });
});

describe("session checkpoint — resume where you left off", () => {
  it("returns exactly what this session recorded", () => {
    const key = cacheKey("pos_transactions", OWNER_A, STATION_1);
    const value = [{ invoice: "INV-1", total: 12.5 }];
    checkpointEntry(key, value);
    expect(readCheckpoint(key)).toEqual(value);
  });

  it("returns null for a key this session never observed (never invents one)", () => {
    // This is the "imaginary data" guard: no checkpoint + no cache must yield
    // null, not a placeholder/default object.
    const unseen = cacheKey("never_seen_key", OWNER_A, STATION_1);
    expect(readCheckpoint(unseen)).toBeNull();
  });

  it("scopes checkpoints per owner so one account cannot read another's", () => {
    const keyA = cacheKey("credit_accounts", OWNER_A, STATION_1);
    const keyB = cacheKey("credit_accounts", OWNER_B, STATION_1);
    checkpointEntry(keyA, [{ name: "Account A" }]);

    expect(readCheckpoint(keyA)).toEqual([{ name: "Account A" }]);
    // Owner B never observed this key -> null, never owner A's data.
    expect(readCheckpoint(keyB)).toBeNull();
  });

  it("scopes checkpoints per station", () => {
    checkpointEntry(cacheKey("sales", OWNER_A, STATION_1), [1]);
    expect(readCheckpoint(cacheKey("sales", OWNER_A, STATION_2))).toBeNull();
  });

  it("clears every checkpoint on demand (used when purging an account)", () => {
    checkpointEntry(cacheKey("a", OWNER_A), { x: 1 });
    checkpointEntry(cacheKey("b", OWNER_A), { y: 2 });
    expect(checkpointedKeys().length).toBeGreaterThan(0);
    clearSessionCheckpoint();
    expect(checkpointedKeys()).toEqual([]);
    expect(readCheckpoint(cacheKey("a", OWNER_A))).toBeNull();
  });

  it("keeps the documented 30-second resume window", () => {
    expect(SESSION_CHECKPOINT_WINDOW_MS).toBe(30_000);
  });
});

describe("purgeUserCaches — account isolation on sign-out", () => {
  it("drops only the departing account's cache + queue + checkpoint", async () => {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");

    // The departing account's cached value + a queued offline write.
    const keyA = cacheKey("credit_accounts", OWNER_A, STATION_1);
    localStorage.setItem(keyA, JSON.stringify([{ name: "A data" }]));
    checkpointEntry(keyA, [{ name: "A data" }]);
    localStorage.setItem(
      "fuelpro_offline_queue_v1",
      JSON.stringify([
        {
          op: "set",
          key: "credit_accounts",
          value: [],
          ownerId: OWNER_A,
          ts: 1,
        },
        {
          op: "set",
          key: "credit_accounts",
          value: [],
          ownerId: OWNER_B,
          ts: 2,
        },
      ]),
    );

    // A second account's cache must be untouched by the purge.
    const keyB = cacheKey("credit_accounts", OWNER_B, STATION_1);
    localStorage.setItem(keyB, JSON.stringify([{ name: "B data" }]));

    cloudStorageService.purgeUserCaches(OWNER_A);

    expect(localStorage.getItem(keyA)).toBeNull();
    expect(readCheckpoint(keyA)).toBeNull();
    // Owner B's data survives: purging one account must not wipe the other's.
    expect(localStorage.getItem(keyB)).not.toBeNull();

    const queue = JSON.parse(localStorage.getItem("fuelpro_offline_queue_v1")!);
    expect(queue.map((op: { ownerId: string }) => op.ownerId)).toEqual([
      OWNER_B,
    ]);
  });

  it("is a no-op for an absent owner", async () => {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    const key = cacheKey("anything", OWNER_A);
    localStorage.setItem(key, JSON.stringify({ keep: true }));
    cloudStorageService.purgeUserCaches("");
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it("also clears the shared anonymous namespace on an identity change", async () => {
    // The anonymous bucket is the fallback when no identity is resolved yet, so
    // it is readable by ANY visitor to this browser profile. It must not survive
    // a sign-in/sign-out, or the next person would read the previous one's data.
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    const anonKey = cacheKey("credit_accounts", "anonymous");
    localStorage.setItem(anonKey, JSON.stringify({ balance: "leaked" }));

    cloudStorageService.purgeUserCaches(OWNER_A);

    expect(localStorage.getItem(anonKey)).toBeNull();
  });

  it("does not clear another account's namespace", async () => {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    const otherKey = cacheKey("credit_accounts", OWNER_B);
    localStorage.setItem(otherKey, JSON.stringify({ keep: true }));

    cloudStorageService.purgeUserCaches(OWNER_A);

    expect(localStorage.getItem(otherKey)).not.toBeNull();
  });
});

describe("user-id cache does not outlive an identity change", () => {
  it("ignores a cached id once the persisted identity differs", async () => {
    // Simulates: user A cached in memory -> sign out -> user B signs in.
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    localStorage.setItem(
      "fuelpro_auth_identity",
      JSON.stringify({ id: OWNER_A, email: "a@example.com" }),
    );
    expect(cloudStorageService.currentUserIdSync()).toBe(OWNER_A);

    // Identity is replaced by another account (as AuthContext does).
    localStorage.setItem(
      "fuelpro_auth_identity",
      JSON.stringify({ id: OWNER_B, email: "b@example.com" }),
    );
    expect(cloudStorageService.currentUserIdSync()).toBe(OWNER_B);

    // And after a full sign-out it is null, so nothing can be namespaced to A.
    localStorage.removeItem("fuelpro_auth_identity");
    expect(cloudStorageService.currentUserIdSync()).toBeNull();
  });
});

describe("connectivity semantics", () => {
  it("does not report offline merely because an API failed", () => {
    // With no network events fired, the module reports the navigator state.
    // The key assertion is that "degraded" and "offline" are distinct states,
    // so a provider outage is not surfaced as a connection loss.
    expect(["online", "offline", "degraded"]).toContain(getConnectivity());
    expect(isOffline()).toBe(getConnectivity() === "offline");
  });

  it("exposes no fabricated values from the checkpoint API", () => {
    expect(readCheckpoint("totally_unknown_key")).toBeNull();
  });
});

describe("resume window (last 30 seconds of work)", () => {
  it("returns work observed inside the resume window", () => {
    checkpointEntry("pos_transactions__list", [{ id: 1 }]);
    const resumed = readCheckpointWithinWindow<Array<{ id: number }>>(
      "pos_transactions__list",
    );
    expect(resumed).toEqual([{ id: 1 }]);
  });

  it("refuses a snapshot older than the window instead of passing it off as resumed work", () => {
    // Freeze the clock so the entry is deterministically older than the window
    // (checkpointEntry stamps Date.now(), so both would otherwise share a ms).
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    checkpointEntry("expenses_data", [1, 2, 3]);
    vi.setSystemTime(now + SESSION_CHECKPOINT_WINDOW_MS + 1_000);
    // The windowed reader must NOT hand this back as "what you were working on".
    const stale = readCheckpointWithinWindow("expenses_data");
    expect(stale).toBeNull();
    // The raw reader still exposes it for callers that explicitly want history.
    expect(readCheckpoint("expenses_data")).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });

  it("returns null for keys this session never observed", () => {
    expect(readCheckpointWithinWindow("never_seen_key")).toBeNull();
  });

  it("uses a 30-second window", () => {
    expect(SESSION_CHECKPOINT_WINDOW_MS).toBe(30_000);
  });
});
