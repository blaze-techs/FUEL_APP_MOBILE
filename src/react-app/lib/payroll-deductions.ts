/**
 * Station-defined custom deduction types ("STATUTORY & OTHER DEDUCTIONS"):
 * the payroll table's built-in columns are SHA, NSSF and Advance; a station
 * can add/remove its own deduction columns (e.g. HELB Loan, Union Dues,
 * Insurance). The type registry lives in payroll settings; per-employee
 * amounts live on each employee record.
 */

/** How a column amount is computed: a fixed flat amount or a % of basic salary. */
export type ColumnCalcMode = "fixed" | "percent";

/** A station-defined custom deduction type (e.g. HELB Loan, Union Dues). */
export interface DeductionType {
  id: string;
  label: string;
  /**
   * How the type's default value is computed when applying to employees.
   * "fixed" = flat amount; "percent" = percentage of basic salary.
   * Optional for backwards compatibility (older types default to "fixed").
   */
  calcMode?: ColumnCalcMode;
  /** Flat amount used when calcMode is "fixed". */
  fixedAmount?: number;
  /** Percent rate (0–100) used when calcMode is "percent". */
  percentRate?: number;
  /** Original "describe the rule" text the column was created from. */
  ruleDescription?: string;
}

/** Per-employee value for a custom deduction type. `amount` carries the
 *  flat value (fixed mode) OR the percent rate (percent mode). */
export interface CustomDeduction {
  typeId: string;
  amount: number;
  /** Optional per-employee mode override (defaults to "fixed"). */
  mode?: ColumnCalcMode;
}

/** Station-defined custom earning/allowance type — identical structure to
 *  a deduction type, but it ADDS to net pay. */
export type EarningType = DeductionType;
/** Per-employee earning value (same shape as a custom deduction). */
export type CustomEarning = CustomDeduction;

// Normalize a raw custom-deductions list (from cloud/localStorage) into a
// clean [{typeId, amount, mode?}] array — guards against partial/corrupt
// records. A `mode` is only kept when it is a valid value.
export function normalizeCustomDeductions(raw: unknown): CustomDeduction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => {
      const mode =
        d.mode === "percent" || d.mode === "fixed"
          ? (d.mode as ColumnCalcMode)
          : undefined;
      return {
        typeId: String(d.typeId ?? d.type_id ?? ""),
        amount:
          typeof d.amount === "number"
            ? d.amount
            : parseFloat(String(d.amount)) || 0,
        ...(mode ? { mode } : {}),
      };
    })
    .filter((d) => d.typeId !== "");
}

// Normalize a raw deduction-types list (from cloud/localStorage) into a
// clean DeductionType[] — preserves the optional calc-mode fields while
// guarding against partial/corrupt records.
export function normalizeDeductionTypes(raw: unknown): DeductionType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => {
      const calcMode =
        d.calcMode === "percent" || d.calcMode === "fixed"
          ? (d.calcMode as ColumnCalcMode)
          : undefined;
      const fixedAmount =
        typeof d.fixedAmount === "number" && Number.isFinite(d.fixedAmount)
          ? d.fixedAmount
          : undefined;
      const percentRate =
        typeof d.percentRate === "number" && Number.isFinite(d.percentRate)
          ? d.percentRate
          : undefined;
      const ruleDescription =
        typeof d.ruleDescription === "string" && d.ruleDescription.trim()
          ? d.ruleDescription
          : undefined;
      return {
        id: String(d.id ?? ""),
        label: String(d.label ?? "").trim(),
        ...(calcMode ? { calcMode } : {}),
        ...(fixedAmount !== undefined ? { fixedAmount } : {}),
        ...(percentRate !== undefined ? { percentRate } : {}),
        ...(ruleDescription ? { ruleDescription } : {}),
      };
    })
    .filter((d) => d.id !== "" && d.label !== "");
}

/** Normalize a raw earning-types list (same shape as deduction types). */
export const normalizeEarningTypes = normalizeDeductionTypes;
/** Normalize a raw per-employee earnings list (same shape as deductions). */
export const normalizeCustomEarnings = normalizeCustomDeductions;

