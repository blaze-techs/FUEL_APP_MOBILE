/**
 * invoice-pdf.ts
 * A minimalist, template-aware invoice PDF builder.
 * Reverse-engineered from Reatech360's invoice settings: selectable
 * templates (Classic / Modern Minimal / Bold Header) + bank details
 * (incl. SWIFT/BIC) + payment terms + notes + terms & conditions.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { addLogoToPDF } from "@/react-app/utils/exportUtils";
import type {
  PdfTemplate,
  BankPaymentDetails,
} from "@/react-app/lib/invoice-config";

export type { PdfTemplate, BankPaymentDetails };

export interface InvoicePdfData {
  companyData?: {
    name?: string;
    email?: string;
    contacts?: string;
    poBox?: string;
    logo?: string;
    currency?: string;
    bankName?: string;
    branchName?: string;
    accountHolder?: string;
    accountNumber?: string;
  };
  currency?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  customerName?: string;
  customerAddress?: string;
  customerPhone?: string;
  quantityLabel?: string;
  invoiceItems?: Array<{
    desc?: string;
    name?: string;
    qty?: number;
    price?: number;
    total?: number;
  }>;
  totalDue?: number;
  paymentTerms?: string;
  notes?: string;
  termsConditions?: string;
  bankDetails?: Partial<BankPaymentDetails>;
  invoiceTemplate?: PdfTemplate;
  /** Document title — defaults to "INVOICE"; quotations pass "QUOTATION". */
  documentTitle?: string;
}

export function buildBankLines(
  details?: Partial<BankPaymentDetails>,
  legacy?: {
    bankName?: string;
    branchName?: string;
    accountHolder?: string;
    accountNumber?: string;
  },
): string[] {
  const lines: string[] = [];
  const b = details || {};
  if (b.bankName) lines.push("Bank: " + b.bankName);
  if (b.accountName) lines.push(b.accountName);
  if (b.accountNumber) lines.push("Account No: " + b.accountNumber);
  if (b.branch) lines.push("Branch: " + b.branch);
  if (b.swiftBic) lines.push("SWIFT/BIC: " + b.swiftBic);
  if (lines.length === 0 && legacy) {
    if (legacy.bankName) lines.push("BANK: " + legacy.bankName);
    if (legacy.branchName) lines.push("BRANCH: " + legacy.branchName);
    if (legacy.accountHolder) lines.push(legacy.accountHolder);
    if (legacy.accountNumber) lines.push("ACCOUNT NO: " + legacy.accountNumber);
  }
  return lines;
}

function tableRows(data: InvoicePdfData): {
  headers: string[];
  rows: Array<(string | number)[]>;
} {
  const items = data.invoiceItems || [];
  const quantityHeader = data.quantityLabel || "Qty (DAYS)";
  const symbol = getCurrencySymbol(data.companyData?.currency || data.currency);
  const headers = ["Description", quantityHeader, "Unit Price", "Total"];
  const rows = items.map((item) => [
    item.desc || item.name || "",
    item.qty || 0,
    symbol + formatNumber(item.price || 0, 0),
    symbol + formatNumber(item.total || 0, 0),
  ]);
  return { headers, rows };
}

function renderTable(
  doc: any,
  data: InvoicePdfData,
  startY: number,
  headFill: false | [number, number, number],
): number {
  const { headers, rows } = tableRows(data);
  if (rows.length === 0) return startY + 12;
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: "plain",
    headStyles: {
      fillColor: headFill === false ? false : headFill,
      textColor: headFill === false ? [0, 0, 0] : [255, 255, 255],
      fontSize: 10,
      fontStyle: "bold",
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
    },
    bodyStyles: { fontSize: 10, lineWidth: 0.1, lineColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 75 },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 42, halign: "right" },
      3: { cellWidth: 42, halign: "right" },
    },
  });
  return (doc as any).lastAutoTable.finalY;
}

function totalLabel(data: InvoicePdfData): string {
  const symbol = getCurrencySymbol(data.companyData?.currency || data.currency);
  return "Total: " + symbol + formatNumber(data.totalDue || 0, 0);
}

function makeFilename(data: InvoicePdfData): string {
  const name = (data.customerName || "Customer").replace(/\s+/g, "_");
  return "Invoice_" + (data.invoiceNumber || "draft") + "_" + name + ".pdf";
}

