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
  /** Fields that were not present or could not be parsed in the source row. */
  missingFields: string[];
  /** Percentage of the core reconciliation fields extracted successfully. */
  completeness: number;
}

export interface ShiftReconciliationWorkbook {
  fileName: string;
  sheetNames: string[];
  selectedSheet: string;
  rows: ShiftReconciliationRow[];
  skippedRows: number;
  warnings: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "shift date", "transaction date", "business date"],
  shift: ["shift", "shift name", "day night", "shift type"],
  combinedShift: [
    "date shift",
    "shift date",
    "date and shift",
    "date/shift",
  ],
  totalSales: [
    "total sales ksh",
    "total sales kes",
    "total sales",
    "sales ksh",
    "sales kes",
    "sales amount",
    "total amount",
    "sales",
  ],
  till: [
    "till ksh",
    "till kes",
    "till amount",
    "mpesa till",
    "m pesa till",
    "mobile payment",
    "mobile payments",
    "till",
    "mpesa",
    "m pesa",
  ],
  deductionsAndCredit: [
    "deductions credit ksh", "deductions and credit ksh",
    "deductions credit", "deductions and credit", "deductions",
    "credit and deductions", "credit deductions",
  ],
  expensesAndCreditDescriptions: [
    "expenses credit descriptions", "expenses and credit descriptions",
    "expenses descriptions", "expense descriptions", "expense details",
    "expenses", "expense", "deductions descriptions",
  ],
  reportedCash: [
    "reported cash ksh", "reported cash kes", "reported cash",
    "cash reported", "cash in hand", "cash",
  ],
  variance: [
    "variance ksh",
    "variance kes",
    "cash variance",
    "variance",
    "difference",
  ],
  smsTimestamp: [
    "sms timestamp",
    "timestamp",
    "message timestamp",
    "sms date",
  ],
  auditFlags: ["audit flags", "audit flag", "flags", "remarks", "status"],
  originalMessage: [
    "full original message",
    "original message",
    "sms message",
    "message text",
    "raw message",
    "message",
  ],
};

