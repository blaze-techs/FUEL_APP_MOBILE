/**
 * payroll-import.ts — robust employee Excel/CSV parser for the Payroll
 * System "Import Excel" feature.
 *
 * Replaces the previous naive header detection, which broke on the app's
 * own exports: the title row ("ACME EMPLOYEES LIST MARCH 2026" / "ACME
 * SALARY MARCH 2026 PAYMENT") contains "employee"/"salary", so it was
 * picked as the header row and extraction yielded zero employees.
 *
 * Strategy:
 *  1. Scan EVERY worksheet (not just the first) and score each row by how
 *     many known payroll columns it matches — the row with the most
 *     matches wins, single-cell title rows never qualify.
 *  2. Column mapping uses word-boundary matching with per-column conflict
 *     resolution, so "ID NO." is never stolen by the "employee id" lookup
 *     and two fields never share one column.
 *  3. Footer rows (TOTALS / GRAND TOTAL) are skipped, Excel serial dates
 *     are converted, numeric phones regain their leading zero, and
 *     duplicate rows inside the file are dropped.
 */
import * as XLSX from "xlsx";

export interface ParsedEmployee {
  first_name: string;
  last_name: string;
  employee_id: string;
  role: string;
  department: string;
  basic_salary: number;
  id_number: string;
  kra_pin: string;
  sha_number: string;
  nssf_number: string;
  sha_amount: number;
  nssf_amount: number;
  net_pay: number;
  bank_account: string;
  bank_name: string;
  bank_code: string;
  phone: string;
  email: string;
  employment_date: string;
  advance_amount: number;
  notes: string;
  /** "bank" | "cash" | "" — "" means unspecified (defaults to bank). */
  payment_method: string;
}

/** Normalizes a free-text payment-mode value ("Cash", "CASH PAYMENT",
 *  "Bank Transfer", "EFT", ...) into the canonical "cash" | "bank" |
 *  "" (unknown). Used by the importer and the payroll UI. */
export function normalizePaymentMethod(value: unknown): "cash" | "bank" | "" {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (/cash|hand\s*money|petty/.test(v)) return "cash";
  if (/bank|transfer|eft|rtgs|cheque|check|deposit|account/.test(v))
    return "bank";
  return "";
}

export interface ParseResult {
  employees: ParsedEmployee[];
  sheetName: string | null;
  headerRowIndex: number;
  /** field -> matched header label (for diagnostics/preview) */
  mappedColumns: Record<string, string>;
  /** every sheet that contributed data (primary sheet first) */
  sheetsUsed: string[];
}

