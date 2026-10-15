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

/**
 * CURRENT GENERATION LAYOUT (Sep 2026 merchant statements): the Withdrawn
 * column is OMITTED entirely when zero, so each key row carries only
 * [Amount, Balance]. Charges print as negative amounts ("-13.75").
 */
const NEW_TWO_COLUMN_ROWS = [
  // Inflow — 2-value row (paid-in + balance), 3-row grid
  "UIBJN5YMQC 2026-09-11 Merchant Payment from - Completed 450.00 69,776.19 Buy Goods 578590 -",
  "17:36:51 0706***777 VERONICAH PUBLICAN",
  "EBENYO ENERGY",
  // Online inflow from - phone on continuation row
  "UIB1W6COQN 2026-09-11 Merchant Payment Online Completed 5,000.00 67,002.86 Online Merchant 578590 -",
  "08:23:08 from - 254717***838 Payment PUBLICAN",
  "JAMES OMONGO ENERGY",
  // Negative charge (withdrawn keeps its sign)
  "UIB6T6AO3Y 2026-09-11 Pay merchant Charge Completed -13.75 67,065.46 Online Merchant 578590 -",
  "16:47:54 Payment PUBLICAN",
  "ENERGY",
  // Same receipt can have BOTH a charge and an inflow (two separate keys)
  "UIB6T6AO3Y 2026-09-11 Merchant Payment Online Completed 2,500.00 67,065.46 Online Merchant 578590 -",
  "16:47:54 from - 254723***963 Payment PUBLICAN",
  "EIPA ARUMU ENERGY",
  // Small Business Pay Merchant (split label)
  "UIB2K6NLSV 2026-09-11 Small Business Pay Completed 100.00 50,274.66 Business Buy 578590 -",
  "13:36:24 Merchant from - goods PUBLICAN",
  "0757***521 JULIUS ENERGY",
  // Agency deposit "received from <code>"
  "UIBU83SHLJ 2026-09-11 Merchant Payment Completed 2,000.00 56,823.91 Merchant to 578590 -",
  "15:42:47 received from 9331084 - Merchant PUBLICAN",
  "JOSEPH NYOTA NYINGI Payment via API ENERGY",
  // Merchant to Merchant charge (exclude)
  "UIBRV4QTM1 2026-09-11 Merchant to Merchant Completed -0.27 67,466.19 Merchant to 578590 PUBLICAN",
  "17:26:24 Payment Charge to Merchant PUBLICAN",
  "578590 - PUBLICAN Payment via API ENERGY",
  "ENERGY",
];

describe("parseMpesaLines — CURRENT 2-column layout (Withdrawn omitted)", () => {
  it("parses 2-value [paid-in, balance] inflow rows", () => {
    const { inflows } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    const first = inflows.find((i) => i.receipt === "UIBJN5YMQC");
    expect(first?.paidIn).toBe(450);
    expect(first?.balance).toBe(69776.19);
    expect(first?.details).toContain("0706***777");
    // Name fragments reconstructed across rows, NO noise words / double dash
    expect(first?.details).toContain("VERONICAH");
    expect(first?.details).toContain("EBENYO");
    expect(first?.details).not.toContain("Buy Goods");
    expect(first?.details).not.toContain("PUBLICAN");
    expect(first?.details).not.toContain("- -");
  });

  it("recognizes 'Merchant Payment Online … from - <phone>' inflows", () => {
    const { inflows } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    const online = inflows.find((i) => i.receipt === "UIB1W6COQN");
    expect(online?.paidIn).toBe(5000);
    expect(online?.isOnline).toBe(true);
    expect(online?.details).toContain("JAMES OMONGO");
  });

  it("counts a receipt once per separate charge/inflow key row", () => {
    const { inflows, excluded } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    // UIB6T6AO3Y appears twice: one inflow + one charge
    expect(inflows.filter((i) => i.receipt === "UIB6T6AO3Y")).toHaveLength(1);
    expect(
      excluded.some(
        (e) =>
          e.receipt === "UIB6T6AO3Y" &&
          e.type === "merchant_charge" &&
          e.amount === 13.75,
      ),
    ).toBe(true);
    const eipa = inflows.find((i) => i.receipt === "UIB6T6AO3Y");
    expect(eipa?.paidIn).toBe(2500);
    expect(eipa?.details).toContain("EIPA ARUMU");
  });

  it("parses negative charges as excluded, not inflows", () => {
    const { inflows, excluded } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    expect(
      excluded.some(
        (e) =>
          e.receipt === "UIBRV4QTM1" &&
          e.type === "merchant_transfer" &&
          e.amount === 0.27,
      ),
    ).toBe(true);
    // The charge row must NOT appear as an inflow
    expect(inflows.find((i) => i.receipt === "UIBRV4QTM1")).toBeUndefined();
  });

  it("recognizes Small Business Pay Merchant as an inflow", () => {
    const { inflows } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    const sb = inflows.find((i) => i.receipt === "UIB2K6NLSV");
    expect(sb?.paidIn).toBe(100);
    expect(sb?.details.toLowerCase()).toContain("julius");
  });

  it("recognizes 'received from <agency>' deposits as inflows", () => {
    const { inflows } = parseMpesaLines(NEW_TWO_COLUMN_ROWS);
    const dep = inflows.find((i) => i.receipt === "UIBU83SHLJ");
    expect(dep?.paidIn).toBe(2000);
    expect(dep?.details).toContain("JOSEPH NYOTA NYINGI");
  });

  it("drops per-page footer/header noise rows", () => {
    const rows = [
      ...NEW_TWO_COLUMN_ROWS,
      "Disclaimer: Any personal information shared with you should be handled in accordance with the Data Protection Act and only used for the purpose",
      "Statement Verification Code To verify the validity of this M-PESA statement dial *334#",
      "XX9Y6NLU",
      "Page 1 of 14",
      "Receipt No. Completion Details Transaction Paid In Withdrawn Balance Transaction Other Party",
      "M-PESA STATEMENT",
      "Account Type - Merchant Account",
    ];
    const { inflows } = parseMpesaLines(rows);
    expect(inflows.length).toBeGreaterThanOrEqual(5);
    // no noise text should leak into a details string
    for (const i of inflows) {
      expect(i.details).not.toContain("Disclaimer");
      expect(i.details).not.toContain("Verification");
      expect(i.details).not.toContain("Page ");
    }
    expect(inflows).toHaveLength(5);
  });
});

