import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  extractComplianceFieldsFromText,
  extractFromFilename,
  mergeFilenameAndTextFields,
} from "@/react-app/lib/compliance-doc-parser";
import {
  mergeRequiredPermits,
  addCustomRequiredPermit,
  removeCustomRequiredPermit,
} from "@/react-app/lib/compliance-documents";

/**
 * Fixtures are the REAL OCR output (tesseract.js) of the station's actual
 * scanned compliance documents, so these tests exercise the exact text the
 * visual-analysis pipeline produces in production.
 */
const KE_PERMITS = [
  "KRA VAT Registration",
  "EPRA License",
  "NEMA Environmental Certificate",
  "County Trade License",
];

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", "ocr", name), "utf8");
}

describe("OCR text extraction — real scanned documents", () => {
  it("Single Business Permit (scan): type, dates, receipt reference", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("SINGLE_BUSINESS_PERMIT.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("Single Business Permit");
    expect(ex.issueDate).toBe("2025-01-16"); // "Issued on: 16:01:2025"
    expect(ex.expiryDate).toBe("2028-12-31"); // "Valid To: 31-12-2028"
    expect(ex.reference).toBe("RC2S016T3TVN"); // "Receipt No: RC2S016T3TVN-"
    expect(ex.name).toBe("Single Business Permit"); // NOT "CamScanner"
  });

  it("KRA Tax Compliance Certificate (scan): type, issuer, PIN, dates", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("Tax_Compliance_Certificate.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("Tax Compliance Certificate");
    expect(ex.issuer).toBe("Kenya Revenue Authority (KRA)");
    expect(ex.reference).toBe("P051431777E"); // KRA PIN beats OCR layout noise
    expect(ex.issueDate).toBe("2025-06-20"); // "Certificate Date: 20/06/2025"
    expect(ex.expiryDate).toBe("2026-06-19"); // "valid … up to 19/06/2026"
  });

  it("County fire certificate (scan): type + county issuer", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("FIRE_Compliance_TRUCK.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("Fire Safety Compliance Certificate");
    expect(ex.issuer).toBe("County Government of Uasin Gishu");
  });

  it("NTSA inspection e-sticker (text PDF): type, issuer, serial, expiry, plate", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("KCQ_Inspection_Certificate.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("NTSA Vehicle Inspection Certificate");
    expect(ex.issuer).toBe("National Transport and Safety Authority (NTSA)");
    expect(ex.reference).toBe("ICELD202410020008");
    expect(ex.expiryDate).toBe("2025-10-01"); // "EXPIRY DATE 2025/10/01"
    expect(ex.issueDate).toBeUndefined(); // never mirror expiry into issue
    expect(ex.name).toBe("NTSA Vehicle Inspection Certificate — KCQ 783J");
  });

  it("Road Tanker Calibration Certificate (scan): type + W&M issuer", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("ROAD_TANKER_CALIBRATION_CERTIFICATE.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("Road Tanker Calibration Certificate");
    expect(ex.issuer).toBe("County Inspectorate — Weights & Measures");
  });

  it("CR12 (scan): registrar issuer + full reference, no garbage type", () => {
    const ex = extractComplianceFieldsFromText(fixture("CR12.txt"), KE_PERMITS);
    expect(ex.issuer).toBe(
      "Business Registration Service (Registrar of Companies)",
    );
    expect(ex.reference).toBe("0S-02,XD69X"); // "REF NO: 0S-02,XD69X"
    // "Date of Registration" is a field label, never a document type.
    expect(ex.permitType).toBeUndefined();
  });

  it("Emergency Response Plan: type + prepared date, no invented expiry", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("EMERGENCY_RESPONSE_PLAN.txt"),
      KE_PERMITS,
    );
    expect(ex.permitType).toBe("Emergency Response Plan");
    expect(ex.issueDate).toBe("2025-05-11"); // "DOCUMENT PREPARED: 11TH May 2025"
    expect(ex.expiryDate).toBeUndefined(); // ERPs don't expire
  });

  it("Directors' ID scan: unreadable photo falls back without crashing", () => {
    const ex = extractComplianceFieldsFromText(
      fixture("Copies_of_Directors_ID_(1).txt"),
      KE_PERMITS,
    );
    // Garbage OCR must never produce a field-label type.
    expect(ex.permitType).toBeUndefined();
  });
});

