// src/react-app/lib/station-stats.ts
// Station analytics helpers: revenue, counts, currency, relative time.
// Defensive by design — station.data is a free-form blob and must never crash the UI.

import { getCurrencySymbol as resolveCurrencySymbol } from "./currency";

export type StationStatus = "active" | "inactive" | "maintenance";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  KE: "KSh",
  TZ: "TSh",
  UG: "USh",
  NG: "₦",
  ZA: "R",
  GH: "GH₵",
  RW: "RF",
  ET: "Br",
  US: "$",
  GB: "£",
  EU: "€",
  IN: "₹",
  JP: "¥",
  CN: "¥",
  BR: "R$",
  AU: "$",
  CA: "$",
};

export function getCurrencySymbol(): string {
  try {
    // Check both the current location cache key (fuelpro_user_location, written
    // by FuelPriceService) and the legacy fuelpro_location_country key.
    for (const key of ["fuelpro_user_location", "fuelpro_location_country"]) {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc = String(
          parsed?.countryCode ||
            parsed?.currentCountry ||
            parsed?.country ||
            "",
        ).toUpperCase();
        if (cc && CURRENCY_BY_COUNTRY[cc]) return CURRENCY_BY_COUNTRY[cc];
      }
    }
  } catch {
    /* ignore */
  }
  return resolveCurrencySymbol();
}

export function formatMoney(amount: number): string {
  const symbol = getCurrencySymbol();
  if (!isFinite(amount)) return `${symbol} 0`;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${symbol} ${(amount / 1_000_000).toFixed(2)}M`;
  return `${symbol} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function toNumber(v: unknown): number {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : 0;
}

/** Extract a flat list of sale-like entries from free-form station data. */
function extractSaleEntries(data: any): any[] {
  const out: any[] = [];
  if (!data) return out;
  try {
    const sh = data.salesHistory;
    if (Array.isArray(sh)) out.push(...sh);
    else if (sh && typeof sh === "object") {
      for (const key of Object.keys(sh)) {
        const v = sh[key];
        if (Array.isArray(v)) out.push(...v);
        else if (v && typeof v === "object") out.push(v);
      }
    }
    if (Array.isArray(data.sales)) out.push(...data.sales);
  } catch {
    /* ignore */
  }
  return out;
}

function entryAmount(e: any): number {
  if (!e || typeof e !== "object") return 0;
  if (e.total != null) return toNumber(e.total);
  if (e.totalAmount != null) return toNumber(e.totalAmount);
  if (e.amount != null) return toNumber(e.amount);
  const qty = toNumber(e.quantity ?? e.litres ?? e.liters);
  const price = toNumber(e.pricePerLiter ?? e.price ?? e.rate);
  return qty * price;
}

function entryTimestamp(e: any): number | null {
  const raw = e?.timestamp ?? e?.date ?? e?.createdAt ?? e?.time;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return isFinite(t) ? t : null;
}

/** Total revenue recorded in a station's data blob. */
export function stationTotalRevenue(data: any): number {
  try {
    if (data && typeof data.totalRevenue === "number") return data.totalRevenue;
    let sum = 0;
    for (const e of extractSaleEntries(data)) sum += entryAmount(e);
    return sum;
  } catch {
    return 0;
  }
}

/** Revenue recorded since a timestamp (falls back to total when entries lack dates). */
export function stationRevenueSince(data: any, since: number): number {
  try {
    const entries = extractSaleEntries(data);
    if (entries.length === 0) return 0;
    let sum = 0;
    let sawDate = false;
    for (const e of entries) {
      const t = entryTimestamp(e);
      if (t != null) {
        sawDate = true;
        if (t >= since) sum += entryAmount(e);
      }
    }
    return sawDate ? sum : stationTotalRevenue(data);
  } catch {
    return 0;
  }
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function stationSalesCount(data: any): number {
  try {
    return extractSaleEntries(data).length;
  } catch {
    return 0;
  }
}

export function stationStatus(data: any): StationStatus {
  const s = String(data?.status || "active").toLowerCase();
  if (s === "inactive" || s === "maintenance") return s;
  return "active";
}

export function relativeTime(iso: string | number | null | undefined): string {
  try {
    if (!iso) return "never";
    const t = typeof iso === "number" ? iso : new Date(iso).getTime();
    if (!isFinite(t)) return "unknown";
    const diff = Date.now() - t;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(t).toLocaleDateString();
  } catch {
    return "unknown";
  }
}

export function initialsOf(name: string): string {
  try {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  } catch {
    return "?";
  }
}

const AVATAR_COLORS = [
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-lime-600",
];

export function avatarColor(seed: string): string {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function downloadJson(filename: string, payload: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error("downloadJson failed:", e);
  }
}
