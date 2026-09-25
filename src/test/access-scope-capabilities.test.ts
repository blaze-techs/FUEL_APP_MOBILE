import { describe, expect, it } from "vitest";
import {
  ACCESS_CAPABILITIES,
  ACCESS_MODE_CAPABILITIES,
  canAccess,
  normalizeAccessCapabilities,
  resolveCapabilities,
  type AccessCapability,
  type AccessMode,
} from "@/react-app/lib/access-mode";
import { resolveVisibleTabIds } from "@/react-app/lib/member-portal-tabs";
import type { StationAccessSession } from "@/react-app/lib/station-access-code-service";

/** A member session with everything wide open; individual tests narrow it. */
function session(overrides: Partial<StationAccessSession> = {}) {
  return {
    accessCodeId: "code_1",
    memberName: "Test Member",
    memberRole: "Manager",
    allowedTabs: [],
    readOnly: false,
    accessMode: "full" as AccessMode,
    stationId: "station_1",
    stationOwnerId: "owner_1",
    loginTime: Date.now(),
    ...overrides,
  } as StationAccessSession;
}

describe("access capability model", () => {
  it("each level is a strict superset of the one below it", () => {
    const read = new Set(ACCESS_MODE_CAPABILITIES.read);
    const edit = new Set(ACCESS_MODE_CAPABILITIES.edit);
    const full = new Set(ACCESS_MODE_CAPABILITIES.full);

    for (const c of read) expect(edit.has(c)).toBe(true);
    for (const c of edit) expect(full.has(c)).toBe(true);
    expect(full.size).toBeGreaterThan(edit.size);
    expect(edit.size).toBeGreaterThan(read.size);
  });

  it("read cannot change anything, edit cannot administer, full can", () => {
    expect(canAccess("read", null, "edit")).toBe(false);
    expect(canAccess("read", null, "settings")).toBe(false);
    expect(canAccess("edit", null, "edit")).toBe(true);
    expect(canAccess("edit", null, "settings")).toBe(false);
    expect(canAccess("edit", null, "manage")).toBe(false);
    expect(canAccess("full", null, "settings")).toBe(true);
    expect(canAccess("full", null, "manage")).toBe(true);
  });

  it("an empty scope means 'whatever the level allows'", () => {
    for (const mode of ["read", "edit", "full"] as AccessMode[]) {
      expect(resolveCapabilities(mode, null)).toEqual(
        ACCESS_MODE_CAPABILITIES[mode],
      );
      expect(resolveCapabilities(mode, { tabs: [], capabilities: [] })).toEqual(
        ACCESS_MODE_CAPABILITIES[mode],
      );
    }
  });

  it("a scope can only REMOVE capabilities, never add them", () => {
    // A hostile scope asking for admin on an edit credential gets nothing
    // beyond what edit already allows.
    const granted = resolveCapabilities("edit", {
      tabs: [],
      capabilities: ["settings", "manage", "edit"],
    });
    expect(granted).toContain("edit");
    expect(granted).not.toContain("settings");
    expect(granted).not.toContain("manage");
    expect(
      granted.every((c) => ACCESS_MODE_CAPABILITIES.edit.includes(c)),
    ).toBe(true);
  });

  it("normalizes junk out of persisted scope values", () => {
    expect(
      normalizeAccessCapabilities(["edit", "NONSENSE", null, "EXPORT", 7]),
    ).toEqual(["export", "edit"]);
    expect(normalizeAccessCapabilities("edit")).toEqual([]);
    expect(normalizeAccessCapabilities(undefined)).toEqual([]);
  });

  it("every capability has a level that grants it", () => {
    const union = new Set<AccessCapability>();
    for (const caps of Object.values(ACCESS_MODE_CAPABILITIES)) {
      for (const c of caps) union.add(c);
    }
    expect([...union].sort()).toEqual([...ACCESS_CAPABILITIES].sort());
  });
});

