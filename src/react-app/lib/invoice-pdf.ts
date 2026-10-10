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
  /** Pre-tax subtotal when known. */
  subtotal?: number;
  /** Optional percentage tax to apply to invoice/quotation line prices. */
  taxRate?: number;
  /** Actual recorded tax amount, used for receipts and imported sales. */
  taxAmount?: number;
  /** Indicates source line prices already include tax (e.g. completed POS sales). */
  pricesIncludeTax?: boolean;
  paymentTerms?: string;
  notes?: string;
  termsConditions?: string;
  bankDetails?: Partial<BankPaymentDetails>;
  invoiceTemplate?: PdfTemplate;
  /** Canonical document type prevents cross-labeling between document workflows. */
  documentType?: DocumentPdfType;
  /** Backward-compatible display title; documentType takes precedence. */
  documentTitle?: string;
  /** Quotation expiry date, rendered only when supplied. */
  validUntil?: string;
}

export type DocumentPdfType = "invoice" | "quotation" | "receipt";

const DOCUMENT_TITLES: Record<DocumentPdfType, string> = {
  invoice: "INVOICE",
  quotation: "QUOTATION",
  receipt: "RECEIPT",
};

function resolveDocumentType(data: InvoicePdfData): DocumentPdfType {
  if (data.documentType) return data.documentType;
  const legacyTitle = (data.documentTitle || "").trim().toUpperCase();
  if (legacyTitle.includes("QUOTATION") || legacyTitle.includes("QUOTE")) {
    return "quotation";
  }
  if (legacyTitle.includes("RECEIPT")) return "receipt";
  return "invoice";
}

function resolveDocumentTitle(data: InvoicePdfData): string {
  return DOCUMENT_TITLES[resolveDocumentType(data)];
}

function recipientLabel(data: InvoicePdfData): string {
  switch (resolveDocumentType(data)) {
    case "quotation":
      return "QUOTATION FOR";
    case "receipt":
      return "PAID BY";
    default:
      return "BILL TO";
  }
}

function numberLabel(data: InvoicePdfData): string {
  switch (resolveDocumentType(data)) {
    case "quotation":
      return "Quote No:";
    case "receipt":
      return "Receipt No:";
    default:
      return "Invoice No:";
  }
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
  const taxRate = Math.max(0, Number(data.taxRate) || 0);
  const headers = [
    "Description",
    quantityHeader,
    taxRate > 0 || data.pricesIncludeTax ? "Unit Price (incl. tax)" : "Unit Price",
    taxRate > 0 || data.pricesIncludeTax ? "Total (incl. tax)" : "Total",
  ];
  const withTax = (amount: number) =>
    Math.round((amount * (1 + taxRate / 100) + Number.EPSILON) * 100) / 100;
  const rows = items.map((item) => [
    item.desc || item.name || "",
    item.qty || 0,
    symbol + formatNumber(taxRate > 0 ? withTax(item.price || 0) : item.price || 0, 2),
    symbol + formatNumber(taxRate > 0 ? withTax(item.total || 0) : item.total || 0, 2),
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
      0: { cellWidth: 65 },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 40, halign: "right" },
      3: { cellWidth: 40, halign: "right" },
    },
  });
  return (doc as any).lastAutoTable.finalY;
}

function totalLabel(data: InvoicePdfData): string {
  const symbol = getCurrencySymbol(data.companyData?.currency || data.currency);
  const subtotal = data.subtotal ?? (data.invoiceItems || []).reduce(
    (sum, item) => sum + (Number(item.total) || (Number(item.qty) || 0) * (Number(item.price) || 0)), 0,
  );
  const rate = Math.max(0, Number(data.taxRate) || 0);
  const tax = data.taxAmount ?? Math.round((subtotal * rate / 100 + Number.EPSILON) * 100) / 100;
  return "Total: " + symbol + formatNumber(data.totalDue ?? subtotal + tax, 2);
}

