import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { supabase } from "@/supabase/client";
import { getBackendUrl } from "@/utils/apiConfig";

export type CanonicalReportRow = {
  business_date: string;
  litres: number;
  gross_sales: number;
  tax_amount: number;
  net_sales: number;
  sale_count: number;
  reversal_count: number;
};

export type CanonicalReportPayload = {
  success: boolean;
  stationId: string;
  start?: string | null;
  end?: string | null;
  rows: CanonicalReportRow[];
  totals: {
    litres: number;
    gross: number;
    tax: number;
    net: number;
    sales: number;
    reversals: number;
  };
  source: string;
};

async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token)
    throw new Error(
      "Please sign in again before exporting a canonical report.",
    );
  return token;
}

export async function fetchCanonicalReport(
  stationId: string,
  start?: string,
  end?: string,
): Promise<CanonicalReportPayload> {
  const params = new URLSearchParams({ stationId, format: "json" });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const response = await fetch(
    `${getBackendUrl()}/api/reports/canonical?${params}`,
    {
      headers: { Authorization: `Bearer ${await bearer()}` },
    },
  );
  const body = await response.json();
  if (!response.ok || !body?.success)
    throw new Error(body?.error || "Canonical report failed");
  return body as CanonicalReportPayload;
}

function reportRows(data: CanonicalReportPayload) {
  return data.rows.map((r) => ({
    Date: r.business_date,
    "Litres Sold": Number(r.litres || 0),
    "Gross Sales": Number(r.gross_sales || 0),
    Tax: Number(r.tax_amount || 0),
    "Net Sales": Number(r.net_sales || 0),
    Sales: Number(r.sale_count || 0),
    Reversals: Number(r.reversal_count || 0),
  }));
}

export async function downloadCanonicalCsv(
  stationId: string,
  start?: string,
  end?: string,
) {
  const params = new URLSearchParams({ stationId, format: "csv" });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const response = await fetch(
    `${getBackendUrl()}/api/reports/canonical?${params}`,
    {
      headers: { Authorization: `Bearer ${await bearer()}` },
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || "CSV export failed");
  }
  const blob = await response.blob();
  saveAs(blob, `fuelpro-canonical-${start || "all"}-${end || "all"}.csv`);
}

export async function downloadCanonicalExcel(
  stationId: string,
  start?: string,
  end?: string,
) {
  const data = await fetchCanonicalReport(stationId, start, end);
  const rows = reportRows(data);
  rows.push({
    Date: "TOTAL",
    "Litres Sold": data.totals.litres,
    "Gross Sales": data.totals.gross,
    Tax: data.totals.tax,
    "Net Sales": data.totals.net,
    Sales: data.totals.sales,
    Reversals: data.totals.reversals,
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Canonical Sales");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `fuelpro-canonical-${start || "all"}-${end || "all"}.xlsx`,
  );
}

export async function downloadCanonicalPdf(
  stationId: string,
  stationName: string,
  start?: string,
  end?: string,
) {
  const data = await fetchCanonicalReport(stationId, start, end);
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text(`${stationName || "FuelPro"} — Canonical Sales Report`, 14, 16);
  doc.setFontSize(9);
  doc.text(
    `Period: ${start || "all"} to ${end || "all"} | Source: ${data.source}`,
    14,
    22,
  );
  autoTable(doc, {
    startY: 28,
    head: [["Date", "Litres", "Gross", "Tax", "Net", "Sales", "Reversals"]],
    body: [
      ...data.rows.map((r) => [
        r.business_date,
        r.litres,
        r.gross_sales,
        r.tax_amount,
        r.net_sales,
        r.sale_count,
        r.reversal_count,
      ]),
      [
        "TOTAL",
        data.totals.litres,
        data.totals.gross,
        data.totals.tax,
        data.totals.net,
        data.totals.sales,
        data.totals.reversals,
      ],
    ],
  });
  doc.save(`fuelpro-canonical-${start || "all"}-${end || "all"}.pdf`);
}
