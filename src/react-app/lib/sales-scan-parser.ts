/**
 * Pure parser that turns the OCR text of a daily sales sheet / pump
 * readings sheet into structured pump readings, expenses, and till/cash
 * totals. Everything here is deterministic and unit-testable — no network,
 * no OCR engine. Feed it the text from `ocr-service` (or a native PDF text
 * layer) and review the result before saving.
 *
 * Handles the messy reality of OCR'd sheets:
 *   - digit confusions (O→0, l→1) between/around numbers
 *   - colon or mixed date separators (04.09.2026, 04/09/2026)
 *   - pump rows like "PMS-1 12045.5 12340.0 62,000"
 *   - labelled totals ("Till/M-PESA: 45,000", "Cash: 78,500")
 *   - fuel names beyond petrol/diesel (kerosene, LPG, V-Power, ...)
 */
import { normalizeFuelType } from "@/react-app/config/pricing";

export interface SalesSheetPump {
  name: string;
  fuelType: string;
  openingReading: number;
  closingReading: number;
  salesAmount: number;
}

export interface SalesSheetExpense {
  name: string;
  amount: number;
}

export interface SalesSheetFields {
  date?: string; // ISO yyyy-mm-dd
  shift?: string;
  pumps: SalesSheetPump[];
  expenses: SalesSheetExpense[];
  totalSales?: number;
  tillAmount?: number;
  cashAmount?: number;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

/** A pump row: optional id prefix, optional fuel word, then 2-3 numbers. */
const PUMP_ID_RE =
  /^([A-Z]{1,4}[\s-]?\d{1,2})[\s:-]+([A-Za-z][A-Za-z\s-]{0,18})?[\s:-]*(\d[\d,.]*)[\s:-]+(\d[\d,.]*)(?:[\s:-]+(\d[\d,.]*))?$/;

/**
 * Normalize OCR digit confusions, but ONLY when the ambiguous char sits next
 * to a digit (so words like "Petrol"/"Kerosene" are never mangled):
 *   12O45 → 12045, 802l → 8021
 */
function fixNumericConfusions(raw: string): string {
  return raw
    .replace(/(?<=\d)[Oo](?=\d)/g, "0")
    .replace(/(?<=\d)[Oo](?=\D|$)/g, "0")
    .replace(/(?<=\d)[lI](?=\d)/g, "1")
    .replace(/(?<=\d)[lI](?=\D|$)/g, "1");
}

/** Parse "12,345.67" / "12345" / "12O45" → number (0 when unreadable). */
function toNumber(raw: string): number {
  const cleaned = fixNumericConfusions(raw)
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31)
    return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse a date token in common formats → ISO yyyy-mm-dd, or undefined. */
export function parseSalesSheetDate(raw: string): string | undefined {
  const s = raw
    .trim()
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/(?<=[\d\-/.])\)(?=\d)/g, "1")
    .replace(/(?<=[\d\-/.])[lI](?=\d)/g, "1")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[:.]\s*(\d{4})/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s+(\d{4})\b/g, "$1/$2/$3")
    .replace(/(\d{1,2})\s*[:.]\s*(\d{1,2})\s*[-/]\s*(\d{4})/g, "$1/$2/$3");
  // "4 Sept 2026" / "4 September 2026"
  let m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()])
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()])
    return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const a = +m[1],
      b = +m[2],
      y = +m[3];
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return iso(y, b, a);
  }
  return undefined;
}

/** Find the first labelled amount after a label like "Cash:", "Till:". */
function findLabelledAmount(text: string, labelRe: RegExp): number | undefined {
  const re = new RegExp(
    `${labelRe.source}\\s*[:\\-–]?\\s*([\\d,.]{1,15})`,
    "i",
  );
  const m = text.match(re);
  if (!m) return undefined;
  const n = toNumber(m[1]);
  return n > 0 ? n : undefined;
}

/**
 * Extract structured sales-sheet fields from OCR/PDF text.
 * Never throws — unreadable input yields `confidence: "low"` + honest notes.
 */
