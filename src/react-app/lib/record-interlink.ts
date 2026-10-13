/**
 * FuelPro shared-record contract.
 *
 * This module defines safe primitives for connecting records across modules.
 * It deliberately does not silently write to legacy module stores: adapters
 * must be added to each module and the authoritative database table before a
 * relation is treated as persisted business truth.
 */

export type FuelProRecordType =
  | "station"
  | "customer"
  | "supplier"
  | "employee"
  | "task"
  | "attendance"
  | "payroll"
  | "payslip"
  | "quotation"
  | "invoice"
  | "receipt"
  | "payment"
  | "customer_statement"
  | "sale"
  | "expense"
  | "purchase_order"
  | "delivery"
  | "inventory_movement"
  | "shift"
  | "meter_reading"
  | "accounting_entry"
  | "document"
  | "message";

export type RecordRelationship =
  | "derived_from"
  | "references"
  | "settles"
  | "issued_to"
  | "assigned_to"
  | "supports"
  | "reverses"
  | "supersedes";

export interface RecordReference {
  type: FuelProRecordType;
  id: string;
  stationId: string;
}

export interface RecordLink {
  id: string;
  stationId: string;
  from: RecordReference;
  to: RecordReference;
  relationship: RecordRelationship;
  /** Stable key supplied by the caller to make retries idempotent. */
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LinkDraft extends Omit<RecordLink, "id" | "createdAt"> {
  id?: string;
  createdAt?: string;
}

export class RecordLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordLinkValidationError";
  }
}

/**
 * Validate relationship boundaries before persistence. All endpoints must
 * belong to the same station; cross-station links require an explicit transfer
 * workflow and must never be created as an ordinary relation.
 */
export function validateRecordLink(draft: LinkDraft): void {
  const required = [
    draft.stationId,
    draft.from?.id,
    draft.from?.stationId,
    draft.to?.id,
    draft.to?.stationId,
    draft.idempotencyKey,
    draft.createdBy,
  ];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    throw new RecordLinkValidationError(
      "A station, both record IDs, idempotency key, and actor are required.",
    );
  }
  if (draft.from.id === draft.to.id && draft.from.type === draft.to.type) {
    throw new RecordLinkValidationError("A record cannot link to itself.");
  }
  if (
    draft.from.stationId !== draft.stationId ||
    draft.to.stationId !== draft.stationId
  ) {
    throw new RecordLinkValidationError(
      "Cross-station links require an approved transfer workflow.",
    );
  }
}

/** Deterministic identifier for retry-safe link creation. */
export function recordLinkId(draft: LinkDraft): string {
  validateRecordLink(draft);
  return [
    draft.stationId,
    draft.idempotencyKey,
    draft.from.type,
    draft.from.id,
    draft.relationship,
    draft.to.type,
    draft.to.id,
  ]
    .map((part) => encodeURIComponent(part))
    .join("|");
}

/** Build a normalized link without creating duplicate links on a retry. */
export function normalizeRecordLink(draft: LinkDraft): RecordLink {
  validateRecordLink(draft);
  return {
    ...draft,
    id: draft.id || recordLinkId(draft),
    createdAt: draft.createdAt || new Date().toISOString(),
    metadata: draft.metadata ? { ...draft.metadata } : undefined,
  };
}

export interface MoneyLine {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  source?: RecordReference;
}

export interface CalculatedMoneyLine extends MoneyLine {
  subtotal: number;
  tax: number;
  total: number;
}

export interface DocumentTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Round currency at the line boundary to avoid binary-float penny drift. */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite, non-negative number.`);
  }
}

/**
 * The same calculation routine must power quotation, invoice, receipt and
 * statement previews. It never trusts a caller-provided line total.
 */
export function calculateDocumentLines(lines: readonly MoneyLine[]): {
  lines: CalculatedMoneyLine[];
  totals: DocumentTotals;
} {
  const calculated = lines.map((line) => {
    requireFiniteNonNegative(line.quantity, "quantity");
    requireFiniteNonNegative(line.unitPrice, "unitPrice");
    const taxRate = line.taxRate ?? 0;
    requireFiniteNonNegative(taxRate, "taxRate");
    const subtotal = roundMoney(line.quantity * line.unitPrice);
    const tax = roundMoney((subtotal * taxRate) / 100);
    return {
      ...line,
      taxRate,
      subtotal,
      tax,
      total: roundMoney(subtotal + tax),
    };
  });
  const subtotal = roundMoney(
    calculated.reduce((sum, line) => sum + line.subtotal, 0),
  );
  const tax = roundMoney(calculated.reduce((sum, line) => sum + line.tax, 0));
  return {
    lines: calculated,
    totals: { subtotal, tax, total: roundMoney(subtotal + tax) },
  };
}

export type FieldProvenance = "source" | "user" | "system";
export interface SourcedField<T = unknown> {
  value: T;
  provenance: FieldProvenance;
  sourceRecord?: RecordReference;
}

/**
 * Fill missing destination fields from a source without overwriting a user's
 * explicit edit. Financial totals should be recalculated from line items, not
 * copied as trusted values.
 */
export function fillMissingFields<T extends Record<string, unknown>>(
  destination: T,
  source: Partial<T>,
  protectedFields: readonly (keyof T)[] = [],
): T {
  const result = { ...destination };
  const protectedSet = new Set<keyof T>(protectedFields);
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (protectedSet.has(key)) continue;
    const current = result[key];
    const incoming = source[key];
    const missing =
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "");
    if (missing && incoming !== undefined && incoming !== null) {
      result[key] = incoming;
    }
  }
  return result;
}

export interface WorkforceLinkStatus {
  employeeId: string;
  active: boolean;
  assignedTaskCount: number;
  eligibleForPayroll: boolean;
  payrollRecordId?: string;
  payslipRecordId?: string;
}

/**
 * Read-model invariant used by HR dashboards: employee counts, assignments,
 * payroll and payslip statuses should be joined by stable employee IDs, never
 * by display names. This reports gaps; it does not invent payroll records.
 */
export function auditWorkforceLinks(
  employees: readonly { id: string; active: boolean }[],
  tasks: readonly { assigneeEmployeeIds: readonly string[]; status?: string }[],
  payrollEmployeeIds: readonly string[],
  payslipEmployeeIds: readonly string[],
  payrollEligibleEmployeeIds: readonly string[],
): WorkforceLinkStatus[] {
  const payroll = new Set(payrollEmployeeIds);
  const payslips = new Set(payslipEmployeeIds);
  const eligible = new Set(payrollEligibleEmployeeIds);
  return employees.map((employee) => ({
    employeeId: employee.id,
    active: employee.active,
    assignedTaskCount: tasks.filter(
      (task) =>
        task.assigneeEmployeeIds.includes(employee.id) &&
        !["completed", "cancelled"].includes(
          String(task.status || "").toLowerCase(),
        ),
    ).length,
    eligibleForPayroll: employee.active && eligible.has(employee.id),
    payrollRecordId: payroll.has(employee.id) ? employee.id : undefined,
    payslipRecordId: payslips.has(employee.id) ? employee.id : undefined,
  }));
}
