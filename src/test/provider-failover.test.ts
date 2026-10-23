import { describe, expect, it, vi } from "vitest";
import {
  withFailover,
  withConsensus,
  pickNumber,
  type ProviderAttempt,
} from "../server/vercel-api/_lib/provider-failover";
import {
  parseObservationDate,
  parseGlobalPetrolPrices,
  isFreshObservation,
  gppSlug,
} from "../server/vercel-api/_lib/fuel-fallback-sources";
import {
  ratesAgree,
  mergeRates,
  type FxRates,
} from "../server/vercel-api/_lib/fx-rates";
import {
  providerChain,
  mayServeCapability,
  PROVIDER_PRECEDENCE,
} from "../react-app/config/provider-precedence";

/** A provider that returns a fixed value. */
const ok = <T>(id: string, value: T): ProviderAttempt<T> => ({
  id,
  run: async () => value,
});

/** A provider that always throws. */
const boom = <T>(id: string): ProviderAttempt<T> => ({
  id,
  run: async () => {
    throw new Error(`${id} down`);
  },
});

/** A provider that returns nothing usable. */
const empty = <T>(id: string): ProviderAttempt<T> => ({
  id,
  run: async () => null,
});

describe("withFailover", () => {
  it("prefers the first provider when it answers", async () => {
    const r = await withFailover([ok("primary", 10), ok("secondary", 99)]);
    expect(r?.value).toBe(10);
    expect(r?.servedBy).toBe("primary");
    // 99 was not consulted as a confirmation (confirmWith defaults to 1).
    expect(r?.corroborated).toBe(false);
  });

  it("fails over when the primary is down (fail-safe)", async () => {
    const r = await withFailover([
      boom<number>("primary"),
      ok("secondary", 42),
    ]);
    expect(r?.value).toBe(42);
    expect(r?.servedBy).toBe("secondary");
    expect(r?.failed).toContain("primary");
  });

  it("keeps trying past several failures", async () => {
    const r = await withFailover([
      boom<number>("a"),
      empty<number>("b"),
      boom<number>("c"),
      ok("d", 7),
    ]);
    expect(r?.value).toBe(7);
    expect(r?.servedBy).toBe("d");
    expect(r?.failed).toEqual(["a", "b", "c"]);
  });

  it("returns null only when every provider fails", async () => {
    expect(
      await withFailover([boom<number>("a"), boom<number>("b")]),
    ).toBeNull();
  });

  it("absorbs a hanging provider via the per-attempt timeout", async () => {
    const slow: ProviderAttempt<number> = {
      id: "slow",
      run: () => new Promise(() => {}), // never resolves
    };
    const r = await withFailover([slow, ok("fast", 5)], { timeoutMs: 30 });
    expect(r?.value).toBe(5);
    expect(r?.servedBy).toBe("fast");
    expect(r?.failed).toContain("slow");
  });

  it("reports corroboration when a second provider agrees", async () => {
    const r = await withFailover([ok("primary", 10), ok("checker", 10)], {
      confirmWith: 2,
    });
    expect(r?.servedBy).toBe("primary");
    expect(r?.corroborated).toBe(true);
    expect(r?.confirmedBy).toEqual(["checker"]);
  });

  it("still returns the primary value when the checker DISAGREES", async () => {
    // Precedence must win: a disagreement is reported, not silently adopted.
    const r = await withFailover([ok("primary", 10), ok("checker", 999)], {
      confirmWith: 2,
    });
    expect(r?.value).toBe(10);
    expect(r?.servedBy).toBe("primary");
    expect(r?.corroborated).toBe(false);
  });

  it("treats empty strings and arrays as no answer", async () => {
    const r = await withFailover([
      ok("blank", ""),
      ok<string[]>("none", []),
      ok("real", ["x"]),
    ]);
    expect(r?.servedBy).toBe("real");
  });

  it("uses a custom agreement predicate", async () => {
    const r = await withFailover([ok("a", 21.4), ok("b", 21.9)], {
      confirmWith: 2,
      agrees: (x, y) => Math.abs(x - y) <= 2,
    });
    expect(r?.corroborated).toBe(true);
  });
});

