/**
 * Deterministic parser for handwritten fuel-station sales sheets.
 *
 * The important pattern for handwritten forecourt sheets is:
 *   opening KSh - opening litres
 *   closing KSh - closing litres
 *   sales KSh
 *
 * We only promote a pump block to high confidence when the meter arithmetic
 * independently agrees with the written sales amount. Fuel/pump identity is
 * resolved later against the station roster/shift-continuity data; the parser
 * never invents an identity.
 */
import { normalizeFuelType } from "@/react-app/config/pricing";

export interface SalesSheetPump {
  name: string;
  fuelType: string;
  openingReading: number;
  closingReading: number;
  openingLitres: number;
  closingLitres: number;
  salesAmount: number;
  salesLitres: number;
  direction: "increasing" | "decreasing" | "unknown";
  confidence: "high" | "medium" | "low";
}

export interface SalesSheetExpense {
  name: string;
  amount: number;
}

export interface SalesSheetFields {
  date?: string;
  shift?: string;
  pumps: SalesSheetPump[];
  expenses: SalesSheetExpense[];
  totalSales?: number;
  tillAmount?: number;
  cashAmount?: number;
  otherDetails: Array<{ label: string; value: number }>;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function fixNumericConfusions(raw: string): string {
  return raw
    .replace(/(?<=\d)[Oo](?=\d)/g, "0")
    .replace(/(?<=\d)[Oo](?=\D|$)/g, "0")
    .replace(/(?<=\d)[lI](?=\d)/g, "1")
    .replace(/(?<=\d)[lI](?=\D|$)/g, "1")
    .replace(/[−–—]/g, "-");
}

function toNumber(raw: string): number {
  const cleaned = fixNumericConfusions(raw)
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31)
    return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseSalesSheetDate(raw: string): string | undefined {
  const s = raw
    .trim()
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/(?<=[\d\-/.])\)(?=\d)/g, "1")
    .replace(/(?<=[\d\-/.])[lI](?=\d)/g, "1")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[:.]\s*(\d{4})/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s+(\d{4})\b/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[-/]\s*(\d{4})/g, "$1/$2/$3");
  let m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s*(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return iso(y, b, a);
  }
  return undefined;
}

function numericGroups(line: string): string[] {
  const tokens = fixNumericConfusions(line).split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/^\d[\d,.]*$/.test(token)) continue;
    if (/^\d{1,3}$/.test(token)) {
      const parts = [token];
      let j = i + 1;
      while (j < tokens.length && /^\d{3}(?:\.\d+)?$/.test(tokens[j])) {
        parts.push(tokens[j]);
        j += 1;
      }
      if (parts.length > 1 && (/^\d{1,2}$/.test(token) || /\.\d+$/.test(parts[parts.length - 1]))) {
        groups.push(parts.join(""));
        i = j - 1;
        continue;
      }
    }
    groups.push(token);
  }
  return groups;
}

function numericValues(line: string): number[] {
  return numericGroups(line).map(toNumber).filter((n) => Number.isFinite(n) && n > 0);
}

function numericValuesIncludingZero(line: string): number[] {
  return numericGroups(line).map(toNumber).filter((n) => Number.isFinite(n) && n >= 0);
}

function meterPairFromLine(line: string): [number, number] | null {
  const parts = fixNumericConfusions(line).split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const left = numericValues(parts[0]);
  const right = numericValues(parts[1]);
  if (left.length !== 1 || right.length !== 1) return null;
  if (left[0] < 1000 || right[0] < 1000) return null;
  return [left[0], right[0]];
}

function buildPump(name: string, fuelType: string, openingKsh: number, closingKsh: number, openingLitres: number, closingLitres: number, confidence: SalesSheetPump["confidence"]): SalesSheetPump {
  return {
    name,
    fuelType,
    openingReading: openingKsh,
    closingReading: closingKsh,
    openingLitres,
    closingLitres,
    salesAmount: Math.abs(closingKsh - openingKsh),
    salesLitres: Math.abs(closingLitres - openingLitres),
    direction: closingKsh > openingKsh ? "increasing" : closingKsh < openingKsh ? "decreasing" : "unknown",
    confidence,
  };
}

