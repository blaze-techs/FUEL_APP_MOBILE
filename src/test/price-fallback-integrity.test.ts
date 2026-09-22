/**
 * Regression guard: the sync services must report an unverified price as
 * unavailable instead of substituting a value from a reference table.
 *
 * Two defects are pinned here, both silent because they produce a
 * plausible-looking number rather than an error:
 *
 * 1. `fetchGenericFuelPrices` filled a failed upstream scrape from
 *    `getRegionalPriceEstimates`, then still labelled the result with the
 *    upstream source name ("Global Petrol Prices") and today's date. An
 *    estimate table was being published as a live, sourced price.
 *
 * 2. `fetchKenyaFuelPrices` discarded a freshly scraped figure that fell
 *    outside +/-15% of the static `KENYA_BASE_PRICES` constant and replaced it
 *    with that constant, relabelling it as a published EPRA cycle. A genuine
 *    new EPRA price that moved more than the tolerance was thrown away in
 *    favour of stale reference data.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const sync = read("src/react-app/services/DataSyncService.ts");

describe("an unverified price is unavailable, not an estimate", () => {
  it("no longer declares the regional estimate table", () => {
    // Removing the table removes the mechanism. If a reference table is
    // reintroduced it needs a deliberate decision, not a silent substitution.
    expect(sync).not.toMatch(/function getRegionalPriceEstimates/);
  });

  it("generic sync returns unavailable when the scrape yields nothing", () => {
    const generic = sync.slice(
      sync.indexOf("async function fetchGenericFuelPrices"),
    );
    expect(generic).toMatch(
      /No verified live petrol\/diesel price data available/,
    );
    // The unavailable path must return before a sourced record is built.
    const unavailableAt = generic.indexOf("return null;");
    const recordAt = generic.indexOf("const data: FuelPriceData");
    expect(unavailableAt).toBeGreaterThan(-1);
    expect(unavailableAt).toBeLessThan(recordAt);
  });

  it("does not fill the generic result from an estimate table", () => {
    const generic = sync.slice(
      sync.indexOf("async function fetchGenericFuelPrices"),
      sync.indexOf("async function fetchKenyaFuelPrices"),
    );
    expect(generic).not.toMatch(/getRegionalPriceEstimates/);
  });
});

describe("a verified figure is never overwritten by the reference constant", () => {
  it("the Kenya plausibility guard reports unavailable instead of substituting", () => {
    const kenya = sync.slice(
      sync.indexOf("async function fetchKenyaFuelPrices"),
    );
    const guardAt = kenya.indexOf("const plausible =");
    expect(guardAt).toBeGreaterThan(-1);
    const guard = kenya.slice(guardAt, guardAt + 700);
    // The guard must not assign the constant back over the scraped value.
    expect(guard).not.toMatch(/petrolPrice = KENYA_BASE_PRICES\.petrol/);
    expect(guard).not.toMatch(/dieselPrice = KENYA_BASE_PRICES\.diesel/);
    expect(guard).toMatch(/return null;/);
  });

  it("the source label can no longer be asserted over a substituted value", () => {
    const kenya = sync.slice(
      sync.indexOf("async function fetchKenyaFuelPrices"),
    );
    expect(kenya).not.toMatch(
      /priceSource = "EPRA Published \(15 Aug – 14 Sep 2026\)"/,
    );
  });
});