describe("withConsensus", () => {
  it("picks the value the most providers agree on", async () => {
    const r = await withConsensus([
      ok("odd-one-out", { v: 1 }),
      ok("majority-1", { v: 5 }),
      ok("majority-2", { v: 5 }),
    ]);
    expect(r?.value).toEqual({ v: 5 });
    expect(r?.corroborated).toBe(true);
  });

  it("breaks a tie by precedence order", async () => {
    const r = await withConsensus([ok("first", 1), ok("second", 2)]);
    expect(r?.value).toBe(1);
    expect(r?.servedBy).toBe("first");
  });
});

describe("pickNumber", () => {
  it("reads alternate spellings and rejects non-finite values", () => {
    expect(pickNumber({ dieselPrice: 217.86 }, ["dieselPrice", "diesel"])).toBe(
      217.86,
    );
    expect(pickNumber({ diesel: "1,234.5" }, ["dieselPrice", "diesel"])).toBe(
      1234.5,
    );
    expect(pickNumber({ diesel: "n/a" }, ["diesel"])).toBeNull();
    expect(pickNumber(null, ["diesel"])).toBeNull();
  });
});

describe("fuel fallback sources", () => {
  it("parses the observation date in both published formats", () => {
    expect(parseObservationDate("Kenya gasoline prices, 19-Oct-2026")).toBe(
      "2026-10-19",
    );
    expect(parseObservationDate("October 19, 2026")).toBe("2026-10-19");
    expect(parseObservationDate("no date here")).toBeNull();
  });

  it("extracts the LOCAL-currency headline, not the USD table", () => {
    // Real pages carry a USD table first and the local-currency table second.
    // Reading the first "Current price" silently returns USD.
    const html = `
      <title>Kenya gasoline prices, 19-Oct-2026</title>
      <th>Price (USD/Liter)</th>
      <td>Current price</td><td>1.74</td>
      <th>Price (KES/Liter)</th>
      <td>Current price</td><td>225.50</td>`;
    const p = parseGlobalPetrolPrices(html, "Kenya", "petrol");
    expect(p?.value).toBe(225.5);
    expect(p?.currency).toBe("KES");
    expect(p?.observedAt).toBe("2026-10-19");
  });

  it("reads a thousands-separated price without truncating it", () => {
    // 1,348.50 NGN must not be read as 1.
    const html = `
      <title>Nigeria gasoline prices, 19-Oct-2026</title>
      <th>Price (USD/Liter)</th>
      <td>Current price</td><td>1.01</td>
      <th>Price (NGN/Liter)</th>
      <td>Current price</td><td>1,348.50</td>`;
    const p = parseGlobalPetrolPrices(html, "Nigeria", "petrol");
    expect(p?.value).toBe(1348.5);
    expect(p?.currency).toBe("NGN");
  });

  it("accepts the slug spelling used in the page title", () => {
    // "United States" is slugged USA, so the title reads "USA gasoline prices".
    const html = `
      <title>USA gasoline prices, 19-Oct-2026</title>
      <th>Price (USD/Liter)</th>
      <td>Current price</td><td>1.22</td>`;
    const p = parseGlobalPetrolPrices(html, "United States", "petrol");
    expect(p?.value).toBe(1.22);
  });

  it("refuses the generic 'around the world' page from a wrong slug", () => {
    // A wrong slug 200s with a generic page rather than erroring; its prices
    // belong to no particular country and must never be attributed.
    const html = `
      <title>Gasoline prices around the world, 19-Oct-2026</title>
      <th>Price (USD/Liter)</th>
      <td>Current price</td><td>1.74</td>`;
    expect(parseGlobalPetrolPrices(html, "United States", "petrol")).toBeNull();
  });

  it("builds country slugs with the documented overrides", () => {
    expect(gppSlug("Kenya")).toBe("Kenya");
    expect(gppSlug("United Kingdom")).toBe("United-Kingdom");
    expect(gppSlug("South Africa")).toBe("South-Africa");
    // "United-States" redirects to a generic page, so it must map to USA.
    expect(gppSlug("United States")).toBe("USA");
  });

  it("returns null rather than a guess when no price is present", () => {
    expect(
      parseGlobalPetrolPrices(
        "<title>Kenya gasoline prices, 19-Oct-2026</title><html>no prices</html>",
        "Kenya",
        "petrol",
      ),
    ).toBeNull();
  });

  it("flags a stale observation instead of presenting it as current", () => {
    const now = new Date("2026-10-22T00:00:00Z");
    expect(isFreshObservation("2026-10-19", 45, now)).toBe(true);
    // A two-cycle-old figure must not pass as current.
    expect(isFreshObservation("2026-08-01", 45, now)).toBe(false);
    expect(isFreshObservation(null, 45, now)).toBe(false);
  });
});

