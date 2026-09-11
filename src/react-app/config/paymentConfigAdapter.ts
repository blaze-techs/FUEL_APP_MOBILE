import {
  WORLD_PAYMENT_CONFIGS,
  CountryPaymentConfig,
} from "./worldPaymentConfigs";

// ─── Flag emoji generator ───
const FLAG_OFFSET = 0x1f1e6;
const A_CODE = 0x41;

function getFlagEmoji(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return "🏳️";
  const cp1 = code.charCodeAt(0);
  const cp2 = code.charCodeAt(1);
  if (cp1 < 0x41 || cp1 > 0x5a || cp2 < 0x41 || cp2 > 0x5a) return "🏳️";
  return String.fromCodePoint(
    FLAG_OFFSET + (cp1 - A_CODE),
    FLAG_OFFSET + (cp2 - A_CODE),
  );
}

// ─── Legacy shape expected by PaymentMethodsSection.tsx ───
export interface LegacyCountryConfig {
  name: string;
  currency: string;
  flag: string;
  banks: string[];
  mobileMoney: string[];
  additional: string[];
}

// ─── Convert new format → legacy format ───
function adaptCountryConfig(config: CountryPaymentConfig): LegacyCountryConfig {
  const banks: string[] = [];
  const mobileMoney: string[] = [];
  const additional: string[] = [];

  for (const method of config.paymentMethods) {
    if (!method.isActive) continue;
    switch (method.type) {
      case "bank":
        banks.push(method.name);
        break;
      case "digital_wallet":
        mobileMoney.push(method.name);
        break;
      case "card":
      case "local_transfer":
      case "cash":
      case "other":
      default:
        additional.push(method.name);
        break;
    }
  }

  return {
    name: config.countryName,
    currency: config.defaultCurrency,
    flag: getFlagEmoji(config.countryCode),
    banks,
    mobileMoney,
    additional,
  };
}

// ─── Build COUNTRY_CONFIGS in legacy Record shape ───
export const COUNTRY_CONFIGS: Record<string, LegacyCountryConfig> = (() => {
  const result: Record<string, LegacyCountryConfig> = {};
  for (const [code, config] of Object.entries(WORLD_PAYMENT_CONFIGS)) {
    result[code] = adaptCountryConfig(config);
  }
  return result;
})();

// ─── Helper: get sorted country codes for selector display ───
export const SORTED_COUNTRY_CODES = Object.keys(COUNTRY_CONFIGS).sort((a, b) =>
  COUNTRY_CONFIGS[a].name.localeCompare(COUNTRY_CONFIGS[b].name),
);

// ─── Get country config safely ───
export function getCountryConfig(
  code: string,
): LegacyCountryConfig | undefined {
  return COUNTRY_CONFIGS[code.toUpperCase()];
}
