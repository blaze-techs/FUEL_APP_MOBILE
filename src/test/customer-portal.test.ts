/**
 * Customer account link (the second mini site) — the properties that must hold.
 *
 * The interesting cases here are not "does it render" but the ones where a
 * mistake leaks one customer's finances to another, or hands a live link to
 * someone who should not have it. Those are asserted directly.
 */
import { describe, expect, it } from "vitest";
import {
  buildCustomerPortalDoc,
  customerPortalShareLine,
  customerPortalUrl,
  isPortalRecordLive,
  normalizePortalConfig,
  parsePortalToken,
  portalLinkStateText,
  PORTAL_TX_LIMIT,
} from "@/react-app/lib/customer-portal-service";
import { isCapabilityCode, randomBase62 } from "@/react-app/lib/random-code";

const account = {
  id: "acc-1",
  customerName: "Acme Logistics",
  balance: 12000,
  creditLimit: 50000,
  status: "active",
};

const transactions = [
  {
    id: "t1",
    accountId: "acc-1",
    type: "purchase",
    amount: 5000,
    description: "Diesel fill",
    date: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "t2",
    accountId: "acc-1",
    type: "payment",
    amount: 2000,
    description: "Bank transfer",
    date: "2026-09-10T10:00:00.000Z",
  },
  {
    id: "t3",
    accountId: "acc-2",
    type: "purchase",
    amount: 99999,
    description: "SOMEONE ELSE",
    date: "2026-09-05T10:00:00.000Z",
  },
];

const base = {
  token: "abcDEF123456",
  station: { name: "Publican Energy", phone: "+254700000000" },
  currencySymbol: "$",
  expiresAt: "2027-01-01T00:00:00.000Z",
};

describe("customer portal document", () => {
  it("excludes another customer's transactions", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions,
    });
    expect(doc.transactions).toHaveLength(2);
    expect(doc.transactions.some((t) => t.description === "SOMEONE ELSE")).toBe(
      false,
    );
  });

  it("never publishes internal-only fields such as the recording operator", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions: [
        {
          id: "t1",
          accountId: "acc-1",
          type: "purchase",
          amount: 100,
          description: "Fuel",
          date: "2026-09-01T10:00:00.000Z",
          recordedBy: "operator@station",
        },
      ],
    });
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("operator@station");
    expect(serialized).not.toContain("recordedBy");
  });

  it("caps the transaction list so a link cannot carry unbounded history", () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      id: `t${i}`,
      accountId: "acc-1",
      type: "purchase",
      amount: 10,
      description: `Entry ${i}`,
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    }));
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions: many,
    });
    expect(doc.transactions).toHaveLength(PORTAL_TX_LIMIT);
    // Newest first.
    expect(doc.transactions[0].description).toBe("Entry 74");
  });

  it("reports no utilisation when no limit is set, rather than a misleading 0%", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account: { ...account, creditLimit: 0 },
      transactions: [],
    });
    expect(doc.utilisation).toBeNull();
  });

  it("computes utilisation against the limit when one exists", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions: [],
    });
    expect(doc.utilisation).toBe(24);
  });

  it("omits payment instructions entirely when none were configured", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions: [],
    });
    expect(doc.paymentInstructions).toBeUndefined();
  });

  it("carries the issued token so a mismatched document can be rejected", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account,
      transactions: [],
    });
    expect(doc.token).toBe("abcDEF123456");
  });

  it("coerces junk figures to 0 instead of publishing NaN", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      account: { ...account, balance: Number.NaN },
      transactions: [
        {
          id: "t1",
          accountId: "acc-1",
          type: "purchase",
          amount: Number.NaN,
          date: "2026-09-01T10:00:00.000Z",
        },
      ],
    });
    expect(doc.balance).toBe(0);
    expect(doc.transactions[0].amount).toBe(0);
  });
});

