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

  it("DeliveryTracker validates the legacy scalar", () => {
    const src = read("src/react-app/components/DeliveryTracker.tsx");
    expect(src).toMatch(/isPlausibleStationPrice\(/);
  });

  it("PointOfSale refuses to sell a fuel with no configured price", () => {
    const src = read("src/react-app/components/PointOfSale.tsx");
    expect(src).toMatch(/No price configured for/);
  });

  it("AIChatbot validates the legacy scalar", () => {
    const src = read("src/react-app/components/AIChatbot.tsx");
    expect(src).toMatch(/isPlausibleStationPrice\(/);
  });
});

describe("sanitizeFuelPricesByType removes foreign-market values", () => {
  it("drops a Kenya EPRA figure from a US station and keeps real USD prices", async () => {
    const { sanitizeFuelPricesByType } =
      await import("@/react-app/context/FuelContext");
    const healed = sanitizeFuelPricesByType(
      { petrol: 1.42, diesel: 217.86 },
      "US",
    );
    expect(healed.petrol).toBe(1.42);
    expect(healed.diesel).toBeUndefined();
  });

  it("keeps in-market values untouched", async () => {
    const { sanitizeFuelPricesByType } =
      await import("@/react-app/context/FuelContext");
    const kept = sanitizeFuelPricesByType({ petrol: 1.42, diesel: 1.51 }, "US");
    expect(kept).toEqual({ petrol: 1.42, diesel: 1.51 });
  });

  it("keeps Kenya prices for a Kenya station", async () => {
    const { sanitizeFuelPricesByType } =
      await import("@/react-app/context/FuelContext");
    const kept = sanitizeFuelPricesByType(
      { petrol: 214.03, diesel: 217.86 },
      "KE",
    );
    expect(kept.petrol).toBe(214.03);
    expect(kept.diesel).toBe(217.86);
  });

  it("passes prices through when the country is unknown", async () => {
    const { sanitizeFuelPricesByType } =
      await import("@/react-app/context/FuelContext");
    const kept = sanitizeFuelPricesByType({ petrol: 1.42 }, "");
    expect(kept).toEqual({ petrol: 1.42 });
  });
});

describe("LOAD_FROM_STORAGE gates the legacy scalars by country", () => {
  it("treats a foreign scalar as absent rather than keeping it", () => {
    const src = read("src/react-app/context/FuelContext.tsx");
    // The scalar path must consult the country, not just a zero-check.
    expect(src).toMatch(/const sanitizeCountry/);
    expect(src).toMatch(
      /pickPrice\(\s*state\.dieselPrice,\s*incoming\.dieselPrice,\s*"Diesel",?\s*\)/,
    );
    expect(src).toMatch(
      /pickPrice\(\s*state\.pmsPrice,\s*incoming\.pmsPrice,\s*"Super Petrol",?\s*\)/,
    );
  });

  it("gates fuel_types_config prices before mirroring them into state", () => {
    const src = read("src/react-app/context/FuelContext.tsx");
    // A stored config price can itself be a foreign leftover and is marked
    // authoritative (source:"scheduled"), so the mirror must validate it.
    const applyBlock = src.slice(
      src.indexOf("const applyFuelTypes"),
      src.indexOf("const applyFuelTypes") + 2600,
    );
    expect(applyBlock).toMatch(/plausible\(/);
    expect(applyBlock).toMatch(/isPlausibleStationPrice\(/);
    expect(applyBlock).toMatch(/plausible\(petrol\.price, "Super Petrol"\)/);
    expect(applyBlock).toMatch(/plausible\(diesel\.price, "Diesel"\)/);
    expect(applyBlock).toMatch(/plausible\(ft\.price, ft\.name\)/);
  });
});

describe("the market signal is actually available when a blob is loaded", () => {
  const src = () => read("src/react-app/context/FuelContext.tsx");

  it("publishes the station-resolved country for the module-level reducer", () => {
    // Regression: the guards silently no-op'd because every signal they read
    // was empty on a cold load — `companyData.country` unset,
    // `companyData.currency` a stale "KSh", `currentStationId` the legacy
    // "default_station" sentinel, and no station row in the DB at all. The
    // reducer is module-level and cannot call hooks, so FuelProvider has to
    // publish the signal it CAN resolve.
    const s = src();
    expect(s).toMatch(/activeStationCountry\s*=/);
    expect(s).toMatch(/resolveStationCountry\(/);
  });

  it("never resolves the market from the browser", () => {
    // The bug that let a Kenya diesel figure (217.86) render as "$217.86/L" on
    // a US station: the guard used `getDetectedCountryCode()`, which falls back
    // to the BROWSER's location, so a Kenya-based user's US station resolved to
    // "KE" and the foreign price validated. FuelContext feeds WRITE paths, so
    // it must never guess from the device — the device-derived fallback lives
    // only in the display-only resolver in station-market.ts.
    const s = src();
    const countryBlock = s.slice(
      s.indexOf("The authoritative market for the active station"),
      s.indexOf("activeStationCountry = resolveStationCountry"),
    );
    expect(countryBlock).not.toMatch(/getDetectedCountryCode\(\)/);
    expect(countryBlock).not.toMatch(/navigator\?\.language/);
  });

  it("keeps the device fallback for display-only decisions", () => {
    // `resolveMarketCountry` may fall back so the guard stays armed before the
    // station record is readable; that fallback must not be used to write.
    const market = read("src/react-app/lib/station-market.ts");
    expect(market).toMatch(/export function resolveMarketCountry/);
    expect(market).toMatch(/navigator\?\.language/);
    expect(market).toMatch(/getDetectedCountryCode/);
  });
});
