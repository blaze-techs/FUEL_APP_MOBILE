import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateGrantCode,
  buildGrantLink,
  redeemCompanyGrant,
  GRANT_TAB_PRESETS,
  createCompanyGrant,
  listCompanyGrants,
  revokeCompanyGrant,
  deleteCompanyGrant,
  grantModeLabel,
} from "@/react-app/lib/company-grant-service";

// The service writes grants through cloudStorageService (app_kv) and redeems
// through GET /api/company-grant-redeem (serverless endpoint) with an RPC
// fallback. Stub both layers so tests exercise every branch without a network.
const rpcMock = vi.fn();
const storageGet = vi.fn();
const storageSet = vi.fn();
const storageDel = vi.fn();

vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(() => ({
        data: { session: { user: { id: "owner-1" } } },
      })),
    },
    rpc: rpcMock,
    from: vi.fn(),
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
    storageGet.mockReset();
    storageSet.mockReset();
    storageDel.mockReset();
    // Default: the serverless endpoint is unreachable → RPC fallback path.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null for empty/whitespace codes", async () => {
    expect(await redeemCompanyGrant("")).toBeNull();
    expect(await redeemCompanyGrant("   ")).toBeNull();
  });

  it("returns null when the RPC reports no row (invalid/revoked/expired)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await redeemCompanyGrant("nope")).toBeNull();
  });

  it("returns null when the RPC errors (e.g. RPC not deployed yet)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "PGRST202" } });
    expect(await redeemCompanyGrant("abc")).toBeNull();
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

  it("redeems through the serverless endpoint FIRST (no migration needed)", async () => {
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
    // The RPC must NOT be called when the endpoint answers.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("treats a 4xx endpoint answer as definitive (no RPC fallback)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "This grant link is not valid." }),
    } as Response);
    expect(await redeemCompanyGrant("ABCDEFGHJKLMNPQRSTU")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("company grant CRUD (app_kv storage)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();
    storageDel.mockReset();
    storageGet.mockResolvedValue(null);
    storageSet.mockResolvedValue(undefined);
    storageDel.mockResolvedValue(undefined);
  });

  it("creates a grant, persisting it + a code-keyed row to app_kv", async () => {
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
    expect(grant.maxUses).toBe(5);
    // list key + code-keyed row both written
    expect(storageSet).toHaveBeenCalledWith(
      "company_grants",
      expect.any(Array),
      "station-1",
    );
    expect(storageSet).toHaveBeenCalledWith(
      `company_grant_${grant.code}`,
      expect.objectContaining({ code: grant.code }),
      "station-1",
    );
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

  it("reads access_mode from stored rows during listing (snake + camel)", async () => {
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

  it("lists grants from app_kv, filtered to the owner + station", async () => {
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

  it("revokes a grant and drops its code-keyed row", async () => {
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
    await revokeCompanyGrant("grant_1", "station-1");
    const saved = storageSet.mock.calls.find((c) => c[0] === "company_grants");
    expect(saved).toBeDefined();
    const arr = saved![1] as Array<{ revoked: boolean; enabled: boolean }>;
    expect(arr[0].revoked).toBe(true);
    expect(arr[0].enabled).toBe(false);
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

  it("deletes a grant entirely (list + code-keyed row)", async () => {
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
    await deleteCompanyGrant("grant_1", "station-1");
    const saved = storageSet.mock.calls.find((c) => c[0] === "company_grants");
    expect(saved).toBeDefined();
    expect(saved![1]).toEqual([]);
    expect(storageDel).toHaveBeenCalledWith(
      "company_grant_AAAAAAAAAAAAAAAAAA",
      "station-1",
    );
  });
});
