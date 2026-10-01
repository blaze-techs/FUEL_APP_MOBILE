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
  date?: string; // ISO yyyy-mm-dd
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
    `${labelRe.source}\\s*[:=\\-–]?\\s*([\\d,.]{1,15})`,
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
function numericGroups(line: string): string[] {
  const tokens = fixNumericConfusions(line).split(/\s+/).filter(Boolean);
  const groups: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/^\d[\d,.]*$/.test(token)) continue;

    // Handwritten meter totals often use spaces as thousands separators
    // (e.g. "65 941 844.05"). Merge those only when the leading group is
    // short enough to be an unambiguous thousands-group prefix. This avoids
    // incorrectly turning ordinary values such as "200 260 7200" into one
    // number.
    if (/^\d{1,3}$/.test(token)) {
      const parts = [token];
      let j = i + 1;
      while (
        j < tokens.length &&
        /^\d{3}(?:\.\d+)?$/.test(tokens[j]) &&
        (/^\d{1,2}$/.test(token) || /\.\d+$/.test(tokens[j]))
      ) {
        parts.push(tokens[j]);
        j += 1;
      }
      if (parts.length > 1) {
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

/** Parse one handwritten "opening KSh - opening litres" line. */
function meterPairFromLine(line: string): [number, number] | null {
  const parts = line.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;
  const left = numericValues(parts[0]);
  const right = numericValues(parts[1]);
  if (left.length !== 1 || right.length !== 1) return null;
  if (left[0] < 1000 || right[0] < 1000) return null;
  return [left[0], right[0]];
}

function explicitPumpId(line: string): { id: string; rest: string } | null {
  const m = line.match(/^([A-Za-z]{1,8}[\s-]?\d{1,3})\b[\s:;-]*(.*)$/);
  if (!m) return null;
  return { id: m[1].toUpperCase().replace(/\s+/g, "-"), rest: m[2] };
}

function buildPump(
  name: string,
  fuelType: string,
  openingKsh: number,
  closingKsh: number,
  openingLitres: number,
  closingLitres: number,
  confidence: SalesSheetPump["confidence"] = "medium",
): SalesSheetPump {
  return {
    name,
    fuelType,
    openingReading: openingKsh,
    closingReading: closingKsh,
    openingLitres,
    closingLitres,
    salesAmount: Math.abs(closingKsh - openingKsh),
    salesLitres: Math.abs(closingLitres - openingLitres),
    direction:
      closingKsh > openingKsh
        ? "increasing"
        : closingKsh < openingKsh
          ? "decreasing"
          : "unknown",
    confidence,
  };
}

function addUniquePump(pumps: SalesSheetPump[], pump: SalesSheetPump) {
  if (
    !pumps.some(
      (p) =>
        Math.abs(p.openingReading - pump.openingReading) <= 25 &&
        Math.abs(p.closingReading - pump.closingReading) <= 25 &&
        Math.abs(p.openingLitres - pump.openingLitres) <= 0.5 &&
        Math.abs(p.closingLitres - pump.closingLitres) <= 0.5,
    )
  ) {
    pumps.push(pump);
  }
}

function labelledAmount(text: string, labelRe: RegExp): number | undefined {
  const re = new RegExp(
    `\\b${labelRe.source}\\b\\s*[:\\-–]?\\s*([\\d,.]{1,18})`,
    "i",
  );
  const m = text.match(re);
  if (!m) return undefined;
  const n = toNumber(m[1]);
  return n > 0 ? n : undefined;
}

/**
 * Extract structured sales-sheet fields from OCR/PDF text.
 *
 * Handwritten station sheets commonly omit pump IDs and use two consecutive
 * lines per pump:
 *   opening KSh - opening litres
 *   closing KSh - closing litres
 *
 * The parser deliberately does NOT require opening < closing. Some station
 * totalizers/counting conventions decrease, so the sales delta is absolute.
 */
export function extractSalesSheetFromText(rawText: string): SalesSheetFields {
  const text = String(rawText || "");
  const notes: string[] = [];
  const pumps: SalesSheetPump[] = [];
  const expenses: SalesSheetExpense[] = [];
  const otherDetails: Array<{ label: string; value: number }> = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => fixNumericConfusions(line).trim())
    .filter(Boolean);

  let date: string | undefined;
  const dateMatch = text.match(
    /\b\d{1,2}[-/.:]\d{1,2}[-/.:]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*\d{4}\b|\b[A-Za-z]{3,9}\s+\d{1,2}\s*,?\s*\d{4}\b/,
  );
  if (dateMatch) date = parseSalesSheetDate(dateMatch[0]);

  const shiftMatch = text.match(
    /\bshift\s*[:–-]?\s*(day|night|morning|evening)/i,
  );
  const shift = shiftMatch
    ? shiftMatch[1][0].toUpperCase() + shiftMatch[1].slice(1)
    : undefined;

  // First handle explicit pump IDs. Support either:
  //   ID openingKsh closingKsh
  // or
  //   ID openingKsh openingL closingKsh closingL
  for (const line of lines) {
    const id = explicitPumpId(line);
    if (!id) continue;
    const values = numericValues(id.rest);
    if (values.length < 2) continue;
    const fuelWord = id.rest.match(
      /\b(petrol|pms|diesel|ago|kerosene|ik|lpg|v[- ]?power|premium\s+diesel|cng)\b/i,
    )?.[1];
    const fuelType = fuelWord ? normalizeFuelType(fuelWord) || fuelWord : "";
    if (values.length >= 4) {
      addUniquePump(
        pumps,
        buildPump(
          id.id,
          fuelType,
          values[0],
          values[2],
          values[1],
          values[3],
          "high",
        ),
      );
    } else {
      const opening = values[0];
      const closing = values[1];
      const suppliedSales = values[2];
      // For the legacy 3-number format, reject a decreasing pair when the
      // stated sales amount does not agree with the meter delta. Handwritten
      // two-line meter blocks are handled separately and may legitimately
      // decrease, because their sales are derived from the absolute delta.
      if (
        closing < opening &&
        (values.length < 3 ||
          Math.abs(Math.abs(closing - opening) - suppliedSales) > 0.01)
      ) {
        continue;
      }
      const pump = buildPump(
        id.id,
        fuelType,
        opening,
        closing,
        0,
        0,
        "medium",
      );
      if (values.length >= 3) {
        // In the legacy labelled format, the third number is the sheet's
        // explicit sales amount and is authoritative for that row.
        pump.salesAmount = suppliedSales;
      }
      addUniquePump(pumps, pump);
    }
  }

  // Handwritten unlabeled two-line pump blocks.
  for (let i = 0; i < lines.length - 1; i++) {
    const first = meterPairFromLine(lines[i]);
    const second = meterPairFromLine(lines[i + 1]);
    if (!first || !second) continue;
    const [openingKsh, openingLitres] = first;
    const [closingKsh, closingLitres] = second;
    addUniquePump(
      pumps,
      buildPump(
        `SCAN-${pumps.length + 1}`,
        "",
        openingKsh,
        closingKsh,
        openingLitres,
        closingLitres,
        "high",
      ),
    );
    i++;
  }

  let tillAmount = labelledAmount(
    text,
    /(?:till|m-?pesa|mobile\s*money)/i,
  );
  let cashAmount = labelledAmount(text, /cash/i);
  let totalSales = labelledAmount(
    text,
    /total\s*(?:sales|revenue|amount|collection)/i,
  );

  // Recognize explicit expense labels even when the "Expenses" heading itself
  // is unreadable. For formulas such as "Generator - 10 x 224.95 = 2,249",
  // the amount after "=" is authoritative.
  for (const line of lines) {
    const named = line.match(
      /^[-•]?\s*([a-z][a-z &/]+?)\s*(?:[-:]\s*|\s+)(.*)$/i,
    );
    if (!named) continue;
    const label = named[1].trim();
    const rhs = named[2];
    const nums = numericValues(rhs);
    if (!nums.length) continue;

    if (/^till\b/i.test(label)) {
      tillAmount = nums[nums.length - 1];
      continue;
    }
    if (/^cash\b/i.test(label)) {
      cashAmount = nums[nums.length - 1];
      continue;
    }
    if (/^(petrol|pms|diesel|ago|kerosene|lpg|v[- ]?power)\b/i.test(label)) {
      otherDetails.push({ label, value: nums[nums.length - 1] });
      continue;
    }
    if (
      /^(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime)\b/i.test(
        label,
      )
    ) {
      const amount = nums[nums.length - 1];
      if (amount > 0) expenses.push({ name: label, amount });
    }
  }

  const computedPumpSales = pumps.reduce((sum, p) => sum + p.salesAmount, 0);
  if (totalSales === undefined && computedPumpSales > 0) {
    totalSales = computedPumpSales;
    notes.push("Total sales was derived from pump meter deltas.");
  } else if (
    totalSales !== undefined &&
    computedPumpSales > 0 &&
    Math.abs(totalSales - computedPumpSales) > 0.01
  ) {
    notes.push(
      `Handwritten total sales differs from meter-derived sales by ${(
        totalSales - computedPumpSales
      ).toFixed(2)}; review before saving.`,
    );
  }

  // Handwritten arithmetic is often written on the next line:
  // "Generator - 10 x 224.95" followed by "= 2,249". Attach a standalone
  // result to the immediately preceding recognized expense instead of
  // incorrectly recording 224.95 as the expense.
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*=\s*[\d,.]+\s*$/.test(lines[i])) continue;
    const previous = lines[i - 1];
    if (!/^(?:[-•]?\s*)?(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime)\b/i.test(previous))
      continue;
    const value = numericValues(lines[i])[0];
    if (value > 0 && expenses.length) expenses[expenses.length - 1].amount = value;
  }

  // Preserve ancillary fuel quantities instead of forcing them into pump/tank
  // fields when their meaning is not explicit on the sheet.
  for (const line of lines) {
    const m = line.match(
      /^[-•]?\s*(petrol|pms|diesel|ago|kerosene|lpg|v[- ]?power)\s*[-:]\s*([\d,.]{1,18})\s*$/i,
    );
    if (!m) continue;
    const value = toNumber(m[2]);
    if (
      value > 0 &&
      !otherDetails.some(
        (x) =>
          x.label.toLowerCase() === m[1].toLowerCase() &&
          Math.abs(x.value - value) < 0.01,
      )
    ) {
      otherDetails.push({ label: m[1], value });
    }
  }

  let confidence: SalesSheetFields["confidence"] = "low";
  if (pumps.length > 0 && date && (totalSales || tillAmount || cashAmount))
    confidence = "high";
  else if (pumps.length > 0 || totalSales || tillAmount || cashAmount)
    confidence = "medium";

  if (!pumps.length)
    notes.push(
      "No complete pump opening/closing pair was recognized. If the scan is unreadable, enter readings manually.",
    );
  if (!date) notes.push("No date recognized — please confirm the date.");
  if (pumps.some((p) => p.direction === "decreasing")) {
    notes.push(
      "At least one pump totalizer decreases from opening to closing; sales use the absolute meter delta rather than rejecting the row.",
    );
  }
  if (pumps.length > 0) {
    notes.push(
      "Pump IDs/fuel types not printed on the sheet remain unassigned until matched against the station pump roster and shift-continuity readings.",
    );
  }

  return {
    date,
    shift,
    pumps,
    expenses,
    totalSales,
    tillAmount,
    cashAmount,
    otherDetails,
    confidence,
    notes,
  };
}
