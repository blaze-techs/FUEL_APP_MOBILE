import { getSupabaseClient } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { emit } from "@/react-app/lib/automation-engine";
import {
  normalizeRecordLink,
  validateRecordLink,
  type LinkDraft,
  type RecordLink,
  type FuelProRecordType,
  type RecordRelationship,
} from "@/react-app/lib/record-interlink";

interface StoredRecordLink {
  id: string;
  station_id: string;
  source_station_id: string;
  target_station_id: string;
  source_record_type: FuelProRecordType;
  source_record_id: string;
  target_record_type: FuelProRecordType;
  target_record_id: string;
  relationship: RecordRelationship;
  idempotency_key: string;
  created_by: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
}

function fromStored(row: StoredRecordLink): RecordLink {
  return {
    id: row.id,
    stationId: row.station_id,
    from: {
      type: row.source_record_type,
      id: row.source_record_id,
      stationId: row.source_station_id,
    },
    to: {
      type: row.target_record_type,
      id: row.target_record_id,
      stationId: row.target_station_id,
    },
    relationship: row.relationship,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

/**
 * Persist a cross-module relationship after the authoritative source write
 * succeeds. DB uniqueness makes network retries safe. A conflicting reuse of
 * an idempotency key is returned as an error rather than silently relinked.
 */
export async function createRecordRelationship(draft: LinkDraft): Promise<RecordLink> {
  validateRecordLink(draft);
  const normalized = normalizeRecordLink(draft);
  const supabase = getSupabaseClient();
  const payload = {
    station_id: normalized.stationId,
    source_station_id: normalized.from.stationId,
    target_station_id: normalized.to.stationId,
    source_record_type: normalized.from.type,
    source_record_id: normalized.from.id,
    target_record_type: normalized.to.type,
    target_record_id: normalized.to.id,
    relationship: normalized.relationship,
    idempotency_key: normalized.idempotencyKey,
    created_by: normalized.createdBy,
    metadata: normalized.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("record_relationships")
    .upsert(payload, { onConflict: "station_id,idempotency_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    const created = fromStored(data as StoredRecordLink);
    emit({
      type: "record:linked",
      stationId: created.stationId,
      fromType: created.from.type,
      fromId: created.from.id,
      toType: created.to.type,
      toId: created.to.id,
      relationship: created.relationship,
      idempotencyKey: created.idempotencyKey,
    });
    return created;
  }

  const { data: existing, error: readError } = await supabase
    .from("record_relationships")
    .select("*")
    .eq("station_id", normalized.stationId)
    .eq("idempotency_key", normalized.idempotencyKey)
    .maybeSingle();

  if (readError) throw readError;
  if (!existing) throw new Error("Relationship write was not confirmed by the database.");
  const link = fromStored(existing as StoredRecordLink);
  if (
    link.from.type !== normalized.from.type ||
    link.from.id !== normalized.from.id ||
    link.to.type !== normalized.to.type ||
    link.to.id !== normalized.to.id ||
    link.relationship !== normalized.relationship
  ) {
    throw new Error("Idempotency key already belongs to a different record relationship.");
  }
  return link;
}

export async function listRecordRelationships(
  stationId: string,
  record: { type: FuelProRecordType; id: string },
): Promise<RecordLink[]> {
  if (!stationId.trim() || !record.id.trim()) {
    throw new Error("Station and record ID are required.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("record_relationships")
    .select("*")
    .eq("station_id", stationId)
    .or(
      `and(source_record_type.eq.${record.type},source_record_id.eq.${record.id}),and(target_record_type.eq.${record.type},target_record_id.eq.${record.id})`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => fromStored(row as StoredRecordLink));
}

/** Named workflow helpers keep relation direction consistent across modules. */
export const recordLinkWorkflows = {
  invoiceToQuotation(input: { stationId: string; invoiceId: string; quotationId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "invoice", id: input.invoiceId, stationId: input.stationId },
      to: { type: "quotation", id: input.quotationId, stationId: input.stationId },
      relationship: "derived_from",
      idempotencyKey: `invoice-to-quotation:${input.invoiceId}:${input.quotationId}`,
      createdBy: input.userId,
    });
  },
  quotationToInvoice(input: { stationId: string; quotationId: string; invoiceId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "quotation", id: input.quotationId, stationId: input.stationId },
      to: { type: "invoice", id: input.invoiceId, stationId: input.stationId },
      relationship: "derived_from",
      idempotencyKey: `quotation-to-invoice:${input.quotationId}:${input.invoiceId}`,
      createdBy: input.userId,
    });
  },
  customerToDocument(input: { stationId: string; customerId: string; documentType: "quotation" | "invoice" | "receipt" | "customer_statement"; documentId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "customer", id: input.customerId, stationId: input.stationId },
      to: { type: input.documentType, id: input.documentId, stationId: input.stationId },
      relationship: "issued_to",
      idempotencyKey: `customer-document:${input.customerId}:${input.documentType}:${input.documentId}`,
      createdBy: input.userId,
    });
  },
  invoiceToReceipt(input: { stationId: string; invoiceId: string; receiptId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "invoice", id: input.invoiceId, stationId: input.stationId },
      to: { type: "receipt", id: input.receiptId, stationId: input.stationId },
      relationship: "settles",
      idempotencyKey: `invoice-to-receipt:${input.invoiceId}:${input.receiptId}`,
      createdBy: input.userId,
    });
  },
  receiptToPayment(input: { stationId: string; receiptId: string; paymentId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "receipt", id: input.receiptId, stationId: input.stationId },
      to: { type: "payment", id: input.paymentId, stationId: input.stationId },
      relationship: "references",
      idempotencyKey: `receipt-to-payment:${input.receiptId}:${input.paymentId}`,
      createdBy: input.userId,
    });
  },
  employeeToTask(input: { stationId: string; employeeId: string; taskId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "employee", id: input.employeeId, stationId: input.stationId },
      to: { type: "task", id: input.taskId, stationId: input.stationId },
      relationship: "assigned_to",
      idempotencyKey: `employee-task:${input.employeeId}:${input.taskId}`,
      createdBy: input.userId,
    });
  },
  employeeToPayroll(input: { stationId: string; employeeId: string; payrollId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "employee", id: input.employeeId, stationId: input.stationId },
      to: { type: "payroll", id: input.payrollId, stationId: input.stationId },
      relationship: "references",
      idempotencyKey: `employee-payroll:${input.employeeId}:${input.payrollId}`,
      createdBy: input.userId,
    });
  },
  payrollToPayslip(input: { stationId: string; payrollId: string; payslipId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "payroll", id: input.payrollId, stationId: input.stationId },
      to: { type: "payslip", id: input.payslipId, stationId: input.stationId },
      relationship: "derived_from",
      idempotencyKey: `payroll-payslip:${input.payrollId}:${input.payslipId}`,
      createdBy: input.userId,
    });
  },
  paymentToStatement(input: { stationId: string; paymentId: string; statementId: string; userId: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: "payment", id: input.paymentId, stationId: input.stationId },
      to: { type: "customer_statement", id: input.statementId, stationId: input.stationId },
      relationship: "references",
      idempotencyKey: `payment-statement:${input.paymentId}:${input.statementId}`,
      createdBy: input.userId,
    });
  },
  reversal(input: { stationId: string; originalType: FuelProRecordType; originalId: string; reversalType: FuelProRecordType; reversalId: string; userId: string; reason: string; idempotencyKey: string }) {
    return createRecordRelationship({
      stationId: input.stationId,
      from: { type: input.originalType, id: input.originalId, stationId: input.stationId },
      to: { type: input.reversalType, id: input.reversalId, stationId: input.stationId },
      relationship: "reverses",
      idempotencyKey: input.idempotencyKey,
      createdBy: input.userId,
      metadata: { reason: input.reason },
    });
  },
};