describe("OCR garbage resilience (regressions from live browser scans)", () => {
  it("parses the exact browser-OCR'd Single Business Permit line", () => {
    // Real tesseract output at pdfjs scale 2.0: "Issued on 16:01 2025" (one
    // colon), "Valid To" garbled to "Nabd To", ")" for "1" in the expiry.
    const ex = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\n" +
        "Issued By: Miriam Ekeno(Mekéno). Pol\n" +
        "Issued on 16:01 2025 ; oo Nabd To: 31-)2-2028 Receipt No: RC25016T3TVNA\n",
      KE_PERMITS,
    );
    expect(ex.issueDate).toBe("2025-01-16");
    expect(ex.expiryDate).toBe("2028-12-31");
    expect(ex.issuer).toBe("Miriam Ekeno(Mekéno)");
  });

  it("mixed separators (16:03-2025) parse and never steal the expiry date", () => {
    // Real chromium tesseract output: "Issued on: 16:03-2025 7, 7 Valid To: 31-12-2028"
    const ex = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\n" +
        "Issued By: Miriam Ekeno(Mekéno). Pol\n" +
        "Issued on: 16:03-2025 7, 7 Valid To: 31-12-2028 Receipt No: RC25016T3 TVR\n",
      KE_PERMITS,
    );
    expect(ex.issueDate).toBe("2025-03-16"); // OCR's own reading (01→03)
    expect(ex.expiryDate).toBe("2028-12-31");
    expect(ex.issueDate).not.toBe(ex.expiryDate);
  });

  it("recovers the fused '2006/2025' certificate date and the 'valid for twelve months' expiry", () => {
    // Real chromium tesseract output for the Tax Compliance Certificate:
    // "Cortificate Date: 2006/2025" (fused dd+mm, misspelled label) and
    // "valid for twelve (12) months up to 19/06/2026".
    const ex = extractComplianceFieldsFromText(
      "TAX COMPLIANCE CERTIFICATE\n" +
        "Taxpayer PIN: P051431777E Cortificate Date: 2006/2025\n" +
        "This Certificate will be valid for\n" +
        "twelve (12) months up to 19/06/2026.\n",
      KE_PERMITS,
    );
    expect(ex.issueDate).toBe("2025-06-20");
    expect(ex.expiryDate).toBe("2026-06-19");
  });

  it("never steals another field's date when the label's own date is garbled", () => {
    const ex = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\nIssued By: Miriam Ekeno. or ie\n" +
        "Issued on: ?? ?? Valid To: 31-12-2028 Receipt No: RC2S016T3TVN-",
      KE_PERMITS,
    );
    expect(ex.expiryDate).toBe("2028-12-31");
    expect(ex.issueDate).not.toBe("2028-12-31"); // must NOT mirror expiry
    expect(ex.issueDate).toBeUndefined();
  });

  it("strips trailing OCR fragments from the issuing authority", () => {
    const ex = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\nIssued By: Miriam Ekeno(Mekéno)- Pa ol :\n" +
        "Valid To: 31-12-2028",
      KE_PERMITS,
    );
    expect(ex.issuer).toBe("Miriam Ekeno(Mekéno)");
  });

  it("keeps real multi-word authority names intact", () => {
    const ex = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\nIssued By: Turkana County Government\n" +
        "Valid To: 31-12-2028",
      KE_PERMITS,
    );
    expect(ex.issuer).toBe("County Government of Turkana"); // normalized
    const ex2 = extractComplianceFieldsFromText(
      "SINGLE BUSINESS PERMIT\nIssued By: County Government of Uasin Gishu\n" +
        "Valid To: 31-12-2028",
      KE_PERMITS,
    );
    expect(ex2.issuer).toBe("County Government of Uasin Gishu");
  });
});