describe("MemberPortal tab access by mode", () => {
  // Explicit tab list so the assertions test the CAPABILITY gate rather than
  // whichever tabs a role happens to default to.
  const adminTabs = [
    "dashboard",
    "sales",
    "settings",
    "team",
    "payroll",
    "audit",
    "automation",
  ];

  it("Normal reaches the admin tabs that Edit only does not", () => {
    const full = resolveVisibleTabIds(
      session({ accessMode: "full", allowedTabs: adminTabs }),
    );
    const edit = resolveVisibleTabIds(
      session({ accessMode: "edit", allowedTabs: adminTabs }),
    );

    expect(full).toContain("settings");
    expect(full).toContain("team");
    expect(full).toContain("payroll");
    expect(full).toContain("audit");

    // The observable difference the requirement is about.
    expect(edit).not.toContain("settings");
    expect(edit).not.toContain("team");
    expect(edit).not.toContain("payroll");
    expect(edit).not.toContain("audit");
    expect(edit).toContain("sales");
  });

  it("Read only is a strict subset of Edit only", () => {
    const read = resolveVisibleTabIds(
      session({ accessMode: "read", allowedTabs: adminTabs }),
    );
    const edit = resolveVisibleTabIds(
      session({ accessMode: "edit", allowedTabs: adminTabs }),
    );
    for (const tab of read) expect(edit).toContain(tab);
    expect(read).toContain("dashboard");
    expect(read).not.toContain("settings");
  });

  it("scopeTabs narrows an otherwise-wide level", () => {
    const tabs = resolveVisibleTabIds(
      session({ accessMode: "full", scopeTabs: ["dashboard", "sales"] }),
    );
    expect(tabs).toEqual(["dashboard", "sales"]);
  });

  it("scopeCapabilities blocks an admin tab even at Normal", () => {
    const tabs = resolveVisibleTabIds(
      session({
        accessMode: "full",
        allowedTabs: adminTabs,
        scopeCapabilities: ["view", "export", "suggest", "edit"],
      }),
    );
    expect(tabs).not.toContain("settings");
    expect(tabs).not.toContain("team");
    expect(tabs).toContain("sales");
  });

  it("scope cannot widen past the level", () => {
    // Read whose scope names admin tabs still cannot see them.
    const tabs = resolveVisibleTabIds(
      session({
        accessMode: "read",
        allowedTabs: adminTabs,
        scopeTabs: adminTabs,
        scopeCapabilities: ["settings", "manage"],
      }),
    );
    expect(tabs).not.toContain("settings");
    expect(tabs).not.toContain("team");
  });

  it("an explicit allowedTabs list is honoured, and scope must not add to it", () => {
    const tabs = resolveVisibleTabIds(
      session({
        accessMode: "full",
        allowedTabs: ["sales", "inventory"],
        scopeTabs: ["sales", "inventory", "settings"],
      }),
    );
    // dashboard is always kept; settings must NOT sneak in via scopeTabs.
    expect(tabs).toEqual(["dashboard", "sales", "inventory"]);
  });

  it("legacy sessions with no scope keep their previous behaviour", () => {
    // No scope fields at all must resolve exactly like an empty scope: the
    // level ceiling applies and removes nothing the level already allows.
    const legacy = resolveVisibleTabIds({
      accessCodeId: "c",
      memberName: "Old",
      memberRole: "Manager",
      allowedTabs: ["sales", "team", "settings"],
      readOnly: false,
      accessMode: "full",
      stationId: "s",
      stationOwnerId: "o",
      loginTime: 0,
    } as StationAccessSession);
    expect(legacy).toContain("sales");
    expect(legacy).toContain("team");
    expect(legacy).toContain("settings");
  });

  it("dashboard is always reachable even when nothing allows it", () => {
    const tabs = resolveVisibleTabIds(
      session({ accessMode: "read", scopeTabs: ["sales"] }),
    );
    expect(tabs).toContain("dashboard");
  });

  it("role defaults apply when the owner pinned no tab list", () => {
    const staff = resolveVisibleTabIds(
      session({ memberRole: "Staff", accessMode: "full" }),
    );
    expect(staff).toContain("sales");
    expect(staff).not.toContain("payroll");
    expect(staff).not.toContain("settings");

    const manager = resolveVisibleTabIds(
      session({ memberRole: "Manager", accessMode: "full" }),
    );
    expect(manager).toContain("payroll");
    expect(manager).toContain("team");
  });
});