describe("fx ratesAgree", () => {
  const rates = (r: Record<string, number>): FxRates => ({
    base: "USD",
    rates: r,
    date: null,
  });

  it("agrees when every shared rate is within tolerance", () => {
    expect(ratesAgree(rates({ KES: 129.2 }), rates({ KES: 129.5 }))).toBe(true);
  });

  it("disagrees on a materially different rate", () => {
    expect(ratesAgree(rates({ KES: 129.2 }), rates({ KES: 100 }))).toBe(false);
  });

  it("ignores currencies only one provider publishes", () => {
    expect(
      ratesAgree(rates({ KES: 129.2, XBT: 0.00001 }), rates({ KES: 129.2 })),
    ).toBe(true);
  });

  it("mergeRates never drops a currency the supplement lacks", () => {
    // The ECB omits KES/NGN/TZS. If the supplement were treated as a
    // replacement, every African rate would silently disappear.
    const primary = rates({ KES: 129.86, NGN: 1450, EUR: 0.89 });
    const ecb = rates({ EUR: 0.8915 });
    const merged = mergeRates(primary, ecb);
    expect(merged.rates.KES).toBe(129.86);
    expect(merged.rates.NGN).toBe(1450);
    expect(merged.rates.EUR).toBe(0.89); // primary stays authoritative
  });

  it("mergeRates fills a currency only the supplement publishes", () => {
    const merged = mergeRates(rates({ KES: 129.86 }), rates({ ISK: 138 }));
    expect(merged.rates.ISK).toBe(138);
    expect(merged.rates.KES).toBe(129.86);
  });
});

describe("provider precedence registry", () => {
  it("keeps the catalogue-substitution ban in force", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      expect(entry.policy).toBe("keep-existing");
      // A fail-safe must never be an undeclared catalogue counterpart.
      for (const f of entry.fallbacks ?? []) {
        expect(f.id).not.toBe(entry.authoritative.id);
      }
    }
  });

  it("orders the chain authoritative-first", () => {
    const chain = providerChain("geocoding");
    expect(chain[0].id).toBe("nominatim");
    expect(chain.map((c) => c.id)).toEqual([
      "nominatim",
      "bigdatacloud",
      "photon",
    ]);
  });

  it("admits a declared fail-safe only when the authoritative key is unset", () => {
    // geocoding has no key at all, so its chain is always available.
    expect(mayServeCapability("geocoding", "bigdatacloud")).toBe(true);
    expect(mayServeCapability("geocoding", "photon")).toBe(true);
    // An undeclared catalogue entry is still refused.
    expect(mayServeCapability("geocoding", "geoapify")).toBe(false);
    expect(mayServeCapability("geocoding", "opencage")).toBe(false);
  });

  it("refuses a catalogue counterpart even when the primary is unconfigured", () => {
    // fuel-price-search's authoritative key is unset in tests, which is
    // exactly when a substitution would be tempting.
    expect(mayServeCapability("fuel-price-search", "serper")).toBe(true);
    expect(mayServeCapability("fuel-price-search", "scrapingbee")).toBe(false);
    expect(mayServeCapability("fuel-price-search", "apilayer")).toBe(false);
  });

  it("never lets a fallback serve while the authoritative provider is configured", () => {
    const entry = PROVIDER_PRECEDENCE.find(
      (e) => e.capability === "assistant-llm",
    )!;
    // Declared with no fallback: an arbitrary provider is refused outright.
    expect(entry.fallbacks).toBeUndefined();
    expect(mayServeCapability("assistant-llm", "openai")).toBe(false);
  });
});