/** Round to 2dp without float noise. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve a stored deduction/earning entry to a money amount. A percent-mode
 * entry stores the RATE in `amount` and is resolved against the employee's
 * basic salary; a fixed-mode entry stores the flat money value directly.
 */
export function resolveDeductionAmount(
  d: CustomDeduction,
  basicSalary: number,
): number {
  const v = Number.isFinite(d.amount) ? d.amount : 0;
  if (d.mode === "percent") {
    const basic = Number.isFinite(basicSalary) ? basicSalary : 0;
    return round2((basic * v) / 100);
  }
  return v;
}
/** Resolve a stored earning entry to a money amount (percent vs fixed). */
export const resolveEarningAmount = resolveDeductionAmount;

/**
 * Compute the DEFAULT value for a column type for an employee with the given
 * basic salary — used when applying a type to all employees.
 */
export function computeColumnValue(
  type: DeductionType,
  basicSalary: number,
): number {
  const mode: ColumnCalcMode = type.calcMode ?? "fixed";
  if (mode === "percent") {
    const rate = Number.isFinite(type.percentRate) ? type.percentRate! : 0;
    const basic = Number.isFinite(basicSalary) ? basicSalary : 0;
    return round2((basic * rate) / 100);
  }
  return Number.isFinite(type.fixedAmount) ? type.fixedAmount! : 0;
}

/**
 * Deterministically interpret a free-text rule description into a calc mode
 * + value. This backs the "describe the rule" mode so the station can type
 * e.g. "5% of basic salary", "10 percent", "KSh 500", "flat 250", or
 * "500 per month" and the system converts it to a concrete rule. Returns
 * null when no understandable rule is present.
 */
export function parseDeductionRule(description: string): {
  calcMode: ColumnCalcMode;
  percentRate?: number;
  fixedAmount?: number;
} | null {
  const text = (description || "").toLowerCase().trim();
  if (!text) return null;

  // Percentage patterns: "5%", "5 %", "5 percent", "5 per cent", "5 pct",
  // "5% of basic salary", "10 percent of gross", etc.
  const percentMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent|pct)/,
  );
  if (percentMatch) {
    const rate = parseFloat(percentMatch[1]);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 100) {
      return { calcMode: "percent", percentRate: rate };
    }
    return null; // an out-of-range percent is a malformed rule
  }

  // Money patterns: "KSh 500", "KES 1,000", "$250", "500", "flat 250",
  // "500 per month", "fixed 1000" — first bare/currency number wins.
  const moneyMatch = text.match(
    /(?:ksh|kes|usd|ush|tsh|ngn|zar|eur|gbp|[$€£₦])?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/,
  );
  if (moneyMatch) {
    const amount = parseFloat(moneyMatch[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount >= 0) {
      return { calcMode: "fixed", fixedAmount: amount };
    }
  }
  return null;
}

/**
 * Single source of truth for net pay: basic + custom earnings − advance −
 * sha − nssf − custom deductions. Percent-mode entries are resolved against
 * the basic salary. Guards against NaN / Infinity (bad parse, missing field).
 */
export function calcNetPay(emp: {
  basicSalary: number;
  advance: number;
  sha: number;
  nssf: number;
  customDeductions?: CustomDeduction[];
  earnings?: CustomEarning[];
}): number {
  const basic = Number.isFinite(emp.basicSalary) ? emp.basicSalary : 0;
  const advance = Number.isFinite(emp.advance) ? emp.advance : 0;
  const sha = Number.isFinite(emp.sha) ? emp.sha : 0;
  const nssf = Number.isFinite(emp.nssf) ? emp.nssf : 0;
  const custom = (emp.customDeductions ?? []).reduce(
    (s, d) => s + resolveDeductionAmount(d, basic),
    0,
  );
  const earnings = (emp.earnings ?? []).reduce(
    (s, e) => s + resolveEarningAmount(e, basic),
    0,
  );
  return round2(basic + earnings - advance - sha - nssf - custom);
}

/**
 * The employee's amount for a given deduction type (0 when absent). When
 * `basicSalary` is provided the amount is RESOLVED (percent entries become
 * money); without it the raw stored value is returned (backwards compatible).
 */
