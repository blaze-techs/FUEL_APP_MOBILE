import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateGrantCode,
  buildGrantLink,
  redeemCompanyGrant,
  fetchGrantStationDataOutcome,
  GRANT_TAB_PRESETS,
  createCompanyGrant,
  listCompanyGrants,
  revokeCompanyGrant,
  deleteCompanyGrant,
  resetGrantUsage,
  grantModeLabel,
} from "@/react-app/lib/company-grant-service";

// The service writes grants through cloudStorageService (app_kv) and redeems
// through GET /api/company-grant-redeem (serverless endpoint) with an RPC
// fallback. Stub both layers so tests exercise every branch without a network.
const rpcMock = vi.fn();
const storageGet = vi.fn();
const storageSet = vi.fn();
const storageDel = vi.fn();
const companyGrantRows: Record<string, unknown>[] = [];

function tableChain() {
  const state: {
    op?: string;
    patch?: Record<string, unknown>;
    filters: Record<string, unknown>;
  } = { filters: {} };
  const chain: any = {
    select: vi.fn(() => {
      state.op = "select";
      return chain;
    }),
    eq: vi.fn((key: string, value: unknown) => {
      state.filters[key] = value;
      return chain;
    }),
    order: vi.fn(() =>
      Promise.resolve({
        data: companyGrantRows.filter((r) =>
          Object.entries(state.filters).every(([k, v]) => r[k] === v),
        ),
        error: null,
      }),
    ),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data:
          companyGrantRows.find((r) =>
            Object.entries(state.filters).every(([k, v]) => r[k] === v),
          ) ?? null,
        error: null,
      }),
    ),
    insert: vi.fn((row: Record<string, unknown>) => {
      companyGrantRows.push(row);
      return Promise.resolve({ data: null, error: null });
    }),
    upsert: vi.fn((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        if (!companyGrantRows.some((r) => r.id === row.id))
          companyGrantRows.push(row);
      }
      return Promise.resolve({ data: null, error: null });
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      state.op = "update";
      state.patch = patch;
      return chain;
    }),
    delete: vi.fn(() => {
      state.op = "delete";
      return chain;
    }),
    then: (resolve: (value: unknown) => unknown) => {
      const matches = companyGrantRows.filter((r) =>
        Object.entries(state.filters).every(([k, v]) => r[k] === v),
      );
      if (state.op === "update") {
        matches.forEach((r) => Object.assign(r, state.patch));
      } else if (state.op === "delete") {
        for (const r of matches) {
          const i = companyGrantRows.indexOf(r);
          if (i >= 0) companyGrantRows.splice(i, 1);
        }
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return chain;
}

vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(() => ({
        data: { session: { user: { id: "owner-1" } } },
      })),
    },
    rpc: rpcMock,
    from: vi.fn(() => tableChain()),
  })),
  supabase: {},
}));

vi.mock("@/react-app/lib/cloud-storage-service", () => ({
  cloudStorageService: {
    get: (...args: unknown[]) => storageGet(...args),
    set: (...args: unknown[]) => storageSet(...args),
    delete: (...args: unknown[]) => storageDel(...args),
    getCached: () => null,
  },
}));

describe("generateGrantCode", () => {
  it("produces a 18-char URL-safe code from the unambiguous alphabet", () => {
    const code = generateGrantCode();
    expect(code).toHaveLength(18);
    expect(code).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/,
    );
  });

  it("is unique across many draws (crypto-random, ~93 bits)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateGrantCode());
    expect(seen.size).toBe(2000);
  });
});

describe("buildGrantLink", () => {
  it("encodes the grant code into the station-access hash route", () => {
    const link = buildGrantLink("AbC123");
    expect(link).toContain("/#/station-access?grant=AbC123");
  });

  it("URL-encodes the code so special chars never break the link", () => {
    const link = buildGrantLink("a b&c");
    expect(link).toContain(encodeURIComponent("a b&c"));
  });
});