describe("live provider reachability (keyless fail-safes)", () => {
  const live = process.env.FUELPRO_LIVE_PROBES === "1";

  it.skipIf(!live)(
    "geocoding chain resolves a village with the primary blocked",
    async () => {
      // Force the authoritative provider to fail, proving the chain carries the
      // capability on its own — this is the production condition (Nominatim 403s
      // datacenter egress).
      const { getExactLocation } =
        await import("../server/vercel-api/_lib/geocoding");
      const realFetch = globalThis.fetch;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);
        if (url.includes("nominatim.openstreetmap.org")) {
          return new Response("blocked", { status: 403 });
        }
        return realFetch(input as RequestInfo, init);
      }) as typeof fetch);

      try {
        const loc = await getExactLocation(3.119, 35.5973); // Lodwar
        expect(loc.provider).not.toBe("nominatim");
        expect(loc.displayName.toLowerCase()).toContain("lodwar");
      } finally {
        spy.mockRestore();
      }
    },
    30000,
  );
});

describe("fuel path wires the fail-safes in", () => {
  const read = async (rel: string) =>
    (await import("node:fs/promises")).readFile(
      new URL(rel, import.meta.url),
      "utf8",
    );

  it("fuel-engine degrades to the keyless chain when Nominatim fails", async () => {
    // The primary fuel path had its OWN Nominatim-only geocoder with no
    // fallback, so a 403 (the normal serverless condition) took the whole
    // lookup down. It must delegate rather than throw.
    const src = await read("../server/vercel-api/_lib/fuel-engine.ts");
    expect(src).toContain("reverseViaFailoverChain");
    expect(src).toMatch(/catch\s*\{\s*\n[\s\S]*?reverseViaFailoverChain/);
  });

  it("fuel-engine keeps the admin fields the EPRA town lookup needs", async () => {
    // county/state drive the county -> pricing-town mapping (Turkana ->
    // Lodwar). Dropping them silently downgrades a remote station to a
    // national price, which is the inaccuracy this work exists to fix.
    const src = await read("../server/vercel-api/_lib/fuel-engine.ts");
    const fn = src.slice(src.indexOf("async function reverseViaFailoverChain"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("county:");
    expect(body).toContain("state:");
  });

  it("fuel-engine consults the published source before the AI path", async () => {
    // With no search key the AI cannot run at all, so without this step the
    // lookup returns nothing even though a real dated figure is free.
    const src = await read("../server/vercel-api/_lib/fuel-engine.ts");
    const published = src.indexOf("fetchPublishedPrice");
    const aiPath = src.indexOf("// D. Fetch fresh REAL data");
    expect(published).toBeGreaterThan(-1);
    expect(published).toBeLessThan(aiPath);
  });

  it("fuel-prices never presents the embedded reference as current", async () => {
    // A hard-coded table cannot know it has gone stale; it must be labelled
    // unverified so the client can say so instead of showing a wrong price.
    const src = await read("../server/vercel-api/fuel-prices.ts");
    expect(src).toContain("unverified: true");
    expect(src).toContain("resolvePublishedKenyaPrices");
    expect(src).not.toMatch(/source: "EPRA Published Reference \(15 Aug/);
  });

  it("fuel-engine refuses to serve a Kenya row with unverifiable provenance", async () => {
    // A cached "AI-Verified" row for a Kenyan village cannot prove the figure
    // was town-specific — that is how a Nairobi price (214) got cached against
    // a Turkana coordinate. Such rows must be re-resolved, not served.
    const src = await read("../server/vercel-api/_lib/fuel-engine.ts");
    expect(src).toContain("cacheIsTrustworthy");
    const fn = src.slice(src.indexOf("function cacheIsTrustworthy"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("gazette");
    expect(body).toContain('!== "KE"');
    // And the cache hit must actually consult it.
    const cache = src.slice(src.indexOf("// B. Exact-match cache check"));
    expect(cache.slice(0, 1200)).toContain("cacheIsTrustworthy(row");
  });

  it("every new _lib module uses an explicit .js import extension", async () => {
    // Extensionless relative imports break Vercel ESM loading and 500 every
    // route in the dispatcher.
    for (const f of [
      "fx-rates.ts",
      "geocoding.ts",
      "weather.ts",
      "fuel-engine.ts",
      "fuel-prices.ts",
    ]) {
      const src = await read(`../server/vercel-api/_lib/${f}`).catch(() =>
        read(`../server/vercel-api/${f}`),
      );
      const bad = [...src.matchAll(/from\s+"(\.\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((p) => !p.endsWith(".js"));
      expect(bad, `${f} has extensionless imports`).toEqual([]);
    }
  });
});