function taxBreakdownLabel(data: InvoicePdfData): string {
  const rate = Math.max(0, Number(data.taxRate) || 0);
  const hasExplicitTax = Number.isFinite(Number(data.taxAmount)) && data.taxAmount !== undefined && data.taxAmount !== null;
  if (rate <= 0 && (!hasExplicitTax || Number(data.taxAmount) <= 0)) return "";
  const symbol = getCurrencySymbol(data.companyData?.currency || data.currency);
  const subtotal = data.subtotal ?? (data.invoiceItems || []).reduce(
    (sum, item) => sum + (Number(item.total) || (Number(item.qty) || 0) * (Number(item.price) || 0)), 0,
  );
  const tax = data.taxAmount ?? Math.round((subtotal * rate / 100 + Number.EPSILON) * 100) / 100;
  const taxLabel = rate > 0 ? "Tax (" + rate + "%): " : "Tax: ";
  return "Subtotal: " + symbol + formatNumber(subtotal, 2) + "  |  " + taxLabel + symbol + formatNumber(tax, 2);
}

export function makeDocumentPdfFilename(data: InvoicePdfData): string {
  const name = (data.customerName || "Customer").replace(/[^a-z0-9_-]+/gi, "_");
  const title = resolveDocumentTitle(data).replace(/[^a-z0-9_-]+/gi, "_");
  return title + "_" + (data.invoiceNumber || "draft") + "_" + name + ".pdf";
}


export interface CustomReceiptPdfData {
  receiptNumber: string;
  receiptDate: string;
  invoiceReference?: string;
  companyData?: InvoicePdfData["companyData"];
  companyTagline?: string;
  currency?: string;
  customerName: string;
  customerAddress?: string;
  subject?: string;
  items: Array<{ id?: string; description: string; details?: string; quantity: number; rate: number }>;
  taxEnabled: boolean;
  taxRate: number;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  amountReceivedWords?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  bankName?: string;
  branchName?: string;
  accountNumber?: string;
  issuedBy?: string;
  signatoryTitle?: string;
  receiptStampText?: string;
  notes?: string;
}

function amountInWords(amount: number, currency: string): string {
  const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (n: number): string => {
    const parts: string[] = [];
    if (n >= 100) { parts.push(small[Math.floor(n / 100)] + " Hundred"); n %= 100; }
    if (n >= 20) { parts.push(tens[Math.floor(n / 10)] + (n % 10 ? " " + small[n % 10] : "")); }
    else if (n > 0) parts.push(small[n]);
    return parts.join(" ");
  };
  const whole = Math.floor(Math.max(0, amount) + 0.0000001);
  const cents = Math.round((Math.max(0, amount) - whole) * 100);
  const chunks = [{ value: Math.floor(whole / 1_000_000), name: "Million" }, { value: Math.floor((whole % 1_000_000) / 1000), name: "Thousand" }, { value: whole % 1000, name: "" }];
  const words = chunks.filter(c => c.value > 0).map(c => underThousand(c.value) + (c.name ? " " + c.name : "")).join(" ") || "Zero";
  const currencyName: Record<string, string> = { KES: "Kenya Shillings", USD: "US Dollars", GBP: "Pounds", EUR: "Euros", UGX: "Ugandan Shillings", TZS: "Tanzanian Shillings" };
  const unit = currencyName[currency.toUpperCase()] || currency.toUpperCase();
  return unit + " " + words + (cents ? " and " + underThousand(cents) + " Cents" : "") + " Only.";
}

