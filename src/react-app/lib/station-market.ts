import { getDetectedCountryCode } from "@/react-app/lib/currency";
import {
  readScopedLocal,
  writeScopedLocal,
} from "@/react-app/lib/scoped-local-storage";
import {
  getCountryByCurrency,
  normalizeCurrencyCode,
} from "@/react-app/lib/world-country-utils";

/**
 * Resolve the market a station actually trades in.
 *
 * This existed as an inline `getDetectedCountryCode()` call in the price
 * guard, which was the bug: `getDetectedCountryCode()` can fall back to the
 * BROWSER's location, so a Kenya-based user managing a US station resolved to
 * "KE". Every Kenya figure then looked legitimate for a US station — the
 * plausibility guard passed and a foreign price rendered and persisted. The
 * station's own record has to win, and the browser only ever informs a
 * fallback.
 */

/** Read the persisted station records for the signed-in user. */
function readStoredStations(): Array<Record<string, unknown>> {
  const keys: string[] = [];
  try {
    const userId = localStorage.getItem("fuelpro_auth_identity");
    if (userId) keys.push(`fuelpro_stations_v3_${userId}`);
  } catch {
    /* storage unavailable */
  }
  keys.push("fuelpro_stations_v3");
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as { stations?: unknown })?.stations as unknown);
      if (Array.isArray(list)) {
        return list.filter(
          (s): s is Record<string, unknown> =>
            !!s && typeof s === "object" && !Array.isArray(s),
        );
      }
    } catch {
      /* malformed cache — try the next key */
    }
  }
  return [];
}

function countryFromRecord(rec: Record<string, unknown> | undefined): string {
  if (!rec) return "";
  const explicit = String(rec.country || rec.countryCode || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  const currency = normalizeCurrencyCode(String(rec.currency || ""));
  if (currency) {
    const byCurrency = getCountryByCurrency(currency);
    if (byCurrency) return String(byCurrency).toUpperCase();
  }
  return "";
}

/** Legacy/placeholder ids that mean "the station currently in view". */
const STATION_ID_SENTINELS = new Set([
  "default_station",
  "default",
  "current",
  "",
]);

/**
 * Where the provider publishes the active station's market once it has the real
 * station object. This is authoritative (derived from the station record, never
 * from the device), and it is what makes the resolution reliable: the persisted
 * station cache keys are derived from `fuelpro_auth_identity`, which is not
 * always present, so a storage-only lookup can miss the station entirely and
 * fall through to the browser's country — the original bug.
 */
export const STATION_MARKET_KEY = "fuelpro_station_market";

/** Publish the active station's market. Empty values are ignored. */
export function publishStationMarket(country: string): void {
  try {
    const cc = String(country || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) writeScopedLocal(STATION_MARKET_KEY, cc);
  } catch {
    /* storage unavailable */
  }
}

function readPublishedMarket(): string {
  try {
    const cc = String(
      readScopedLocal<string>(STATION_MARKET_KEY, ""),
    ).toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) return cc;
  } catch {
    /* storage unavailable */
  }
  return "";
}

/**
 * The station's country, trusted only from the station's own record (its
 * explicit country, else its currency) or the market the provider published
 * from that record. Returns "" when it cannot be known.
 *
 * Callers that WRITE data back must use this, so a wrong guess can never
 * destroy a correctly-configured price. Callers that merely decide whether to
 * display a value can fall back to `resolveMarketCountry`.
 */
export function resolveStationCountry(
  stationId?: string,
  station?: { country?: string; currency?: string } | null,
): string {
  const fromArg = countryFromRecord(
    station as Record<string, unknown> | undefined,
  );
  if (fromArg) return fromArg;

  const list = readStoredStations();
  const wanted = String(stationId ?? "").toLowerCase();
  if (wanted && !STATION_ID_SENTINELS.has(wanted)) {
    const match = list.find((s) => String(s.id) === String(stationId));
    // An explicit id that does not match any stored record is genuinely
    // unknown. Do NOT fall through to the current station: that id belongs to
    // a different station, and judging its prices against the current
    // station's market could discard a perfectly valid price.
    return countryFromRecord(match) || readPublishedMarket();
  }

  // No id given (or a placeholder): the caller means "the station in view", so
  // the record flagged as current is the right one.
  let currentId = "";
  try {
    currentId =
      localStorage.getItem("fuelpro_current_station_v3") ||
      localStorage.getItem("fuelpro_current_station") ||
      "";
  } catch {
    /* storage unavailable */
  }
  const current =
    (currentId && list.find((s) => String(s.id) === currentId)) || list[0];
  return countryFromRecord(current) || readPublishedMarket();
}

/**
 * The market to judge prices against. Adds the detected/locale fallbacks on
 * top of `resolveStationCountry` so the guard stays armed even before the
 * station record is readable. Use for read-only decisions; never for writes.
 */
export function resolveMarketCountry(
  stationId?: string,
  station?: { country?: string; currency?: string } | null,
): string {
  // The station's own record always wins — including the record currently in
  // view, which is what a caller means when it passes a placeholder id.
  const confident =
    resolveStationCountry(stationId, station) ||
    resolveStationCountry(undefined, station);
  if (confident) return confident;
  // Only when NO station record is readable at all do we fall back to the
  // device. That keeps the guard armed during a cold load without letting the
  // browser's country override a station we can actually identify.
  try {
    const detected = String(getDetectedCountryCode() || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(detected)) return detected;
  } catch {
    /* detection unavailable */
  }
  try {
    const region = String(navigator?.language || "")
      .split("-")[1]
      ?.toUpperCase();
    if (region && /^[A-Z]{2}$/.test(region)) return region;
  } catch {
    /* navigator unavailable */
  }
  return "";
}