const COLUMN_MAPPING: Record<string, string[]> = {
  firstName: ["first name", "fname", "first_name", "firstname", "given name"],
  lastName: [
    "last name",
    "lname",
    "last_name",
    "lastname",
    "surname",
    "family name",
  ],
  fullName: [
    "full name",
    "employee name",
    "full_name",
    "fullname",
    "staff name",
    "employee",
    "name",
  ],
  employeeId: [
    "employee id",
    "emp id",
    "employee_id",
    "empid",
    "staff id",
    "employee no",
    "emp no",
    "pf no",
    "pf number",
    "payroll no",
  ],
  role: ["role", "position", "job title", "designation", "title", "job"],
  department: ["department", "dept", "division", "section", "unit"],
  basicSalary: [
    "basic salary",
    "basic_salary",
    "basicsalary",
    "basic amount",
    "basic pay",
    "gross salary",
    "gross pay",
    "gross",
    "salary",
    "amount",
  ],
  idNo: [
    "id number",
    "id no",
    "national id",
    "id_number",
    "idno",
    "nin",
    "national id no",
    "identity",
  ],
  kraPin: [
    "kra pin",
    "kra_pin",
    "krapin",
    "tax pin",
    "kra",
    "pin",
    // Country-local tax identifiers (matches payroll-localization.ts).
    "tin",
    "tin no",
    "tin number",
    "trn",
    "ssn",
    "pan",
    "npwp",
    "ntn",
    "tpin",
    "tfh no",
    "tax id",
    "tax id no",
    "tax number",
    "ird number",
    "steuer-id",
    "numero fiscal",
    "nino",
  ],
  // Amount columns ("SHA", "SHA AMOUNT", "NSSF", "NET PAY") must win over
  // the *number* lookups for those exact headers — listed first so equal
  // scores resolve to them. The number variations below no longer include
  // the bare "sha"/"nssf" abbreviations.
  shaAmount: [
    "sha amount",
    "sha",
    // Localized medical-cover headers (export round-trip for non-KE).
    "health insurance",
    "medical cover",
    "medical aid",
    "nhis",
    "philhealth",
    "medicare",
    "cbhi",
    "shu",
    "bpjs kesehatan",
  ],
  nssfAmount: [
    "nssf amount",
    "nssf",
    // Localized social-fund headers (export round-trip for non-KE).
    "401(k)",
    "401k",
    "pension",
    "pension contribution",
    "social security",
    "ssnit",
    "epf",
    "rrsp",
    "kiwisaver",
    "super",
    "superannuation",
    "napsa",
    "eobi",
    "gosi",
    "uif",
    "provident fund",
    "pension fund",
    "rssb",
  ],
  netPay: ["net pay", "net total", "net salary", "net"],
  shaNo: [
    "sha no",
    "sha number",
    "sha_no",
    "shanumber",
    "sha_number",
    "nhif no",
    "nhif number",
    "nhif",
    // Localized medical-cover number columns.
    "health insurance no",
    "health insurance number",
    "medical cover no",
    "medical cover number",
    "medical aid no",
    "medical aid number",
    "insurance no",
    "insurance number",
  ],
  nssfNo: [
    "nssf no",
    "nssf number",
    "nssf_no",
    "nssfnumber",
    "nssf_number",
    // Localized social-fund number columns.
    "401(k) no",
    "401k no",
    "pension no",
    "pension number",
    "social security no",
    "social security number",
    "ssnit no",
    "epf no",
    "napsa no",
    "gosi no",
    "uif no",
    "sss no",
    "provident fund no",
  ],
  bankAccount: [
    "bank account",
    "account no",
    "bank_account",
    "accountno",
    "account_number",
    "account",
    "acc no",
  ],
  bankName: ["bank name", "bank_name", "bankname", "bank branch", "bank"],
  bankCode: ["bank code", "bank_code", "bankcode", "branch code"],
  phone: [
    "phone number",
    "phone",
    "mobile number",
    "mobile",
    "contact",
    "telephone",
    "tel",
  ],
  email: ["email address", "email", "e-mail", "mail"],
  employmentDate: [
    "employment date",
    "date employed",
    "date of employment",
    "date joined",
    "start date",
    "employment_date",
    "hire date",
    "joining date",
    "doj",
  ],
  advance: [
    "advance amount",
    "salary advance",
    "advance",
    "loan amount",
    "loan",
    "deduction",
  ],
  notes: ["notes", "remarks", "comments", "description"],
  paymentMethod: [
    "payment method",
    "payment mode",
    "mode of payment",
    "payment type",
    "pay method",
    "pay mode",
    "paid via",
    "pay via",
    "payment",
  ],
};

/** Fields that identify a person — at least one must map for the sheet to
 *  be considered employee data. */
const IDENTITY_FIELDS = ["fullName", "firstName", "lastName"];

/** Headers containing these words must NOT map to the field (e.g. "Bank
 *  Charges" is not a bank name, "Tax PIN" column of totals is not a pin). */
const FIELD_EXCLUSIONS: Record<string, string[]> = {
  bankName: ["charge", "originator"],
  // "Bank Charges" is a fee column, not an account; "Originator Account"
  // (CPC bulk-payment sheets) is the COMPANY's source account, not the
  // employee's.
  bankAccount: ["charge", "originator"],
  bankCode: ["charge", "originator"],
};

