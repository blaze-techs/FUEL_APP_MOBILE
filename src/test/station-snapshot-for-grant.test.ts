import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveGrantForAccess,
  buildStationSnapshotForGrant,
  decodeStored,
  type GrantIdentity,
} from "@/server/vercel-api/_lib/station-snapshot-for-grant";

const URL_BASE = "https://proj.supabase.co";
const KEY = "svc";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

/** Route the fetch mock by REST path so tests read like the real flow. */
function mockFetch(handlers: {
  grants?: unknown[];
  mirror?: unknown[];
  kv?: { id: string; data: unknown }[];
}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/rest/v1/company_grants"))
      return jsonResponse(handlers.grants ?? []);
    if (url.includes("/rest/v1/app_kv")) {
      // The mirror lookup filters on a code-derived id; the station read lists
      // all rows for the station. Distinguish by the `select` shape.
      if (url.includes("select=data") && url.includes("company_grant_"))
        return jsonResponse(handlers.mirror ?? []);
      return jsonResponse(handlers.kv ?? []);
    }
    return jsonResponse([]);
  });
}

const activeRow = {
  id: "grant_1",
  code: "ABC123",
  station_id: "st1",
  owner_id: "own1",
  member_name: "Ada",
  member_role: "Attendant",
  enabled: true,
  revoked: false,
  max_uses: null,
  uses: 0,
  expires_at: null,
  allowed_tabs: [],
};

afterEach(() => vi.restoreAllMocks());

describe("resolveGrantForAccess", () => {
  it("resolves an active grant from the relational table", async () => {
    vi.stubGlobal("fetch", mockFetch({ grants: [activeRow] }));
    const { grant } = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(grant?.stationId).toBe("st1");
    expect(grant?.source).toBe("table");
  });

  it("denies a revoked grant and says so", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ grants: [{ ...activeRow, revoked: true }] }),
    );
    const r = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(r.grant).toBeNull();
    expect(r.reason).toBe("revoked");
  });

  it("reports an exhausted active grant as used_up, NOT revoked", async () => {
    // The reported bug: revoked=false, enabled=true, uses==max_uses rendered
    // as "revoked" although the grant itself was never revoked.
    vi.stubGlobal(
      "fetch",
      mockFetch({
        grants: [
          { ...activeRow, revoked: false, enabled: true, max_uses: 1, uses: 1 },
        ],
      }),
    );
    const r = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(r.grant).toBeNull();
    expect(r.reason).toBe("used_up");
  });

  it("denies a disabled grant", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ grants: [{ ...activeRow, enabled: false }] }),
    );
    const r = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(r.reason).toBe("disabled");
  });

  it("denies an expired grant", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        grants: [{ ...activeRow, expires_at: "2000-01-01T00:00:00.000Z" }],
      }),
    );
    const r = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(r.reason).toBe("expired");
  });

  it("falls back to the legacy app_kv mirror and verifies the code exactly", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        grants: [],
        mirror: [{ data: { ...activeRow, code: "abc123" } }],
      }),
    );
    const { grant } = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(grant?.source).toBe("mirror");
  });

  it("rejects a mirror row whose exact code differs (wildcard guard)", async () => {
    // A `LIKE` pattern can match on `_`; authorisation must rest on the exact
    // code comparison, never the pattern alone.
    vi.stubGlobal(
      "fetch",
      mockFetch({
        grants: [],
        mirror: [{ data: { ...activeRow, code: "ZZZ" } }],
      }),
    );
    const r = await resolveGrantForAccess("ABC123", URL_BASE, KEY);
    expect(r.grant).toBeNull();
    expect(r.reason).toBe("invalid");
  });

  it("rejects an empty code", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const r = await resolveGrantForAccess("   ", URL_BASE, KEY);
    expect(r.reason).toBe("invalid");
  });
});