function addUniquePump(pumps: SalesSheetPump[], pump: SalesSheetPump): void {
  const duplicate = pumps.some(
    (p) => Math.abs(p.openingReading - pump.openingReading) <= 100 &&
      Math.abs(p.closingReading - pump.closingReading) <= 100 &&
      Math.abs(p.openingLitres - pump.openingLitres) <= 2 &&
      Math.abs(p.closingLitres - pump.closingLitres) <= 2,
  );
  if (!duplicate) pumps.push(pump);
}

function labelledAmount(text: string, labelRe: RegExp): number | undefined {
  const re = new RegExp(`\\b${labelRe.source}\\b\\s*[:=\\-–]?\\s*([\\d,.]{1,18})`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  const n = toNumber(m[1]);
  return n >= 0 ? n : undefined;
}

function explicitPumpId(line: string): { id: string; rest: string } | null {
  const m = line.match(/^([A-Za-z]{1,8}[\s-]?\d{1,3})\b[\s:;-]*(.*)$/);
  if (!m) return null;
  return { id: m[1].toUpperCase().replace(/\s+/g, "-"), rest: m[2] };
}

function fuelFromText(line: string): string {
  const fuelWord = line.match(/\b(petrol|pms|diesel|ago|kerosene|ik|lpg|v[- ]?power|premium\s+diesel|cng)\b/i)?.[1];
  return fuelWord ? normalizeFuelType(fuelWord) || fuelWord.toLowerCase() : "";
}

function salesMatchesDelta(delta: number, written: number): boolean {
  return Math.abs(delta - written) <= Math.max(0.05, delta * 0.0005);
}

export function extractSalesSheetFromText(rawText: string): SalesSheetFields {
  const text = String(rawText || "");
  const notes: string[] = [];
  const pumps: SalesSheetPump[] = [];
  const expenses: SalesSheetExpense[] = [];
  const otherDetails: Array<{ label: string; value: number }> = [];
  const lines = text.split(/\r?\n/).map((line) => fixNumericConfusions(line).trim()).filter(Boolean);

  let date: string | undefined;
  const dateMatch = text.match(/\b\d{1,2}[-/.:]\d{1,2}[-/.:]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9},?\s*\d{4}\b|\b[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}\b/);
  if (dateMatch) date = parseSalesSheetDate(dateMatch[0]);
  const shiftMatch = text.match(/\bshift\s*[:–-]?\s*(day|night|morning|evening)/i);
  const shift = shiftMatch ? shiftMatch[1][0].toUpperCase() + shiftMatch[1].slice(1) : undefined;

  for (const line of lines) {
    const id = explicitPumpId(line);
    if (!id) continue;
    const values = numericValues(id.rest);
    if (values.length < 2) continue;
    const fuelType = fuelFromText(id.rest);
    if (values.length >= 4) {
      addUniquePump(pumps, buildPump(id.id, fuelType, values[0], values[2], values[1], values[3], "high"));
      continue;
    }
    const opening = values[0], closing = values[1], suppliedSales = values[2];
    const delta = Math.abs(closing - opening);
    if (values.length >= 3 && !salesMatchesDelta(delta, suppliedSales)) continue;
    const pump = buildPump(id.id, fuelType, opening, closing, 0, 0, "medium");
    if (values.length >= 3) pump.salesAmount = suppliedSales;
    addUniquePump(pumps, pump);
  }

  // Handwritten forecourt block: opening pair, closing pair, written sales.
  // The sales line is required for high confidence so unrelated numeric lines
  // can never become fake pump records.
  for (let i = 0; i < lines.length - 2; i += 1) {
    const first = meterPairFromLine(lines[i]);
    const second = meterPairFromLine(lines[i + 1]);
    if (!first || !second) continue;
    const salesValues = numericValuesIncludingZero(lines[i + 2]);
    if (salesValues.length !== 1) continue;
    const [openingKsh, openingLitres] = first;
    const [closingKsh, closingLitres] = second;
    const writtenSales = salesValues[0];
    if (!salesMatchesDelta(Math.abs(closingKsh - openingKsh), writtenSales)) continue;
    const pump = buildPump(`SCAN-${pumps.length + 1}`, "", openingKsh, closingKsh, openingLitres, closingLitres, "high");
    pump.salesAmount = writtenSales;
    addUniquePump(pumps, pump);
    i += 2;
  }

  let tillAmount = labelledAmount(text, /(?:till|tll|m-?pesa|mobile\s*money)/i);
  let cashAmount = labelledAmount(text, /cash|cach/i);
  let totalSales = labelledAmount(text, /(?:total|fotal|tota1)\s*(?:sales|sale|revenue|amount|collection)/i);

  for (const line of lines) {
    const named = line.match(/^[-•]?\s*([a-z][a-z &/]+?)\s*(?:[-:]\s*|\s+)(.*)$/i);
    if (!named) continue;
    const label = named[1].trim();
    const nums = numericValues(named[2]);
    if (!nums.length) continue;
    if (/^(?:till|tll)\b/i.test(label)) { tillAmount = nums[nums.length - 1]; continue; }
    if (/^cash\b/i.test(label)) { cashAmount = nums[nums.length - 1]; continue; }
    if (/^(petrol|pms|diesel|ago|kerosene|lpg|v[- ]?power)\b/i.test(label)) { otherDetails.push({ label, value: nums[nums.length - 1] }); continue; }
    if (/^(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime|bank|deposit|boss|amref|kcb)\b/i.test(label)) {
      expenses.push({ name: label, amount: nums[nums.length - 1] });
    }
  }

  const computedPumpSales = pumps.reduce((sum, p) => sum + p.salesAmount, 0);
  if (totalSales === undefined && computedPumpSales > 0) {
    totalSales = computedPumpSales;
    notes.push("Total sales was derived from independently validated pump meter deltas.");
  }
  const totalAgreesWithMeters = totalSales === undefined || computedPumpSales === 0 || Math.abs(totalSales - computedPumpSales) <= Math.max(0.05, computedPumpSales * 0.0005);
  if (totalSales !== undefined && computedPumpSales > 0 && !totalAgreesWithMeters) {
    notes.push(`Written total sales differs from validated pump-meter sales by ${(totalSales - computedPumpSales).toFixed(2)}; automatic application is blocked.`);
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (!/^\s*=\s*[\d,.]+\s*$/.test(lines[i])) continue;
    const value = numericValues(lines[i])[0];
    if (!value) continue;
    const previous = lines[i - 1];
    if (/^(?:[-•]?\s*)?(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime)\b/i.test(previous) && expenses.length) {
      expenses[expenses.length - 1].amount = value;
    }
  }

  const completePumps = pumps.filter((p) =>
    p.openingReading > 0 && p.closingReading > 0 &&
    p.openingLitres > 0 && p.closingLitres > 0 &&
    Number.isFinite(p.salesAmount) && Number.isFinite(p.salesLitres),
  );

  // Date is deliberately NOT a prerequisite for high confidence. The supplied
  // photos crop the header/date, but the four meter blocks are mathematically
  // self-verifying and can safely populate the form without guessing a date.
  let confidence: SalesSheetFields["confidence"] = "low";
  if (completePumps.length >= 2 && completePumps.length === pumps.length && totalAgreesWithMeters && completePumps.every((p) => p.confidence === "high")) {
    confidence = "high";
  } else if (completePumps.length > 0 || totalSales !== undefined || tillAmount !== undefined || cashAmount !== undefined) {
    confidence = "medium";
  }

  if (!completePumps.length) notes.push("No complete handwritten pump blocks were validated. Do not auto-apply unreadable meter data.");
  if (!date) notes.push("Date was not visible/recognized in this image; the existing form date is retained and should be confirmed.");
  if (pumps.some((p) => p.direction === "decreasing")) notes.push("Some totalizers decrease from opening to closing; sales are calculated from the absolute meter delta.");
  if (pumps.length > 0) notes.push("Pump/fuel identity is resolved against the station roster and shift-continuity readings; no identity is invented from row order.");

  return { date, shift, pumps, expenses, totalSales, tillAmount, cashAmount, otherDetails, confidence, notes };
}
