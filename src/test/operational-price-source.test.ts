/**
 * Regression guard: a station's operational price must never originate from a
 * reference table, and a value from another market must never be written into
 * the station's config as if the owner had set it.
 *
 * History: FuelContext seeded `pmsPrice`/`agoPrice`/`petrolPrice`/
 * `dieselPrice` from `getCountryPrice(detectedCountry)` (falling back to
 * `KENYA_BASE_PRICES`). The universal price-propagation effect then mirrored
 * any positive scalar into `fuel_types_config` with `source: "user"`, so the
 * seeded reference value was persisted as a real price. On a station that was
 * later moved to another country, the old value stayed behind and rendered as
 * e.g. "Diesel $217.86/L" — a Kenya EPRA figure shown in USD.
 *
 * These tests pin the fix at the source, because the failure is silent: it
 * produces a plausible-looking number rather than an error.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("operational prices are never seeded from reference data", () => {
  const fuelContext = read("src/react-app/context/FuelContext.tsx");

  it("does not derive a default pump price from the detected country", () => {
    // The seeding constants are the mechanism that turned reference data into
    // operational truth. They must not come back.
    expect(fuelContext).not.toMatch(/DEFAULT_PMS_PRICE\s*=/);
    expect(fuelContext).not.toMatch(/DEFAULTAGO_PRICE\s*=/);
    expect(fuelContext).not.toMatch(/getCountryPrice\(\s*_detectedCC/);
  });

  it("initialises the legacy price scalars to unknown, not to a reference", () => {
    // All four legacy scalars must start at 0 (unknown) so a station with no
    // configured price reads "not configured" rather than a regulator figure.
    for (const field of [
      "pmsPrice",
      "agoPrice",
      "petrolPrice",
      "dieselPrice",
    ]) {
      // Scope the assertion to the initialState block: `pmsPrice: 0,` also
      // appears in unrelated reducer branches, so a file-wide regex would pass
      // even if the initial state were seeded.
      const start = fuelContext.indexOf("const initialState: FuelState = {");
      expect(start).toBeGreaterThan(-1);
      const block = fuelContext.slice(
        start,
        fuelContext.indexOf("\n};", start),
      );
      expect(block).toMatch(new RegExp(`${field}:\\s*0,`));
    }
  });

  it("validates a legacy scalar against the station country before propagating it", () => {
    // The propagation effect writes into fuel_types_config as source:"user".
    // It must gate on plausibility so a restored foreign-market value cannot
    // become permanent.
    expect(fuelContext).toMatch(/isPlausibleStationPrice\(/);
    expect(fuelContext).toMatch(/propCountry/);
  });

  it("does not fall back to a Kenya baseline price anywhere in FuelContext", () => {
    expect(fuelContext).not.toMatch(/KENYA_BASE_PRICES/);
  });
});

describe("legacy price consumers validate before falling back", () => {
  it("SalesTracking validates the legacy scalar", () => {
    const src = read("src/react-app/components/SalesTracking.tsx");
    expect(src).toMatch(/isPlausibleStationPrice\(/);
  });

  it("AIChatbot validates the legacy scalar", () => {
    const src = read("src/react-app/components/AIChatbot.tsx");
    expect(src).toMatch(/isPlausibleStationPrice\(/);
  });
});