function receiptDateLabel(value: string): string {
  if (!value) return "";
  const parsed = new Date(value + (value.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Branded, editable receipt layout modeled on the supplied tax/no-tax samples. */
export async function exportCustomReceiptPDF(
  data: CustomReceiptPdfData,
  action: PdfOutputAction = "download",
): Promise<void> {
  const previewWindow = action === "preview" ? window.open("about:blank", "_blank") : null;
  if (action === "preview" && !previewWindow) throw new Error("The PDF preview was blocked. Allow pop-ups and try again.");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const company = data.companyData || {};
  const currency = data.currency || company.currency || "KES";
  const symbol = getCurrencySymbol(currency);
  const subtotal = data.subtotal ?? data.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0), 0);
  const taxAmount = data.taxEnabled ? (data.taxAmount ?? Math.round((subtotal * Math.max(0, Number(data.taxRate) || 0) / 100 + Number.EPSILON) * 100) / 100) : 0;
  const totalAmount = data.totalAmount ?? Math.round((subtotal + taxAmount + Number.EPSILON) * 100) / 100;
  const money = (n: number) => symbol + " " + formatNumber(n, 2);
  const navy: [number, number, number] = [0, 75, 129];
  const pale: [number, number, number] = [239, 244, 250];
  let y = 14;
  if (company.logo) {
    try {
      const logoY = await addLogoToPDF(doc, company.logo, margin, 12, 38, 24);
      y = Math.max(y, logoY);
    } catch { /* A bad optional logo must not prevent the receipt from being created. */ }
  }
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(company.name || "Business Name", pageWidth - margin, 17, { align: "right", maxWidth: pageWidth - 70 });
  doc.setTextColor(55, 65, 81);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  let companyY = 23;
  for (const line of [data.companyTagline, company.poBox, company.contacts, company.email].filter(Boolean) as string[]) {
    doc.text(line, pageWidth - margin, companyY, { align: "right", maxWidth: pageWidth - 70 });
    companyY += 4.2;
  }
  y = Math.max(y + 2, companyY + 1, 37);
  doc.setDrawColor(...navy);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 9;
  doc.setFillColor(...pale);
  doc.rect(margin, y, pageWidth - margin * 2, 15, "F");
  doc.setFillColor(...navy);
  doc.rect(margin, y, 1.4, 15, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("OFFICIAL RECEIPT", margin + 5, y + 9.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const meta = "RECEIPT NO: " + (data.receiptNumber || "DRAFT") + "  |  DATE: " + receiptDateLabel(data.receiptDate) + (data.invoiceReference ? "  |  REF INVOICE: " + data.invoiceReference : "");
  doc.text(meta, pageWidth - margin - 3, y + 9.2, { align: "right", maxWidth: pageWidth - margin * 2 - 58 });
  y += 22;

  const recipientLines = [data.customerName || "Customer", data.customerAddress].filter(Boolean) as string[];
  const subjectLines = data.subject ? doc.splitTextToSize("RE: " + data.subject, pageWidth - margin * 2 - 10) : [];
  const customerBoxH = 13 + recipientLines.length * 5 + subjectLines.length * 4;
  doc.setDrawColor(220, 226, 235);
  doc.setFillColor(250, 251, 253);
  doc.roundedRect(margin, y, pageWidth - margin * 2, customerBoxH, 1.5, 1.5, "FD");
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("RECEIVED FROM:", margin + 4, y + 5.5);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(9);
  doc.text(recipientLines[0] || "", margin + 4, y + 11);
  let cy = y + 16;
  if (recipientLines[1]) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(recipientLines[1], margin + 4, cy); cy += 5; }
  if (subjectLines.length) { doc.setTextColor(...navy); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text(subjectLines, margin + 4, cy); }
  y += customerBoxH + 5;

  const body = data.items.map((item, index) => [
    String(index + 1) + ".",
    [item.description, item.details].filter(Boolean).join("\\n"),
    formatNumber(item.quantity, 2),
    money(item.rate),
    money(item.quantity * item.rate),
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["S/NO", "DESCRIPTION & DETAILS", "QTY / DAYS", "RATE (" + currency + ")", "AMOUNT (" + currency + ")"]],
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.4, textColor: [55, 65, 81], lineColor: [220, 226, 235], lineWidth: 0.15, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.2, cellPadding: 2.6 },
    columnStyles: { 0: { cellWidth: 13, halign: "center" }, 1: { cellWidth: "auto" }, 2: { cellWidth: 23, halign: "center" }, 3: { cellWidth: 31, halign: "right" }, 4: { cellWidth: 34, halign: "right" } },
  });
  y = (doc as any).lastAutoTable.finalY + 1;
  const totals = [{ label: "Sub Total", value: money(subtotal) }];
  if (data.taxEnabled) totals.push({ label: (Number(data.taxRate) || 0).toFixed(2).replace(/\\.?0+$/, "") + "% VAT", value: money(taxAmount) });
  totals.push({ label: data.paymentStatus === "Paid in Full" ? "TOTAL PAID" : "TOTAL", value: money(totalAmount) });
  const labelX = pageWidth - margin - 57;
  const valueX = pageWidth - margin - 3;
  for (let i = 0; i < totals.length; i++) {
    const row = totals[i];
    const isGrand = i === totals.length - 1;
    const rowH = isGrand ? 16 : 9;
    if (isGrand) {
      doc.setFillColor(226, 232, 240);
      doc.rect(pageWidth - margin - 111, y, 111, rowH, "F");
      doc.setDrawColor(203, 213, 225);
      doc.line(pageWidth - margin - 111, y, pageWidth - margin, y);
    }
    doc.setTextColor(isGrand ? 17 : 71, isGrand ? 24 : 85, isGrand ? 39 : 105);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(isGrand ? 9.5 : 8.5);
    doc.text(row.label, labelX, y + (isGrand ? 6 : 5.8), { align: "right" });
    doc.text(row.value, valueX, y + (isGrand ? 6 : 5.8), { align: "right" });
    y += rowH;
  }
  y += 5;
  const paymentLines = [
    data.amountReceivedWords ? "Amount Received: " + data.amountReceivedWords : "Amount Received: " + amountInWords(totalAmount, currency),
    "Status: " + (data.paymentStatus || "Paid in Full"),
    data.paymentMethod ? "Payment Method / Reference: " + data.paymentMethod : "",
    data.bankName ? "Bank: " + data.bankName : "",
    data.branchName ? "Branch: " + data.branchName : "",
    data.accountNumber ? "Account No: " + data.accountNumber : "",
    data.notes ? "Notes: " + data.notes : "",
  ].filter(Boolean);
  const paymentHeight = 12 + paymentLines.length * 4.5;
  if (y + paymentHeight + 43 > pageHeight - 20) { doc.addPage(); y = 18; }
  doc.setDrawColor(220, 226, 235);
  doc.setFillColor(250, 251, 253);
  doc.roundedRect(margin, y, pageWidth - margin * 2, paymentHeight, 1.5, 1.5, "FD");
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PAYMENT SUMMARY:", margin + 4, y + 6);
  doc.setTextColor(55, 65, 81);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.text(paymentLines.map(line => "• " + line), margin + 4, y + 12, { maxWidth: pageWidth - margin * 2 - 8 });
  y += paymentHeight + 10;

  const signatureY = Math.min(y + 2, pageHeight - 48);
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("ISSUED BY:", margin, signatureY);
  doc.text("OFFICIAL STAMP & RECEIPT:", pageWidth / 2 + 4, signatureY);
  doc.setTextColor(55, 65, 81);
  doc.setFontSize(8);
  doc.text(data.issuedBy || company.name || "", margin, signatureY + 8);
  doc.setDrawColor(100, 116, 139);
  doc.line(margin, signatureY + 19, margin + 75, signatureY + 19);
  doc.setFont("helvetica", "normal");
  doc.text(data.signatoryTitle || "Authorized Signatory", margin, signatureY + 24);
  doc.text("Date: " + receiptDateLabel(data.receiptDate), margin, signatureY + 29);
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.roundedRect(pageWidth / 2 + 4, signatureY + 3, pageWidth / 2 - margin - 4, 27, 1.5, 1.5, "S");
  doc.setLineDashPattern([], 0);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(data.receiptStampText || "OFFICIAL PAID STAMP HERE", pageWidth * 0.75, signatureY + 18, { align: "center", maxWidth: pageWidth / 2 - margin - 10 });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(220, 226, 235);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text((company.name || "Business") + " — Official Receipt " + (data.receiptNumber || "DRAFT"), margin, pageHeight - 7);
    doc.text("Page " + page + " of " + pageCount, pageWidth - margin, pageHeight - 7, { align: "right" });
  }
  doc.setProperties({ title: "OFFICIAL RECEIPT " + (data.receiptNumber || "DRAFT"), subject: "Receipt " + (data.receiptNumber || ""), author: company.name || "FuelPro", creator: "FuelPro Custom Receipt Builder" });
  const safeName = (data.receiptNumber || "draft").replace(/[^a-z0-9_-]+/gi, "_");
  const safeCustomer = (data.customerName || "Customer").replace(/[^a-z0-9_-]+/gi, "_");
  const filename = "RECEIPT_" + safeName + "_" + safeCustomer + ".pdf";
  const blob = doc.output("blob");
  if (action === "preview") {
    const url = URL.createObjectURL(blob);
    if (!previewWindow) throw new Error("The PDF preview was blocked. Allow pop-ups and try again.");
    previewWindow.opener = null;
    previewWindow.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    return;
  }
  if (action === "share") {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (typeof navigator !== "undefined" && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "Official Receipt " + (data.receiptNumber || ""), files: [file] });
      return;
    }
  }
  doc.save(filename);
}

