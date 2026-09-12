import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAccessCode } from "@/react-app/lib/station-access-code-service";

// Regression: creating an edit/full access code must NOT fail on a live DB
// that predates migration 028 (no `access_mode` column). The service must
// retry with the legacy row shape for EVERY mode (not just read), and the
// mode still round-trips through the app_kv mirror.
const insertMock = vi.fn();
const selectMock = vi.fn();
const storageGet = vi.fn();
const storageSet = vi.fn();

vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(() => ({
        data: { session: { user: { id: "owner-1" } } },
      })),
    },
    from: vi.fn(() => ({
      insert: insertMock,
      select: selectMock,
    })),
  })),
  supabase: {},
}));

vi.mock("@/react-app/lib/cloud-storage-service", () => ({
  cloudStorageService: {
    get: (...args: unknown[]) => storageGet(...args),
    set: (...args: unknown[]) => storageSet(...args),
    getCached: () => null,
  },
}));

// Build a thenable select(...).eq(...).maybeSingle() chain.
const along = (obj: Record<string, unknown>) => ({
  ...obj,
  eq: () => along(obj),
  maybeSingle: () => ({ data: null, error: null }),
});

beforeEach(() => {
  insertMock.mockReset();
  selectMock.mockReset();
  selectMock.mockImplementation(() => along({}));
  storageGet.mockReset();
  storageSet.mockReset();
  storageGet.mockResolvedValue([]);
  storageSet.mockResolvedValue(undefined);
});

// supabase-js resolves inserts with {error?, data?} — never throws.
const schemaError = (code: string, message: string) => ({
  error: { code, message },
});
const okInsert = () => ({ error: null, data: [{ id: "x" }] });

describe("createAccessCode legacy-schema fallback", () => {
  it("retries with the legacy row shape when access_mode column is missing (edit mode)", async () => {
    // First insert fails with 42703 (unknown column access_mode).
    insertMock.mockResolvedValueOnce(
      schemaError("42703", 'column "access_mode" does not exist'),
    );
    // Legacy retry succeeds.
    insertMock.mockResolvedValueOnce(okInsert());

    const code = await createAccessCode(
      {
        username: "qa_editor",
        password: "Secret123!",
        memberName: "QA Editor",
        memberRole: "Staff",
        allowedTabs: ["dashboard", "pos"],
        readOnly: false,
        accessMode: "edit",
      },
      "station-1",
    );

    expect(code.accessMode).toBe("edit");
    expect(insertMock).toHaveBeenCalledTimes(2);
    // The legacy retry row must NOT contain access_mode.
    const legacyRow = insertMock.mock.calls[1][0];
    expect(legacyRow).not.toHaveProperty("access_mode");
    expect(legacyRow.read_only).toBe(false);
    // The app_kv mirror carries the mode so it works without the DB column.
    const mirrored = storageSet.mock.calls[0][1] as Array<{
      accessMode: string;
    }>;
    expect(mirrored[0].accessMode).toBe("edit");
  });

  it("retries with the legacy row shape for full mode too", async () => {
    insertMock.mockResolvedValueOnce(
      schemaError("42703", 'column "access_mode" does not exist'),
    );
    insertMock.mockResolvedValueOnce(okInsert());

    const code = await createAccessCode(
      {
        username: "qa_full",
        password: "Secret123!",
        memberName: "QA Full",
        memberRole: "Manager",
        allowedTabs: [],
        readOnly: false,
        accessMode: "full",
      },
      "station-1",
    );

    expect(code.accessMode).toBe("full");
    expect(insertMock).toHaveBeenCalledTimes(2);
    const legacyRow = insertMock.mock.calls[1][0];
    expect(legacyRow).not.toHaveProperty("access_mode");
    expect(legacyRow.read_only).toBe(false);
  });

  it("does NOT swallow a genuine non-schema error", async () => {
    insertMock.mockResolvedValueOnce(
      schemaError(
        "23505",
        'duplicate key value violates unique constraint "station_access_codes_username_key"',
      ),
    );

    await expect(
      createAccessCode(
        {
          username: "dup",
          password: "Secret123!",
          memberName: "Dup",
          memberRole: "Staff",
          allowedTabs: [],
          readOnly: true,
          accessMode: "read",
        },
        "station-1",
      ),
    ).rejects.toThrow(/already exists/i);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
