import { describe, it, expect } from "vitest";
import {
  computeDocStatus,
  daysUntilExpiry,
  filterComplianceDocs,
  newComplianceDoc,
  needsAutoRenewal,
  removeComplianceDoc,
  rollExpiry,
  summarizeComplianceDocs,
  upsertComplianceDoc,
  dateToPeriod,
  compliancePeriodLabel,
  buildRenewalLetterPdf,
  checkRequiredCoverage,
  docCoversPermit,
  type ComplianceDocument,
} from "@/react-app/lib/compliance-documents";

const NOW = new Date("2026-09-04T12:00:00Z");

function doc(p: Partial<ComplianceDocument>): ComplianceDocument {
  return newComplianceDoc({ name: "Test Permit", ...p });
}

describe("computeDocStatus", () => {
  it("marks docs with no expiry date", () => {
    const r = computeDocStatus(doc({ expiryDate: "" }), NOW);
    expect(r.status).toBe("no-expiry");
    expect(r.daysLeft).toBeNull();
  });

  it("marks active when expiry is beyond the reminder window", () => {
    const r = computeDocStatus(
      doc({ expiryDate: "2026-12-31", reminderDays: 30 }),
      NOW,
    );
    expect(r.status).toBe("active");
    expect(r.daysLeft).toBeGreaterThan(30);
  });

  it("marks expiring within the reminder window", () => {
    const r = computeDocStatus(
      doc({ expiryDate: "2026-09-20", reminderDays: 30 }),
      NOW,
    );
    expect(r.status).toBe("expiring");
    expect(r.daysLeft).toBe(16);
  });

  it("marks expired past the expiry date", () => {
    const r = computeDocStatus(doc({ expiryDate: "2026-08-31" }), NOW);
    expect(r.status).toBe("expired");
    expect(r.daysLeft).toBeLessThan(0);
  });

  it("marks renewal-pending when auto-renew already handled this expiry", () => {
    const r = computeDocStatus(
      doc({
        expiryDate: "2026-08-31",
        autoRenewedFor: "2026-08-31",
        renewalRequestedAt: "2026-09-01T00:00:00Z",
      }),
      NOW,
    );
    expect(r.status).toBe("renewal-pending");
  });

  it("handles invalid dates gracefully", () => {
    expect(daysUntilExpiry(doc({ expiryDate: "not-a-date" }), NOW)).toBeNull();
  });
});