const FOOTER_RE = /^(grand\s+)?sub?\s*totals?|totals?$/i;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordBoundaryScore(variation: string, header: string): number {
  if (!variation || !header) return 0;
  if (header === variation) return 100;
  const escaped = variation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`).test(header)) return 80;
  // Substring matches are only allowed for longer variations so tiny ones
  // ("id", "pin", "code", "tel") never steal unrelated columns.
  if (variation.length >= 4 && header.includes(variation)) return 40;
  return 0;
}

interface ColumnCandidate {
  field: string;
  colIndex: number;
  score: number;
}

/**
 * Assigns each field to at most one column (and each column to at most one
 * field) by greedily taking the highest-scoring (field, column) pairs.
 */
function assignColumns(headers: string[]): Record<string, number> {
  const candidates: ColumnCandidate[] = [];
  const normHeaders = headers.map(normalizeHeader);
  for (const [field, variations] of Object.entries(COLUMN_MAPPING)) {
    const exclusions = FIELD_EXCLUSIONS[field] ?? [];
    for (let col = 0; col < normHeaders.length; col++) {
      if (exclusions.some((ex) => normHeaders[col].includes(ex))) continue;
      let best = 0;
      for (const variation of variations) {
        best = Math.max(
          best,
          wordBoundaryScore(normalizeHeader(variation), normHeaders[col]),
        );
      }
      if (best > 0) candidates.push({ field, colIndex: col, score: best });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const assignedFields = new Set<string>();
  const assignedCols = new Set<number>();
  const result: Record<string, number> = {};
  for (const c of candidates) {
    if (assignedFields.has(c.field) || assignedCols.has(c.colIndex)) continue;
    assignedFields.add(c.field);
    assignedCols.add(c.colIndex);
    result[c.field] = c.colIndex;
  }
  return result;
}

/** Scores a row as a potential header row: number of distinct fields its
 *  cells map to. Single-cell title rows can never reach the threshold. */
function scoreHeaderRow(row: unknown[]): number {
  const nonEmpty = row.filter(
    (c) => c !== undefined && c !== null && String(c).trim() !== "",
  );
  if (nonEmpty.length < 2) return 0;
  const mapping = assignColumns(row.map((c) => String(c ?? "")));
  return Object.keys(mapping).length;
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDateValue(value: unknown): string {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return excelSerialToIso(value) ?? "";
  }
  const s = String(value ?? "").trim();
  if (!s) return "";
  // A bare serial number stored as text
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return excelSerialToIso(parseFloat(s)) ?? s;
  }
  return s;
}

function parsePhoneValue(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  // Numeric cells arrive as "254712345678" or "712345678" — restore a
  // leading zero for 9-digit local Kenyan numbers.
  const digits = s.replace(/[^\d+]/g, "");
  if (/^[71]\d{8}$/.test(digits)) return `0${digits}`;
  return s;
}

function cellText(value: unknown): string {
  if (value instanceof Date) return parseDateValue(value);
  return String(value ?? "").trim();
}

interface SheetParse {
  sheetName: string;
  headerRowIndex: number;
  employees: ParsedEmployee[];
  mapping: Record<string, number>;
  mappedColumns: Record<string, string>;
}

/** Normalized name key used to match the same person across sheets. */
function nameKey(
  emp: Pick<ParsedEmployee, "first_name" | "last_name">,
): string {
  return `${emp.first_name} ${emp.last_name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Fields a secondary sheet may fill when the primary sheet left them empty. */
const MERGEABLE_STRING_FIELDS = [
  "employee_id",
  "role",
  "department",
  "id_number",
  "kra_pin",
  "sha_number",
  "nssf_number",
  "bank_account",
  "bank_name",
  "bank_code",
  "phone",
  "email",
  "employment_date",
  "notes",
  "payment_method",
] as const;
const MERGEABLE_NUMBER_FIELDS = [
  "basic_salary",
  "sha_amount",
  "nssf_amount",
  "net_pay",
  "advance_amount",
] as const;

/** Parses ONE worksheet into employee rows (or null if no employee table). */
function parseEmployeeSheet(
  ws: XLSX.WorkSheet,
  sheetName: string,
): SheetParse | null {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  // Keep original indices but work on non-empty rows only.
  const nonEmpty = rows.filter((row) =>
    row.some((c) => c !== undefined && c !== null && String(c).trim() !== ""),
  );
  if (nonEmpty.length < 2) return null;

  let headerIdx = -1;
  let headerScore = 0;
  for (let i = 0; i < Math.min(nonEmpty.length, 15); i++) {
    const score = scoreHeaderRow(nonEmpty[i]);
    if (score > headerScore) {
      headerScore = score;
      headerIdx = i;
    }
  }
  // Need at least 2 mapped fields, one of them an identity field.
  if (headerIdx === -1 || headerScore < 2) return null;
  const headers = nonEmpty[headerIdx].map((c) => String(c ?? "").trim());
  const mapping = assignColumns(headers);
  if (!IDENTITY_FIELDS.some((f) => mapping[f] !== undefined)) return null;

  const get = (row: unknown[], field: string): unknown =>
    mapping[field] !== undefined ? row[mapping[field]] : undefined;

  const employees: ParsedEmployee[] = [];
  const seenKeys = new Set<string>();

  for (const row of nonEmpty.slice(headerIdx + 1)) {
    // Skip footer/total rows.
    const joined = row
      .map((c) =>
        String(c ?? "")
          .trim()
          .toLowerCase(),
      )
      .join(" ");
    const firstCell = String(row[0] ?? "").trim();
    if (
      FOOTER_RE.test(firstCell) ||
      /^(grand\s+)?totals?\b/.test(joined) ||
      joined === ""
    ) {
      continue;
    }

    const firstName = cellText(get(row, "firstName"));
    const lastName = cellText(get(row, "lastName"));
    const fullName = cellText(get(row, "fullName"));

    const nameSource = fullName || `${firstName} ${lastName}`.trim();
    if (!nameSource) continue;
    // A "name" that is purely numeric is a serial/amount, not a person.
    if (/^[\d.,\s]+$/.test(nameSource)) continue;
    if (FOOTER_RE.test(nameSource)) continue;

    const emp: ParsedEmployee = {
      first_name: firstName || nameSource.split(/\s+/)[0] || "",
      last_name: lastName || nameSource.split(/\s+/).slice(1).join(" ") || "",
      employee_id: cellText(get(row, "employeeId")),
      role: cellText(get(row, "role")),
      department: cellText(get(row, "department")),
      basic_salary: parseAmount(get(row, "basicSalary")),
      id_number: cellText(get(row, "idNo")),
      kra_pin: cellText(get(row, "kraPin")),
      sha_number: cellText(get(row, "shaNo")),
      nssf_number: cellText(get(row, "nssfNo")),
      sha_amount: parseAmount(get(row, "shaAmount")),
      nssf_amount: parseAmount(get(row, "nssfAmount")),
      net_pay: parseAmount(get(row, "netPay")),
      bank_account: cellText(get(row, "bankAccount")),
      bank_name: cellText(get(row, "bankName")),
      bank_code: cellText(get(row, "bankCode")),
      phone: parsePhoneValue(get(row, "phone")),
      email: cellText(get(row, "email")),
      employment_date: parseDateValue(get(row, "employmentDate")),
      advance_amount: parseAmount(get(row, "advance")),
      notes: cellText(get(row, "notes")),
      payment_method: normalizePaymentMethod(get(row, "paymentMethod")),
    };

    // De-duplicate within the sheet itself.
    const key = (
      emp.employee_id ||
      emp.id_number ||
      `${emp.first_name} ${emp.last_name}`
    ).toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    employees.push(emp);
  }

  if (employees.length === 0) return null;

  const mappedColumns: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) {
    mappedColumns[field] = headers[col];
  }

  return {
    sheetName,
    headerRowIndex: headerIdx,
    employees,
    mapping,
    mappedColumns,
  };
}

/**
 * Parses a workbook (xlsx/xls/csv already read by SheetJS) and extracts
 * employee rows. Kenyan payroll workbooks routinely split one employee's
 * data across several sheets (payments, SHA list, NSSF list, CPC bank
 * details) — so ALL sheets are parsed and the employee rows are merged by
 * normalized name: the sheet with the most mapped columns is the primary
 * source, and every other sheet fills fields the primary left empty.
 */
export function parseEmployeeWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const parsed: SheetParse[] = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const p = parseEmployeeSheet(ws, sheetName);
    if (!p) continue;
    // A sheet literally named "CASH PAYMENTS" lists the cash-paid staff
    // (common in Kenyan payroll workbooks) — mark its rows as cash unless
    // a row-level payment-method column says otherwise.
    if (/cash\s*payments?/i.test(sheetName)) {
      for (const emp of p.employees) {
        if (!emp.payment_method) emp.payment_method = "cash";
      }
    }
    parsed.push(p);
  }

  if (parsed.length === 0) {
    return {
      employees: [],
      sheetName: null,
      headerRowIndex: -1,
      mappedColumns: {},
      sheetsUsed: [],
    };
  }

  // Primary sheet: most mapped fields; ties break toward more rows.
  parsed.sort((a, b) => {
    const fa = Object.keys(a.mapping).length;
    const fb = Object.keys(b.mapping).length;
    if (fb !== fa) return fb - fa;
    return b.employees.length - a.employees.length;
  });
  const primary = parsed[0];
  const sheetsUsed = [primary.sheetName];
  const byName = new Map<string, ParsedEmployee>();
  for (const emp of primary.employees) byName.set(nameKey(emp), emp);
  const merged = [...primary.employees];

  for (const sheet of parsed.slice(1)) {
    let contributed = false;
    for (const other of sheet.employees) {
      const key = nameKey(other);
      const target = byName.get(key);
      if (!target) {
        // Person only present on a secondary sheet — still an employee.
        byName.set(key, other);
        merged.push(other);
        contributed = true;
        continue;
      }
      for (const f of MERGEABLE_STRING_FIELDS) {
        if (!target[f] && other[f]) {
          (target as unknown as Record<string, unknown>)[f] = other[f];
          contributed = true;
        }
      }
      for (const f of MERGEABLE_NUMBER_FIELDS) {
        if (!target[f] && other[f]) {
          (target as unknown as Record<string, unknown>)[f] = other[f];
          contributed = true;
        }
      }
    }
    if (contributed) sheetsUsed.push(sheet.sheetName);
  }

  return {
    employees: merged,
    sheetName: primary.sheetName,
    headerRowIndex: primary.headerRowIndex,
    mappedColumns: primary.mappedColumns,
    sheetsUsed,
  };
}

