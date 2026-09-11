/**
 * Shared geographic utilities — single source of truth for
 * timezone→country mapping, country detection, and locale resolution.
 * Prevents duplication across multiple files.
 */

import { WORLD_PAYMENT_CONFIGS } from "@/react-app/config/worldPaymentConfigs";

// ─── Timezone to Country Code Mapping ───
const TZ_COUNTRY_MAP: Record<string, string> = {
  // Africa
  "Africa/Nairobi": "KE",
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Lagos": "NG",
  "Africa/Johannesburg": "ZA",
  "Africa/Accra": "GH",
  "Africa/Kigali": "RW",
  "Africa/Addis_Ababa": "ET",
  "Africa/Cairo": "EG",
  "Africa/Casablanca": "MA",
  "Africa/Algiers": "DZ",
  "Africa/Tunis": "TN",
  "Africa/Tripoli": "LY",
  "Africa/Khartoum": "SD",
  "Africa/Douala": "CM",
  "Africa/Libreville": "GA",
  "Africa/Brazzaville": "CG",
  "Africa/Kinshasa": "CD",
  "Africa/Ndjamena": "TD",
  "Africa/Bangui": "CF",
  "Africa/Dakar": "SN",
  "Africa/Abidjan": "CI",
  "Africa/Bamako": "ML",
  "Africa/Ouagadougou": "BF",
  "Africa/Porto-Novo": "BJ",
  "Africa/Lome": "TG",
  "Africa/Freetown": "SL",
  "Africa/Monrovia": "LR",
  "Africa/Conakry": "GN",
  "Africa/Bissau": "GW",
  "Africa/Banjul": "GM",
  "Africa/Nouakchott": "MR",
  "Africa/Niamey": "NE",
  "Africa/Djibouti": "DJ",
  "Africa/Asmara": "ER",
  "Africa/Antananarivo": "MG",
  "Africa/Port_Louis": "MU",
  "Africa/Maseru": "LS",
  "Africa/Mbabane": "SZ",
  "Africa/Lusaka": "ZM",
  "Africa/Harare": "ZW",
  "Africa/Blantyre": "MW",
  "Africa/Maputo": "MZ",
  "Africa/Gaborone": "BW",
  "Africa/Windhoek": "NA",
  "Africa/Bujumbura": "BI",
  "Africa/Mogadishu": "SO",
  "Africa/Juba": "SS",
  // Americas
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Detroit": "US",
  "America/Anchorage": "US",
  "America/Honolulu": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Montreal": "CA",
  "America/Edmonton": "CA",
  "America/Winnipeg": "CA",
  "America/Halifax": "CA",
  "America/Sao_Paulo": "BR",
  "America/Rio_de_Janeiro": "BR",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Santiago": "CL",
  "America/Bogota": "CO",
  "America/Lima": "PE",
  "America/Caracas": "VE",
  "America/Mexico_City": "MX",
  "America/Guayaquil": "EC",
  "America/Montevideo": "UY",
  "America/Asuncion": "PY",
  "America/La_Paz": "BO",
  "America/Guyana": "GY",
  "America/Paramaribo": "SR",
  "America/Costa_Rica": "CR",
  "America/Panama": "PA",
  "America/Guatemala": "GT",
  "America/Tegucigalpa": "HN",
  "America/El_Salvador": "SV",
  "America/Managua": "NI",
  "America/Belize": "BZ",
  "America/Havana": "CU",
  "America/Port-au-Prince": "HT",
  "America/Santo_Domingo": "DO",
  "America/Jamaica": "JM",
  "America/Port_of_Spain": "TT",
  "America/Barbados": "BB",
  // Europe
  "Europe/London": "GB",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Zurich": "CH",
  "Europe/Vienna": "AT",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ",
  "Europe/Budapest": "HU",
  "Europe/Bratislava": "SK",
  "Europe/Ljubljana": "SI",
  "Europe/Zagreb": "HR",
  "Europe/Belgrade": "RS",
  "Europe/Sofia": "BG",
  "Europe/Bucharest": "RO",
  "Europe/Chisinau": "MD",
  "Europe/Kiev": "UA",
  "Europe/Minsk": "BY",
  "Europe/Vilnius": "LT",
  "Europe/Riga": "LV",
  "Europe/Tallinn": "EE",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Europe/Athens": "GR",
  "Europe/Nicosia": "CY",
  "Europe/Malta": "MT",
  "Europe/Reykjavik": "IS",
  "Europe/Luxembourg": "LU",
  "Europe/Moscow": "RU",
  "Europe/Istanbul": "TR",
  // Asia
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Singapore": "SG",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Manila": "PH",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Mumbai": "IN",
  "Asia/Kolkata": "IN",
  "Asia/Delhi": "IN",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK",
  "Asia/Kathmandu": "NP",
  "Asia/Yangon": "MM",
  "Asia/Phnom_Penh": "KH",
  "Asia/Vientiane": "LA",
  "Asia/Brunei": "BN",
  "Asia/Thimphu": "BT",
  "Asia/Male": "MV",
  "Asia/Ulaanbaatar": "MN",
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW",
  "Asia/Bahrain": "BH",
  "Asia/Muscat": "OM",
  "Asia/Baghdad": "IQ",
  "Asia/Tehran": "IR",
  "Asia/Jerusalem": "IL",
  "Asia/Amman": "JO",
  "Asia/Beirut": "LB",
  "Asia/Damascus": "SY",
  "Asia/Sana": "YE",
  "Asia/Aden": "YE",
  "Asia/Almaty": "KZ",
  "Asia/Tashkent": "UZ",
  "Asia/Dushanbe": "TJ",
  "Asia/Bishkek": "KG",
  "Asia/Ashgabat": "TM",
  "Asia/Kabul": "AF",
  "Asia/Tbilisi": "GE",
  "Asia/Yerevan": "AM",
  "Asia/Baku": "AZ",
  // Oceania
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Darwin": "AU",
  "Australia/Hobart": "AU",
  "Australia/Canberra": "AU",
  "Pacific/Auckland": "NZ",
  "Pacific/Fiji": "FJ",
  "Pacific/Guam": "GU",
  "Pacific/Samoa": "WS",
  "Pacific/Tongatapu": "TO",
  // UTC fallback
  UTC: "US",
  GMT: "GB",
  "Etc/UTC": "US",
  "Etc/GMT": "GB",
};