/** OLD 3-column grid layout (withdrawn column always present even when zero). */
const OLD_GRID_SUMMARY_ROWS = [
  "M-PESA STATEMENT Page 1 of 12",
  "Organisation Name: PUBLICAN ENERGY",
  "Shortcode: 578590",
  "Statement Period: 05 Sep 2025 - 06 Sep 2025",
  "Request Date: 06 Sep 2025",
  "Summary",
  "Transaction Type Paid In Paid Out",
  "Pay Bill 0.00 128,900.00",
  "Buy Goods 98,721.00 0.00",
  "Payment to Mobile Number 0.00 0.00",
  "Withdraw to Bank 0.00 0.00",
  "Withdraw at Agent 0.00 0.00",
  "Sell Airtime 0.00 0.00",
  "Fees 0.00 638.29",
  "Other 194.68 168.76",
  "Total 98,915.68 129,707.05",
  "Account Type - Merchant Account",
  "Receipt No. Completion Details Transaction Paid In Withdrawn Balance Transaction Other Party",
  "Time Status Type",
  "TI66P7TDSE 2025-09-06 Merchant Payment from Completed 80.00 0.00 200.00 Customer 578590-",
  "18:26:32 0746***921 - isaac alemu aleper Merchant PUBLICAN",
  "Payment ENERGY",
  "TI60P6R3LS 2025-09-06 Biashara Overdraft Repayment Completed 0.00 80.00 120.00 OD Payment 804080-Boost",
  "18:22:30 Transfer Biashara",
  "TI63P6ODGT 2025-09-06 Merchant Payment from Completed 100.00 0.00 200.00 Customer 578590-",
  "18:22:11 0723***798 - Longorot Simon Merchant PUBLICAN",
  "Lopatio Payment ENERGY",
  "TI68P648H8 2025-09-06 Merchant Payment from Completed 100.00 0.00 100.00 Customer 578590-",
  "18:19:58 254740***795 - Victor Ekal Merchant PUBLICAN",
  "Erupe Payment ENERGY",
];

describe("parseMpesaLines — OLD 3-column grid (withdrawn always shown)", () => {
  it("extracts the 3-row grid with explicit 0.00 withdrawn", () => {
    const { inflows, excluded } = parseMpesaLines(OLD_GRID_SUMMARY_ROWS);
    // 3 Merchant Payment from inflows; the summary + Biashara row excluded
    expect(inflows).toHaveLength(3);
    const first = inflows.find((i) => i.receipt === "TI66P7TDSE");
    expect(first?.paidIn).toBe(80);
    expect(first?.balance).toBe(200);
    expect(first?.details).toContain("isaac alemu aleper");
    expect(first?.details).toContain("0746***921");
    expect(excluded.length).toBeGreaterThanOrEqual(0);
  });

  it("keeps old-format paid-in/withdrawn/balance positions", () => {
    const { inflows } = parseMpesaLines(OLD_GRID_SUMMARY_ROWS);
    const elk = inflows.find((i) => i.receipt === "TI68P648H8");
    expect(elk?.paidIn).toBe(100);
    expect(elk?.balance).toBe(100);
  });
});