describe("buildStationSnapshotForGrant", () => {
  const grant: GrantIdentity = {
    grantId: "grant_1",
    stationId: "st1",
    ownerId: "own1",
    memberName: "Ada",
    memberRole: "Manager",
    readOnly: true,
    accessMode: "read",
    allowedTabs: [],
    expiresAt: null,
    source: "table",
  };

  const kvFixture = [
    {
      id: "fuel_types_config__own1__st1",
      data: [
        {
          name: "Super Petrol",
          localName: "Super Petrol",
          price: 220.08,
          code: "PMS",
          pumpCount: 4,
          active: true,
        },
        {
          name: "Diesel",
          localName: "Diesel",
          price: 224.95,
          code: "AGO",
          pumpCount: 3,
          active: true,
        },
      ],
    },
    {
      id: "pos_transactions__own1__st1",
      data: [
        {
          invoiceNumber: "INV1",
          total: 220.08,
          timestamp: "2026-08-17T13:00:00Z",
          items: [{ litres: 1, fuelType: "Super Petrol" }],
        },
      ],
    },
    {
      id: "user_own1_st1_compact__own1__st1",
      data: {
        companyData: { name: "Acme Fuels", currency: "KSh" },
        invoices: {
          "INV-1": {
            status: "unpaid",
            totalAmount: 510000,
            customer: { name: "IEBC" },
            date: "2026-09-11",
          },
        },
        clients: { IEBC: { name: "IEBC" } },
      },
    },
    {
      id: "payroll_employees__own1__st1",
      data: [{ fullName: "Ada", role: "Attendant" }],
    },
  ];

  it("reads the same authoritative rows the owner's app reads", async () => {
    vi.stubGlobal("fetch", mockFetch({ kv: kvFixture }));
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    expect(snap.stationName).toBe("Acme Fuels");
    expect(snap.dataSource).toBe("live");
    // Prices come from fuel_types_config, not a stale published copy.
    expect((snap.fuelPrices as { price: number }[])[0].price).toBe(220.08);
    // Sales come from the canonical POS ledger — not a null reducer field.
    expect(
      (snap.salesKpis as { transactionCount: number }).transactionCount,
    ).toBe(1);
    expect(
      (snap.salesKpis as { totalRevenue: number }).totalRevenue,
    ).toBeCloseTo(220.08);
  });

  it("reports invoice status from the stored status field (no truthy fallback)", async () => {
    // `inv.status || inv.paid` evaluated to "paid" for any non-empty status,
    // so a live unpaid invoice rendered as paid in the member view.
    vi.stubGlobal("fetch", mockFetch({ kv: kvFixture }));
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    const inv = (snap.invoices as { status: string }[])[0];
    expect(inv.status).toBe("unpaid");
  });

  it("does not leak sections the owner did not grant", async () => {
    // A manager with an EXPLICIT restricted tab set must not receive payroll,
    // credit or expense rows in the payload.
    vi.stubGlobal("fetch", mockFetch({ kv: kvFixture }));
    const restricted: GrantIdentity = { ...grant, allowedTabs: ["dashboard"] };
    const snap = await buildStationSnapshotForGrant(restricted, URL_BASE, KEY);
    expect(snap.employees).toEqual([]);
    expect(snap.creditAccounts).toEqual([]);
    expect(snap.expenses).toEqual([]);
    // Dashboard-granted sections still present.
    expect((snap.fuelPrices as unknown[]).length).toBe(2);
  });

  it("never returns a truthy aggregate for an ungranted section", async () => {
    vi.stubGlobal("fetch", mockFetch({ kv: kvFixture }));
    const restricted: GrantIdentity = { ...grant, allowedTabs: ["dashboard"] };
    const snap = await buildStationSnapshotForGrant(restricted, URL_BASE, KEY);
    const kpis = snap.reportKpis as Record<string, number>;
    expect(kpis.totalTeamMembers).toBe(0);
    expect(kpis.totalCreditOutstanding).toBe(0);
  });
});

describe("decodeStored", () => {
  it("unwraps the legacy __c envelope and returns plain values untouched", () => {
    expect(decodeStored({ a: 1 })).toEqual({ a: 1 });
    expect(decodeStored('{"b":2}')).toEqual({ b: 2 });
  });
});