export function deductionAmountFor(
  customDeductions: CustomDeduction[] | undefined,
  typeId: string,
  basicSalary?: number,
): number {
  const entry = (customDeductions ?? []).find((d) => d.typeId === typeId);
  if (!entry) return 0;
  return basicSalary === undefined
    ? entry.amount
    : resolveDeductionAmount(entry, basicSalary);
}
/** The employee's resolved amount for a given earning type (0 when absent). */
export const earningAmountFor = deductionAmountFor;

/**
 * Upsert an employee's value for a deduction type (returns a new array).
 * `mode` stores whether `amount` is a flat value or a percent rate.
 */
export function setDeductionAmount(
  customDeductions: CustomDeduction[] | undefined,
  typeId: string,
  amount: number,
  mode?: ColumnCalcMode,
): CustomDeduction[] {
  const existing = customDeductions ?? [];
  const idx = existing.findIndex((d) => d.typeId === typeId);
  if (idx >= 0) {
    return existing.map((d, i) =>
      i === idx ? { ...d, amount, ...(mode !== undefined ? { mode } : {}) } : d,
    );
  }
  return [
    ...existing,
    { typeId, amount, ...(mode !== undefined ? { mode } : {}) },
  ];
}
/** Upsert an employee's value for an earning type (returns a new array). */
export const setEarningAmount = setDeductionAmount;

/**
 * Excel sheet-name rules: max 31 chars; [ ] : * ? / \ are forbidden. Produces
 * a unique, valid sheet name for a list sheet ("<label> List"), appending
 * " (2)", " (3)", ... on collision with an already-used name.
 */
export function sanitizeSheetName(label: string, used: Set<string>): string {
  const base = `${label} List`
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let name = (base || "List").slice(0, 31);
  let i = 2;
  while (used.has(name)) {
    const suffix = ` (${i++})`;
    name = `${(base || "List").slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

/** One generated "<label> List" sheet for a custom deduction type. */
export interface DeductionListSheet {
  /** Unique, Excel-valid sheet name (<= 31 chars). */
  sheetName: string;
  /** The deduction type's display label (for the title/header rows). */
  label: string;
  /** Rows: [sno, NAME (upper), idNo, basicSalary, amount] -- contributors only. */
  rows: (string | number)[][];
  totalBasic: number;
  totalAmount: number;
}

/**
 * Build the per-custom-deduction-type list sheets for the combined payroll
 * export. Mirrors the SHA/NSSF list format. Rules:
 *  - a type gets its own sheet only when at least one employee actually
 *    contributes (resolved amount > 0) -- no empty lists;
 *  - employees with a 0 contribution are NOT listed (statutory-list rule);
 *  - sheet names are sanitized to Excel rules and deduped against
 *    `reservedNames` (existing sheets) + each other.
 */
export function buildCustomDeductionListSheets(
  employees: Array<{
    fullName: string;
    idNo?: string;
    basicSalary: number;
    customDeductions?: CustomDeduction[];
  }>,
  types: DeductionType[],
  reservedNames: string[],
): DeductionListSheet[] {
  const used = new Set(reservedNames);
  const sheets: DeductionListSheet[] = [];
  for (const t of types) {
    const contributors = employees
      .map((emp) => {
        const entry = (emp.customDeductions ?? []).find(
          (d) => d.typeId === t.id,
        ) ?? { typeId: t.id, amount: 0 };
        return { emp, amount: resolveDeductionAmount(entry, emp.basicSalary) };
      })
      .filter((c) => c.amount > 0);
    if (contributors.length === 0) continue;
    sheets.push({
      sheetName: sanitizeSheetName(t.label, used),
      label: t.label,
      rows: contributors.map((c, i) => [
        i + 1,
        (c.emp.fullName || "").toUpperCase(),
        c.emp.idNo ?? "",
        Number.isFinite(c.emp.basicSalary) ? c.emp.basicSalary : 0,
        c.amount,
      ]),
      totalBasic: contributors.reduce(
        (s, c) =>
          s + (Number.isFinite(c.emp.basicSalary) ? c.emp.basicSalary : 0),
        0,
      ),
      totalAmount: contributors.reduce((s, c) => s + c.amount, 0),
    });
  }
  return sheets;
}
