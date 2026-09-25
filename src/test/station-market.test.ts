import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveStationCountry,
  resolveMarketCountry,
  publishStationMarket,
} from "@/react-app/lib/station-market";
import { isPlausibleStationPrice } from "@/react-app/config/pricing";

/**
 * Regression: a user based in Kenya managing a US station had diesel 217.86
 * (the Kenya EPRA figure) rendered and persisted as "$217.86/L".
 *
 * The guard validated against `getDetectedCountryCode()`, which can fall back
 * to the BROWSER's location. So the station resolved to "KE" regardless of its
 * own record, 217.86 was judged plausible, and the foreign price passed. The
 * station's own record must win.
 */
const US_STATION = {
  id: "52c24393-55e1-4ff4-9087-f06009f69da3",
  name: "Founder Admin Station",
  country: "US",
  currency: "USD",
};
const KE_STATION = {
  id: "5bd26c8b-914b-46bc-88e0-486c61014d7b",
  name: "THE PUBLICAN ENERGY",
  country: "KE",
  currency: "KES",
};

function seedStorage(locale: string) {
  localStorage.clear();
  localStorage.setItem("fuelpro_auth_identity", "u1");
  localStorage.setItem(
    "fuelpro_stations_v3_u1",
    JSON.stringify([US_STATION, KE_STATION]),
  );
  localStorage.setItem("fuelpro_current_station_v3", US_STATION.id);
  // The browser thinks it is in Kenya — the condition that broke the guard.
  vi.stubGlobal("navigator", { language: locale });
}

describe("station market resolution", () => {
  beforeEach(() => {
    seedStorage("en-KE");
  });

  it("uses the station's own country, not the browser's", () => {
    // Browser locale is en-KE, but this station is US.
    expect(resolveStationCountry(US_STATION.id)).toBe("US");
    expect(resolveMarketCountry(US_STATION.id)).toBe("US");
  });

  it("resolves each station independently", () => {
    expect(resolveMarketCountry(KE_STATION.id)).toBe("KE");
    expect(resolveMarketCountry(US_STATION.id)).toBe("US");
  });

  it("prefers the station argument over stored records", () => {
    expect(resolveStationCountry(undefined, US_STATION)).toBe("US");
    expect(resolveStationCountry(undefined, KE_STATION)).toBe("KE");
  });

  it("derives the country from currency when none is set", () => {
    localStorage.setItem(
      "fuelpro_stations_v3_u1",
      JSON.stringify([{ id: "x1", currency: "USD" }]),
    );
    expect(resolveStationCountry("x1")).toBe("US");
  });

  it("reports unknown (never a guess) for an unknown station id", () => {
    // `resolveStationCountry` is the write-path resolver, so it must not invent
    // a market — a wrong guess there would destroy a valid price.
    expect(resolveStationCountry("does-not-exist")).toBe("");
  });

  it("falls back to a detected market only for display decisions", () => {
    localStorage.clear();
    expect(resolveStationCountry("does-not-exist")).toBe("");
    // The display resolver may fall back to the device's own detection so the
    // guard stays armed before the station record is readable. Which country
    // it lands on is environment-dependent — what matters is that it yields a
    // usable 2-letter market instead of disabling the check.
    expect(resolveMarketCountry("does-not-exist")).toMatch(/^[A-Z]{2}$/);
  });

  it("does not reuse another station's published market for an explicit station id", () => {
    localStorage.clear();
    localStorage.setItem("fuelpro_auth_identity", "u1");
    // Keep only the source station in the stored cache. The target station id
    // is intentionally absent so the resolver must not reuse the source
    // station's published market.
    localStorage.setItem(
      "fuelpro_stations_v3_u1",
      JSON.stringify([KE_STATION]),
    );
    publishStationMarket("KE", KE_STATION.id);
    expect(resolveStationCountry(US_STATION.id)).toBe("");
  });

  it("trusts the market the provider published from the station record", () => {
    // The persisted station cache keys are derived from
    // `fuelpro_auth_identity`, which is not always written. Without a
    // provider-published market a storage miss fell through to the BROWSER,
    // which is how a Kenya figure reached a US station.
    localStorage.clear();
    publishStationMarket("US", US_STATION.id);
    expect(resolveStationCountry(US_STATION.id)).toBe("US");
    expect(resolveMarketCountry(US_STATION.id)).toBe("US");
    // ...and it must not be overridden by the device's own country.
    vi.stubGlobal("navigator", { language: "en-KE" });
    expect(resolveMarketCountry(US_STATION.id)).toBe("US");
  });

  it("ignores a malformed published market", () => {
    localStorage.clear();
    publishStationMarket("not-a-country");
    expect(resolveStationCountry("does-not-exist")).toBe("");
  });
});

describe("the Kenya diesel figure is rejected for a US station", () => {
  beforeEach(() => {
    seedStorage("en-KE");
  });

  it("rejects 217.86 for the US station the Kenya-based user manages", () => {
    const cc = resolveMarketCountry(US_STATION.id);
    expect(cc).toBe("US");
    expect(isPlausibleStationPrice(217.86, cc, "Diesel")).toBe(false);
    expect(isPlausibleStationPrice(220.08, cc, "Super Petrol")).toBe(false);
  });

  it("still accepts the station's genuine US prices", () => {
    const cc = resolveMarketCountry(US_STATION.id);
    expect(isPlausibleStationPrice(1.42, cc, "Super Petrol")).toBe(true);
    expect(isPlausibleStationPrice(1.51, cc, "Diesel")).toBe(true);
  });

  it("still accepts Kenya prices for the Kenya station", () => {
    const cc = resolveMarketCountry(KE_STATION.id);
    expect(cc).toBe("KE");
    expect(isPlausibleStationPrice(217.86, cc, "Diesel")).toBe(true);
    expect(isPlausibleStationPrice(1.42, cc, "Super Petrol")).toBe(false);
  });
});