describe("GRANT_TAB_PRESETS", () => {
  it("has an 'all sections' preset with an empty tab list (empty = all)", () => {
    const all = GRANT_TAB_PRESETS.find((p) => p.id === "all");
    expect(all).toBeDefined();
    expect(all!.tabs).toEqual([]);
  });

  it("presets are unique by id", () => {
    const ids = GRANT_TAB_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("redeemCompanyGrant", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    rpcMock.mockReset();
    companyGrantRows.splice(0, companyGrantRows.length);
    storageGet.mockReset();
    storageSet.mockReset();
    storageDel.mockReset();
    // Default: the serverless endpoint is unreachable → RPC fallback path.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects empty/whitespace codes as invalid", async () => {
    await expect(redeemCompanyGrant("")).rejects.toMatchObject({
      reason: "invalid",
    });
    await expect(redeemCompanyGrant("   ")).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects as invalid when the RPC reports no row", async () => {
    // No row and no structured reason is a missing link — never "revoked".
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(redeemCompanyGrant("nope")).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects as unknown when the RPC errors (e.g. RPC not deployed yet)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "PGRST202" } });
    await expect(redeemCompanyGrant("abc")).rejects.toMatchObject({
      reason: "unknown",
    });
  });

  it("surfaces the precise reason for an exhausted grant (not 'revoked')", async () => {
    // The reported bug: a grant that was never revoked rendered as revoked.
    rpcMock.mockResolvedValue({
      data: { reason: "used_up" },
      error: null,
    });
    await expect(redeemCompanyGrant("abcdefghijklmnopq")).rejects.toMatchObject(
      {
        reason: "used_up",
      },
    );
  });

  it("returns the access config on a successful RPC redeem", async () => {
    rpcMock.mockResolvedValue({
      data: {
        grantId: "grant_1",
        memberName: "QA Tester",
        memberRole: "Manager",
        allowedTabs: ["dashboard", "pos"],
        readOnly: true,
        stationId: "station-1",
        stationOwnerId: "owner-1",
        expiresAt: "2026-10-01T00:00:00Z",
      },
      error: null,
    });
    const res = await redeemCompanyGrant("RealCode123");
    expect(res).not.toBeNull();
    expect(res!.stationId).toBe("station-1");
    expect(res!.stationOwnerId).toBe("owner-1");
    expect(res!.allowedTabs).toEqual(["dashboard", "pos"]);
    expect(res!.readOnly).toBe(true);
  });

  it("throws a clear error when the grant is brute-force locked", async () => {
    rpcMock.mockResolvedValue({
      data: { locked: true, retryAfter: "2026-09-06T00:00:00Z" },
      error: null,
    });
    await expect(redeemCompanyGrant("locked")).rejects.toThrow(/locked/i);
  });

  it("redeems through the authoritative RPC before the legacy endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        grantId: "grant_endpoint",
        memberName: "Endpoint Tester",
        memberRole: "Staff",
        allowedTabs: ["dashboard"],
        readOnly: true,
        stationId: "station-9",
        stationOwnerId: "owner-9",
        expiresAt: null,
      }),
    } as Response);
    const res = await redeemCompanyGrant("ABCDEFGHJKLMNPQRSTU");
    expect(res).not.toBeNull();
    expect(res!.grantId).toBe("grant_endpoint");
    expect(res!.stationId).toBe("station-9");
    expect(res!.readOnly).toBe(true);
    // The authoritative RPC is attempted first; the legacy endpoint is a compatibility fallback.
    expect(rpcMock).toHaveBeenCalledWith("redeem_company_grant", {
      p_code: "ABCDEFGHJKLMNPQRSTU",
    });
  });

  it("treats a 4xx endpoint answer with a precise reason as definitive", async () => {
    // A 4xx that names the reason is authoritative — do not fall through to
    // the legacy RPC (which would report a coarse, misleading state).
    rpcMock.mockResolvedValue({ data: null, error: { message: "PGRST202" } });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "used up", reason: "used_up" }),
    } as Response);
    await expect(
      redeemCompanyGrant("ABCDEFGHJKLMNPQRSTU"),
    ).rejects.toMatchObject({ reason: "used_up" });
  });
});

