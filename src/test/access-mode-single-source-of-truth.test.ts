import { describe, it, expect } from "vitest";
import {
  ACCESS_MODES,
  accessModeLabel,
  modeToReadOnly,
  normalizeAccessMode,
  resolveAccessMode,
  resolveSessionAccessMode,
} from "@/react-app/lib/access-mode";

/**
 * The Company-QR card and the member portal used to disagree ("Normal" vs
 * "Read only") because each read a different column. These tests pin the
 * single-source-of-truth rule: access_mode decides, read_only is derived.
 */
describe("access-mode single source of truth", () => {
  it("exposes exactly the three canonical modes", () => {
    expect(ACCESS_MODES).toEqual(["read", "edit", "full"]);
  });

  it("derives read_only from the mode in ONE direction", () => {
    expect(modeToReadOnly("read")).toBe(true);
    expect(modeToReadOnly("edit")).toBe(false);
    expect(modeToReadOnly("full")).toBe(false);
  });

  it("normalizes unknown/malformed values down to the safest mode", () => {
    for (const bad of [undefined, null, "", "junk", "admin", "FULL ACCESS"]) {
      expect(normalizeAccessMode(bad)).toBe("read");
    }
    expect(normalizeAccessMode("FULL")).toBe("full");
    expect(normalizeAccessMode(" Edit ")).toBe("edit");
  });

  it("gives every mode exactly one canonical label", () => {
    expect(accessModeLabel("read")).toBe("Read only");
    expect(accessModeLabel("edit")).toBe("Edit only");
    expect(accessModeLabel("full")).toBe("Normal");
    // The label must be stable no matter which mode alias produced it.
    expect(accessModeLabel(normalizeAccessMode("full"))).toBe(
      accessModeLabel("full"),
    );
  });

  describe("canonical access_mode always wins over the legacy boolean", () => {
    it("never demotes a canonical full/edit via a stale read_only", () => {
      expect(resolveAccessMode({ access_mode: "full", read_only: true })).toBe(
        "full",
      );
      expect(resolveAccessMode({ access_mode: "edit", read_only: true })).toBe(
        "edit",
      );
    });

    it("never promotes a canonical read via a stale read_only=false", () => {
      expect(resolveAccessMode({ access_mode: "read", read_only: false })).toBe(
        "read",
      );
    });

    it("honours camelCase payloads from the server", () => {
      expect(resolveAccessMode({ accessMode: "full", readOnly: true })).toBe(
        "full",
      );
      expect(resolveAccessMode({ accessMode: "edit", readOnly: true })).toBe(
        "edit",
      );
    });

    it("falls back to the legacy boolean only when access_mode is absent", () => {
      expect(resolveAccessMode({ read_only: false })).toBe("full");
      expect(resolveAccessMode({ readOnly: false })).toBe("full");
      expect(resolveAccessMode({ read_only: true })).toBe("read");
      expect(resolveAccessMode({})).toBe("read");
      expect(resolveAccessMode(null)).toBe("read");
    });
  });

  describe("member session resolution never escalates", () => {
    it("resolves the true mode when the RPC reports it", () => {
      expect(resolveSessionAccessMode({ accessMode: "full" })).toBe("full");
      expect(resolveSessionAccessMode({ accessMode: "edit" })).toBe("edit");
    });

    it("defaults to read when access_mode is missing (pre-028)", () => {
      expect(resolveSessionAccessMode({ readOnly: false })).toBe("read");
      expect(resolveSessionAccessMode({ readOnly: true })).toBe("read");
      expect(resolveSessionAccessMode({})).toBe("read");
      expect(resolveSessionAccessMode(undefined)).toBe("read");
    });
  });
});
