/**
 * Keyless published-price sources for the fuel capability.
 *
 * These exist so the fuel-price capability keeps working when the configured
 * providers are unavailable — a missing `SERPAPI_KEY`, an exhausted quota, or
 * a regulator site that blocks datacenter egress (EPRA returns HTTP 403 to
 * Vercel/CI egress; verified).
 *
 * Every source here is a PUBLISHED price page that states its own observation
 * date, which matters: it lets the caller reject a stale figure rather than
 * presenting last month's number as today's. Nothing in this module estimates
 * or interpolates a price.
 */

export interface PublishedPrice {
  /** Per-litre price in the local currency. */
  value: number;
  /** ISO 4217 code the price is denominated in. */
  currency: string;
  /** Source id (matches the provider-precedence registry). */
  source: string;
  /** ISO date the source says the price was observed, when published. */
  observedAt: string | null;
  /** Human label for the UI. */
  label: string;
}

const UA = "FuelAppMobile/1.0 (fuel-app-mobile.vercel.app)";

/** Fuel kinds a published source can report. */
export type FuelKind = "petrol" | "diesel" | "kerosene";

/** GlobalPetrolPrices uses different slugs per fuel. */
const GPP_SLUG: Record<FuelKind, string> = {
  petrol: "gasoline_prices",
  diesel: "diesel_prices",
  kerosene: "kerosene_prices",
};

/**
 * Countries whose GlobalPetrolPrices slug differs from their name.
 * Everything else uses the country name with spaces replaced by hyphens.
 */
const GPP_SLUG_OVERRIDES: Record<string, string> = {
  "united states": "USA",
  usa: "USA",
  "united states of america": "USA",
  "united kingdom": "United-Kingdom",
  "south korea": "South-Korea",
  "north korea": "North-Korea",
  "czech republic": "Czech-Republic",
  czechia: "Czech-Republic",
  "ivory coast": "Cote-dIvoire",
  "democratic republic of the congo": "DR-Congo",
  "united arab emirates": "United-Arab-Emirates",
  "south sudan": "South-Sudan",
  "burkina faso": "Burkina-Faso",
  "sierra leone": "Sierra-Leone",
  "cape verde": "Cape-Verde",
  "new zealand": "New-Zealand",
  "saudi arabia": "Saudi-Arabia",
  "sri lanka": "Sri-Lanka",
  "costa rica": "Costa-Rica",
  "dominican republic": "Dominican-Republic",
  "el salvador": "El-Salvador",
  "hong kong": "Hong-Kong",
  "papua new guinea": "Papua-New-Guinea",
};

/** "19-Oct-2026" | "October 19, 2026" -> ISO date, else null. */
export function parseObservationDate(text: string): string | null {
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  // 19-Oct-2026
  let m = text.match(/(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/);
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
  }
  // October 19, 2026
  m = text.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** Build the GlobalPetrolPrices path segment for a country name. */
export function gppSlug(country: string): string {
  const key = country.trim().toLowerCase().replace(/\s+/g, " ");
  if (GPP_SLUG_OVERRIDES[key]) return GPP_SLUG_OVERRIDES[key];
  return country
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

/**
 * Pull the headline national price + observation date out of a
 * GlobalPetrolPrices page.
 *
 * Two guards matter here, both learned from probing the real pages:
 *
 *  1. A wrong slug 200s with a GENERIC "around the world" page rather than
 *     erroring. Reading a price off that page would attribute some other
 *     country's figure to this one, so the page title is verified against the
 *     slug first.
 *  2. The currency comes from the page's own "Price (XXX/Liter)" column
 *     header — authoritative — rather than a JS variable that is not always
 *     present.
 *  3. The page carries a USD table BEFORE the local-currency one, so the value
 *     must be read from the local table's own region.
 *  4. Prices use thousands separators ("1,348.50"), which must be admitted by
 *     the pattern or the value silently truncates at the comma.
 */
export function parseGlobalPetrolPrices(
  html: string,
  country: string,
  kind: FuelKind,
): PublishedPrice | null {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";

  // Verify against the SLUG, not the raw country name: the page title uses the
  // slug's spelling ("USA gasoline prices…", not "United States…"), so
  // comparing to the country name would reject a correct page.
  const expected = gppSlug(country).replace(/-/g, " ").toLowerCase();
  if (!title.toLowerCase().startsWith(expected)) {
    // Generic/redirected page — never attribute its prices to this country.
    return null;
  }

  const observedAt = parseObservationDate(title);

  // The page carries TWO price tables: one in USD and one in the local
  // currency. We must take the LOCAL one — it is what a pump displays, and
  // the USD figure would need an FX rate to be usable. The local table is
  // identified by its own column header ("Price (KES/Liter)"), so the value
  // is read from the "Current price" row that FOLLOWS that header. Matching
  // the first "Current price" on the page silently returns USD.
  const headers = [...html.matchAll(/Price\s*\(([A-Z]{3})\s*\/\s*Liter/gi)];
  if (!headers.length) return null;
  const local = headers.find((h) => h[1].toUpperCase() !== "USD") ?? headers[0];
  const currency = local[1].toUpperCase();
  const from = local.index ?? 0;
  const region = html.slice(from);

  // Prices carry thousands separators in most currencies ("1,348.50"), so the
  // integer part must admit commas — otherwise the match stops at the comma
  // and 1,348.50 is silently read as 1.
  const NUM = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const current = region.match(
    new RegExp(
      `Current\\s*price\\s*\\|?\\s*<\\/td>\\s*<td[^>]*>\\s*${NUM}`,
      "i",
    ),
  );
  let value = current ? Number(current[1].replace(/,/g, "")) : NaN;

  if (!Number.isFinite(value)) {
    // Tolerate the flattened form produced by stripping tags.
    const flat = region.match(new RegExp(`Current price[\\s|]*${NUM}`, "i"));
    if (flat) value = Number(flat[1].replace(/,/g, ""));
  }

  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    value,
    currency,
    source: "globalpetrolprices",
    observedAt,
    label: `GlobalPetrolPrices ${country} ${kind} (${currency}/L)${
      observedAt ? ` — ${observedAt}` : ""
    }`,
  };
}

/**
 * Fetch a published national price for `country`.
 *
 * Keyless and independent of every other provider, so it is a genuine
 * fail-safe rather than a second view of the same upstream.
 */
export async function fetchPublishedPrice(
  country: string,
  kind: FuelKind,
): Promise<PublishedPrice | null> {
  const slug = gppSlug(country);
  if (!slug) return null;
  const url = `https://www.globalpetrolprices.com/${slug}/${GPP_SLUG[kind]}/`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return parseGlobalPetrolPrices(await res.text(), country, kind);
  } catch {
    return null;
  }
}

/**
 * Whether a published observation date is recent enough to trust.
 *
 * A monthly-regulated market changes on a known cadence, so a figure older
 * than `maxAgeDays` is reported as stale instead of being shown as current.
 */
export function isFreshObservation(
  observedAt: string | null,
  maxAgeDays = 45,
  now: Date = new Date(),
): boolean {
  if (!observedAt) return false;
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return false;
  const ageDays = (now.getTime() - t) / 86_400_000;
  return ageDays >= 0 && ageDays <= maxAgeDays;
}