async function renderMinimal(doc: any, data: InvoicePdfData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const company = data.companyData || {};
  let y = 12;
  if (company.logo) {
    const logoY = await addLogoToPDF(doc, company.logo, 15, 8, 50, 28);
    if (logoY > 8) y = logoY;
  }
  doc.setDrawColor("#d1d5db");
  doc.setLineWidth(0.3);
  doc.line(15, y, pageWidth - 15, y);

  doc.setTextColor("#111827");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(data.documentTitle || "INVOICE", 15, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const rightX = pageWidth - 80;
  let rightY = y + 2;
  doc.setFont("helvetica", "bold");
  doc.text(data.invoiceNumber || "", rightX, rightY);
  rightY += 6;
  doc.setFont("helvetica", "normal");
  if (data.invoiceDate) doc.text("Date: " + data.invoiceDate, rightX, rightY);
  rightY += 14;

  doc.setFont("helvetica", "bold");
  doc.text("Bill To", 15, rightY);
  rightY += 6;
  doc.setFont("helvetica", "normal");
  if (data.customerName) doc.text(data.customerName, 15, rightY);
  rightY += 5;
  if (data.customerAddress) doc.text(data.customerAddress, 15, rightY);
  rightY += 5;
  if (data.customerPhone) doc.text(data.customerPhone, 15, rightY);
  y = rightY + 8;

  if (data.notes) {
    doc.setTextColor("#6b7280");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(data.notes, 15, y);
    y += 12;
  }

  y = renderTable(doc, data, y, false) + 10;

  doc.setDrawColor("#b45309");
  doc.setLineWidth(0.6);
  doc.line(pageWidth - 90, y - 4, pageWidth - 15, y - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor("#b45309");
  doc.text(totalLabel(data), pageWidth - 60, y);
  y += 14;

  const bankLines = buildBankLines(data.bankDetails, company as any);
  if (bankLines.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#374151");
    bankLines.forEach((line) => {
      doc.text(line, 15, y);
      y += 6;
    });
    y += 6;
  }

  if (data.termsConditions) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor("#9ca3af");
    doc.text(data.termsConditions, 15, y);
  }
}

async function renderBold(doc: any, data: InvoicePdfData) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const company = data.companyData || {};
  const bandH = 46;

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, bandH, "F");
  if (company.logo) {
    await addLogoToPDF(doc, company.logo, 15, 10, 42, 24);
  }
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.documentTitle || "INVOICE", 15, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  if (company.name) doc.text(company.name, 15, 30);
  if (company.email || company.contacts || company.poBox) {
    const bits = [
      company.email,
      company.contacts,
      company.poBox ? "P.O. Box: " + company.poBox : "",
    ].filter(Boolean);
    doc.text(bits.join(" · "), 15, 36);
  }
  doc.setFont("helvetica", "bold");
  doc.text(data.invoiceNumber || "", pageWidth - 15, 20, { align: "right" });
  if (data.invoiceDate) {
    doc.setFont("helvetica", "normal");
    doc.text("Date: " + data.invoiceDate, pageWidth - 15, 28, {
      align: "right",
    });
  }

  let y = bandH + 12;
  doc.setTextColor("#111827");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", 15, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  if (data.customerName) {
    doc.text(data.customerName, 15, y);
    y += 6;
  }
  if (data.customerAddress) {
    doc.text(data.customerAddress, 15, y);
    y += 6;
  }
  y = renderTable(doc, data, y, [17, 24, 39]) + 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(totalLabel(data), 120, y);
  y += 14;

  const bankLines = buildBankLines(data.bankDetails, company as any);
  if (bankLines.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#374151");
    doc.text("Payment details", 15, y);
    y += 6;
    bankLines.forEach((line) => {
      doc.text(line, 15, y);
      y += 6;
    });
    y += 6;
  }
  if (data.termsConditions) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor("#9ca3af");
    doc.text(data.termsConditions, 15, y);
  }
}

/** Build the invoice PDF for the requested template and save it. */
export async function exportInvoicePDFTemplate(data: InvoicePdfData) {
  const template = data.invoiceTemplate || "classic";
  const doc = new jsPDF();

  if (template === "minimal") {
    await renderMinimal(doc, data);
    doc.save(makeFilename(data));
    return;
  }
  if (template === "bold") {
    await renderBold(doc, data);
    doc.save(makeFilename(data));
    return;
  }
  const mod = await import("@/react-app/utils/exportUtils");
  await mod.exportInvoicePDF({
    ...data,
    companyData: data.companyData,
  });
}
