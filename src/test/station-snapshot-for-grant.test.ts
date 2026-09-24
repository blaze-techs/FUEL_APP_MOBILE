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
  stations?: unknown[];
}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/rest/v1/company_grants"))
      return jsonResponse(handlers.grants ?? []);
    if (url.includes("/rest/v1/stations"))
      return jsonResponse(handlers.stations ?? []);
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

  it("reports the currency code, never a stale leftover symbol", async () => {
    // The owner's Dashboard resolves the display currency with
    // `resolveCurrencySymbol`, which discards a value that is not a real ISO
    // code. A US station whose record still carried "KSh" therefore rendered as
    // "$ 1.42" for the owner but "KSh 1.42" for the member. The payload must
    // resolve the same way so the two views never disagree.
    const symbolOnly = kvFixture.map((row) =>
      row.id.startsWith("user_own1_st1_compact")
        ? {
            ...row,
            data: {
              ...(row.data as Record<string, unknown>),
              companyData: {
                name: "Acme Fuels",
                currency: "KSh",
                country: "US",
              },
            },
          }
        : row,
    );
    vi.stubGlobal("fetch", mockFetch({ kv: symbolOnly }));
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    expect(snap.currency).toBe("USD");
  });

  it("zeroes a price that cannot be right for the station's own market", async () => {
    // A Kenya station switched to USD keeps its old KSh figures in
    // fuel_types_config until someone edits them. The owner's Dashboard
    // rejects such a value (useStationFuelTypes), so the member payload must
    // too — otherwise the member reads a price the owner never sees, which is
    // exactly the contradiction this payload removes.
    const usFixture = kvFixture.map((row) =>
      row.id.startsWith("user_own1_st1_compact")
        ? {
            ...row,
            data: {
              ...(row.data as Record<string, unknown>),
              companyData: {
                name: "Acme Fuels",
                currency: "USD",
                companyCurrency: "USD",
                country: "US",
              },
            },
          }
        : row,
    );
    vi.stubGlobal("fetch", mockFetch({ kv: usFixture }));
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    // 220.08 (KSh) is far outside the US reference band => unknown, not a
    // substituted figure.
    expect((snap.fuelPrices as { price: number }[])[0].price).toBe(0);
  });

  it("takes the market from the station record, not a stale blob symbol", async () => {
    // The reported contradiction. This station's `stations` row says
    // country=US / currency=USD, but its compact blob still carries the
    // wizard-era `currency: "KSh"` with no country at all. Resolving the
    // market from the blob alone picked Kenya, so the plausibility guard threw
    // away the station's real USD price and the member saw a different price
    // from the owner. The station record must win.
    const usdKv = kvFixture.map((row) => {
      if (row.id === "fuel_types_config__own1__st1") {
        return {
          ...row,
          data: [
            {
              name: "Super Petrol",
              localName: "Super Petrol",
              price: 1.42,
              code: "PMS",
              pumpCount: 4,
              active: true,
            },
            {
              name: "Diesel",
              localName: "Diesel",
              price: 0,
              code: "AGO",
              pumpCount: 3,
              active: true,
            },
          ],
        };
      }
      if (row.id.startsWith("user_own1_st1_compact")) {
        return {
          ...row,
          data: {
            ...(row.data as Record<string, unknown>),
            companyData: { name: "", currency: "KSh" },
          },
        };
      }
      return row;
    });
    vi.stubGlobal(
      "fetch",
      mockFetch({
        kv: usdKv,
        stations: [
          { name: "Founder Admin Station", country: "US", currency: "USD" },
        ],
      }),
    );
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    // Display currency follows the record, so a stale symbol never leaks.
    expect(snap.currency).toBe("USD");
    // 1.42 is a valid USD pump price and must survive; judging it against a
    // Kenya band would zero it.
    expect((snap.fuelPrices as { price: number }[])[0].price).toBe(1.42);
    // The record also supplies the name the owner sees.
    expect(snap.stationName).toBe("Founder Admin Station");
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

  it("ignores a stale legacy price scalar when the live config disagrees", async () => {
    // THE reported contradiction: the published snapshot held the legacy
    // `pmsPrice` scalar (214.03/217.86) while the station's live configured
    // prices were 220.08/224.95, so the grant link showed different prices
    // from the main site. The live config must always win; a legacy scalar on
    // the compact blob is not a price source.
    const staleKv = [
      ...kvFixture,
      {
        id: "user_own1_st1_compact__own1__st1",
        data: {
          companyData: { name: "Acme Fuels", currency: "KSh" },
          pmsPrice: 214.03,
          agoPrice: 217.86,
          fuelPricesByType: { petrol: 214.03, diesel: 217.86 },
          invoices: {},
          clients: {},
        },
      },
    ];
    vi.stubGlobal("fetch", mockFetch({ kv: staleKv }));
    const snap = await buildStationSnapshotForGrant(grant, URL_BASE, KEY);
    const prices = (snap.fuelPrices as { label: string; price: number }[]).map(
      (f) => f.price,
    );
    expect(prices).toEqual([220.08, 224.95]);
    expect(prices).not.toContain(214.03);
    expect(prices).not.toContain(217.86);
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
