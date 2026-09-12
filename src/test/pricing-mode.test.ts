import { describe, it, expect } from "vitest";
import {
  canAutoSyncPrice,
  defaultPricingMode,
} from "@/react-app/lib/pricing-mode";

describe("defaultPricingMode (manual by default)", () => {
  it("is manual for every station", () => {
    expect(defaultPricingMode()).toBe("manual");
  });
});

/**
 * The core pricing-stability rule: the regulator/EPRA auto-sync may ONLY
 * overwrite a fuel price that is still "auto"-sourced (or an unmarked legacy
 * entry), and only when the station's pricing mode is "auto". Prices set by
 * the user OR applied by the Price Scheduler are protected — this is what
 * stops a scheduled price from being reverted to the national price.
 */
describe("canAutoSyncPrice (regulator may not overwrite user/scheduled)", () => {
  it("lets the regulator sync unmarked legacy entries in auto mode", () => {
    expect(canAutoSyncPrice(undefined, "auto")).toBe(true);
  });

  it("lets the regulator sync entries that were auto-set in auto mode", () => {
    expect(canAutoSyncPrice("auto", "auto")).toBe(true);
  });

  it("NEVER overwrites a user-set price", () => {
    expect(canAutoSyncPrice("user", "auto")).toBe(false);
  });

  it("NEVER overwrites a price applied by the Price Scheduler", () => {
    expect(canAutoSyncPrice("scheduled", "auto")).toBe(false);
  });

  it("NEVER lets the regulator write at all in manual mode", () => {
    expect(canAutoSyncPrice(undefined, "manual")).toBe(false);
    expect(canAutoSyncPrice("auto", "manual")).toBe(false);
    expect(canAutoSyncPrice("user", "manual")).toBe(false);
    expect(canAutoSyncPrice("scheduled", "manual")).toBe(false);
  });

  it("is strict about the source string", () => {
    // Only EXACTLY "auto" (or undefined) is eligible. A trailing-space
    // "auto " is a malformed/non-recognized source → treated as explicitly
    // set and protected (defensive against bad write paths).
    expect(canAutoSyncPrice("auto ", "auto")).toBe(false);
    expect(canAutoSyncPrice("AUTO", "auto")).toBe(false);
    // An explicit arbitrary string is NOT auto → protected.
    // (No arbitrary sources exist; this guards against future typos.)
    expect(canAutoSyncPrice("regulator", "auto")).toBe(false);
  });
});
