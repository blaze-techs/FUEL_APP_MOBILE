/**
 * Currency FX with a fail-safe provider chain + cross-validation.
 *
 * exchangerate-api.com stays authoritative (it is what DataSyncService already
 * uses). Frankfurter (ECB reference rates) is an INDEPENDENT keyless source,
 * used two ways:
 *
 *  - fail-safe: if the authoritative endpoint is unreachable, rates still
 *    resolve;
 *  - cross-check: when both answer, a large divergence flags the rate as
 *    unverified instead of silently converting money at a wrong rate.
 *
 * A wrong FX rate corrupts every derived price, so a silent disagreement is
 * more dangerous here than a missing value.
 */

import { withFailover, type ProviderAttempt } from "./provider-failover";
import { parseObservationDate } from "./fuel-fallback-sources";

export interface FxRates {
  base: string;
  rates: Record<string, number>;
  /** ISO date the rates are for, when published. */
  date: string | null;
  provider?: string;
  corroborated?: boolean;
}

const UA = "FuelAppMobile/1.0 (fuel-app-mobile.vercel.app)";

async function viaExchangeRateApi(base: string): Promise<FxRates | null> {
  const res = await fetch(
    `https://api.exchangerate-api.com/v4/latest/${base}`,
    { signal: AbortSignal.timeout(9000) },
  );
  if (!res.ok) throw new Error(`exchangerate-api ${res.status}`);
  const d = (await res.json()) as {
    base?: string;
    date?: string;
    rates?: Record<string, number>;
  };
  if (!d.rates || typeof d.rates !== "object") return null;
  return {
    base: (d.base || base).toUpperCase(),
    rates: d.rates,
    date: d.date || null,
  };
}

async function viaFrankfurter(base: string): Promise<FxRates | null> {
  const res = await fetch(
    `https://api.frankfurter.dev/v1/latest?base=${base}`,
    {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(9000),
    },
  );
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const d = (await res.json()) as {
    base?: string;
    date?: string;
    rates?: Record<string, number>;
  };
  if (!d.rates || typeof d.rates !== "object") return null;
  return {
    base: (d.base || base).toUpperCase(),
    rates: d.rates,
    date: d.date || null,
  };
}

async function viaOpenErApi(base: string): Promise<FxRates | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`open.er-api ${res.status}`);
  const d = (await res.json()) as {
    base_code?: string;
    time_last_update_utc?: string;
    rates?: Record<string, number>;
  };
  if (!d.rates || typeof d.rates !== "object") return null;
  return {
    base: (d.base_code || base).toUpperCase(),
    rates: d.rates,
    date: d.time_last_update_utc
      ? (parseObservationDate(d.time_last_update_utc) ??
        new Date(d.time_last_update_utc).toISOString().slice(0, 10))
      : null,
  };
}

/**
 * A second provider "agrees" when every rate it reports is within `tolerance`
 * of the winner's. Only overlapping currencies are compared — the ECB set is
 * narrower, and a currency the ECB does not publish is not a disagreement.
 */
export function ratesAgree(a: FxRates, b: FxRates, tolerance = 0.02): boolean {
  const shared = Object.keys(a.rates).filter((k) => k in b.rates);
  if (!shared.length) return false;
  return shared.every((k) => {
    const x = a.rates[k];
    const y = b.rates[k];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) return false;
    return Math.abs(x - y) / Math.abs(x) <= tolerance;
  });
}

/**
 * Merge two rate sets.
 *
 * The ECB (Frankfurter) publishes only ~30 majors and notably omits KES, NGN,
 * TZS and most African currencies, so a second source is not a drop-in
 * replacement — it SUPPLEMENTS. The base set stays authoritative; the
 * supplement only fills currencies the base does not publish.
 */
export function mergeRates(base: FxRates, supplement: FxRates): FxRates {
  return {
    base: base.base,
    rates: { ...supplement.rates, ...base.rates },
    date: base.date,
    provider: base.provider,
    corroborated: base.corroborated,
  };
}

/**
 * Fetch rates for `base`.
 *
 * The primary supplies the full currency set; the secondary is consulted in
 * parallel purely to CORROBORATE (and to fill any currency the primary omits).
 * A missing KES in the secondary must never remove KES from the result.
 *
 * Throws only when every provider fails.
 */
export async function getFxRates(base = "USD"): Promise<FxRates> {
  const b = base.toUpperCase();
  const attempts: ProviderAttempt<FxRates>[] = [
    { id: "exchangerate-api", run: () => viaExchangeRateApi(b) },
    { id: "open-er-api", run: () => viaOpenErApi(b) },
  ];

  const primary = await withFailover(attempts, {
    timeoutMs: 9000,
    confirmWith: 2,
    agrees: ratesAgree,
  });

  // ECB is a supplementary cross-check, never a substitute: it lacks most
  // African currencies, so using it alone would silently drop them.
  let merged: FxRates | null = primary
    ? {
        ...primary.value,
        provider: primary.servedBy,
        corroborated: primary.corroborated,
      }
    : null;

  try {
    const ecb = await viaFrankfurter(b);
    if (ecb) {
      if (!merged) {
        merged = { ...ecb, provider: "frankfurter", corroborated: false };
      } else {
        merged = mergeRates(merged, ecb);
        if (!merged.corroborated && ratesAgree(primary!.value, ecb)) {
          merged.corroborated = true;
        }
      }
    }
  } catch {
    /* the ECB cross-check is best-effort */
  }

  if (!merged) throw new Error("FX failed: all providers unavailable");
  return merged;
}
