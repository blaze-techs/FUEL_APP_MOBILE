// packages/utils/src/formatters.ts
// Dynamic Formatting & Compliance Adapter for all 250+ countries

import { WORLD_PAYMENT_CONFIGS } from "@/react-app/config/worldPaymentConfigs";
// Unified tax rates - single source of truth
import { getVATRate } from "@/react-app/config/pricing";

// ─── Currency formatter with Intl.NumberFormat ───
export function formatCurrency(
  amount: number,
  currency: string,
  locale?: string,
): string {
  const resolvedLocale = resolveLocale(currency, locale);
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for unsupported currencies
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ─── Short currency (no decimals for large amounts) ───
export function formatCurrencyShort(amount: number, currency: string): string {
  const locale = resolveLocale(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

// ─── Compact number (1K, 1M, 1B) ───
export function formatCompactNumber(num: number, locale?: string): string {
  const l = locale || getCurrentLocale();
  try {
    return new Intl.NumberFormat(l, {
      notation: "compact",
      compactDisplay: "short",
    }).format(num);
  } catch {
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return String(num);
  }
}

// ─── Date formatting with timezone ───
export function formatLocalDate(
  date: Date | string,
  timezone?: string,
  locale?: string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const tz = timezone || getCurrentTimezone();
  const l = locale || getCurrentLocale();
  try {
    return new Intl.DateTimeFormat(l, {
      timeZone: tz,
      dateStyle: "medium",
    }).format(d);
  } catch {
    return d.toLocaleDateString(l);
  }
}

// ─── Date + time formatting ───
export function formatLocalDateTime(
  date: Date | string,
  timezone?: string,
  locale?: string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const tz = timezone || getCurrentTimezone();
  const l = locale || getCurrentLocale();
  try {
    return new Intl.DateTimeFormat(l, {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toLocaleString(l);
  }
}

// ─── Time formatting ───
export function formatLocalTime(
  date: Date | string,
  timezone?: string,
  locale?: string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const tz = timezone || getCurrentTimezone();
  const l = locale || getCurrentLocale();
  try {
    return new Intl.DateTimeFormat(l, {
      timeZone: tz,
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toLocaleTimeString(l);
  }
}

// ─── Relative time (e.g. "2 hours ago") ───
export function formatRelativeTime(
  date: Date | string,
  locale?: string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || getCurrentLocale();
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hr ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
  return formatLocalDate(d, undefined, l);
}

// ─── Number formatting ───
export function formatNumber(num: number, locale?: string): string {
  const l = locale || getCurrentLocale();
  try {
    return new Intl.NumberFormat(l).format(num);
  } catch {
    return num.toLocaleString();
  }
}

// ─── Percentage formatting ───
export function formatPercent(value: number, locale?: string): string {
  const l = locale || getCurrentLocale();
  try {
    return new Intl.NumberFormat(l, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${(value * 100).toFixed(1)}%`;
  }
}

// ─── Tax rate lookup - uses unified tax rates from config/pricing.ts ───
export function getTaxRate(country: string): number {
  // Use unified tax rates from config/pricing.ts
  return getVATRate(country.toUpperCase());
}

// ─── Calculate price with tax ───
export function calculateWithTax(
  amount: number,
  country: string,
): { subtotal: number; tax: number; total: number } {
  const rate = getTaxRate(country);
  const tax = amount * rate;
  return { subtotal: amount, tax, total: amount + tax };
}

// ─── Resolve locale from currency or country ───
function resolveLocale(currency: string, override?: string): string {
  if (override) return override;
  const map: Record<string, string> = {
    KES: "en-KE",
    UGX: "en-UG",
    TZS: "en-TZ",
    NGN: "en-NG",
    ZAR: "en-ZA",
    GHS: "en-GH",
    RWF: "en-RW",
    ETB: "en-ET",
    USD: "en-US",
    EUR: "en-DE",
    GBP: "en-GB",
    CAD: "en-CA",
    AUD: "en-AU",
    JPY: "ja-JP",
    CNY: "zh-CN",
    INR: "en-IN",
    BRL: "pt-BR",
    MXN: "es-MX",
  };
  return map[currency] || "en-US";
}

// ─── Get current locale from localStorage or default ───
function getCurrentLocale(): string {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const parsed = JSON.parse(saved);
      const cc = parsed.currentCountry || parsed.country;
      if (cc) {
        const config = WORLD_PAYMENT_CONFIGS[cc.toUpperCase()];
        if (config) return resolveLocale(config.defaultCurrency);
      }
    }
  } catch {
    /* ignore */
  }
  return "en-US";
}

// ─── Get current timezone ───
function getCurrentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// ─── Format liters (fuel volume) ───
export function formatLiters(liters: number): string {
  if (liters >= 1000000) return `${(liters / 1000000).toFixed(2)} ML`;
  if (liters >= 1000) return `${(liters / 1000).toFixed(2)} kL`;
  return `${liters.toFixed(2)} L`;
}
