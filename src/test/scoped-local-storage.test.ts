/**
 * Cross-account isolation contract for the local business-data cache.
 *
 * These are the cases behind the reported "offline mode shows another user's
 * data" bug: a legacy global key written by account A must never be readable
 * by account B on the same device.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearScopedLocalForOwner,
  legacyOwnerKey,
  localDataOwner,
  readScopedLocal,
  removeScopedLocal,
  scopedLocalKey,
  writeScopedLocal,
} from "@/react-app/lib/scoped-local-storage";

function signIn(id: string | null): void {
  if (id === null) {
    localStorage.removeItem("fuelpro_auth_identity");
    return;
  }
  localStorage.setItem("fuelpro_auth_identity", JSON.stringify({ id }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("scoped local storage isolation", () => {
  it("returns the fallback when nothing is cached", () => {
    signIn("user-a");
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([]);
  });

  it("round-trips a value for the same account", () => {
    signIn("user-a");
    writeScopedLocal("fuelpro_pos_transactions", [{ id: "t1" }]);
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([
      { id: "t1" },
    ]);
  });

  it("NEVER serves one account's data to another account", () => {
    signIn("user-a");
    writeScopedLocal("fuelpro_pos_transactions", [{ id: "a-sale" }]);

    // Second account on the same device must not see account A's rows.
    signIn("user-b");
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([]);
  });

  it("does not adopt a legacy global value that another account owns", () => {
    // Account A wrote through the OLD global key (pre-fix build).
    signIn("user-a");
    localStorage.setItem(
      "fuelpro_credit_accounts",
      JSON.stringify([{ id: "a" }]),
    );
    localStorage.setItem(legacyOwnerKey("fuelpro_credit_accounts"), "user-a");

    // Account B signs in on the same device.
    signIn("user-b");
    expect(readScopedLocal("fuelpro_credit_accounts", [])).toEqual([]);
  });

  it("adopts an unclaimed legacy value once, for the account that claims it", () => {
    // Legacy value with no owner marker (upgrade from a single-account build).
    signIn("user-a");
    localStorage.setItem(
      "fuelpro_credit_accounts",
      JSON.stringify([{ id: "legacy" }]),
    );

    expect(readScopedLocal("fuelpro_credit_accounts", [])).toEqual([
      { id: "legacy" },
    ]);
    // Now claimed: the global copy is gone and ownership is recorded.
    expect(localStorage.getItem("fuelpro_credit_accounts")).toBeNull();
    expect(
      localStorage.getItem(legacyOwnerKey("fuelpro_credit_accounts")),
    ).toBe("user-a");

    // A different account can no longer see it.
    signIn("user-b");
    expect(readScopedLocal("fuelpro_credit_accounts", [])).toEqual([]);
  });

  it("keeps the same account's value across a re-read", () => {
    signIn("user-a");
    writeScopedLocal("fuelpro_news_bookmarks", ["b1"]);
    expect(readScopedLocal("fuelpro_news_bookmarks", [])).toEqual(["b1"]);
    expect(readScopedLocal("fuelpro_news_bookmarks", [])).toEqual(["b1"]);
  });

  it("survives corrupt stored JSON", () => {
    signIn("user-a");
    localStorage.setItem(
      scopedLocalKey("fuelpro_pos_transactions"),
      "{not json",
    );
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([]);
  });

  it("treats a signed-out session as its own namespace", () => {
    signIn(null);
    expect(localDataOwner()).toBeNull();
    writeScopedLocal("fuelpro_pos_transactions", [{ id: "guest" }]);
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([
      { id: "guest" },
    ]);
    // Signing in must not inherit the guest cache.
    signIn("user-a");
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([]);
  });

  it("removeScopedLocal clears both scoped and legacy copies", () => {
    signIn("user-a");
    writeScopedLocal("fuelpro_credit_tx", [{ id: "x" }]);
    localStorage.setItem(
      "fuelpro_credit_tx",
      JSON.stringify([{ id: "legacy" }]),
    );
    removeScopedLocal("fuelpro_credit_tx");
    expect(readScopedLocal("fuelpro_credit_tx", [])).toEqual([]);
    expect(localStorage.getItem("fuelpro_credit_tx")).toBeNull();
  });

  it("clearScopedLocalForOwner drops only that account's keys", () => {
    signIn("user-a");
    writeScopedLocal("fuelpro_pos_transactions", [{ id: "a" }]);
    signIn("user-b");
    writeScopedLocal("fuelpro_pos_transactions", [{ id: "b" }]);

    clearScopedLocalForOwner("user-a");

    signIn("user-a");
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([]);
    signIn("user-b");
    expect(readScopedLocal("fuelpro_pos_transactions", [])).toEqual([
      { id: "b" },
    ]);
  });
});
