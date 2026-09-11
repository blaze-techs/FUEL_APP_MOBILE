/**
 * SalesInvoices.tsx
 * Sales listing with search, date filter, and invoice detail modal.
 *
 * Hosted as the "Sales Invoices" sub-tab inside the Invoice tab.
 * Reads completed sales from the `sales_enhanced` Supabase table (via
 * pos-service.fetchSales) — these are POS/checkout sales, NOT the manual
 * invoices saved from the Invoice generator (those live in the FuelContext
 * compact blob). The two invoice concepts are distinct: this sub-tab is the
 * sales-history ledger; the "Invoice" sub-tab is the manual invoice builder.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  X,
  FileText,
  Loader2,
  Plus,
  Download,
  AlertCircle,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { fetchSales } from "@/react-app/lib/pos-service";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import { formatNumber } from "@/react-app/utils/formatUtils";
import * as XLSX from "xlsx";

// Resolve the currency symbol at CALL time (not module-import time). The
// previous version called getDetectedCurrency() once at import, freezing the
// currency for the entire session — a station that changed currency or a
// different-currency station logging in kept showing the old currency.
const useCurrencySymbol = () => {
  const { currentStation } = useStations();
  return useMemo(
    () =>
      getCurrencySymbol(
        (currentStation as any)?.companyCurrency ||
          (currentStation as any)?.currency,
      ),
    [currentStation],
  );
};

const formatMoney = (amount: number, symbol: string) =>
  `${symbol}${formatNumber(amount || 0)}`;

export default function SalesInvoices() {
  const { currentStation } = useStations();
  const currencySymbol = useCurrencySymbol();
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedSale, setSelectedSale] = useState<any>(null);

  const loadSales = useCallback(async () => {
    if (!currentStation?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSales(
        currentStation.id,
        startDate || undefined,
        endDate || undefined,
      );
      setSales(data);
    } catch (err) {
      // Surface the error to the user instead of silently showing "No sales
      // found" (which hid RLS/table-missing/network failures).
      const msg =
        err instanceof Error ? err.message : "Failed to load sales records.";
      setError(msg);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [currentStation?.id, startDate, endDate]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  // Search by invoice number OR customer name (was invoice_number only).
  const filteredSales = sales.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.invoice_number?.toLowerCase().includes(q) ||
      s.customers?.name?.toLowerCase().includes(q) ||
      s.payment_method?.toLowerCase().includes(q)
    );
  });

  const totalSales = filteredSales.reduce(
    (sum, s) => sum + (s.total_amount || 0),
    0,
  );

  const safeDate = (v: any) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };
  const safeDateTime = (v: any) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  const exportToExcel = () => {
    const rows = filteredSales.map((s) => ({
      Invoice: s.invoice_number || "N/A",
      Date: safeDate(s.created_at),
      Customer: s.customers?.name || "Walk-in",
      Payment: s.payment_method || "—",
      Subtotal: s.subtotal || 0,
      Tax: s.tax_amount || 0,
      Discount: s.discount_amount || 0,
      Total: s.total_amount || 0,
      Reference: s.payment_reference || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Invoices");
    XLSX.writeFile(wb, "Sales_Invoices.xlsx");
  };

  if (loading) {
    return (
      <div className="flex justify-center h-full py-20">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading sales…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Sales &amp; Invoices
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {filteredSales.length} sales •{" "}
            {formatMoney(totalSales, currencySymbol)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigateToTab("invoice")}
            className="btn btn-primary flex items-center gap-2"
            title="Switch to the Invoice generator sub-tab"
          >
            <Plus size={16} />
            New Invoice
          </button>
          <button
            onClick={exportToExcel}
            disabled={filteredSales.length === 0}
            className="btn btn-outline flex items-center gap-2 disabled:opacity-50"
            title="Export filtered sales to Excel"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Error banner (was hidden — failures showed "No sales found"). */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Could not load sales records</p>
            <p className="opacity-80">{error}</p>
            <button
              onClick={loadSales}
              className="mt-2 underline text-sm hover:opacity-80"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <input
            type="text"
            placeholder="Search by invoice, customer, or payment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
          title="From date"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
          title="To date"
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                  Invoice
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                  Date
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                  Customer
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                  Payment
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                  Amount
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 dark:text-gray-500">
                      {error ? "" : "No sales found"}
                    </p>
                    {!error && (
                      <button
                        onClick={() => navigateToTab("invoice")}
                        className="mt-3 text-sm text-indigo-600 hover:underline"
                      >
                        Create an invoice →
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <td className="px-4 py-4">
                      <span className="text-gray-900 dark:text-white font-medium">
                        {sale.invoice_number || "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300 text-sm">
                      {safeDate(sale.created_at)}
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300 text-sm">
                      {sale.customers?.name || "Walk-in"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${sale.payment_method === "cash" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : sale.payment_method === "mpesa" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"}`}
                      >
                        {sale.payment_method || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-amber-600 dark:text-amber-400 font-medium">
                      {formatMoney(sale.total_amount, currencySymbol)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSale && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedSale(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg border border-gray-200 dark:border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                Invoice {selectedSale.invoice_number}
              </h3>
              <button
                onClick={() => setSelectedSale(null)}
                className="text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-400">Date</span>
                <span className="text-gray-900 dark:text-white">
                  {safeDateTime(selectedSale.created_at)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Customer</span>
                <span className="text-gray-900 dark:text-white">
                  {selectedSale.customers?.name || "Walk-in"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Payment</span>
                <span className="text-gray-900 dark:text-white">
                  {selectedSale.payment_method || "—"}
                </span>
              </div>
              {selectedSale.payment_reference && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Reference</span>
                  <span className="text-gray-900 dark:text-white">
                    {selectedSale.payment_reference}
                  </span>
                </div>
              )}
              <div className="border-t border-gray-200 dark:border-white/10 pt-4">
                <h4 className="text-gray-400 text-sm mb-2">Items</h4>
                {(selectedSale.sale_items || []).map(
                  (item: any, idx: number) => (
                    <div
                      key={item.id || idx}
                      className="flex justify-between py-2 border-b border-gray-100 dark:border-white/5 last:border-0"
                    >
                      <span className="text-gray-900 dark:text-white">
                        {item.product_name} x{item.quantity}
                      </span>
                      <span className="text-amber-600 dark:text-amber-400">
                        {formatMoney(item.total_amount, currencySymbol)}
                      </span>
                    </div>
                  ),
                )}
              </div>
              <div className="border-t border-gray-200 dark:border-white/10 pt-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Subtotal</span>
                  <span className="text-gray-900 dark:text-white">
                    {formatMoney(selectedSale.subtotal, currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Tax</span>
                  <span className="text-gray-900 dark:text-white">
                    {formatMoney(selectedSale.tax_amount, currencySymbol)}
                  </span>
                </div>
                {(selectedSale.discount_amount || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Discount</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      -
                      {formatMoney(
                        selectedSale.discount_amount,
                        currencySymbol,
                      )}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg">
                  <span className="text-gray-900 dark:text-white font-semibold">
                    Total
                  </span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                    {formatMoney(selectedSale.total_amount, currencySymbol)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
