import { describe, it, expect } from "vitest";
import {
  normalizeAccessMode,
  accessModeLabel,
  resolveMemberSessionMode,
} from "@/react-app/lib/station-access-code-service";

describe("access-code access modes", () => {
  it("normalizes mode values (read / edit / full, case + junk tolerant)", () => {
    expect(normalizeAccessMode("read")).toBe("read");
    expect(normalizeAccessMode("edit")).toBe("edit");
    expect(normalizeAccessMode("full")).toBe("full");
    expect(normalizeAccessMode("READ")).toBe("read");
    expect(normalizeAccessMode("Edit")).toBe("edit");
    expect(normalizeAccessMode(undefined)).toBe("read");
    expect(normalizeAccessMode(null)).toBe("read");
    expect(normalizeAccessMode("junk")).toBe("read");
    expect(normalizeAccessMode("")).toBe("read");
  });

  it("labels modes for UI badges", () => {
    expect(accessModeLabel("read")).toContain("Read");
    expect(accessModeLabel("edit")).toContain("Edit");
    expect(accessModeLabel("full")).toContain("Normal");
    expect(accessModeLabel(undefined)).toContain("Read");
    expect(accessModeLabel(null)).toContain("Read");
  });

  it("resolves the TRUE mode from a post-migration RPC result", () => {
    expect(resolveMemberSessionMode({ accessMode: "edit" })).toBe("edit");
    expect(resolveMemberSessionMode({ accessMode: "full" })).toBe("full");
    expect(resolveMemberSessionMode({ accessMode: "read" })).toBe("read");
  });

  it("NEVER escalates when the live RPC cannot report the mode (pre-028)", () => {
    // read_only=false (edit/full intent) but no access_mode column yet →
    // must resolve to READ, not full (privilege-escalation guard).
    expect(resolveMemberSessionMode({ readOnly: false })).toBe("read");
    expect(resolveMemberSessionMode({ readOnly: true })).toBe("read");
    expect(resolveMemberSessionMode({})).toBe("read");
    expect(resolveMemberSessionMode(null)).toBe("read");
    expect(resolveMemberSessionMode(undefined)).toBe("read");
  });
});