/**
 * Mark a quotation as converted in its existing authoritative station KV
 * store. This blocks a second invoice even if the relationship write is
 * temporarily unavailable. The relation table remains the cross-module audit.
 */
export async function markQuotationConverted(
  stationId: string,
  quotationId: string,
  invoiceId: string,
): Promise<void> {
  const quotes = await cloudStorageService.get<Array<Record<string, unknown>>>(
    "quotations",
    stationId,
  );
  if (!Array.isArray(quotes)) {
    throw new Error("The authoritative quotation list could not be read.");
  }
  const index = quotes.findIndex((quote) => quote.id === quotationId);
  if (index < 0) {
    throw new Error("The source quotation no longer exists.");
  }
  const current = quotes[index];
  const convertedInvoiceId =
    typeof current.convertedInvoiceId === "string"
      ? current.convertedInvoiceId
      : "";
  if (convertedInvoiceId && convertedInvoiceId !== invoiceId) {
    throw new Error(`Quotation is already converted to invoice ${convertedInvoiceId}.`);
  }
  const next = quotes.map((quote, i) =>
    i === index
      ? {
          ...quote,
          convertedInvoiceId: invoiceId,
          convertedAt:
            typeof quote.convertedAt === "string"
              ? quote.convertedAt
              : new Date().toISOString(),
        }
      : quote,
  );
  await cloudStorageService.set("quotations", next, stationId);
}