describe("filename heuristics + merge precedence", () => {
  it("recognizes catalogue types from filenames", () => {
    expect(extractFromFilename("CR12.pdf").permitType).toBe(
      "CR12 — Registrar of Companies",
    );
    expect(
      extractFromFilename("Copies of Directors ID (1).pdf").permitType,
    ).toBe("Directors' National Identity Cards");
    expect(extractFromFilename("KCQ 738J LOGBOOK.pdf").permitType).toBe(
      "Vehicle Logbook",
    );
    expect(
      extractFromFilename("ROAD TANKER CALIBRATION CERTIFICATE.pdf").permitType,
    ).toBe("Road Tanker Calibration Certificate");
    expect(
      extractFromFilename("EMERGENCY RESPONSE PLAN THE PUBLICAN ENERGY (1).pdf")
        .permitType,
    ).toBe("Emergency Response Plan");
  });

  it("filename catalogue type beats a weak generic OCR phrase", () => {
    const fromText = extractComplianceFieldsFromText(
      fixture("KCQ_738J_LOGBOOK.txt"),
      KE_PERMITS,
    );
    const fromName = extractFromFilename("KCQ 738J LOGBOOK.pdf");
    const merged = mergeFilenameAndTextFields(fromName, fromText, KE_PERMITS);
    expect(merged.permitType).toBe("Vehicle Logbook");
    expect(merged.name).toBe("Vehicle Logbook");
  });

  it("filename wins the name when OCR text produced no type", () => {
    const fromText = extractComplianceFieldsFromText(
      fixture("CR12.txt"),
      KE_PERMITS,
    );
    const fromName = extractFromFilename("CR12.pdf");
    const merged = mergeFilenameAndTextFields(fromName, fromText, KE_PERMITS);
    expect(merged.permitType).toBe("CR12 — Registrar of Companies");
    expect(merged.name).toBe("CR12"); // not the garbled OCR first line
    expect(merged.issuer).toBe(
      "Business Registration Service (Registrar of Companies)",
    );
    expect(merged.reference).toBe("0S-02,XD69X");
  });

  it("text-derived structured fields win when the text type is catalogue-matched", () => {
    const fromText = extractComplianceFieldsFromText(
      fixture("SINGLE_BUSINESS_PERMIT.txt"),
      KE_PERMITS,
    );
    const fromName = extractFromFilename("SINGLE BUSINESS PERMIT.pdf");
    const merged = mergeFilenameAndTextFields(fromName, fromText, KE_PERMITS);
    expect(merged.permitType).toBe("Single Business Permit");
    expect(merged.issueDate).toBe("2025-01-16");
    expect(merged.expiryDate).toBe("2028-12-31");
    expect(merged.name).toBe("Single Business Permit"); // never "CamScanner"
  });
});

describe("custom required compliance documents (auto-add)", () => {
  it("merges base + custom deduped (case/whitespace-insensitive)", () => {
    const merged = mergeRequiredPermits(
      ["EPRA License", "NEMA Environmental Certificate"],
      ["  epra   license ", "Fire Safety Compliance Certificate"],
    );
    expect(merged).toEqual([
      "EPRA License",
      "NEMA Environmental Certificate",
      "Fire Safety Compliance Certificate",
    ]);
  });

  it("adds a new custom permit exactly once", () => {
    const first = addCustomRequiredPermit([], "Single Business Permit");
    expect(first.added).toBe(true);
    expect(first.list).toEqual(["Single Business Permit"]);
    const dup = addCustomRequiredPermit(first.list, "single   business PERMIT");
    expect(dup.added).toBe(false);
    expect(dup.list).toEqual(["Single Business Permit"]);
  });

  it("rejects blank permits", () => {
    const r = addCustomRequiredPermit([], "   ");
    expect(r.added).toBe(false);
    expect(r.list).toEqual([]);
  });

  it("removes a custom permit case-insensitively", () => {
    const list = ["Fire Safety Compliance Certificate", "Vehicle Logbook"];
    expect(removeCustomRequiredPermit(list, "vehicle   logbook")).toEqual([
      "Fire Safety Compliance Certificate",
    ]);
  });
});
