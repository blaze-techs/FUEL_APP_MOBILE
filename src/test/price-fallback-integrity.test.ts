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

/**
 * The LOAD_FROM_STORAGE reducer must keep exactly ONE definition of each
 * price scalar.
 *
 * A parallel change added the hardened `pickPrice(...)` guard for
 * pmsPrice/petrolPrice/agoPrice/dieselPrice but left the older, permissive
 * `incoming.x ?? state.x` chain in the same object literal. Later keys win in
 * an object literal, so the permissive chain was the live behaviour and the
 * hardened guard was dead code -- and `tsc -b` rejected the file with TS1117,
 * taking the whole pipeline red. Removing the duplicate is what actually
 * switches the guard on, so this pins the absence of a second definition.
 */
describe("the sync reducer defines each price scalar exactly once", () => {
  const fuelContext = read("src/react-app/context/FuelContext.tsx");

  /** Keys of the object literal in the LOAD_FROM_STORAGE branch. */
  const loadObjectKeys = (): string[] => {
    const lines = fuelContext.split("\n");
    const anchor = lines.findIndex((l) =>
      l.includes("pickPrice(state.pmsPrice"),
    );
    expect(anchor, "the hardened pickPrice guard must exist").toBeGreaterThan(
      -1,
    );

    // Walk back to the enclosing `return {`, then forward to its closing `};`.
    let start = anchor;
    while (start > 0 && lines[start].trim() !== "return {") start--;
    const indent = lines[start].length - lines[start].trimStart().length;
    let end = start + 1;
    while (end < lines.length) {
      const isClose =
        lines[end].trim() === "};" &&
        lines[end].length - lines[end].trimStart().length === indent;
      if (isClose) break;
      end++;
    }

    const keys: string[] = [];
    for (let i = start + 1; i < end; i++) {
      const m = /^\s{8}([A-Za-z_$][\w$]*)\s*:/.exec(lines[i]);
      if (m) keys.push(m[1]);
    }
    return keys;
  };

  it("has no duplicated key in the restored-state literal", () => {
    const keys = loadObjectKeys();
    const seen = new Set<string>();
    const duplicates = keys.filter((k) => {
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
    expect(duplicates).toEqual([]);
  });

  it("still routes all four scalars through the plausibility guard", () => {
    for (const key of ["pmsPrice", "petrolPrice", "agoPrice", "dieselPrice"]) {
      expect(fuelContext).toMatch(new RegExp(`${key}: pickPrice\\(`));
    }
  });

  it("does not also carry the permissive incoming-first chain", () => {
    // `pmsPrice: (incoming.pmsPrice ?? state.pmsPrice)` is the shape that was
    // silently overriding the guard.
    expect(fuelContext).not.toMatch(/pmsPrice:\s*\n?\s*\(?incoming\.pmsPrice/);
    expect(fuelContext).not.toMatch(/agoPrice:\s*\n?\s*\(?incoming\.agoPrice/);
  });
});
