/**
 * Quotations.tsx
 * Quotation module — reverse-engineered from Reatech360's Quotations +
 * "Quotations Settings" (Draft/Sent/Accepted/Declined/Expired lifecycle,
 * configurable numbering prefix/separator/padding/year, "valid for (days)"
 * expiry, default customer notes + terms, selectable PDF template,
 * bank payment details).
 *
 * Persisted to the station-scoped "quotations" cloud key via
 * cloudStorageService (block-shaped payload, same cross-device pattern as
 * every other cloud-backed module).
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Send,
  Check,
  X,
  Search,
  RefreshCw,
  Edit3,
  Download,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  type DocumentsConfig,
  buildDocumentNumber,
  dueDateFromTerms,
  formatDateShort,
  normalizeDocumentsConfig,
  saveDocumentsConfig,
} from "@/react-app/lib/invoice-config";
import { exportInvoicePDFTemplate } from "@/react-app/lib/invoice-pdf";

export type QuoteStatus =
  "draft" | "sent" | "accepted" | "declined" | "expired";

export interface QuoteItem {
  desc: string;
  qty: number;
  price: number;
  total: number;
}

export interface Quotation {
  id: string;
  quoteNumber: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  date: string;
  validUntil: string;
  items: QuoteItem[];
  status: QuoteStatus;
  notes: string;
  termsConditions: string;
  currency: string;
  totalAmount: number;
  createdAt: string;
}

const QUOTATIONS_KEY = "quotations";

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  accepted:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  expired:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function statusLabel(status: QuoteStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "expired":
      return "Expired";
  }
}

const inputClass =
  "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-h-[40px]";

const btnPrimaryClass =
  "px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[40px]";

const btnSecondaryClass =
  "px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 min-h-[40px]";

export default function Quotations() {
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = currentStation?.id;

  const [quotes, setQuotes] = useState<Quotation[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [validDays, setValidDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [termsConditions, setTermsConditions] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([
    { desc: "", qty: 1, price: 0, total: 0 },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "all">("all");

  const [documentsCached, setDocumentsCached] = useState<DocumentsConfig>(
    normalizeDocumentsConfig(null),
  );
  const [configLoading, setConfigLoading] = useState(true);

  const currencySymbol = getCurrencySymbol(
    (currentStation as any)?.companyCurrency ||
      (currentStation as any)?.currency,
  );

  // Load the documents_config for numbering + template defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = cloudStorageService.getCached<unknown>(
        "documents_config",
        stationId,
      );
      setDocumentsCached((prev) => ({
        ...prev,
        ...normalizeDocumentsConfig(cached),
      }));
      try {
        const cloud = await cloudStorageService.get<unknown>(
          "documents_config",
          stationId,
        );
        if (!cancelled) {
          setDocumentsCached((prev) => ({
            ...prev,
            ...normalizeDocumentsConfig(cloud),
          }));
        }
      } catch {
        /* keep cached */
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const loadQuotes = useCallback(async () => {
    if (!stationId) return;
    try {
      const data = await cloudStorageService.get<Quotation[]>(
        QUOTATIONS_KEY,
        stationId,
      );
      const list = Array.isArray(data) ? data : [];
      setQuotes(list);
    } catch {
      setQuotes([]);
    }
  }, [stationId]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  const persist = useCallback(
    (next: Quotation[]) => {
      setQuotes(next);
      if (stationId) {
        cloudStorageService
          .set(QUOTATIONS_KEY, next, stationId)
          .catch(() => {});
      }
    },
    [stationId],
  );

  const totalAmount = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.total) || 0), 0),
    [items],
  );

  const addItem = () => {
    setItems((prev) => [...prev, { desc: "", qty: 1, price: 0, total: 0 }]);
  };

  const updateItem = (index: number, field: keyof QuoteItem, value: string) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const next = { ...it };
        if (field === "desc") {
          next.desc = value;
        } else {
          next[field] = parseFloat(value) || 0;
        }
        next.total = Math.round(next.qty * next.price * 100) / 100;
        return next;
      }),
    );
  };

  const deleteItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setCustomerName("");
    setCustomerAddress("");
    setCustomerPhone("");
    setQuoteDate(new Date().toISOString().slice(0, 10));
    setValidDays(30);
    setValidUntil(formatDateShort(dueDateFromTerms(`Net ${30}`)));
    setNotes(documentsCached.defaultCustomerNotes || "");
    setTermsConditions(documentsCached.defaultTermsConditions || "");
    setItems([{ desc: "", qty: 1, price: 0, total: 0 }]);
    setEditingId(null);
  };

  // Set sensible first-open defaults once the documents config loads.
  useEffect(() => {
    if (configLoading) return;
    if (quoteDate) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading]);

  const saveQuote = () => {
    if (!customerName || items.length === 0) {
      toastError("Please add customer details and at least one item.");
      return;
    }
    const hasContent = items.some(
      (it) => (it.desc && it.desc.trim()) || it.qty > 0 || it.price > 0,
    );
    if (!hasContent) {
      toastError("Please add at least one item with a description.");
      return;
    }

    if (editingId) {
      let updated = false;
      const next = quotes.map((q) => {
        if (q.id !== editingId) return q;
        updated = true;
        return {
          ...q,
          customerName,
          customerAddress,
          customerPhone,
          date: quoteDate,
          validUntil,
          items: items.map((it) => ({ ...it })),
          notes,
          termsConditions,
          totalAmount,
        };
      });
      if (!updated) {
        toastError("Quotation no longer exists. It may have been deleted.");
        return;
      }
      persist(next);
      toastSuccess("Quotation updated.");
    } else {
      const quoteNumber = buildDocumentNumber(
        documentsCached.numbering,
        documentsCached.quotationNextNumber,
      );
      const quotation: Quotation = {
        id: `quo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        quoteNumber,
        customerName,
        customerAddress,
        customerPhone,
        date: quoteDate,
        validUntil,
        items: items.map((it) => ({ ...it })),
        status: "draft",
        notes,
        termsConditions,
        currency: state.companyData?.currency || "USD",
        totalAmount,
        createdAt: new Date().toISOString(),
      };
      // Increment the quotation counter in the documents_config row.
      setDocumentsCached((prev) => {
        const nextCfg = {
          ...prev,
          quotationNextNumber: prev.quotationNextNumber + 1,
        };
        saveDocumentsConfig(nextCfg, stationId).catch(() => {});
        return nextCfg;
      });
      persist([...quotes, quotation]);
      toastSuccess(`Quotation ${quoteNumber} created.`);
    }
    resetForm();
  };

  const changeStatus = (id: string, status: QuoteStatus) => {
    persist(quotes.map((q) => (q.id === id ? { ...q, status } : q)));
  };

  const deleteQuote = (id: string) => {
    const target = quotes.find((q) => q.id === id);
    if (target && !window.confirm(`Delete quotation ${target.quoteNumber}?`)) {
      return;
    }
    persist(quotes.filter((q) => q.id !== id));
    toastSuccess("Quotation deleted.");
  };

  const downloadQuotePdf = async (q: Quotation) => {
    try {
      await exportInvoicePDFTemplate({
        companyData: {
          name: state.companyData?.name,
          email: state.companyData?.email,
          contacts: state.companyData?.contacts,
          poBox: state.companyData?.poBox,
          logo: state.companyData?.logo,
          currency: state.companyData?.currency,
          bankName: state.companyData?.bankName,
          branchName: state.companyData?.branchName,
          accountHolder: state.companyData?.accountHolder,
          accountNumber: state.companyData?.accountNumber,
        },
        currency: q.currency || state.companyData?.currency,
        invoiceNumber: q.quoteNumber,
        invoiceDate: q.date,
        customerName: q.customerName,
        customerAddress: q.customerAddress,
        customerPhone: q.customerPhone,
        invoiceItems: q.items.map((it) => ({ ...it })),
        totalDue: q.totalAmount,
        paymentTerms: documentsCached.defaultPaymentTerms,
        notes: q.notes,
        termsConditions: q.termsConditions,
        bankDetails: documentsCached.bankDetails,
        invoiceTemplate: documentsCached.quotationTemplate,
        documentTitle: "QUOTATION",
        quantityLabel: "Qty",
      });
    } catch (err) {
      console.error("quote pdf error", err);
      toastError("Could not generate the quotation PDF.");
    }
  };

  const startEdit = (q: Quotation) => {
    setEditingId(q.id);
    setCustomerName(q.customerName);
    setCustomerAddress(q.customerAddress);
    setCustomerPhone(q.customerPhone);
    setQuoteDate(q.date);
    setValidUntil(q.validUntil);
    setNotes(q.notes || documentsCached.defaultCustomerNotes);
    setTermsConditions(
      q.termsConditions || documentsCached.defaultTermsConditions,
    );
    setItems(q.items.map((it) => ({ ...it })));
  };

  const filtered = useMemo(() => {
    let list = quotes;
    if (statusFilter !== "all") {
      list = list.filter((q) => q.status === statusFilter);
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter(
        (q) =>
          (q.quoteNumber || "").toLowerCase().includes(s) ||
          (q.customerName || "").toLowerCase().includes(s),
      );
    }
    // Auto-mark expired when validUntil has passed.
    const today = new Date();
    today.setHours(23, 59, 59, 0);
    return list.map((q) => {
      const until = q.validUntil ? new Date(q.validUntil) : null;
      if (
        until &&
        !Number.isNaN(until.getTime()) &&
        (q.status === "draft" || q.status === "sent") &&
        until.getTime() < today.getTime()
      ) {
        return { ...q, status: "expired" as QuoteStatus };
      }
      return q;
    });
  }, [quotes, statusFilter, search]);

  return (
    <div className="space-y-6">
      {/* Quotation editor */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            {editingId ? "Edit Quotation" : "New Quotation"}
          </h3>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            className={inputClass}
            placeholder="Customer name *"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Customer address"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Customer phone"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
          <input
            type="date"
            className={inputClass}
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
          />
          <select
            className={inputClass}
            value={validDays}
            onChange={(e) => {
              const days = parseInt(e.target.value, 10) || 30;
              setValidDays(days);
              setValidUntil(formatDateShort(dueDateFromTerms(`Net ${days}`)));
            }}
          >
            <option value={7}>Valid 7 days</option>
            <option value={14}>Valid 14 days</option>
            <option value={30}>Valid 30 days</option>
            <option value={60}>Valid 60 days</option>
            <option value={90}>Valid 90 days</option>
          </select>
          <input
            type="text"
            className={inputClass}
            placeholder="Valid until (e.g. 30/09/2026)"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Items
            </p>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add item
            </button>
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <input
                className={`${inputClass} col-span-12 sm:col-span-5`}
                placeholder="Description"
                value={it.desc}
                onChange={(e) => updateItem(i, "desc", e.target.value)}
              />
              <input
                type="number"
                min={0}
                className={`${inputClass} col-span-4 sm:col-span-2`}
                placeholder="Qty"
                value={it.qty || ""}
                onChange={(e) => updateItem(i, "qty", e.target.value)}
              />
              <input
                type="number"
                min={0}
                className={`${inputClass} col-span-4 sm:col-span-2`}
                placeholder="Price"
                value={it.price || ""}
                onChange={(e) => updateItem(i, "price", e.target.value)}
              />
              <div className="col-span-3 sm:col-span-2 text-right text-sm font-medium text-gray-800 dark:text-gray-200">
                {currencySymbol}
                {formatNumber(it.total || 0)}
              </div>
              <button
                type="button"
                onClick={() => deleteItem(i)}
                className="col-span-1 text-gray-400 hover:text-red-500"
                aria-label="Remove item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="text-right text-sm font-semibold text-gray-900 dark:text-white pt-2">
            Total: {currencySymbol}
            {formatNumber(totalAmount || 0)}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1">
              Notes
            </label>
            <textarea
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1">
              Terms &amp; conditions
            </label>
            <textarea
              className={inputClass}
              rows={2}
              value={termsConditions}
              onChange={(e) => setTermsConditions(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2 gap-3">
          <button
            type="button"
            onClick={resetForm}
            className={btnSecondaryClass}
          >
            Clear
          </button>
          <button type="button" onClick={saveQuote} className={btnPrimaryClass}>
            {editingId ? "Update quotation" : "Save quotation"}
          </button>
        </div>
      </div>

      {/* Quotation list */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Quotations ({filtered.length})
          </h3>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className={`${inputClass} pl-9 min-w-[200px]`}
                placeholder="Search by number or customer"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className={`${inputClass} w-auto`}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as QuoteStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
              <option value="expired">Expired</option>
            </select>
            <button
              type="button"
              onClick={loadQuotes}
              aria-label="Refresh quotations"
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
            No quotations
            {statusFilter !== "all"
              ? ` with status "${statusFilter}"`
              : ""}{" "}
            yet. Create your first quotation above.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((q) => (
              <div
                key={q.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {q.quoteNumber}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status]}`}
                      >
                        {statusLabel(q.status)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                      {q.customerName}
                      {q.customerPhone ? ` · ${q.customerPhone}` : ""}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Date: {q.date || formatDateShort(q.createdAt)} · Valid
                      until: {q.validUntil}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {q.currency
                        ? getCurrencySymbol(q.currency)
                        : currencySymbol}
                      {formatNumber(q.totalAmount || 0)}
                    </p>
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        type="button"
                        onClick={() => downloadQuotePdf(q)}
                        className="p-1.5 text-gray-500 hover:text-amber-500"
                        title="Download quotation PDF"
                        aria-label={`Download ${q.quoteNumber} PDF`}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(q)}
                        className="p-1.5 text-gray-500 hover:text-blue-500"
                        title="Edit quotation"
                        aria-label={`Edit ${q.quoteNumber}`}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeStatus(q.id, "sent")}
                        className="p-1.5 text-gray-500 hover:text-blue-500"
                        title="Mark as sent"
                        aria-label={`Mark ${q.quoteNumber} as sent`}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeStatus(q.id, "accepted")}
                        className="p-1.5 text-gray-500 hover:text-green-500"
                        title="Mark as accepted"
                        aria-label={`Accept ${q.quoteNumber}`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeStatus(q.id, "declined")}
                        className="p-1.5 text-gray-500 hover:text-red-500"
                        title="Mark as declined"
                        aria-label={`Decline ${q.quoteNumber}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteQuote(q.id)}
                        className="p-1.5 text-gray-500 hover:text-red-500"
                        title="Delete quotation"
                        aria-label={`Delete ${q.quoteNumber}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
