import { describe, it, expect } from "vitest";
import {
  parseMpesaLines,
  parseMpesaRows,
  detectFormat,
  isPasswordProtectedPdfError,
  type MpesaRow,
} from "@/react-app/lib/mpesa-statement-parser";

/** The NEW M-PESA merchant-account grid layout (from a real Safaricom statement). */
const NEW_GRID_ROWS = [
  "TIA9B1U5VV 2025-09-10 18:26:58 Merchant Payment Online from Completed 2,000.00 0.00 43,336.47 Customer Merchant 578590-",
  "18:26:58 254727***578 - ESTHER",
  "IKARU Payment ENERGY",
  "TIA9B1U5VV 2025-09-10 Pay merchant Charge Completed 0.00 11.00 43,325.47 Customer Merchant 578590-",
  "18:26:58 Merchant PUBLICAN",
  "Payment ENERGY",
  "TIA8B1QHBW 2025-09-10 18:26:36 Merchant Payment from Completed 100.00 0.00 41,336.47 Customer Merchant 578590-",
  "18:26:36 0790***511 - David Ekaru Lokopon",
  "TIA3B1JEHL 2025-09-10 18:25:50 Merchant Payment from Completed 100.00 0.00 41,236.47 Customer Merchant 578590-",
  "18:25:50 0726***187 - Felix Lokiriama Lokui",
  "TIA0B1BSCM 2025-09-10 18:25:01 Merchant Payment from Completed 200.00 0.00 41,136.47 Customer Merchant 578590-",
  "18:25:01 254710***507 - ROGERS OLUKOYE OTIANYA",
];

/** The OLD flat format: one transaction per line. */
const OLD_FLAT_ROWS = [
  "Receipt No | Completion Time | Details | Transaction Status | Paid in | Withdrawn | Balance",
  "TIA1A1AAAA 2025-09-10 18:26:58 Merchant Payment from 254727***578 - ESTHER IKARU Completed 2,000.00 0.00 43,336.47 Customer Merchant Payment",
  "TIA1A2BBBB 2025-09-11 09:12:33 Merchant Payment from 0790***511 - DAVID EKARU Completed 500.00 0.00 44,000.00 Customer Merchant Payment",
];

/** OCR / pasted scan: wrapped lines, no x/y, columns may be lost. */
const OCR_ROWS = [
  "MPESA",
  "Confirmed. You have received Ksh500.00 from",
  "DAVID EKARU 254727123456 on 10/9/2025 at 6:26 PM",
  "New M-PESA balance is Ksh43,336.00",
  "Merchant Payment from 254727123456 - ESTHER IKARU",
  "Completed",
  "2,000.00",
  "0.00",
  "43,336.47",
];

describe("detectFormat", () => {
  it("detects the new grid layout", () => {
    const rows: MpesaRow[] = NEW_GRID_ROWS.map((t) => ({ text: t }));
    expect(detectFormat(rows)).toBe("grid");
  });

  it("detects the old flat layout", () => {
    const rows: MpesaRow[] = OLD_FLAT_ROWS.map((t) => ({ text: t }));
    expect(detectFormat(rows)).toBe("flat");
  });

  it("detects an OCR/scan layout", () => {
    const rows: MpesaRow[] = OCR_ROWS.map((t) => ({ text: t }));
    expect(detectFormat(rows)).toBe("scan");
  });

  it("is password detection correct", () => {
    expect(isPasswordProtectedPdfError("No password given")).toBe(true);
    expect(isPasswordProtectedPdfError("Invalid password entered")).toBe(true);
    expect(isPasswordProtectedPdfError("PasswordException: encrypted")).toBe(
      true,
    );
    expect(isPasswordProtectedPdfError("document is encrypted")).toBe(true);
    expect(isPasswordProtectedPdfError("failed to load PDF document")).toBe(
      false,
    );
    expect(isPasswordProtectedPdfError("Missing or invalid xref")).toBe(false);
  });
});