describe("capability tokens", () => {
  it("produces the requested length with a full base62 alphabet", () => {
    const code = randomBase62(12);
    expect(code).toHaveLength(12);
    expect(/^[A-Za-z0-9]{12}$/.test(code)).toBe(true);
  });

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomBase62(12)));
    expect(seen.size).toBe(500);
  });

  it("is free of modulo bias: the alphabet is drawn uniformly", () => {
    // 256 % 62 == 8, so a naive `byte % 62` would make the first 8 characters
    // noticeably more frequent. Sample heavily and check the spread is tight.
    const counts = new Map<string, number>();
    const draws = 6200;
    for (let i = 0; i < draws; i++) {
      for (const ch of randomBase62(1)) {
        counts.set(ch, (counts.get(ch) || 0) + 1);
      }
    }
    expect(counts.size).toBeGreaterThan(50);
    const expected = draws / 62;
    const max = Math.max(...counts.values());
    const min = Math.min(...counts.values());
    // Generous bound: catches the ~33% skew of a biased generator while not
    // flaking on ordinary sampling noise.
    expect(max).toBeLessThan(expected * 1.6);
    expect(min).toBeGreaterThan(expected * 0.4);
  });

  it("validates token shape", () => {
    expect(isCapabilityCode("abcDEF123456")).toBe(true);
    expect(isCapabilityCode("short")).toBe(false);
    expect(isCapabilityCode("has-dash-1234")).toBe(false);
    expect(isCapabilityCode("")).toBe(false);
    expect(isCapabilityCode(null)).toBe(false);
  });
});

describe("link addressing", () => {
  it("builds an /account/<token> URL distinct from the station /site/<slug>", () => {
    const url = customerPortalUrl("abcDEF123456");
    expect(url).toContain("/account/abcDEF123456");
    expect(url).not.toContain("/site/");
  });

  it("extracts a token from a pasted URL or a bare token", () => {
    expect(parsePortalToken("https://x.dev/account/abcDEF123456")).toBe(
      "abcDEF123456",
    );
    expect(parsePortalToken("abcDEF123456")).toBe("abcDEF123456");
    expect(parsePortalToken("https://x.dev/site/some-station")).toBeNull();
    expect(parsePortalToken("nope")).toBeNull();
  });

  it("returns an empty share line for an unusable token", () => {
    // An empty line is what lets callers skip appending anything at all,
    // instead of emitting a dangling "View your account:" with no link.
    expect(customerPortalShareLine(null)).toBe("");
    expect(customerPortalShareLine("")).toBe("");
    expect(customerPortalShareLine("bad")).toBe("");
  });

  it("includes the token when quoting the share line", () => {
    const line = customerPortalShareLine("abcDEF123456", "View:");
    expect(line).toContain("/account/abcDEF123456");
    expect(line.startsWith("View:")).toBe(true);
  });
});

describe("link lifecycle", () => {
  const now = Date.UTC(2026, 8, 24);

  it("treats a missing record as not live", () => {
    expect(isPortalRecordLive(null, now)).toBe(false);
    expect(isPortalRecordLive(undefined, now)).toBe(false);
  });

  it("treats an unexpired record as live", () => {
    expect(
      isPortalRecordLive({ expiresAt: "2026-10-01T00:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("treats an expired record as not live", () => {
    expect(
      isPortalRecordLive({ expiresAt: "2026-09-01T00:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("treats a revoked record as not live even before it expires", () => {
    expect(
      isPortalRecordLive(
        { expiresAt: "2026-10-01T00:00:00.000Z", revoked: true },
        now,
      ),
    ).toBe(false);
  });

  it("labels link state for the owner", () => {
    expect(portalLinkStateText({ expired: false })).toBe("Active");
    expect(portalLinkStateText({ expired: true })).toBe("Expired");
    expect(portalLinkStateText({ expired: false, revoked: true })).toBe(
      "Revoked",
    );
  });

  it("clamps the expiry setting to a sane window", () => {
    expect(normalizePortalConfig({ expiryDays: 0 }).expiryDays).toBe(1);
    expect(normalizePortalConfig({ expiryDays: 9999 }).expiryDays).toBe(365);
    expect(normalizePortalConfig({ expiryDays: 14 }).expiryDays).toBe(14);
    // Junk falls back to the default rather than a non-numeric window.
    expect(normalizePortalConfig({ expiryDays: Number.NaN }).expiryDays).toBe(
      30,
    );
    expect(normalizePortalConfig(null).expiryDays).toBe(30);
  });
});