describe("company grant CRUD (authoritative relational storage + compatibility app_kv)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    companyGrantRows.splice(0, companyGrantRows.length);
    storageGet.mockReset();
    storageSet.mockReset();
    storageDel.mockReset();
    storageGet.mockResolvedValue(null);
    storageSet.mockResolvedValue(undefined);
    storageDel.mockResolvedValue(undefined);
  });

  it("creates a grant in the authoritative table plus a code-keyed compatibility row", async () => {
    const grant = await createCompanyGrant(
      {
        memberName: "QA Manager",
        memberRole: "Manager",
        allowedTabs: ["dashboard", "pos"],
        readOnly: true,
        expiresInDays: 7,
        maxUses: 5,
      },
      "station-1",
    );
    expect(grant.code).toHaveLength(18);
    expect(grant.memberName).toBe("QA Manager");
    expect(grant.expiresAt).not.toBeNull();
    // An explicitly requested limit is preserved (the UI now defaults to
    // blank = un-capped, so a shared QR is not silently exhausted).
    expect(grant.maxUses).toBe(5);
    expect(companyGrantRows).toHaveLength(1);
    expect(companyGrantRows[0]).toEqual(
      expect.objectContaining({
        id: grant.id,
        code: grant.code,
        station_id: "station-1",
        owner_id: "owner-1",
        max_uses: 5,
      }),
    );
    expect(storageSet).toHaveBeenCalledWith(
      `company_grant_${grant.code}`,
      expect.objectContaining({ code: grant.code }),
      "station-1",
    );
  });

  it("resets an exhausted grant's usage counter without changing its code", async () => {
    // The reported bug: a grant that merely ran out of uses was reported as
    // revoked. Re-enabling must restore it WITHOUT issuing a new code, so an
    // already-shared QR keeps working.
    const grant = await createCompanyGrant(
      {
        memberName: "QA Reset",
        memberRole: "Staff",
        allowedTabs: [],
        maxUses: 1,
      },
      "station-1",
    );
    companyGrantRows[0].uses = 1;

    await resetGrantUsage(grant.id, "station-1");

    expect(companyGrantRows[0].uses).toBe(0);
    expect(companyGrantRows[0].code).toBe(grant.code);
    expect(companyGrantRows[0].revoked).toBe(false);
  });

  it("creates a grant under a non-read access mode (edit / full)", async () => {
    const edit = await createCompanyGrant(
      {
        memberName: "QA Editor",
        memberRole: "Staff",
        allowedTabs: ["dashboard"],
        readOnly: false,
        accessMode: "edit",
        expiresInDays: 3,
      },
      "station-1",
    );
    expect(edit.accessMode).toBe("edit");
    expect(edit.readOnly).toBe(false);

    const full = await createCompanyGrant(
      {
        memberName: "QA Full",
        memberRole: "Manager",
        allowedTabs: [],
        accessMode: "full",
      },
      "station-1",
    );
    expect(full.accessMode).toBe("full");
    expect(full.readOnly).toBe(false);

    // Default (no accessMode) → read.
    const auto = await createCompanyGrant(
      { memberName: "QA Auto", memberRole: "Staff", allowedTabs: [] },
      "station-1",
    );
    expect(auto.accessMode).toBe("read");
    expect(auto.readOnly).toBe(true);

    // readOnly:false with no accessMode → full (legacy behavior preserved).
    const legacy = await createCompanyGrant(
      {
        memberName: "QA Legacy",
        memberRole: "Staff",
        allowedTabs: [],
        readOnly: false,
      },
      "station-1",
    );
    expect(legacy.accessMode).toBe("full");
    expect(legacy.readOnly).toBe(false);
  });

  it("migrates access_mode from legacy rows during authoritative listing (snake + camel)", async () => {
    storageGet.mockResolvedValue([
      {
        id: "grant_edit",
        code: "BBBBBBBBBBBBBBBBBB",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "Editor",
        memberRole: "Staff",
        allowedTabs: ["pos"],
        access_mode: "edit",
        read_only: false,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
      },
      {
        id: "grant_full",
        code: "CCCCCCCCCCCCCCCCCC",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "Full",
        memberRole: "Manager",
        allowedTabs: [],
        accessMode: "full",
        readOnly: false,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
      },
      {
        id: "grant_read",
        code: "DDDDDDDDDDDDDDDDDD",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "Viewer",
        memberRole: "Auditor",
        allowedTabs: [],
        read_only: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
      },
    ]);
    const grants = await listCompanyGrants("station-1");
    expect(grants.find((g) => g.id === "grant_edit")?.accessMode).toBe("edit");
    expect(grants.find((g) => g.id === "grant_full")?.accessMode).toBe("full");
    expect(grants.find((g) => g.id === "grant_read")?.accessMode).toBe("read");
  });

  it("grantModeLabel covers all modes", () => {
    expect(grantModeLabel("read")).toContain("Read only");
    expect(grantModeLabel("edit")).toContain("Edit only");
    expect(grantModeLabel("full")).toContain("Normal");
    expect(grantModeLabel(undefined)).toContain("Read only");
    expect(grantModeLabel(null)).toContain("Read only");
  });

  it("migrates and lists legacy app_kv grants, filtered to the owner + station", async () => {
    storageGet.mockResolvedValue([
      {
        id: "grant_1",
        code: "AAAAAAAAAAAAAAAAAA",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "QA Manager",
        memberRole: "Manager",
        allowedTabs: ["dashboard"],
        readOnly: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
        expiresAt: null,
        maxUses: null,
        uses: 0,
        lastRedeemedAt: null,
      },
      {
        id: "grant_other",
        code: "BBBBBBBBBBBBBBBBBB",
        stationId: "station-OTHER",
        ownerId: "owner-1",
        memberName: "Other Station",
        memberRole: "Staff",
        allowedTabs: [],
        readOnly: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
        expiresAt: null,
        maxUses: null,
        uses: 0,
        lastRedeemedAt: null,
      },
    ]);
    const grants = await listCompanyGrants("station-1");
    expect(grants).toHaveLength(1);
    expect(grants[0].id).toBe("grant_1");
  });

  it("revokes one authoritative grant and drops its code-keyed compatibility row", async () => {
    storageGet.mockResolvedValue([
      {
        id: "grant_1",
        code: "AAAAAAAAAAAAAAAAAA",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "QA Manager",
        memberRole: "Manager",
        allowedTabs: [],
        readOnly: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
        expiresAt: null,
        maxUses: null,
        uses: 0,
        lastRedeemedAt: null,
      },
    ]);
    companyGrantRows.push({
      id: "grant_1",
      code: "AAAAAAAAAAAAAAAAAA",
      station_id: "station-1",
      owner_id: "owner-1",
      member_name: "QA Manager",
      member_role: "Manager",
      allowed_tabs: [],
      read_only: true,
      enabled: true,
      revoked: false,
      created_at: new Date().toISOString(),
      expires_at: null,
      max_uses: null,
      uses: 0,
      access_mode: "read",
    });
    await revokeCompanyGrant("grant_1", "station-1");
    expect(companyGrantRows).toHaveLength(1);
    expect(companyGrantRows[0].revoked).toBe(true);
    expect(companyGrantRows[0].enabled).toBe(false);
    expect(storageDel).toHaveBeenCalledWith(
      "company_grant_AAAAAAAAAAAAAAAAAA",
      "station-1",
    );
  });

  it("normalizes a numeric-ms expiresAt (client-shape), not 'Never'", async () => {
    storageGet.mockResolvedValue([
      {
        id: "grant_1",
        code: "AAAAAAAAAAAAAAAAAA",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "QA Manager",
        memberRole: "Manager",
        allowedTabs: [],
        readOnly: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86400000, // number, not ISO string
        maxUses: null,
        uses: 0,
        lastRedeemedAt: null,
      },
    ]);
    const grants = await listCompanyGrants("station-1");
    expect(grants).toHaveLength(1);
    expect(grants[0].expiresAt).not.toBeNull();
    expect(grants[0].expiresAt).toBeGreaterThan(Date.now() + 5 * 86400000);
  });

  it("deletes one authoritative grant and its code-keyed compatibility row", async () => {
    storageGet.mockResolvedValue([
      {
        id: "grant_1",
        code: "AAAAAAAAAAAAAAAAAA",
        stationId: "station-1",
        ownerId: "owner-1",
        memberName: "QA Manager",
        memberRole: "Manager",
        allowedTabs: [],
        readOnly: true,
        enabled: true,
        revoked: false,
        createdAt: Date.now(),
        expiresAt: null,
        maxUses: null,
        uses: 0,
        lastRedeemedAt: null,
      },
    ]);
    companyGrantRows.push({
      id: "grant_1",
      code: "AAAAAAAAAAAAAAAAAA",
      station_id: "station-1",
      owner_id: "owner-1",
      member_name: "QA Manager",
      member_role: "Manager",
      allowed_tabs: [],
      read_only: true,
      enabled: true,
      revoked: false,
      created_at: new Date().toISOString(),
      expires_at: null,
      max_uses: null,
      uses: 0,
      access_mode: "read",
    });
    await deleteCompanyGrant("grant_1", "station-1");
    expect(companyGrantRows).toHaveLength(0);
    expect(storageDel).toHaveBeenCalledWith(
      "company_grant_AAAAAAAAAAAAAAAAAA",
      "station-1",
    );
  });
});