describe("parseMpesaLines — NEW grid format", () => {
  it("extracts all Merchant Payment inflows", () => {
    const { inflows, format, candidates } = parseMpesaLines(NEW_GRID_ROWS);

    expect(format).toBe("grid");
    expect(candidates).toBeGreaterThanOrEqual(5);
    // 4 inflows: online 2000 + 100 + 100 + 200
    expect(inflows).toHaveLength(4);

    const online = inflows.find((i) => i.receipt === "TIA9B1U5VV");
    expect(online?.isOnline).toBe(true);
    expect(online?.paidIn).toBe(2000);
    expect(online?.balance).toBe(43336.47);
    expect(online?.date).toBe("2025-09-10");

    // Full name + phone reconstructed across continuation rows
    const byrd = inflows.find((i) => i.receipt === "TIA8B1QHBW");
    expect(byrd?.paidIn).toBe(100);
    expect(byrd?.details).toContain("David Ekaru");
    expect(byrd?.details).toContain("0790***511");
  });

  it("excludes merchant charges", () => {
    const { excluded } = parseMpesaLines(NEW_GRID_ROWS);
    expect(excluded.length).toBe(1);
    expect(excluded[0].type).toBe("merchant_charge");
    expect(excluded[0].amount).toBe(11);
  });
});

describe("parseMpesaLines — OLD flat format", () => {
  it("keeps working for single-line transactions", () => {
    const { inflows, excluded } = parseMpesaLines(OLD_FLAT_ROWS);
    expect(inflows).toHaveLength(2);
    expect(inflows[0].paidIn).toBe(2000);
    expect(inflows[0].receipt).toBe("TIA1A1AAAA");
    expect(inflows[0].details).toContain("ESTHER IKARU");
    expect(excluded).toHaveLength(0);
  });
});

describe("parseMpesaLines — OCR / scan (no spatial info)", () => {
  it("extracts from OCR-friend keyword rows", () => {
    const { inflows } = parseMpesaLines(OCR_ROWS);
    expect(inflows.length).toBeGreaterThan(0);
    const rec = inflows[0];
    expect(rec.paidIn).toBe(2000);
    expect(rec.balance).toBe(43336.47);
    expect(rec.details.toLowerCase()).toContain("esther ikaru");
  });
});

describe("parseMpesaRows — real-world adaptive recognition", () => {
  it("recognizes 'Small Business Pay Merchant' as an inflow", () => {
    const rows: MpesaRow[] = [
      "TIA5A5QSVF 2025-09-10 Small Business Pay Merchant Completed 100.00 0.00 26,275.19 Customer 578590-",
      "15:54:48 from 0745***444 - EREGAE Merchant PUBLICAN",
      "NGASIKE Payment ENERGY",
    ].map((text) => ({ text }));
    const { inflows, excluded } = parseMpesaRows(rows);
    expect(inflows.length).toBe(1);
    expect(inflows[0].paidIn).toBe(100);
    expect(inflows[0].receipt).toBe("TIA5A5QSVF");
    expect(inflows[0].details.toLowerCase()).toContain("eregae");
    expect(excluded.length).toBe(0);
  });

  it("excludes merchant charges with exact amounts (no time/shortcode pollution)", () => {
    const rows: MpesaRow[] = [
      "TIA9B1U5VV 2025-09-10 18:26:58 Merchant Payment Online from Completed 2,000.00 0.00 43,336.47 Customer Merchant 578590-",
      "18:26:58 254727***578 - ESTHER",
      "IKARU Payment ENERGY",
      "TIA9B1U5VV 2025-09-10 Pay merchant Charge Completed 0.00 11.00 43,325.47 Customer Merchant 578590-",
      "18:26:58 Merchant PUBLICAN",
      "Payment ENERGY",
    ].map((text) => ({ text }));
    const { inflows, excluded } = parseMpesaRows(rows);
    expect(inflows.length).toBe(1);
    expect(inflows[0].paidIn).toBe(2000);
    expect(
      excluded.some((e) => e.type === "merchant_charge" && e.amount === 11),
    ).toBe(true);
  });
});

describe("parseMpesaRows with spatial data", () => {
  it("handles rows with x/y coordinates", () => {
    const rows: MpesaRow[] = [
      {
        text: "TIA9B1U5VV 2025-09-10 18:26:58 Merchant Payment Online from Completed 2,000.00 0.00 43,336.47 Customer Merchant 578590-",
        x: 43,
        y: 450,
      },
      { text: "18:26:58 254727***578 - ESTHER", x: 43, y: 443 },
      { text: "IKARU", x: 43, y: 436 },
      {
        text: "TIA8B1QHBW 2025-09-10 18:26:36 Merchant Payment from Completed 100.00 0.00 41,336.47 Customer Merchant 578590-",
        x: 43,
        y: 425,
      },
      { text: "18:26:36 0790***511 - David Ekaru Lokopon", x: 43, y: 418 },
    ];
    const { inflows } = parseMpesaRows(rows);
    expect(inflows).toHaveLength(2);
    expect(inflows.find((i) => i.receipt === "TIA9B1U5VV")?.details).toContain(
      "ESTHER",
    );
  });
});
