/**
 * forecourt-features.ts — shared types + cloud keys + helpers for the
 * competitor-derived forecourt management features:
 *  - Tank Monitor (Shell eVMI / Crone SmartFuel / Advatech ATG)
 *  - Day Book cash reconciliation (Codelab FMS)
 *  - Nozzle & Attendant analysis (Codelab FMS)
 *  - Fleet & Fuel Cards (Shell Fleet Solutions / Pesapal)
 *  - Customer Segments & Events (Veira CRM / Codelab SMS events)
 *  - Forecourt Hardware registry (Advatech AdvaForecourt / Livetrac PTS)
 *
 * All state is cloud-synced via app_kv scoped row ids (RLS by owner_id),
 * using the established cloudStorageService / useCloudKV pattern.
 */

export const CLOUD_KEYS = {
  tankReadings: "tank_monitor_readings",
  daybook: "daybook_entries",
  fleetCards: "fleet_cards",
  fleetUsage: "fleet_card_usage",
  forecourtHardware: "forecourt_hardware",
  // Round 2
  tankCalibration: "tank_calibration",
  priceSchedules: "price_schedules",
  promoRules: "loyalty_promo_rules",
  commissionSettings: "commission_settings",
} as const;

/* ------------------------------------------------------------------ */
/* Tank Monitor (wet stock)                                            */
/* ------------------------------------------------------------------ */

export interface TankReading {
  id: string;
  fuelType: string;
  label: string;
  date: string;
  /** ATG/dip-measured level in litres */
  measuredLevel: number;
  /** Product temperature in °C (optional) */
  temperature?: number;
  /** Free-water phase in millimetres (optional) */
  waterMm?: number;
  /** Book (expected) level in litres at the time of reading */
  expectedLevel: number;
  /** measured - expected */
  variance: number;
  /** (variance / expected) * 100 */
  variancePct: number;
  /** ok | variance | water | low */
  status: "ok" | "variance" | "water" | "low";
}

export const WATER_ALERT_MM = 5;
export const VARIANCE_ALERT_PCT = 2;
export const TEMP_MIN = 0;
export const TEMP_MAX = 50;

export function classifyReading(
  measured: number,
  expected: number,
  waterMm?: number,
): { status: TankReading["status"]; variance: number; variancePct: number } {
  const variance = measured - expected;
  const variancePct = expected > 0 ? (variance / expected) * 100 : 0;
  if ((waterMm ?? 0) > WATER_ALERT_MM)
    return { status: "water", variance, variancePct };
  if (Math.abs(variancePct) > VARIANCE_ALERT_PCT)
    return { status: "variance", variance, variancePct };
  if (measured <= 0) return { status: "low", variance, variancePct };
  return { status: "ok", variance, variancePct };
}

/* ------------------------------------------------------------------ */
/* Tank calibration (dip / ullage / strapping chart math) — round 2    */
/* ------------------------------------------------------------------ */

export interface TankCalibration {
  id: string;
  fuelType: string;
  label: string;
  /** total geometric capacity of the tank (litres) */
  capacity: number;
  /** tank inner diameter in mm (horizontal cylinder model) */
  diameterMm: number;
  /** tank length in mm (informational, stored for audit) */
  lengthMm: number;
}

export function cylinderVolumeFraction(
  dipMm: number,
  diameterMm: number,
): number {
  if (diameterMm <= 0 || dipMm < 0) return 0;
  if (dipMm >= diameterMm) return 1;
  const x = 1 - (2 * dipMm) / diameterMm; // 1 at empty, -1 at full
  const theta = Math.acos(Math.max(-1, Math.min(1, x)));
  const frac = (theta - x * Math.sqrt(Math.max(0, 1 - x * x))) / Math.PI;
  return Math.max(0, Math.min(1, frac));
}

export function dipToVolume(
  dipMm: number,
  diameterMm: number,
  capacity: number,
): number {
  return capacity * cylinderVolumeFraction(dipMm, diameterMm);
}

export function ullage(
  dipMm: number,
  diameterMm: number,
  capacity: number,
): number {
  return capacity - dipToVolume(dipMm, diameterMm, capacity);
}

