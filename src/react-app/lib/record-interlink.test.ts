import { describe, expect, it } from "vitest";
import {
  auditWorkforceLinks,
  calculateDocumentLines,
  fillMissingFields,
  normalizeRecordLink,
  validateRecordLink,
  type LinkDraft,
} from "@/react-app/lib/record-interlink";

const linkDraft: LinkDraft = {
  stationId: "station-1",
  from: { type: "quotation", id: "quote-1", stationId: "station-1" },
  to: { type: "invoice", id: "invoice-1", stationId: "station-1" },
  relationship: "derived_from",
  idempotencyKey: "quote-1-to-invoice-1",
  createdBy: "user-1",
};

describe("shared record interlink contract", () => {
  it("rejects cross-station links", () => {
    expect(() =>
      validateRecordLink({
        ...linkDraft,
        to: { ...linkDraft.to, stationId: "station-2" },
      }),
    ).toThrow(/Cross-station/);
  });

  it("rejects self-links", () => {
    expect(() =>
      validateRecordLink({
        ...linkDraft,
        to: { ...linkDraft.from },
      }),
    ).toThrow(/cannot link to itself/);
  });

  it("uses a stable relation id for retries", () => {
    expect(normalizeRecordLink(linkDraft).id).toBe(
      normalizeRecordLink(linkDraft).id,
    );
  });

  it("calculates totals from line items and rounds currency", () => {
    const result = calculateDocumentLines([
      { description: "Fuel", quantity: 2.5, unitPrice: 220.08, taxRate: 16 },
    ]);
    expect(result.lines[0].subtotal).toBe(550.2);
    expect(result.lines[0].tax).toBe(88.03);
    expect(result.totals.total).toBe(638.23);
  });

  it("fills blank fields without replacing existing destination data", () => {
    expect(
      fillMissingFields(
        { customerName: "", reference: "manually-edited" },
        { customerName: "Customer A", reference: "source-reference" },
      ),
    ).toEqual({
      customerName: "Customer A",
      reference: "manually-edited",
    });
  });

  it("reports missing payroll/payslip links by stable employee ID", () => {
    const result = auditWorkforceLinks(
      [
        { id: "employee-1", active: true },
        { id: "employee-2", active: true },
      ],
      [{ assigneeEmployeeIds: ["employee-1"], status: "open" }],
      ["employee-1"],
      [],
      ["employee-1"],
    );
    expect(result[0].assignedTaskCount).toBe(1);
    expect(result[0].eligibleForPayroll).toBe(true);
    expect(result[1].eligibleForPayroll).toBe(false);
    expect(result[1].payrollRecordId).toBeUndefined();
  });
});
