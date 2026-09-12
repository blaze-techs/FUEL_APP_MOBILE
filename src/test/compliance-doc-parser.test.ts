import { describe, it, expect } from "vitest";
import {
  extractComplianceFieldsFromText,
  extractFromFilename,
  mergeExtractedIntoDoc,
  parseDateToken,
} from "@/react-app/lib/compliance-doc-parser";
import { newComplianceDoc } from "@/react-app/lib/compliance-documents";

const US_PERMITS = [
  "State Fuel Dealer License",
  "EPA Compliance Certificate",
  "State Environmental Permit",
  "Local Business License",
];

describe("parseDateToken", () => {
  it("parses common formats to ISO", () => {
    expect(parseDateToken("12 March 2026")).toBe("2026-03-12");
    expect(parseDateToken("12th March, 2026")).toBe("2026-03-12");
    expect(parseDateToken("March 5, 2026")).toBe("2026-03-05");
    expect(parseDateToken("2026-03-12")).toBe("2026-03-12");
    expect(parseDateToken("31/12/2026")).toBe("2026-12-31"); // day-first
    expect(parseDateToken("12/31/2026")).toBe("2026-12-31"); // month>12 flip
    expect(parseDateToken("05.06.2026")).toBe("2026-06-05"); // default day-first
  });

  it("rejects impossible dates", () => {
    expect(parseDateToken("32/13/2026")).toBeUndefined();
    expect(parseDateToken("not a date")).toBeUndefined();
  });
});

describe("extractComplianceFieldsFromText", () => {
  const PERMIT_PDF_TEXT = `
    ENVIRONMENTAL PROTECTION AGENCY
    EPA COMPLIANCE CERTIFICATE
    Certificate No: EPA-2026-00451
    This is to certify that Founder Admin Station has complied with all
    underground storage tank requirements.
    Issued by: Environmental Protection Agency
    Contact: licensing@epa.gov
    Date of Issue: 01 February 2026
    Expiry Date: 31 January 2027
  `;

  it("extracts permit type, issuer, email, dates and reference", () => {
    const ex = extractComplianceFieldsFromText(PERMIT_PDF_TEXT, US_PERMITS);
    expect(ex.permitType).toBe("EPA Compliance Certificate");
    expect(ex.issuer).toMatch(/Environmental Protection Agency/i);
    expect(ex.issuerEmail).toBe("licensing@epa.gov");
    expect(ex.issueDate).toBe("2026-02-01");
    expect(ex.expiryDate).toBe("2027-01-31");
    expect(ex.reference).toBe("EPA-2026-00451");
    expect(ex.name).toBe("EPA Compliance Certificate");
  });

  it("handles unlabelled dates (earliest = issue, latest = expiry)", () => {
    const ex = extractComplianceFieldsFromText(
      "Fire Safety Certificate. This permit is valid. 10/01/2026 to 09/01/2027.",
      [],
    );
    expect(ex.issueDate).toBe("2026-01-10");
    expect(ex.expiryDate).toBe("2027-01-09");
  });

  it("prefers a verbatim required-permit mention over generic phrases", () => {
    const ex = extractComplianceFieldsFromText(
      "This document certifies your Local Business License renewal. " +
        "Issued by County Government. Valid until 15/08/2027.",
      US_PERMITS,
    );
    expect(ex.permitType).toBe("Local Business License");
    expect(ex.expiryDate).toBe("2027-08-15");
  });

  it("returns empty object for blank text", () => {
    expect(extractComplianceFieldsFromText("   \n  ")).toEqual({});
  });
});

describe("extractFromFilename", () => {
  it("uses the filename as a name hint", () => {
    const ex = extractFromFilename("fire_certificate_2026.pdf");
    expect(ex.name).toBe("Fire certificate 2026");
    expect(ex.permitType).toBe("Fire certificate 2026");
  });
});

describe("mergeExtractedIntoDoc", () => {
  it("fills only EMPTY fields and appends the reference to notes", () => {
    const doc = newComplianceDoc({
      name: "My Typed Name",
      permitType: "Already Set",
    });
    const { doc: merged, filled } = mergeExtractedIntoDoc(doc, {
      name: "EPA Compliance Certificate",
      permitType: "Other",
      issuer: "EPA",
      issuerEmail: "licensing@epa.gov",
      issueDate: "2026-02-01",
      expiryDate: "2027-01-31",
      reference: "EPA-2026-00451",
    });
    // user-typed values are never overwritten
    expect(merged.name).toBe("My Typed Name");
    expect(merged.permitType).toBe("Already Set");
    // empty fields get filled
    expect(merged.issuer).toBe("EPA");
    expect(merged.issuerEmail).toBe("licensing@epa.gov");
    expect(merged.issueDate).toBe("2026-02-01");
    expect(merged.expiryDate).toBe("2027-01-31");
    expect(merged.notes).toContain("EPA-2026-00451");
    expect(filled).toEqual(
      expect.arrayContaining([
        "issuing authority",
        "authority email",
        "issue date",
        "expiry date",
        "reference no.",
      ]),
    );
    expect(filled).not.toContain("name");
    expect(filled).not.toContain("permit type");
  });

  it("does not duplicate the reference in notes", () => {
    const doc = newComplianceDoc({ notes: "Ref: EPA-2026-00451" });
    const { doc: merged } = mergeExtractedIntoDoc(doc, {
      reference: "EPA-2026-00451",
    });
    expect(merged.notes).toBe("Ref: EPA-2026-00451");
  });
});