/* ------------------------------------------------------------------ */
/* Price scheduling (Shell / Livetrac price-change calendars)  — rnd 2 */
/* ------------------------------------------------------------------ */

export interface PriceSchedule {
  id: string;
  fuelType: string;
  label: string;
  price: number;
  /** ISO date when the change should activate */
  effectiveOn: string;
  status: "pending" | "applied" | "cancelled";
  createdAt: string;
}

export function marginInfo(price: number, cost: number) {
  const margin = price - cost;
  const marginPct =
    price > 0 && isFinite(price) && isFinite(cost) ? (margin / price) * 100 : 0;
  return { margin, marginPct: isFinite(marginPct) ? marginPct : 0 };
}

export const LOW_MARGIN_PCT = 2;

/* ------------------------------------------------------------------ */
/* Loyalty promotions (Veira / BPme / Petro-Points) — round 2          */
/* ------------------------------------------------------------------ */

export interface PromoRule {
  id: string;
  label: string;
  /** points earned per litre for the matched fuel ("" = all fuels) */
  fuelType: string;
  pointsPerLitre: number;
  /** additional multiplier window (happy hours / promo days) */
  multiplier: number;
  /** ISO window boundaries; optional ("" = no window limit) */
  fromDate: string;
  toDate: string;
  active: boolean;
}

export interface LoyaltySettings {
  /** fallback earn rate when no promo/rule applies */
  basePointsPerLitre: number;
  /** points monetary value: how many points = 1 unit of currency */
  redemptionPointsPerCurrency: number;
  /** points needed to redeem one unit of currency */
  redemptionRate: number;
  rules: PromoRule[];
}

export function bestRuleFor(
  rules: PromoRule[],
  fuelType: string,
  dateIso: string,
): PromoRule | null {
  let best: PromoRule | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.fuelType && r.fuelType !== fuelType) continue;
    if (r.fromDate && dateIso < r.fromDate) continue;
    if (r.toDate && dateIso > r.toDate) continue;
    if (!best || r.pointsPerLitre > best.pointsPerLitre) best = r;
  }
  return best;
}

export function earnForLitres(
  litres: number,
  canonical: string,
  settings: LoyaltySettings,
  dateIso: string,
): { points: number; via: string } {
  const rule = bestRuleFor(settings.rules, canonical, dateIso);
  const rate = rule
    ? rule.pointsPerLitre * (rule.multiplier || 1)
    : settings.basePointsPerLitre;
  const points = litres * rate;
  return {
    points: isFinite(points) ? points : 0,
    via: rule ? `promo: ${rule.label}` : "base rate",
  };
}

/* ------------------------------------------------------------------ */
/* Attendant commissions (Codelab FMS style) — round 2                 */
/* ------------------------------------------------------------------ */