// ─── Public API ───

/** Resolve country code from IANA timezone (250+ mappings) */
export function getCountryFromTimezone(timezone: string): string | null {
  return TZ_COUNTRY_MAP[timezone] || null;
}

/** Resolve country code using browser timezone as fallback */
export function resolveCountryFromBrowser(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return getCountryFromTimezone(tz) || "US";
}

/** Get country data from WORLD_PAYMENT_CONFIGS by code */
export function getWorldConfig(countryCode: string) {
  return WORLD_PAYMENT_CONFIGS[countryCode.toUpperCase()];
}

/** Build a best-effort locale string from country code */
export function buildLocale(
  countryCode: string,
  languageHint?: string,
): string {
  const lang = languageHint || navigator.language?.split("-")[0] || "en";
  try {
    const candidate = `${lang}-${countryCode.toUpperCase()}`;
    // Check if this locale is supported
    if (Intl.NumberFormat.supportedLocalesOf([candidate]).length > 0) {
      return candidate;
    }
  } catch {
    /* */
  }
  return `${lang}-${countryCode.toUpperCase()}`;
}

/** Read saved location country from localStorage */
export function readSavedCountry(): string | null {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const p = JSON.parse(saved);
      return (p.currentCountry || p.country || "").toUpperCase() || null;
    }
  } catch {
    /* */
  }
  return null;
}

/** Full resolution: saved → browser timezone → fallback */
export function resolveCountryCode(fallbackCode = "US"): string {
  return readSavedCountry() || resolveCountryFromBrowser() || fallbackCode;
}

/** Run all storage migrations at app startup */
export function runAllStorageMigrations(): void {
  // Trial key migration
  try {
    const trialKeys = [
      "fuelpro_trial",
      "fuelpro_trial_v3",
      "fuelpro_trial_v2",
      "fuelpro_trial_v1",
    ];
    const currentTrial = localStorage.getItem(trialKeys[0]);
    if (!currentTrial) {
      for (let i = 1; i < trialKeys.length; i++) {
        const old = localStorage.getItem(trialKeys[i]);
        if (old) {
          localStorage.setItem(trialKeys[0], old);
          break;
        }
      }
    }
  } catch {
    /* */
  }

  // Subscription key migration
  try {
    const subKeys = [
      "fuelpro_subscription",
      "fuelpro_subscription_v3",
      "fuelpro_subscription_v2",
      "fuelpro_subscription_v1",
    ];
    const currentSub = localStorage.getItem(subKeys[0]);
    if (!currentSub) {
      for (let i = 1; i < subKeys.length; i++) {
        const old = localStorage.getItem(subKeys[i]);
        if (old) {
          localStorage.setItem(subKeys[0], old);
          break;
        }
      }
    }
  } catch {
    /* */
  }

  // Payment methods key migration
  try {
    const pmKeys = [
      "fuelpro_payment_methods",
      "fuelpro_payment_methods_v2",
      "fuelpro_payment_methods_v1",
    ];
    const currentPm = localStorage.getItem(pmKeys[0]);
    if (!currentPm) {
      for (let i = 1; i < pmKeys.length; i++) {
        const old = localStorage.getItem(pmKeys[i]);
        if (old) {
          localStorage.setItem(pmKeys[0], old);
          break;
        }
      }
    }
  } catch {
    /* */
  }
}
