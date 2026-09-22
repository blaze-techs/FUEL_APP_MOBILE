import { describe, it, expect } from "vitest";
import { isPlausibleStationPrice } from "@/react-app/config/pricing";

describe("isPlausibleStationPrice", () => {
  it("rejects a Kenya EPRA diesel figure held by a US station", () => {
    // The regression this guards: a station switched from Kenya to the US kept
    // 217.86 KES/L in fuel_types_config and rendered it as "$217.86/L".
    expect(isPlausibleStationPrice(217.86, "US", "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(214.03, "US", "Super Petrol")).toBe(false);
  });

  it("rejects a US price held by a Kenya station", () => {
    // The inverse leak: 1.51 USD/L rendered as "KSh 1.51/L".
    expect(isPlausibleStationPrice(1.51, "KE", "Diesel")).toBe(false);
  });

  it("accepts a station's own plausible price", () => {
    expect(isPlausibleStationPrice(1.51, "US", "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(1.42, "US", "Super Petrol")).toBe(true);
    expect(isPlausibleStationPrice(217.86, "KE", "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(214.03, "KE", "Super Petrol")).toBe(true);
  });

  it("tolerates legitimate deviation from the reference price", () => {
    // A promotion or a remote station may sit well below/above the reference.
    expect(isPlausibleStationPrice(0.8, "US", "Diesel")).toBe(true); // ~53% of 1.51
    expect(isPlausibleStationPrice(3.0, "US", "Diesel")).toBe(true); // ~199%
    // But not an order-of-magnitude error.
    expect(isPlausibleStationPrice(60, "US", "Diesel")).toBe(false);
  });

  it("treats a non-positive or non-finite price as unusable", () => {
    expect(isPlausibleStationPrice(0, "US", "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(-5, "US", "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(NaN, "US", "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(Infinity, "US", "Diesel")).toBe(false);
  });

  it("does not reject when the country has no reference to judge against", () => {
    // No reference table entry -> cannot call it implausible, so keep the value.
    expect(isPlausibleStationPrice(1.5, "ZZ", "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(1.5, "", "Diesel")).toBe(true);
  });

  it("resolves the reference in the station's own currency", () => {
    // Same numeric value, different country -> different verdict. This is the
    // property that makes the check work without an exchange-rate guess.
    expect(isPlausibleStationPrice(1.5, "US", "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(1.5, "KE", "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(217.86, "KE", "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(217.86, "US", "Diesel")).toBe(false);
  });
});