describe("needsAutoRenewal", () => {
  it("triggers only for expired docs with autoRenew on", () => {
    expect(
      needsAutoRenewal(doc({ expiryDate: "2026-08-01", autoRenew: true }), NOW),
    ).toBe(true);
    expect(
      needsAutoRenewal(
        doc({ expiryDate: "2026-08-01", autoRenew: false }),
        NOW,
      ),
    ).toBe(false);
    expect(
      needsAutoRenewal(doc({ expiryDate: "2027-01-01", autoRenew: true }), NOW),
    ).toBe(false);
  });

  it("does not re-trigger for an already-handled expiry (dedup)", () => {
    expect(
      needsAutoRenewal(
        doc({
          expiryDate: "2026-08-01",
          autoRenew: true,
          autoRenewedFor: "2026-08-01",
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("upsert/remove", () => {
  it("prepends new docs and updates existing ones by id", () => {
    const a = doc({ id: "a", name: "A" });
    const b = doc({ id: "b", name: "B" });
    let list = upsertComplianceDoc([], a);
    list = upsertComplianceDoc(list, b);
    expect(list.map((d) => d.id)).toEqual(["b", "a"]);
    list = upsertComplianceDoc(list, { ...a, name: "A2" });
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.id === "a")?.name).toBe("A2");
  });

  it("removes by id", () => {
    const list = [doc({ id: "a" }), doc({ id: "b" })];
    expect(removeComplianceDoc(list, "a").map((d) => d.id)).toEqual(["b"]);
  });
});

describe("filterComplianceDocs (period records)", () => {
  const docs = [
    doc({
      id: "1",
      name: "EPRA Licence",
      issuer: "EPRA",
      expiryDate: "2026-08-31",
      issueDate: "2025-08-01",
    }),
    doc({
      id: "2",
      name: "Fire Certificate",
      issuer: "County",
      expiryDate: "2026-12-15",
      issueDate: "2025-12-01",
    }),
    doc({
      id: "3",
      name: "NEMA Permit",
      issuer: "NEMA",
      expiryDate: "",
      issueDate: "2024-03-10",
    }),
  ];

  it("filters by expiry month", () => {
    const r = filterComplianceDocs(docs, { month: 8 }, NOW);
    expect(r.map((d) => d.id)).toEqual(["1"]);
  });

  it("filters by year across expiry/issue/created", () => {
    // 2025 = issue year of docs 1+2 (doc 3 was issued 2024)
    const r = filterComplianceDocs(docs, { year: 2025 }, NOW);
    expect(r.map((d) => d.id).sort()).toEqual(["1", "2"]);
    // expiry year 2026 matches docs 1+2 as well (createdAt is "now" = 2026)
    const r2 = filterComplianceDocs(docs, { year: 2026 }, NOW);
    expect(r2.map((d) => d.id).sort()).toContain("1");
    expect(r2.map((d) => d.id).sort()).toContain("2");
  });

  it("matches issue-period too (record keeping)", () => {
    const r = filterComplianceDocs(docs, { month: 3, year: 2024 }, NOW);
    expect(r.map((d) => d.id)).toEqual(["3"]);
  });

  it("searches name/type/issuer", () => {
    expect(
      filterComplianceDocs(docs, { search: "nema" }, NOW).map((d) => d.id),
    ).toEqual(["3"]);
    expect(
      filterComplianceDocs(docs, { search: "certificate" }, NOW).map(
        (d) => d.id,
      ),
    ).toEqual(["2"]);
  });

  it("filters by computed status", () => {
    const r = filterComplianceDocs(docs, { status: "expired" }, NOW);
    expect(r.map((d) => d.id)).toEqual(["1"]);
  });

  it("expired filter includes renewal-pending docs (past expiry)", () => {
    const pending = doc({
      id: "4",
      name: "Renewal-pending permit",
      expiryDate: "2026-08-31",
      autoRenewedFor: "2026-08-31",
      renewalRequestedAt: "2026-09-01T00:00:00Z",
    });
    const list = [...docs, pending];
    const r = filterComplianceDocs(list, { status: "expired" }, NOW);
    expect(r.map((d) => d.id).sort()).toEqual(["1", "4"]);
    // the narrower "Renewal pending" filter only matches pending docs
    const r2 = filterComplianceDocs(list, { status: "renewal-pending" }, NOW);
    expect(r2.map((d) => d.id)).toEqual(["4"]);
  });
});

describe("required-permit coverage (upload check)", () => {
  const required = [
    "EPRA Licence",
    "Fire Certificate",
    "NEMA Environmental Permit",
  ];

  it("matches by permit type (two-way containment)", () => {
    expect(
      docCoversPermit(
        doc({ permitType: "EPRA Retail Licence" }),
        "EPRA Licence",
      ),
    ).toBe(true);
    expect(docCoversPermit(doc({ permitType: "EPRA" }), "EPRA Licence")).toBe(
      true,
    );
  });

  it("matches by document name and issuer keywords", () => {
    expect(
      docCoversPermit(
        doc({ name: "Fire Safety Cert 2026", issuer: "County Fire Dept" }),
        "Fire Certificate",
      ),
    ).toBe(true);
    expect(
      docCoversPermit(
        doc({ name: "Environmental Permit", issuer: "NEMA" }),
        "NEMA Environmental Permit",
      ),
    ).toBe(true);
    // a vague doc does NOT auto-cover a specific requirement
    expect(
      docCoversPermit(
        doc({ name: "NEMA approval", issuer: "NEMA" }),
        "NEMA Environmental Permit",
      ),
    ).toBe(false);
  });

  it("does not match unrelated documents", () => {
    expect(
      docCoversPermit(
        doc({ name: "Insurance Policy", permitType: "Insurance" }),
        "Fire Certificate",
      ),
    ).toBe(false);
  });

  it("checkRequiredCoverage splits covered vs missing", () => {
    const docs = [
      doc({ permitType: "EPRA Retail Licence" }),
      doc({ name: "Fire Certificate 2026" }),
    ];
    const r = checkRequiredCoverage(docs, required);
    expect(r.covered).toEqual(["EPRA Licence", "Fire Certificate"]);
    expect(r.missing).toEqual(["NEMA Environmental Permit"]);
    // with everything covered, missing is empty
    const full = checkRequiredCoverage(
      [...docs, doc({ permitType: "NEMA Environmental Permit" })],
      required,
    );
    expect(full.missing).toEqual([]);
  });
});

describe("rollExpiry", () => {
  it("rolls forward N months", () => {
    expect(rollExpiry("2026-08-31", 12)).toBe("2027-08-31");
    expect(rollExpiry("2026-01-31", 1)).toBe("2026-02-28"); // clamped
  });

  it("handles empty input (rolls from today)", () => {
    const r = rollExpiry("", 12);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(r)).toBe(true);
  });
});

describe("summarizeComplianceDocs", () => {
  it("counts statuses", () => {
    const docs = [
      doc({ expiryDate: "2027-01-01" }),
      doc({ expiryDate: "2026-09-10", reminderDays: 30 }),
      doc({ expiryDate: "2026-01-01" }),
      doc({ expiryDate: "" }),
    ];
    const s = summarizeComplianceDocs(docs, NOW);
    expect(s).toEqual({ total: 4, active: 2, expiring: 1, expired: 1 });
  });
});

describe("period helpers", () => {
  it("dateToPeriod parses ISO dates", () => {
    expect(dateToPeriod("2026-08-31")).toEqual({ year: 2026, month: 8 });
    expect(dateToPeriod("")).toBeNull();
    expect(dateToPeriod("junk")).toBeNull();
  });

  it("compliancePeriodLabel formats", () => {
    expect(compliancePeriodLabel(8, 2026)).toBe("August 2026");
  });
});

describe("buildRenewalLetterPdf", () => {
  it("generates a PDF letter with the document + station details", () => {
    const pdf = buildRenewalLetterPdf({
      doc: doc({
        name: "EPRA Retail Licence",
        permitType: "EPRA Licence",
        issuer: "EPRA",
        issueDate: "2025-08-01",
        expiryDate: "2026-08-31",
      }),
      stationName: "THE PUBLICAN ENERGY",
      stationAddress: "Lodwar",
      stationPhone: "0700000000",
      stationEmail: "info@publican.co.ke",
    });
    const text = pdf.output();
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(text.length).toBeGreaterThan(1000);
  });
});
