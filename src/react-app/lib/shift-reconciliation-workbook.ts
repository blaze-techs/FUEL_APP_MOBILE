import * as XLSX from "xlsx";

export interface ShiftReconciliationRow {
  date: string;
  shift: "Day" | "Night";
  totalSales: number | null;
  till: number | null;
  deductionsAndCredit: number | null;
  expensesAndCreditDescriptions: string;
  reportedCash: number | null;
  variance: number | null;
  smsTimestamp: string;
  auditFlags: string;
  originalMessage: string;
  sourceSheet: string;
  sourceRow: number;
}

export interface ShiftReconciliationWorkbook {
  fileName: string;
  sheetNames: string[];
  selectedSheet: string;
  rows: ShiftReconciliationRow[];
  skippedRows: number;
}

const HEADER_ALIASES: Record<string, string[]> = {
  shift: ["shift", "date shift", "shift date"],
  totalSales: ["total sales ksh", "total sales", "sales ksh", "sales"],
  till: ["till ksh", "till", "mobile payment", "till amount"],
  deductionsAndCredit: ["deductions credit ksh", "deductions and credit ksh", "deductions credit", "deductions and credit"],
  expensesAndCreditDescriptions: ["expenses credit descriptions", "expenses and credit descriptions", "expenses descriptions", "expense descriptions"],
  reportedCash: ["reported cash ksh", "reported cash", "cash reported"],
  variance: ["variance ksh", "variance", "cash variance"],
  smsTimestamp: ["sms timestamp", "timestamp", "message timestamp"],
  auditFlags: ["audit flags", "audit flag", "flags"],
  originalMessage: ["full original message", "original message", "sms message", "message"],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findColumn(headers: unknown[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[field];
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return aliases.some((alias) => normalized === normalizeHeader(alias));
  });
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function cellNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,\s]|KSh|KES/gi, "").replace(/[()]/g, (m) => m === "(" ? "-" : "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseShift(value: unknown): { date: string; shift: "Day" | "Night" } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value.toISOString().slice(0, 10), shift: "Day" };
  }
  const text = cellText(value);
  const match = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s+(Day|Night)\b/i);
  if (!match) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (month == null) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { date: date.toISOString().slice(0, 10), shift: match[4].toLowerCase() === "night" ? "Night" : "Day" };
}

function rowsFromSheet(workbook: XLSX.WorkBook, sheetName: string): { rows: ShiftReconciliationRow[]; skippedRows: number } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], skippedRows: 0 };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  if (!matrix.length) return { rows: [], skippedRows: 0 };
  const headerIndex = matrix.findIndex((row) => findColumn(row, "shift") >= 0 && findColumn(row, "totalSales") >= 0);
  if (headerIndex < 0) return { rows: [], skippedRows: 0 };
  const headers = matrix[headerIndex];
  const columns = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).map((field) => [field, findColumn(headers, field)]),
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const rows: ShiftReconciliationRow[] = [];
  let skippedRows = 0;
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const values = matrix[index];
    if (!values || values.every((value) => value == null || value === "")) continue;
    const shiftValue = values[columns.shift];
    const parsedShift = parseShift(shiftValue);
    if (!parsedShift) { skippedRows++; continue; }
    const getText = (field: keyof typeof HEADER_ALIASES) => columns[field] < 0 ? "" : cellText(values[columns[field]]);
    const getNumber = (field: keyof typeof HEADER_ALIASES) => columns[field] < 0 ? null : cellNumber(values[columns[field]]);
    rows.push({
      ...parsedShift,
      totalSales: getNumber("totalSales"),
      till: getNumber("till"),
      deductionsAndCredit: getNumber("deductionsAndCredit"),
      expensesAndCreditDescriptions: getText("expensesAndCreditDescriptions"),
      reportedCash: getNumber("reportedCash"),
      variance: getNumber("variance"),
      smsTimestamp: getText("smsTimestamp"),
      auditFlags: getText("auditFlags"),
      originalMessage: getText("originalMessage"),
      sourceSheet: sheetName,
      sourceRow: index + 1,
    });
  }
  return { rows, skippedRows };
}

/** Parse reconciliation workbooks without interpreting them as pump-meter readings. */
export async function parseShiftReconciliationWorkbook(
  file: File,
  preferredSheet?: string,
): Promise<ShiftReconciliationWorkbook> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const candidates = sheetNames.filter((name) => {
    const result = rowsFromSheet(workbook, name);
    return result.rows.length > 0;
  });
  const selectedSheet =
    (preferredSheet && candidates.includes(preferredSheet) ? preferredSheet : "") ||
    (candidates.find((name) => normalizeHeader(name) === "latest per shift") ?? candidates[0] ?? "");
  if (!selectedSheet) throw new Error("No sheet with recognisable shift reconciliation columns was found.");
  const parsed = rowsFromSheet(workbook, selectedSheet);
  if (!parsed.rows.length) throw new Error(`No valid shift rows were found in "${selectedSheet}".`);
  return {
    fileName: file.name,
    sheetNames,
    selectedSheet,
    rows: parsed.rows,
    skippedRows: parsed.skippedRows,
  };
}