export function extractSalesSheetFromText(rawText: string): SalesSheetFields {
  const text = rawText || "";
  const notes: string[] = [];
  const pumps: SalesSheetPump[] = [];
  const expenses: SalesSheetExpense[] = [];

  // Date — first recognizable date token wins.
  let date: string | undefined;
  const dateMatch = text.match(
    /\b\d{1,2}[-/.:]\d{1,2}[-/.:]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*\d{4}\b|\b[A-Za-z]{3,9}\s+\d{1,2}\s*,?\s*\d{4}\b/,
  );
  if (dateMatch) date = parseSalesSheetDate(dateMatch[0]);

  // Shift — "Shift: Day" / "Shift: Night".
  let shift: string | undefined;
  const shiftMatch = text.match(
    /\bshift\s*[:–-]?\s*(day|night|morning|evening)/i,
  );
  if (shiftMatch)
    shift = shiftMatch[1][0].toUpperCase() + shiftMatch[1].slice(1);

  // Pump rows — scan line by line.
  let inExpenses = false;
  for (const rawLine of text.split("\n")) {
    const line = fixNumericConfusions(rawLine).trim();
    if (!line) continue;
    if (/^expenses?\b/i.test(line)) {
      inExpenses = true;
      continue;
    }
    if (/^(total|grand\s*total|summary)\b/i.test(line)) {
      inExpenses = false;
      continue;
    }
    if (inExpenses) {
      // "Fuel 2,000" / "Lunch 500" — name then amount.
      const em = line.match(/^([A-Za-z][A-Za-z\s&-]{1,24}?)\s+([\d,.]{1,15})$/);
      if (em) {
        const amount = toNumber(em[2]);
        if (amount > 0) expenses.push({ name: em[1].trim(), amount });
      }
      continue;
    }
    const idMatch = line.match(PUMP_ID_RE);
    if (!idMatch) continue;
    const opening = toNumber(idMatch[3]);
    const closing = toNumber(idMatch[4]);
    // A meter pair must increase; otherwise it's not a reading row.
    if (closing < opening) continue;
    const salesAmount = idMatch[5] ? toNumber(idMatch[5]) : 0;
    const fuelRaw = (idMatch[2] || "").trim();
    // Prefer the explicit fuel word; fall back to the pump-id prefix
    // (e.g. "PMS-1" → petrol, "AGO-1" → diesel, "IK-1" → kerosene).
    const canonical =
      normalizeFuelType(fuelRaw) ||
      normalizeFuelType(idMatch[1].replace(/[\s-]*\d+$/, "").trim()) ||
      "petrol";
    pumps.push({
      name: idMatch[1].toUpperCase(),
      fuelType: canonical,
      openingReading: opening,
      closingReading: closing,
      salesAmount,
    });
  }

  const tillAmount = findLabelledAmount(
    text,
    /(?:till|m-?pesa\s*(?:total|amount)?|mobile\s*money)/i,
  );
  const cashAmount = findLabelledAmount(text, /\bcash\b/i);
  const totalSales = findLabelledAmount(
    text,
    /total\s*(?:sales|revenue|amount|collection)/i,
  );

  const pumpsWithReadings = pumps.filter(
    (p) => p.openingReading > 0 || p.closingReading > 0,
  );
  let confidence: SalesSheetFields["confidence"] = "low";
  if (pumpsWithReadings.length >= 1 && (date || tillAmount || cashAmount))
    confidence = "high";
  else if (pumpsWithReadings.length >= 1 || totalSales || tillAmount)
    confidence = "medium";

  if (!pumps.length)
    notes.push("No pump meter rows were recognized — enter readings manually.");
  if (!date) notes.push("No date recognized — please confirm the date.");
  if (confidence === "high")
    notes.push("Fields read by visual (OCR) analysis — review before saving.");

  return {
    date,
    shift,
    pumps,
    expenses,
    totalSales,
    tillAmount,
    cashAmount,
    confidence,
    notes,
  };
}
