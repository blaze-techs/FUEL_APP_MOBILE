/**
 * Account-isolation regression tests for the offline/sync layer.
 *
 * Reported symptoms these lock down:
 *
 *  - "offline mode shows another user's data, different from this user's data"
 *  - "offline and online mode have different sets of data hence they are not in
 *    sync"
 *
 * Root causes covered here:
 *
 *  1. The cross-tab BroadcastChannel in syncEngine was created once at module
 *     load, freezing the namespace of whoever signed in first. A later account
 *     in the same tab kept listening on the previous account's channel.
 *  2. The same for the localStorage sync ping, which was a single global key.
 *  3. `exportAllData()` swept every `fuelpro_` key, so a backup could contain a
 *     previous account's user-scoped data.
 *  4. PlatformDataContext read/wrote unscoped shared keys (fuelpro_sales_v3,
 *     fuelpro_users_v3, ...) and broadcast on a global channel.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const OWNER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function signInAs(id: string): void {
  localStorage.setItem(
    "fuelpro_auth_identity",
    JSON.stringify({ id, email: `${id}@example.com` }),
  );
}

function signOut(): void {
  localStorage.removeItem("fuelpro_auth_identity");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.resetModules();
});

describe("syncEngine broadcast isolation", () => {
  it("namespaces the BroadcastChannel per signed-in account", async () => {
    const opened: string[] = [];
    class FakeBroadcastChannel {
      name: string;
      constructor(name: string) {
        this.name = name;
        opened.push(name);
      }
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as never);

    const mod = await import("@/react-app/lib/syncEngine");
    const BROADCAST_KEY_PREFIX = mod.BROADCAST_KEY_PREFIX;

    signInAs(OWNER_A);
    mod.onMutation(() => {});

    signInAs(OWNER_B);
    mod.onMutation(() => {});

    // Two distinct accounts must never share a channel name.
    const unique = [...new Set(opened)];
    expect(unique.length).toBeGreaterThanOrEqual(2);
    expect(unique.some((n) => n.includes(OWNER_A))).toBe(true);
    expect(unique.some((n) => n.includes(OWNER_B))).toBe(true);
    for (const name of unique) {
      expect(name.startsWith(BROADCAST_KEY_PREFIX)).toBe(true);
    }
  });

  it("falls back to a per-account localStorage ping key", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("unsupported");
        }
      } as never,
    );

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const mod = await import("@/react-app/lib/syncEngine");

    signInAs(OWNER_A);
    mod.onMutation(() => {});
    mod.__testing.broadcastMutation({
      id: "x",
      collection: "c",
      operation: "create",
      data: {},
      timestamp: Date.now(),
      deviceId: "d",
      synced: false,
    });

    const pingKeys = setItem.mock.calls
      .map(([k]) => String(k))
      .filter((k) => k.startsWith("fuelpro_sync_ping"));
    for (const k of pingKeys) {
      // Every ping key must carry the account namespace — never a bare global.
      expect(k).not.toBe("fuelpro_sync_ping");
      expect(k).toContain(OWNER_A);
    }
    setItem.mockRestore();
  });
});

describe("exportAllData account scoping", () => {
  it("exports only the active account's scoped keys", async () => {
    signInAs(OWNER_A);
    localStorage.setItem(`fuelpro_cloud_credit_accounts__${OWNER_A}`, "[]");
    localStorage.setItem(`fuelpro_cloud_pos_transactions__${OWNER_A}`, "[]");
    // A previous account's leftovers must not enter the export.
    localStorage.setItem(
      `fuelpro_cloud_credit_accounts__${OWNER_B}`,
      "[secret]",
    );
    localStorage.setItem(
      `fuelpro_cloud_pos_transactions__${OWNER_B}`,
      "[secret]",
    );

    const { exportAllData } = await import("@/react-app/lib/syncEngine");
    const json = await exportAllData();

    expect(json).toContain(OWNER_A);
    expect(json).not.toContain(OWNER_B);
    expect(json).not.toContain("secret");
  });
});

describe("PlatformDataContext key scoping", () => {
  it("namespaces shared storage keys per account", async () => {
    const { __testing } =
      (await import("@/react-app/context/PlatformDataContext")) as unknown as {
        __testing: {
          scopedKey: (k: string) => string;
          broadcastChannelName: () => string;
          setItem: (k: string, v: unknown) => void;
          getItem: <T>(k: string, f: T) => T;
        };
      };

    signInAs(OWNER_A);
    const aKey = __testing.scopedKey("fuelpro_sales_v3");
    const aChannel = __testing.broadcastChannelName();

    signInAs(OWNER_B);
    const bKey = __testing.scopedKey("fuelpro_sales_v3");
    const bChannel = __testing.broadcastChannelName();

    expect(aKey).not.toBe(bKey);
    expect(aKey).toContain(OWNER_A);
    expect(bKey).toContain(OWNER_B);
    expect(aChannel).not.toBe(bChannel);
  });

  it("round-trips a value within one account and hides it from another", async () => {
    const { __testing } =
      (await import("@/react-app/context/PlatformDataContext")) as unknown as {
        __testing: {
          setItem: (k: string, v: unknown) => void;
          getItem: <T>(k: string, f: T) => T;
        };
      };

    signInAs(OWNER_A);
    __testing.setItem("fuelpro_sales_v3", [{ id: "a-sale" }]);
    expect(__testing.getItem("fuelpro_sales_v3", [])).toEqual([
      { id: "a-sale" },
    ]);

    signInAs(OWNER_B);
    // B must NOT see A's sales — this is the "another user's data" symptom.
    expect(__testing.getItem("fuelpro_sales_v3", [])).toEqual([]);

    signOut();
    expect(__testing.getItem("fuelpro_sales_v3", [])).toEqual([]);
  });
});