export type PdfOutputAction = "download" | "preview" | "share";

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
  doc.text(resolveDocumentTitle(data), 15, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const rightX = pageWidth - 80;
  let rightY = y + 2;
  doc.setFont("helvetica", "bold");
  doc.text(data.invoiceNumber ? numberLabel(data) + " " + data.invoiceNumber : "", rightX, rightY);
  rightY += 6;
  doc.setFont("helvetica", "normal");
  if (data.invoiceDate) doc.text("Date: " + data.invoiceDate, rightX, rightY);
  rightY += 6;
  if (data.validUntil) doc.text("Valid until: " + data.validUntil, rightX, rightY);
  rightY += 8;

  doc.setFont("helvetica", "bold");
  doc.text(recipientLabel(data), 15, rightY);
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
  const taxSummary = taxBreakdownLabel(data);
  if (taxSummary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(taxSummary, pageWidth - 15, y + 5, { align: "right" });
  }
  y += taxSummary ? 18 : 14;

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
  doc.text(resolveDocumentTitle(data), 15, 20);
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
  doc.text(data.invoiceNumber ? numberLabel(data) + " " + data.invoiceNumber : "", pageWidth - 15, 20, { align: "right" });
  if (data.invoiceDate) {
    doc.setFont("helvetica", "normal");
    doc.text("Date: " + data.invoiceDate, pageWidth - 15, 28, {
      align: "right",
    });
  }
  if (data.validUntil) {
    doc.setFont("helvetica", "normal");
    doc.text("Valid until: " + data.validUntil, pageWidth - 15, 34, {
      align: "right",
    });
  }

  let y = bandH + 12;
  doc.setTextColor("#111827");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(recipientLabel(data), 15, y);
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
  const taxSummary = taxBreakdownLabel(data);
  if (taxSummary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(taxSummary, 120, y + 5);
  }
  y += taxSummary ? 18 : 14;

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

/** Build a document PDF for download, in-browser preview, or native sharing. */
export async function exportInvoicePDFTemplate(
  data: InvoicePdfData,
  action: PdfOutputAction = "download",
): Promise<void> {
  const previewWindow = action === "preview" ? window.open("about:blank", "_blank") : null;
  if (action === "preview" && !previewWindow) {
    throw new Error("The PDF preview was blocked. Allow pop-ups and try again.");
  }
  // Normalize identity once so the visible heading, PDF metadata, filename,
  // and share-sheet title can never disagree.
  const documentData: InvoicePdfData = {
    ...data,
    documentType: resolveDocumentType(data),
    documentTitle: resolveDocumentTitle(data),
  };
  const template = documentData.invoiceTemplate || "classic";
  const doc = new jsPDF();
  const documentNumber = documentData.invoiceNumber || "draft";
  doc.setProperties({
    title: documentData.documentTitle,
    subject: documentData.documentTitle + " " + documentNumber,
    author: documentData.companyData?.name || "FuelPro",
    creator: "FuelPro",
  });

  if (template === "minimal") {
    await renderMinimal(doc, documentData);
  } else if (template === "bold") {
    await renderBold(doc, documentData);
  } else {
    await renderClassic(doc, documentData);
  }

  const filename = makeDocumentPdfFilename(documentData);
  const blob = doc.output("blob");
  if (action === "preview") {
    const url = URL.createObjectURL(blob);
    const preview = previewWindow;
    if (!preview) throw new Error("The PDF preview was blocked. Allow pop-ups and try again.");
    preview.opener = null;
    preview.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
    return;
  }

  if (action === "share") {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (typeof navigator !== "undefined" && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: documentData.documentTitle || "Document", files: [file] });
      return;
    }
  }

  doc.save(filename);
}

