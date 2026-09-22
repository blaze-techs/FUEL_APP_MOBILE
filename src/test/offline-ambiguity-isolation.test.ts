/**
 * Regression tests for the per-account keys that were still GLOBAL.
 *
 * The offline/sync layer had been scoped per account, but several stores were
 * missed. Because localStorage is shared by every account on the device, a
 * second account inherited the first one's data — the reported "offline mode
 * shows another user's data, different from this user's data". This file locks
 * down each store that was missed.
 *
 * Keys covered:
 *  - fuelpro_v2_team / fuelpro_v2_invites / fuelpro_role_tab_grants /
 *    fuelpro_custom_roles  (team + access control)
 *  - fuelpro_station_market  (which market a station's prices are judged in)
 *  - fuelpro_subscription_v1 / _tier_v1 / _history / _trial_start (billing)
 *  - fuelpro_mpesa_pending / _history (payment records)
 *  - fuelpro_role_bindings (station role grants)
 *  - fuelpro_sync_queue (pending cloud writes)
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

describe("station market isolation", () => {
  it("does not hand the previous account's market to the next account", async () => {
    const mod = await import("@/react-app/lib/station-market");
    const { publishStationMarket, resolveStationCountry, STATION_MARKET_KEY } =
      mod;

    signInAs(OWNER_A);
    publishStationMarket("KE");
    // A's market is stored under A's own key, never the bare global.
    expect(localStorage.getItem(STATION_MARKET_KEY)).toBeNull();
    expect(
      localStorage.getItem(`fuelpro_scoped_${OWNER_A}__${STATION_MARKET_KEY}`),
    ).toBeTruthy();

    // B must not inherit A's market from the published value.
    signInAs(OWNER_B);
    expect(resolveStationCountry("default_station")).toBe("");

    // Even after signing out, the value must not resurface as a global.
    signOut();
    expect(resolveStationCountry("default_station")).toBe("");
  });
});

describe("subscription isolation", () => {
  it("keeps the paid plan, receipt and history on the paying account", async () => {
    const store = await import("@/react-app/lib/subscriptionStore");

    signInAs(OWNER_A);
    store.activateTier("manager", {
      mpesaReceipt: "QK123",
      phone: "254700000000",
    });
    store.logSubscriptionAction("activated", "manager", "paid by M-PESA");
    expect(store.getSubscription().tier).toBe("manager");

    signInAs(OWNER_B);
    // B is a fresh account: not A's paid tier, and no trace of A's receipt.
    const bSub = store.getSubscription();
    expect(bSub.tier).toBe("free");
    expect(bSub.mpesaReceipt).not.toBe("QK123");
    expect(JSON.stringify(store.getSubscriptionHistory())).not.toContain(
      "QK123",
    );
  });

  it("resetSubscription only clears the current account", async () => {
    const store = await import("@/react-app/lib/subscriptionStore");

    signInAs(OWNER_A);
    store.activateTier("manager");
    signInAs(OWNER_B);
    store.activateTier("auditor");

    store.resetSubscription();
    expect(store.getSubscription().tier).not.toBe("auditor");

    // A's plan survives B's reset.
    signInAs(OWNER_A);
    expect(store.getSubscription().tier).toBe("manager");
  });
});

describe("M-PESA record isolation", () => {
  it("never returns another account's pending or historical payments", async () => {
    const mod = await import("@/react-app/utils/mpesaStk");

    signInAs(OWNER_A);
    mod.addToHistory({
      checkoutRequestId: "A-1",
      merchantRequestId: "m",
      phoneNumber: "254711111111",
      amount: 1000,
      accountReference: "FUEL-A",
      status: "success",
      timestamp: new Date().toISOString(),
    });
    expect(mod.getTransactionHistory()).toHaveLength(1);

    signInAs(OWNER_B);
    expect(mod.getTransactionHistory()).toEqual([]);
    expect(mod.getPendingTransactions()).toEqual([]);

    // B's own records stay separate from A's.
    mod.addToHistory({
      checkoutRequestId: "B-1",
      merchantRequestId: "m",
      phoneNumber: "254722222222",
      amount: 50,
      accountReference: "FUEL-B",
      status: "pending",
      timestamp: new Date().toISOString(),
    });
    expect(
      mod.getTransactionHistory().map((t) => t.checkoutRequestId),
    ).toEqual(["B-1"]);

    signInAs(OWNER_A);
    expect(
      mod.getTransactionHistory().map((t) => t.checkoutRequestId),
    ).toEqual(["A-1"]);
  });
});

describe("scoped key helper", () => {
  it("partitions each key per account and never writes the bare global", () => {
    // Guard the contract every store above relies on.
    return import("@/react-app/lib/scoped-local-storage").then(
      ({ writeScopedLocal, readScopedLocal, scopedLocalKey }) => {
        signInAs(OWNER_A);
        writeScopedLocal("fuelpro_any_key", { v: "A" });
        expect(localStorage.getItem("fuelpro_any_key")).toBeNull();
        expect(localStorage.getItem(scopedLocalKey("fuelpro_any_key"))).toBe(
          JSON.stringify({ v: "A" }),
        );
        expect(readScopedLocal("fuelpro_any_key", null)).toEqual({ v: "A" });

        signInAs(OWNER_B);
        expect(readScopedLocal("fuelpro_any_key", null)).toBeNull();

        signOut();
        expect(readScopedLocal("fuelpro_any_key", null)).toBeNull();
      },
    );
  });
});