type HeaderField = keyof typeof HEADER_ALIASES;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findColumn(headers: unknown[], field: HeaderField): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  const exact = normalizedHeaders.findIndex((header) => aliases.includes(header));
  if (exact >= 0) return exact;

  // Allow useful variants such as "Total Sales (Ksh)" and "Reported Cash
  // Amount" without matching unrelated columns such as "Cashier Name".
  return normalizedHeaders.findIndex((header) =>
    aliases.some((alias) => {
      if (alias.length < 5) return false;
      return header.startsWith(alias + " ") || header.endsWith(" " + alias);
    }) ||
    (field === "totalSales" && /sales/.test(header)) ||
    (field === "shift" && /shift|day|night/.test(header)) ||
    (field === "combinedShift" &&
      /date|shift/.test(header) &&
      /day|night/.test(header)),
  );
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function cellNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw || /^(?:-|—|n\/?a|nil|none)$/i.test(raw)) return null;
  const negative = /^\s*\(.*\)\s*$/.test(raw);
  const cleaned = raw
    .replace(/[(),\s]/g, "")
    .replace(/(?:ksh|kes|kshs?\.?|kes\.?)/gi, "")
    .replace(/[^0-9.+-]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return date.toISOString().slice(0, 10);
    }
  }
  const text = cellText(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return date.toISOString().slice(0, 10);
    }
  }
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(
      dmy[3].length === 2 ? "20" + dmy[3] : dmy[3],
    );
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return date.toISOString().slice(0, 10);
    }
  }
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (named) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const m = monthNames.indexOf(named[2].slice(0, 3).toLowerCase());
    const d = Number(named[1]);
    const y = Number(named[3]);
    if (m >= 0) {
      const date = new Date(Date.UTC(y, m, d));
      if (date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

function parseShift(value: unknown): "Day" | "Night" | null {
  const text = cellText(value).toLowerCase();
  if (/\bnight\b|\bp\.?m\.?\b/.test(text)) return "Night";
  if (/\bday\b|\ba\.?m\.?\b/.test(text)) return "Day";
  return null;
}

function parseCombinedShift(value: unknown): { date: string; shift: "Day" | "Night" } | null {
  const text = cellText(value);
  const shift = parseShift(text);
  const date = parseDate(text);
  return date && shift ? { date, shift } : null;
}

function rowsFromSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): { rows: ShiftReconciliationRow[]; skippedRows: number } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], skippedRows: 0 };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (!matrix.length) return { rows: [], skippedRows: 0 };

  const headerIndex = matrix.findIndex((row) => {
    const hasDateOrShift =
      findColumn(row, "combinedShift") >= 0 ||
      (findColumn(row, "date") >= 0 && findColumn(row, "shift") >= 0) ||
      findColumn(row, "shift") >= 0;
    return hasDateOrShift && findColumn(row, "totalSales") >= 0;
  });
  if (headerIndex < 0) return { rows: [], skippedRows: 0 };

  const headers = matrix[headerIndex];
  const columns = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as HeaderField[]).map((field) => [
      field,
      findColumn(headers, field),
    ]),
  ) as Record<HeaderField, number>;

  const rows: ShiftReconciliationRow[] = [];
  let skippedRows = 0;
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const values = matrix[index];
    if (!values || values.every((value) => value == null || value === "")) continue;

    const combined =
      (columns.combinedShift >= 0
        ? parseCombinedShift(values[columns.combinedShift])
        : null) ??
      (columns.shift >= 0
        ? parseCombinedShift(values[columns.shift])
        : null);
    const date =
      combined?.date ??
      (columns.date >= 0
        ? parseDate(values[columns.date])
        : columns.shift >= 0
          ? parseDate(values[columns.shift])
          : null);
    const shift =
      combined?.shift ??
      (columns.shift >= 0 ? parseShift(values[columns.shift]) : null);
    if (!date || !shift) {
      skippedRows++;
      continue;
    }

    const getText = (field: HeaderField) =>
      columns[field] < 0 ? "" : cellText(values[columns[field]]);
    const getNumber = (field: HeaderField) =>
      columns[field] < 0 ? null : cellNumber(values[columns[field]]);
    const numericFields: Array<
      [
        | "totalSales"
        | "till"
        | "deductionsAndCredit"
        | "reportedCash"
        | "variance",
        number | null,
      ]
    > = [
      ["totalSales", getNumber("totalSales")],
      ["till", getNumber("till")],
      ["deductionsAndCredit", getNumber("deductionsAndCredit")],
      ["reportedCash", getNumber("reportedCash")],
      ["variance", getNumber("variance")],
    ];
    const missingFields: string[] = numericFields
      .filter(([, value]) => value == null)
      .map(([field]) => field);
    if (!getText("expensesAndCreditDescriptions")) {
      missingFields.push("expensesAndCreditDescriptions");
    }
    const completeness = Math.round(((6 - missingFields.length) / 6) * 100);

    rows.push({
      date,
      shift,
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
      missingFields,
      completeness,
    });
  }
  return { rows, skippedRows };
}

/** Parse reconciliation workbooks while retaining incomplete rows and explicitly reporting missing data. */
export async function parseShiftReconciliationWorkbook(
  file: File,
  preferredSheet?: string,
): Promise<ShiftReconciliationWorkbook> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const sheetNames = workbook.SheetNames;
  const parsedSheets = sheetNames.map((name) => ({
    name,
    parsed: rowsFromSheet(workbook, name),
  }));
  const candidates = parsedSheets.filter(({ parsed }) => parsed.rows.length > 0);
  const selected =
    (preferredSheet &&
      candidates.find(({ name }) => name === preferredSheet)) ||
    candidates.find(
      ({ name }) => normalizeHeader(name) === "latest per shift",
    ) ||
    candidates[0];
  if (!selected) {
    throw new Error(
      "No sheet with recognisable date/shift and total-sales columns was found.",
    );
  }
  const rows = selected.parsed.rows;
  const incomplete = rows.filter((row) => row.missingFields.length > 0).length;
  const warnings: string[] = [];
  if (selected.parsed.skippedRows) {
    warnings.push(
      `${selected.parsed.skippedRows} non-empty rows were skipped because date or shift could not be identified.`,
    );
  }
  if (incomplete) {
    warnings.push(
      `${incomplete} of ${rows.length} rows have missing or unparseable financial fields. Review them before posting to ledgers.`,
    );
  }
  if (rows.some((row) => row.totalSales == null)) {
    warnings.push(
      "Some rows have no valid total-sales amount; these must not be treated as zero.",
    );
  }
  return {
    fileName: file.name,
    sheetNames,
    selectedSheet: selected.name,
    rows,
    skippedRows: selected.parsed.skippedRows,
    warnings,
  };
}