/** Classic template: clean company header, recipient block, item table and totals. */
async function renderClassic(doc: any, data: InvoicePdfData) {
  const company = data.companyData || {};
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;
  if (company.logo) {
    const logoY = await addLogoToPDF(doc, company.logo, 15, 10, 42, 24);
    if (logoY > y) y = logoY;
  }
  doc.setTextColor("#111827");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(company.name || " ", 15, y + 7);
  doc.setFontSize(11);
  doc.text(resolveDocumentTitle(data), pageWidth - 15, y + 7, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const details = [company.email, company.contacts, company.poBox ? "P.O. Box: " + company.poBox : ""].filter(Boolean);
  if (details.length) doc.text(details.join(" · "), 15, y + 13);
  doc.setDrawColor("#d1d5db");
  doc.line(15, y + 17, pageWidth - 15, y + 17);
  y += 27;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(recipientLabel(data), 15, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  if (data.customerName) { doc.text(data.customerName, 15, y); y += 5; }
  if (data.customerAddress) { doc.text(data.customerAddress, 15, y); y += 5; }
  if (data.customerPhone) { doc.text(data.customerPhone, 15, y); y += 5; }
  if (data.invoiceNumber) doc.text(numberLabel(data) + " " + data.invoiceNumber, pageWidth - 15, y - 11, { align: "right" });
  if (data.invoiceDate) doc.text("Date: " + data.invoiceDate, pageWidth - 15, y - 5, { align: "right" });
  if (data.validUntil) doc.text("Valid until: " + data.validUntil, pageWidth - 15, y + 1, { align: "right" });
  y = renderTable(doc, data, y + 4, [55, 65, 81]) + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(totalLabel(data), pageWidth - 15, y, { align: "right" });
  const taxSummary = taxBreakdownLabel(data);
  if (taxSummary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(taxSummary, pageWidth - 15, y + 5, { align: "right" });
  }
  y += taxSummary ? 18 : 12;
  if (data.paymentTerms) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Payment terms: " + data.paymentTerms, 15, y); y += 6; }
  if (data.notes) { doc.setFontSize(9); doc.text(doc.splitTextToSize("Notes: " + data.notes, pageWidth - 30), 15, y); y += 10; }
  const bankLines = buildBankLines(data.bankDetails, company as any);
  if (bankLines.length) { doc.setFontSize(9); bankLines.forEach((line) => { doc.text(line, 15, y); y += 5; }); }
  if (data.termsConditions) { doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.text(doc.splitTextToSize(data.termsConditions, pageWidth - 30), 15, Math.min(y + 5, 275)); }
}