/**
 * Builds a SheetJS workbook from OCR text of a scanned/photographed payroll
 * sheet. Lines become rows; cells are split on tabs, pipes, or runs of 2+
 * spaces (how a visual table OCRs). The result flows through the same
 * parseEmployeeWorkbook pipeline as a real spreadsheet.
 */
export function workbookFromOcrText(
  text: string,
  sheetName = "Scanned Sheet",
): XLSX.WorkBook {
  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/\t|\s*\|\s*| {2,}/)
        .map((c) => c.trim())
        .filter((c) => c !== ""),
    );
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/** Reads a File (xlsx/xls/csv) into a SheetJS workbook with date parsing. */
export async function readWorkbookFile(file: File): Promise<XLSX.WorkBook> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return XLSX.read(text, { type: "string", cellDates: true });
  }
  const data = await file.arrayBuffer();
  return XLSX.read(data, { type: "array", cellDates: true });
}

/** Stable dedup key for an employee record (import or existing). */
export function employeeDedupKey(emp: {
  employee_id?: string;
  employeeId?: string;
  id_number?: string;
  idNo?: string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
}): string {
  const id = emp.employee_id ?? emp.employeeId ?? "";
  const idNo = emp.id_number ?? emp.idNo ?? "";
  const name =
    `${emp.first_name ?? emp.firstName ?? ""} ${emp.last_name ?? emp.lastName ?? ""}`.trim();
  return (id || idNo || name).toLowerCase();
}

/** Builds the headers + one sample row used by the "Download Template" button. */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const data = [
    [
      "First Name",
      "Last Name",
      "Employee ID",
      "Role",
      "Department",
      "Basic Salary",
      "ID Number",
      "KRA PIN",
      "SHA Number",
      "NSSF Number",
      "Bank Name",
      "Bank Account",
      "Bank Code",
      "Phone",
      "Email",
      "Employment Date",
      "Advance",
      "Notes",
    ],
    [
      "Jane",
      "Wanjiku",
      "EMP-001",
      "Cashier",
      "Sales",
      45000,
      "12345678",
      "A001234567X",
      "SHA-123456",
      "NSSF-123456",
      "KCB",
      "1234567890",
      "01100",
      "0712345678",
      "jane@example.com",
      "2024-01-15",
      0,
      "Sample row — delete before importing",
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = data[0].map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, ws, "Employees");
  return wb;
}