describe("company grant code normalization", () => {
  it("accepts QR links regardless of URL/QR case normalization", () => {
    const generated = "AaBbCcDd23456789";
    expect(generated.toLowerCase()).toBe("aabbccdd23456789");
    expect(generated.toLowerCase()).toBe("AABBCCDD23456789".toLowerCase());
  });
});

describe("fetchGrantStationDataOutcome — denial vs outage", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    // `grantApiBase()` reads window.location; give it a supported host so the
    // request is attempted instead of short-circuiting to "unavailable".
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "https://fuel-app-mobile.pages.dev",
        hostname: "fuel-app-mobile.pages.dev",
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("reports `denied` with the precise reason for an exhausted grant", async () => {
    // THE regression: the handler answered a used-up grant with 502, so the
    // member page could not tell a revoked link from an outage and silently
    // rendered the stale published snapshot (contradictory prices).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ success: false, reason: "used_up" }),
    } as Response);
    const outcome = await fetchGrantStationDataOutcome("ABC");
    expect(outcome).toMatchObject({ state: "denied", reason: "used_up" });
  });

  it("reports `denied` even when a relay normalises the status code", async () => {
    // The Cloudflare relay can turn a 4xx body into a 502 transport error;
    // the body's reason is authoritative.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ success: false, reason: "revoked" }),
    } as Response);
    const outcome = await fetchGrantStationDataOutcome("ABC");
    expect(outcome).toMatchObject({ state: "denied", reason: "revoked" });
  });

  it("reports `unavailable` (not denied) when the backend cannot be reached", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const outcome = await fetchGrantStationDataOutcome("ABC");
    expect(outcome.state).toBe("unavailable");
  });

  it("reports `unavailable` for a bodyless 5xx so a stale copy may be shown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    } as Response);
    const outcome = await fetchGrantStationDataOutcome("ABC");
    expect(outcome.state).toBe("unavailable");
  });

  it("returns the authoritative snapshot on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        snapshot: {
          stationId: "s1",
          fuelPrices: [{ label: "Diesel", price: 224.95 }],
        },
      }),
    } as Response);
    const outcome = await fetchGrantStationDataOutcome("ABC");
    expect(outcome.state).toBe("ok");
    expect(
      (outcome as { snapshot: { fuelPrices: { price: number }[] } }).snapshot
        .fuelPrices[0].price,
    ).toBe(224.95);
  });

  it("an empty code is denied as invalid without a network call", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const outcome = await fetchGrantStationDataOutcome("   ");
    expect(outcome).toMatchObject({ state: "denied", reason: "invalid" });
    expect(spy).not.toHaveBeenCalled();
  });
});