export interface CommissionSetting {
  id: string;
  /** litres per pump-sale price basis → commission per litre */
  ratePerLitre: number;
  /** optional fuel restriction; "" = any fuel */
  fuelType: string;
  active: boolean;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Day Book (cash reconciliation)                                       */
/* ------------------------------------------------------------------ */

export interface DayBookEntry {
  date: string;
  /** Physical cash counted / banked */
  depositAmount: number;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Fleet & Fuel Cards                                                    */
/* ------------------------------------------------------------------ */

export interface FleetCard {
  id: string;
  /** linked credit / corporate account name */
  accountName: string;
  cardNumber: string;
  plate: string;
  driver: string;
  /** canonical fuel label restricted to ("" = all fuels) */
  fuelProduct: string;
  /** per-transaction volume cap (litres; 0 = unlimited) */
  txnLimitLitres: number;
  /** daily spend cap (0 = unlimited) */
  dailyLimitAmount: number;
  /** prepaid true = balance drawn down; false = postpaid (credit) */
  prepaid: boolean;
  /** prepaid balance (only used when prepaid) */
  balance: number;
  status: "active" | "suspended" | "blocked";
  createdAt: string;
}

export interface FleetUsage {
  id: string;
  cardId: string;
  date: string;
  amount: number;
  litres: number;
  fuelType: string;
}

/* ------------------------------------------------------------------ */
/* Forecourt Hardware registry                                           */
/* ------------------------------------------------------------------ */

export type HardwareCategory = "dispenser" | "atg" | "peripheral";

export interface ForecourtDevice {
  id: string;
  category: HardwareCategory;
  brandModel: string;
  /** protocol / interface (IFSF, TQM, current loop, RS-485, TCP/IP…) */
  protocol: string;
  /** COM3, 192.168.1.10:502 … */
  connection: string;
  /** mapped pump / tank reference */
  mappedTo: string;
  status: "configured" | "not-configured";
  lastEvent?: string;
}

/** Real-world forecourt integration catalog (protocol families by vendor). */
export const HARDWARE_CATALOG: {
  category: HardwareCategory;
  brandModel: string;
  protocol: string;
}[] = [
  {
    category: "dispenser",
    brandModel: "Gilbarco Veeder-Root",
    protocol: "IFSF / current loop",
  },
  {
    category: "dispenser",
    brandModel: "Wayne Fueling (DFS)",
    protocol: "TQM / IFSF",
  },
  {
    category: "dispenser",
    brandModel: "Tokheim Quantium",
    protocol: "Tokheim protocol",
  },
  {
    category: "dispenser",
    brandModel: "Bennett (SB / Horizon)",
    protocol: "Bennett protocol",
  },
  {
    category: "dispenser",
    brandModel: "Tatsuno (OCEAN / Sunny)",
    protocol: "Tatsuno protocol",
  },
  {
    category: "dispenser",
    brandModel: "Censtar (Provence)",
    protocol: "Censtar protocol",
  },
  { category: "dispenser", brandModel: "LPG dispenser", protocol: "RS-485" },
  {
    category: "dispenser",
    brandModel: "PTS forecourt controller",
    protocol: "PTS JSON/TCP",
  },
  {
    category: "atg",
    brandModel: "Veeder-Root TLS-450+",
    protocol: "Serial / TCP",
  },
  {
    category: "atg",
    brandModel: "OPW SiteSentinel Integra",
    protocol: "Serial / TCP",
  },
  {
    category: "atg",
    brandModel: "Franklin Fueling AutoLearn",
    protocol: "Modbus",
  },
  {
    category: "peripheral",
    brandModel: "Outdoor price board",
    protocol: "RS-485",
  },
  {
    category: "peripheral",
    brandModel: "Pole display (VFD/LCD)",
    protocol: "Serial",
  },
  {
    category: "peripheral",
    brandModel: "Barcode scanner",
    protocol: "USB HID",
  },
  {
    category: "peripheral",
    brandModel: "Receipt printer",
    protocol: "USB / LAN",
  },
  {
    category: "peripheral",
    brandModel: "OPT payment terminal",
    protocol: "TETRA / LAN",
  },
  {
    category: "peripheral",
    brandModel: "Car wash controller",
    protocol: "Relay",
  },
];

/* ------------------------------------------------------------------ */
/* Customer segmentation (Veira-style)                                   */
/* ------------------------------------------------------------------ */

export type CustomerSegment = "vip" | "active" | "at-risk" | "dormant" | "new";

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  vip: "VIP / High Value",
  active: "Active",
  "at-risk": "At Risk (30+ days)",
  dormant: "Dormant (60+ days)",
  new: "New (this month)",
};

export function segmentOf(customer: {
  loyaltyPoints?: number;
  totalSpent?: number;
  lastVisit?: string;
}): CustomerSegment {
  const days = daysSince(customer.lastVisit);
  if (
    (customer.loyaltyPoints ?? 0) >= 2000 ||
    (customer.totalSpent ?? 0) >= 100000
  )
    return "vip";
  if (days !== null && days > 60) return "dormant";
  if (days !== null && days > 30) return "at-risk";
  if (days !== null && days <= 30) return "active";
  return "new";
}

export function daysSince(isoDate?: string): number | null {
  if (!isoDate) return null;
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* ------------------------------------------------------------------ */
/* CSV helper (RFC 4180-safe)                                           */
/* ------------------------------------------------------------------ */

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(
  filename: string,
  rows: (string | number | null | undefined)[][],
) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
