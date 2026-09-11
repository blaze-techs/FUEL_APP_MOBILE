import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveLandingTab,
  validateTabId,
  persistLastActiveTab,
  LAST_TAB_STORAGE_KEY,
  FALLBACK_TAB,
} from "@/react-app/lib/landing-tab";
import type { TabConfiguration } from "@/react-app/context/FuelContext";

const cfg = (id: string, order: number, visible = true): TabConfiguration => ({
  id,
  label: id,
  originalLabel: id,
  description: "",
  order,
  visible,
});

const REGISTRY: TabConfiguration[] = [
  cfg("dashboard", 0),
  cfg("pos", 1),
  cfg("sales", 2),
  cfg("inventory", 4),
  cfg("settings", 31),
  cfg("analytics", 12, false), // hidden but registered
];

describe("landing-tab resolver", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("validateTabId recognizes registered tabs (visible or hidden)", () => {
    expect(validateTabId("pos", REGISTRY)).toBe(true);
    expect(validateTabId("analytics", REGISTRY)).toBe(true); // hidden tab still valid
    expect(validateTabId("settings", REGISTRY)).toBe(true);
  });

  it("validateTabId rejects unknown / empty ids", () => {
    expect(validateTabId("no-such-tab", REGISTRY)).toBe(false);
    expect(validateTabId("", REGISTRY)).toBe(false);
    expect(validateTabId(null, REGISTRY)).toBe(false);
    expect(validateTabId(undefined, REGISTRY)).toBe(false);
  });

  it("validateTabId trusts only the fallback before the registry loads", () => {
    expect(validateTabId("dashboard", null)).toBe(true);
    expect(validateTabId("pos", null)).toBe(false);
    expect(validateTabId(undefined, undefined)).toBe(false);
  });

  it("uses the saved default tab when it is registered", () => {
    expect(
      resolveLandingTab(
        { defaultTab: "pos", rememberLastTab: false },
        REGISTRY,
      ),
    ).toBe("pos");
  });

  it("falls back to dashboard when the saved tab was removed/never registered", () => {
    expect(
      resolveLandingTab(
        { defaultTab: "ghost-tab", rememberLastTab: false },
        REGISTRY,
      ),
    ).toBe(FALLBACK_TAB);
  });

  it("falls back to dashboard before the registry loads (non-dashboard saved)", () => {
    expect(
      resolveLandingTab({ defaultTab: "pos", rememberLastTab: false }, null),
    ).toBe(FALLBACK_TAB);
  });

  it("rememberLastTab reopens the valid stored last tab", () => {
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, "inventory");
    expect(
      resolveLandingTab({ defaultTab: "pos", rememberLastTab: true }, REGISTRY),
    ).toBe("inventory");
  });

  it("rememberLastTab falls back to defaultTab when stored tab is invalid", () => {
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, "ghost-tab");
    expect(
      resolveLandingTab({ defaultTab: "pos", rememberLastTab: true }, REGISTRY),
    ).toBe("pos");
  });

  it("explicit lastTab arg beats localStorage read", () => {
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, "inventory");
    expect(
      resolveLandingTab(
        { defaultTab: "pos", rememberLastTab: true },
        REGISTRY,
        "sales",
      ),
    ).toBe("sales");
  });

  it("rememberLastTab=false ignores stored last tab", () => {
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, "inventory");
    expect(
      resolveLandingTab(
        { defaultTab: "settings", rememberLastTab: false },
        REGISTRY,
      ),
    ).toBe("settings");
  });

  it("persistLastActiveTab writes the storage key", () => {
    persistLastActiveTab("pos");
    expect(window.localStorage.getItem(LAST_TAB_STORAGE_KEY)).toBe("pos");
    persistLastActiveTab("dashboard");
    expect(window.localStorage.getItem(LAST_TAB_STORAGE_KEY)).toBe("dashboard");
  });
});
