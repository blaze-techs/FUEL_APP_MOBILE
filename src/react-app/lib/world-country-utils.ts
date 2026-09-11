/**
 * World Country Utilities — All 250+ countries supported everywhere in FuelPro
 * Import this wherever country data is needed to ensure no country is ever left out.
 */

import { WORLD_PAYMENT_CONFIGS } from "@/react-app/config/worldPaymentConfigs";

export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  flag: string;
}

// ─── Flag emoji generator ───
function getFlagEmoji(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return "🏳️";
  const cp1 = code.charCodeAt(0);
  const cp2 = code.charCodeAt(1);
  if (cp1 < 0x41 || cp1 > 0x5a || cp2 < 0x41 || cp2 > 0x5a) return "🏳️";
  const OFFSET = 0x1f1e6;
  return String.fromCodePoint(OFFSET + (cp1 - 0x41), OFFSET + (cp2 - 0x41));
}

// ─── All 250+ countries sorted alphabetically ───
export const ALL_COUNTRIES: CountryInfo[] = Object.entries(
  WORLD_PAYMENT_CONFIGS,
)
  .map(([code, config]) => ({
    code,
    name: config.countryName,
    currency: config.defaultCurrency,
    flag: getFlagEmoji(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ─── Get country by code ───
export function getCountryByCode(code: string): CountryInfo | undefined {
  return ALL_COUNTRIES.find((c) => c.code === code.toUpperCase());
}

// ─── Get country by name (case-insensitive, trimmed) ───
// Used to resolve a country NAME embedded in a free-text location string
// (e.g. "Nairobi, Kenya" → Kenya → KE → KES) when no country code is stored.
export function getCountryByName(name: string): CountryInfo | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return ALL_COUNTRIES.find((c) => c.name.toLowerCase() === n);
}

// ─── City → ISO country code map ───
// Many station location strings contain only a city/neighborhood name
// (e.g. "Kasarani, Nairobi") without the country name. Without this map,
// getCountryFromLocation returns undefined and the app falls through to
// CDN/IP-based geolocation (which often resolves to the server's country,
// e.g. US), showing the wrong flag/currency in the header.
const CITY_TO_COUNTRY: Record<string, string> = {
  // Kenya
  nairobi: "KE",
  mombasa: "KE",
  kisumu: "KE",
  nakuru: "KE",
  eldoret: "KE",
  kakamega: "KE",
  kitale: "KE",
  bungoma: "KE",
  lodwar: "KE",
  garissa: "KE",
  kericho: "KE",
  kakuma: "KE",
  malindi: "KE",
  lamu: "KE",
  nyeri: "KE",
  meru: "KE",
  machakos: "KE",
  kiambu: "KE",
  kasarani: "KE",
  thika: "KE",
  // Uganda
  kampala: "UG",
  entebbe: "UG",
  gulu: "UG",
  jinja: "UG",
  mbarara: "UG",
  // Tanzania
  "dar es salaam": "TZ",
  dodoma: "TZ",
  arusha: "TZ",
  mwanza: "TZ",
  zanzibar: "TZ",
  tanga: "TZ",
  // Rwanda
  kigali: "RW",
  // Ethiopia
  "addis ababa": "ET",
  // Nigeria
  lagos: "NG",
  abuja: "NG",
  kano: "NG",
  ibadan: "NG",
  // Ghana
  accra: "GH",
  kumasi: "GH",
  // South Africa
  johannesburg: "ZA",
  cape_town: "ZA",
  "cape town": "ZA",
  durban: "ZA",
  pretoria: "ZA",
  // Germany
  berlin: "DE",
  munich: "DE",
  hamburg: "DE",
  frankfurt: "DE",
  cologne: "DE",
  // UK
  london: "GB",
  manchester: "GB",
  birmingham: "GB",
  // US
  "new york": "US",
  "los angeles": "US",
  chicago: "US",
  houston: "US",
  // India
  "new delhi": "IN",
  mumbai: "IN",
  bangalore: "IN",
  chennai: "IN",
};

// ─── Currency → ISO country code map (for currencies with a unique country) ───
// Used when a station has a currency code but no country code. EUR is
// intentionally omitted (shared by multiple countries).
export const CURRENCY_TO_COUNTRY: Record<string, string> = {
  KES: "KE",
  UGX: "UG",
  TZS: "TZ",
  RWF: "RW",
  ETB: "ET",
  NGN: "NG",
  GHS: "GH",
  ZAR: "ZA",
  GBP: "GB",
  USD: "US",
  CHF: "CH",
  CNY: "CN",
  INR: "IN",
  PKR: "PK",
  JPY: "JP",
  CAD: "CA",
  AUD: "AU",
  MAD: "MA",
  DZD: "DZ",
  TND: "TN",
  SDG: "SD",
  SOS: "SO",
  SSP: "SS",
  MGA: "MG",
  MRU: "MR",
  MZN: "MZ",
  NAD: "NA",
  SZL: "SZ",
  GMD: "GM",
  CVE: "CV",
  XOF: "SN",
  XAF: "CM",
};

/** Resolve a country from a currency code (e.g. "KES" → "KE"). */
/** Reverse map of currency symbols → ISO currency codes */
const CURRENCY_SYMBOL_TO_CODE: Record<string, string> = {
  KSh: "KES",
  USh: "UGX",
  TSh: "TZS",
  "\u20A6": "NGN", // Naira sign
  R: "ZAR",
  "GH\u20B5": "GHS",
  RF: "RWF",
  FBu: "BIF",
  $: "USD",
  "\u00A3": "GBP", // Pound sign
  "\u20AC": "EUR", // Euro sign
  "\u00A5": "JPY", // Yen sign
  "\u20B9": "INR", // Rupee sign
  A$: "AUD",
  C$: "CAD",
  CHF: "CHF",
  R$: "BRL",
  K: "ZMW",
  P: "BWP",
  MT: "MZN",
};

/** Normalize a currency string that may be a symbol (KSh, $) or code (KES, USD) */
export function normalizeCurrencyCode(currency: string): string | undefined {
  if (!currency) return undefined;
  const upper = currency.toUpperCase();
  // Already a code
  if (CURRENCY_TO_COUNTRY[upper]) return upper;
  // Try symbol → code (case-sensitive for symbols like "KSh")
  const fromSymbol = CURRENCY_SYMBOL_TO_CODE[currency];
  if (fromSymbol) return fromSymbol;
  // Try uppercased symbol
  const fromSymbolUpper = CURRENCY_SYMBOL_TO_CODE[upper];
  if (fromSymbolUpper) return fromSymbolUpper;
  return undefined;
}

export function getCountryByCurrency(currency: string): string | undefined {
  if (!currency) return undefined;
  // Accept both codes (KES) and symbols (KSh)
  const code = normalizeCurrencyCode(currency);
  if (code) return CURRENCY_TO_COUNTRY[code];
  return CURRENCY_TO_COUNTRY[currency.toUpperCase()];
}

// ─── Extract a country from a free-text location string ───
// Handles "City, Country", "Country", and common variants. Returns the
// matched CountryInfo, or undefined if no known country is found.
export function getCountryFromLocation(
  location: string,
): CountryInfo | undefined {
  if (!location) return undefined;
  const lower = location.toLowerCase();
  // Fast path: check the city map first (handles "Kasarani, Nairobi" → KE).
  for (const [city, cc] of Object.entries(CITY_TO_COUNTRY)) {
    if (lower.includes(city)) {
      const country = ALL_COUNTRIES.find((c) => c.code === cc);
      if (country) return country;
    }
  }
  // Split on commas / semicolons / pipes and try each segment, longest first
  // so "Mombasa Road, Nairobi, Kenya" prefers the most specific match.
  const segments = location
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const seg of segments) {
    const direct = getCountryByName(seg);
    if (direct) return direct;
    // Also try matching a country name that appears as a substring
    // (e.g. "Nairobi Kenya" without a separator, or "Mombasa Road Kenya").
    const contained = ALL_COUNTRIES.find((c) =>
      seg.toLowerCase().includes(c.name.toLowerCase()),
    );
    if (contained) return contained;
  }
  return undefined;
}

// ─── Get payment methods for a country ───
export function getCountryPaymentMethods(countryCode: string) {
  const config = WORLD_PAYMENT_CONFIGS[countryCode.toUpperCase()];
  if (!config) return { banks: [], digitalWallets: [], cards: [], methods: [] };
  const banks = config.paymentMethods
    .filter((m) => m.type === "bank")
    .map((m) => m.name);
  const digitalWallets = config.paymentMethods
    .filter((m) => m.type === "digital_wallet")
    .map((m) => m.name);
  const cards = config.paymentMethods
    .filter((m) => m.type === "card")
    .map((m) => m.name);
  return { banks, digitalWallets, cards, methods: config.paymentMethods };
}

// ─── Exchange rates to USD (simplified) ───
function getExchangeRate(currency: string): number {
  const rates: Record<string, number> = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    AUD: 1.52,
    JPY: 150,
    CHF: 0.88,
    KES: 129,
    UGX: 3800,
    TZS: 2530,
    NGN: 900,
    ZAR: 18.9,
    GHS: 12.5,
    RWF: 1300,
    ETB: 56,
    MAD: 10.1,
    DZD: 135,
    XOF: 605,
    XAF: 605,
    CVE: 102,
    GMD: 63,
    MGA: 4550,
    MRU: 40,
    MZN: 64,
    NAD: 18.9,
    SZL: 18.9,
    SDG: 600,
    SOS: 571,
    SSP: 13000,
    TND: 3.11,
    CNY: 7.19,
    INR: 83.1,
    PKR: 278,
    LKR: 300,
    IDR: 15600,
    PHP: 56,
    THB: 35.5,
    MYR: 4.75,
    VND: 24500,
    KRW: 1330,
    SGD: 1.34,
    HKD: 7.82,
    NZD: 1.61,
    BRL: 4.97,
    MXN: 17.1,
    ARS: 350,
    COP: 3920,
    CLP: 880,
    PEN: 3.73,
    UYU: 39.2,
    AED: 3.67,
    SAR: 3.75,
    QAR: 3.64,
    KWD: 0.31,
    BHD: 0.38,
    OMR: 0.38,
    RUB: 91,
    UAH: 38,
    PLN: 4,
    CZK: 23.2,
    HUF: 360,
    RON: 4.6,
    SEK: 10.4,
    NOK: 10.5,
    DKK: 6.9,
    ILS: 3.7,
    TRY: 31,
    EGP: 31,
    IRR: 42000,
    IQD: 1310,
    LBP: 89500,
    SYP: 13000,
    YER: 250,
    ALL: 95,
    MKD: 56.8,
    BAM: 1.8,
    HRK: 7,
    RSD: 108,
    BGN: 1.8,
    GEL: 2.7,
    AMD: 405,
    AZN: 1.7,
    KZT: 500,
    TMT: 3.5,
    UZS: 12500,
    TJS: 11,
    KGS: 89,
    MNT: 3400,
    LAK: 20700,
    MMK: 2100,
    KHR: 4100,
    FJD: 2.22,
    PGK: 3.7,
    SBD: 8.4,
    VUV: 120,
    WST: 2.74,
    TOP: 2.36,
    JMD: 156,
    TTD: 6.76,
    XCD: 2.7,
    HTG: 132,
    DOP: 59,
    GTQ: 7.82,
    HNL: 24.7,
    NIO: 36.6,
    CRC: 514,
    PAB: 1,
    BZD: 2,
    CUP: 24,
    ANG: 1.79,
    AWG: 1.79,
    BMD: 1,
    PYG: 7300,
    BOB: 6.91,
    VEF: 36.2,
    GYD: 209,
    SRD: 38,
    XPF: 109,
    BND: 1.34,
    MOP: 8,
    TWD: 31.3,
    AFN: 71,
    BTN: 83.1,
    NPR: 133,
    SCR: 13.5,
    MVR: 15.4,
    GNF: 8600,
    SLL: 22.5,
    LRD: 189,
    DJF: 178,
    ERN: 15,
    ZWL: 5800,
    BWP: 13.6,
    ZMW: 26,
  };
  return rates[currency] || 1;
}

// ─── Payment gateways by country ───
export function getCountryGateways(countryCode: string): string[] {
  const cc = countryCode.toUpperCase();
  // African markets
  if (
    [
      "KE",
      "TZ",
      "UG",
      "RW",
      "GH",
      "NG",
      "ZA",
      "ET",
      "MW",
      "ZM",
      "ZW",
      "MZ",
      "BI",
      "BF",
      "ML",
      "SN",
      "CI",
      "TG",
      "BJ",
      "CM",
      "CD",
      "CG",
      "GA",
      "GQ",
      "ST",
      "SL",
      "LR",
      "GN",
      "GW",
      "MR",
      "NE",
      "TD",
      "CF",
      "SO",
      "ER",
      "DJ",
      "KM",
      "MG",
      "MU",
      "SC",
      "LS",
      "SZ",
      "BW",
      "NA",
      "AO",
    ].includes(cc)
  ) {
    return [
      "M-PESA",
      "Flutterwave",
      "Paystack",
      "MTN MoMo",
      "Airtel Money",
      "Card (Visa/Mastercard)",
      "PayPal",
      "Stripe",
    ];
  }
  // North America / Western Europe / Oceania
  if (
    ["US", "CA", "GB", "AU", "NZ", "IE", "SG", "HK", "JP", "KR"].includes(cc)
  ) {
    return [
      "Stripe",
      "PayPal",
      "Apple Pay",
      "Card (Visa/Mastercard)",
      "Google Pay",
    ];
  }
  // Eurozone
  if (
    [
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "BE",
      "AT",
      "PT",
      "GR",
      "FI",
      "SE",
      "NO",
      "DK",
      "LU",
      "SK",
      "SI",
      "EE",
      "LV",
      "LT",
      "MT",
      "CY",
      "CH",
      "IS",
      "LI",
      "MC",
      "AD",
      "SM",
      "VA",
    ].includes(cc)
  ) {
    return ["Stripe", "PayPal", "SEPA", "Card (Visa/Mastercard)", "Apple Pay"];
  }
  // South Asia
  if (["IN", "PK", "LK", "NP", "BT", "MV", "BD"].includes(cc)) {
    return [
      "Razorpay",
      "Paytm",
      "Stripe",
      "PayPal",
      "UPI",
      "Card (Visa/Mastercard)",
    ];
  }
  // Southeast Asia
  if (
    ["TH", "MY", "VN", "ID", "PH", "BN", "KH", "LA", "MM", "TW", "MO"].includes(
      cc,
    )
  ) {
    return ["Stripe", "PayPal", "Alipay", "Card (Visa/Mastercard)"];
  }
  // Middle East
  if (
    [
      "AE",
      "SA",
      "QA",
      "KW",
      "BH",
      "OM",
      "JO",
      "LB",
      "IQ",
      "SY",
      "YE",
      "IL",
      "PS",
      "TR",
      "IR",
    ].includes(cc)
  ) {
    return ["Stripe", "PayPal", "Telr", "Card (Visa/Mastercard)"];
  }
  // Latin America
  if (
    [
      "BR",
      "MX",
      "AR",
      "CL",
      "CO",
      "PE",
      "UY",
      "VE",
      "PY",
      "BO",
      "EC",
      "GY",
      "SR",
      "CR",
      "PA",
      "GT",
      "HN",
      "SV",
      "NI",
      "BZ",
      "JM",
      "TT",
      "BB",
      "BS",
      "DO",
      "HT",
      "CU",
      "PR",
    ].includes(cc)
  ) {
    return ["Stripe", "PayPal", "Mercado Pago", "Card (Visa/Mastercard)"];
  }
  // Eastern Europe / Central Asia
  if (
    [
      "RU",
      "BY",
      "KZ",
      "AM",
      "GE",
      "AZ",
      "MD",
      "UA",
      "UZ",
      "KG",
      "TJ",
      "TM",
      "MN",
      "AL",
      "MK",
      "BA",
      "RS",
      "ME",
      "XK",
      "BG",
      "HR",
      "RO",
      "CZ",
      "HU",
      "PL",
      "SK",
      "SI",
      "LT",
      "LV",
      "EE",
    ].includes(cc)
  ) {
    return ["Stripe", "PayPal", "Card (Visa/Mastercard)"];
  }
  // China
  if (cc === "CN")
    return ["Alipay", "WeChat Pay", "Stripe", "Card (Visa/Mastercard)"];
  // Default
  return ["Stripe", "PayPal", "Flutterwave", "Card (Visa/Mastercard)"];
}

// ─── Base prices in USD per tier ───
const USD_BASE_PRICES: Record<string, number> = {
  daily: 2,
  weekly: 7,
  monthly: 15,
  yearly: 150,
  lifetime: 599,
};

// ─── Tier multipliers ───
const TIER_MULTIPLIERS: Record<string, number> = {
  daily: 1,
  weekly: 4,
  monthly: 10,
  yearly: 100,
  lifetime: 400,
};

type TierSlug = "daily" | "weekly" | "monthly" | "yearly" | "lifetime";

// ─── Generate regional prices for ALL countries dynamically ───
export function generateRegionalPricesForAllCountries(): {
  tierId: TierSlug;
  currency: string;
  price: number;
  regionCodes: string[];
  paymentGateways: string[];
}[] {
  const prices: {
    tierId: TierSlug;
    currency: string;
    price: number;
    regionCodes: string[];
    paymentGateways: string[];
  }[] = [];

  Object.entries(WORLD_PAYMENT_CONFIGS).forEach(([code, config]) => {
    const currency = config.defaultCurrency;
    const rate = getExchangeRate(currency);
    const gateways = getCountryGateways(code);

    (Object.keys(USD_BASE_PRICES) as TierSlug[]).forEach((tierId) => {
      const usdPrice = USD_BASE_PRICES[tierId];
      const mult = TIER_MULTIPLIERS[tierId] || 1;
      const localPrice = Math.round(
        (usdPrice * rate * mult) / TIER_MULTIPLIERS.daily,
      );
      const nicePrice =
        localPrice < 100
          ? Math.round(localPrice / 5) * 5
          : localPrice < 10000
            ? Math.round(localPrice / 100) * 100
            : Math.round(localPrice / 1000) * 1000;

      prices.push({
        tierId,
        currency,
        price: Math.max(nicePrice, 1),
        regionCodes: [code],
        paymentGateways: gateways,
      });
    });
  });

  return prices;
}

// ─── Country-specific default station names ───
export function getDefaultStationForCountry(countryCode: string): string {
  const config = WORLD_PAYMENT_CONFIGS[countryCode.toUpperCase()];
  return config ? `${config.countryName} Central Station` : "Fuel Station";
}

// ─── Get all currencies used worldwide ───
export function getAllCurrencies(): string[] {
  const currencies = new Set<string>();
  Object.values(WORLD_PAYMENT_CONFIGS).forEach((c) =>
    currencies.add(c.defaultCurrency),
  );
  return Array.from(currencies).sort();
}
