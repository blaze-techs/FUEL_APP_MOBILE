import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Save,
  Trash2,
  Edit3,
  MessageCircle,
  Bot,
  Send,
  Building2,
  Printer,
  Loader2,
  Receipt,
  FileText,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import {
  exportInvoicePDF,
  exportInvoiceExcel,
  exportInvoiceTXT,
} from "@/react-app/utils/exportUtils";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { silentPrintService } from "@/react-app/lib/silent-print-service";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
  getDetectedCurrency,
} from "@/react-app/lib/currency";
import SubTabBar from "@/react-app/components/SubTabBar";
import SalesInvoices from "@/react-app/components/SalesInvoices";
import {
  onTabPayload,
  navigateToTab,
  consumePendingPayload,
  type InvoicePrefill,
  type StkPushPrefill,
  type FuelPricePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { resolveContractPrice } from "@/react-app/lib/contract-pricing";
import { useStations } from "@/react-app/context/StationContext";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

export default function Invoice() {
  const { state, dispatch } = useFuel();
  const { currentStation } = useStations();
  const fuelTypeApi = useStationFuelTypes(currentStation?.id);
  // Customer Price Lists (Credit tab → Price Lists) — the "use fuel price"
  // action falls back to the customer's contract price if one matches the
  // attached customer + the item description.
  const { data: customerPriceRules } = useCloudKV<
    { id: string; customer: string; fuelType: string; price: number }[]
  >("customer_price_lists", currentStation?.id, []);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  // Inner sub-tab: "Invoice" (this generator) vs "Sales Invoices" (the
  // formerly-standalone detailed sales-invoice module, now hosted here).
  const [activeView, setActiveView] = useState<"invoice" | "sales-invoices">(
    "invoice",
  );
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("invoice", setActiveView);
  const [quantityLabel, setQuantityLabel] = useState(
    state.invoiceSettings.quantityLabel,
  );
  // Tracks the last value *this component* wrote, so the sync-from-global
  // effect below never fights the user's own typing.
  const lastDispatchedLabel = useRef(state.invoiceSettings.quantityLabel);
  // Refs for the onTabPayload callback so it always reads the LATEST state
  // (the effect has stable deps, so without refs the callback closure would
  // capture stale customerName/invoiceItems from the first render).
  const customerNameRef = useRef(customerName);
  customerNameRef.current = customerName;
  const invoiceItemsRef = useRef(state.invoiceItems);
  invoiceItemsRef.current = state.invoiceItems;
  // Idempotency: track which prefill payloads have already been applied so
  // the multi-dispatch (50/200/500/1000ms) from navigateToTab doesn't add
  // duplicate line items.
  const appliedPrefillRef = useRef<Set<string>>(new Set());

  // Centralized prefill application logic — called from BOTH the
  // onTabPayload effect (for event-driven prefills) AND the synchronous
  // mount check (for pending payloads stored before mount).
  const applyPrefill = useCallback(
    (raw: unknown) => {
      const p = (raw || {}) as InvoicePrefill;
      if (Object.keys(p).length === 0) return;
      setActiveView("invoice");
      const sig = `${p.customerName || ""}|${p.amount || 0}|${p.description || ""}`;
      const alreadyApplied = appliedPrefillRef.current.has(sig);
      if (!alreadyApplied) appliedPrefillRef.current.add(sig);
      const currentName = customerNameRef.current;
      const currentItems = invoiceItemsRef.current;
      const draftHasContent = currentItems.some(
        (it) => (it.desc && it.desc.trim()) || it.qty > 0 || it.price > 0,
      );
      if (p.customerName && (!currentName || !draftHasContent)) {
        setCustomerName(p.customerName);
      }
      if (!alreadyApplied && (p.amount || p.description)) {
        const prefillItem = {
          desc: p.description || "Outstanding balance",
          qty: 1,
          price: p.amount ?? 0,
          total: p.amount ?? 0,
        };
        dispatch({
          type: "SET_INVOICE_ITEMS",
          payload: draftHasContent
            ? [...currentItems, prefillItem]
            : [prefillItem],
        });
      }
    },
    [dispatch],
  );
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  // Search across saved invoices (was missing — a flat grid of every saved
  // invoice with no way to find one by number/customer).
  const [invoiceSearch, setInvoiceSearch] = useState("");

  useEffect(() => {
    // Auto-fill today's date
    const today = new Date().toISOString().split("T")[0];
    setInvoiceDate(today);
  }, []);

  // Interlink receiver: Credit Management / Customer Loyalty calls
  // navigateToTab("invoice", <InvoicePrefill>) to start a new invoice for an
  // outstanding credit balance — pre-fill the customer + a line item.
  // onTabPayload checks the pending-payload store on registration (handles
  // the lazy-load race where the component mounts after the tabPayload event
  // fires), then listens for subsequent event-driven dispatches.
  useEffect(() => {
    return onTabPayload("invoice", (raw) => {
      applyPrefill(raw);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Synchronous mount-time check: consume any pending prefill that was set
  // BEFORE this component mounted (handles the lazy-load race). Retry for
  // up to 1s because the payload may arrive slightly after mount.
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 10; // 10 x 100ms = 1s
    const interval = setInterval(() => {
      attempts++;
      const pending = consumePendingPayload("invoice");
      if (
        pending &&
        typeof pending === "object" &&
        Object.keys(pending as object).length > 0
      ) {
        clearInterval(interval);
        setTimeout(() => applyPrefill(pending), 50);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only pull in the global value if it changed for a reason OTHER than
    // this component's own edit (e.g. loadInvoice() set it, or another tab
    // synced in). Prevents the input from ever snapping back mid-edit.
    if (state.invoiceSettings.quantityLabel !== lastDispatchedLabel.current) {
      setQuantityLabel(state.invoiceSettings.quantityLabel);
      lastDispatchedLabel.current = state.invoiceSettings.quantityLabel;
    }
  }, [state.invoiceSettings.quantityLabel]);

  const updateQuantityLabel = (newLabel: string) => {
    setQuantityLabel(newLabel);
    lastDispatchedLabel.current = newLabel;
    dispatch({
      type: "SET_INVOICE_SETTINGS",
      payload: { quantityLabel: newLabel },
    });
  };

  // WORLDWIDE: derive the display currency symbol from the station's/company
  // currency instead of the previously hardcoded "Ksh".
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const getInvoiceNumber = () => {
    const num = String(state.invoiceCounter).padStart(3, "0");
    return `INV-${new Date().getFullYear()}-${num}`;
  };

  const addInvoiceItem = () => {
    const newItem = { desc: "", qty: 1, price: 0, total: 0 };
    dispatch({
      type: "SET_INVOICE_ITEMS",
      payload: [...state.invoiceItems, newItem],
    });
  };

  const updateInvoiceItem = (index: number, field: string, value: any) => {
    // Clone the item object (not just the array) so we never mutate the
    // shared state object in place — a shared reference can be clobbered
    // by a concurrent LOAD_FROM_STORAGE/real-time echo and lose the edit.
    const updatedItems = state.invoiceItems.map((it, i) =>
      i === index ? { ...it } : it,
    );
    const item = updatedItems[index];

    if (field === "qty" || field === "price") {
      (item as any)[field] = parseFloat(value) || 0;
    } else {
      (item as any)[field] = value;
    }

    // FIX: Round to 2 decimal places to prevent floating point errors
    item.total = Math.round(item.qty * item.price * 100) / 100;

    dispatch({ type: "SET_INVOICE_ITEMS", payload: updatedItems });
  };

  const deleteInvoiceItem = (index: number) => {
    const updatedItems = [...state.invoiceItems];
    updatedItems.splice(index, 1);
    dispatch({ type: "SET_INVOICE_ITEMS", payload: updatedItems });
  };

  const calculateTotals = () => {
    // FIX: Round to 2 decimal places to prevent floating point errors
    const totalDue =
      Math.round(
        state.invoiceItems.reduce((sum, item) => sum + item.total, 0) * 100,
      ) / 100;
    return { totalDue };
  };

  const { totalDue } = calculateTotals();

  const saveInvoice = () => {
    if (!customerName || state.invoiceItems.length === 0) {
      toastError(
        "Please add customer details and invoice items before saving.",
      );
      return;
    }
    // Reject empty all-blank items (a user who clicked "Add Item" but never
    // filled the description) so the saved invoice is always meaningful.
    const hasContent = state.invoiceItems.some(
      (it) => (it.desc && it.desc.trim()) || it.qty > 0 || it.price > 0,
    );
    if (!hasContent) {
      toastError(
        "Please add at least one item with a description before saving.",
      );
      return;
    }

    const invNum = getInvoiceNumber();
    const invoiceData = {
      customer: {
        name: customerName,
        address: customerAddress,
        phone: customerPhone,
      },
      date: invoiceDate,
      items: [...state.invoiceItems],
      quantityLabel: quantityLabel,
      // Store the NUMERIC total + the currency CODE (not the symbol) so a
      // currency change later or a different detected currency on another
      // device renders correctly. The symbol is resolved at display time.
      // Previously the symbol was frozen into the string AND cents were
      // dropped via formatNumber(x, 0) → a 1,234.56 invoice saved as
      // "Ksh 1,234", permanently losing the 0.56 AND the wrong currency on
      // cross-device/cross-currency reload.
      currency: state.companyData?.currency || getDetectedCurrency(),
      totalAmount: totalDue,
      status: "unpaid" as const,
      createdAt: new Date().toISOString(),
    };

    dispatch({
      type: "SET_INVOICES",
      payload: { ...state.invoices, [invNum]: invoiceData },
    });

    dispatch({
      type: "SET_INVOICE_COUNTER",
      payload: state.invoiceCounter + 1,
    });

    // Also create/update a client record in state.clients so the customer
    // appears in the Customers tab. Without this, customers created via the
    // Invoice tab were invisible in the Customers tab (the Customers tab reads
    // from the customers DB table + cloud KV + state.clients fallback).
    const clientKey = customerPhone || customerName;
    if (clientKey && !state.clients[clientKey]) {
      dispatch({
        type: "SET_CLIENTS",
        payload: {
          ...state.clients,
          [clientKey]: {
            id: clientKey,
            name: customerName,
            phone: customerPhone || "",
            address: customerAddress || "",
            email: "",
            company: customerName,
            createdAt: new Date().toISOString(),
          },
        },
      });
    }

    // Reset the idempotency tracker so the next prefill can apply cleanly.
    appliedPrefillRef.current.clear();

    toastSuccess(`Invoice ${invNum} saved successfully!`);
  };

  // Silent print invoice using print service
  const handleSilentPrint = async () => {
    if (!customerName || state.invoiceItems.length === 0) {
      setPrintError(
        "Please add customer details and invoice items before printing.",
      );
      return;
    }

    setIsPrinting(true);
    setPrintError(null);

    try {
      const invoiceData = {
        invoiceNumber: getInvoiceNumber(),
        stationName: state.companyData.name || "FuelPro Station",
        stationLocation:
          state.companyData.poBox ||
          state.companyData.physicalAddress ||
          state.companyData.town ||
          "",
        date: invoiceDate,
        time: new Date().toLocaleTimeString(),
        customerName,
        customerAddress,
        customerPhone,
        items: state.invoiceItems.map((item) => ({
          desc: item.desc || item.name || "",
          qty: item.qty || 1,
          price: item.price || 0,
          total: item.total || item.qty * item.price,
        })),
        subtotal: totalDue,
        tax: 0,
        discount: 0,
        totalDue: totalDue,
        currency: /^[A-Z]{3}$/.test(state.companyData?.currency || "")
          ? state.companyData?.currency
          : currentStation?.currency || getDetectedCurrency(),
        attendantName: "System",
        footerMessage: "Thank you for your business",
      };

      await silentPrintService.queueInvoice(invoiceData);

      // Show brief success indicator
      setTimeout(() => {
        setIsPrinting(false);
      }, 1500);
    } catch (error) {
      console.error("Print error:", error);
      setPrintError(error instanceof Error ? error.message : "Print failed");
      setIsPrinting(false);
    }
  };

  const loadInvoice = (num: string) => {
    const inv = state.invoices[num];
    if (!inv) return;

    setCustomerName(inv.customer.name);
    setCustomerAddress(inv.customer.address);
    setCustomerPhone(inv.customer.phone);
    setInvoiceDate(inv.date);

    // Load custom quantity label if saved with invoice
    if (inv.quantityLabel) {
      setQuantityLabel(inv.quantityLabel);
      lastDispatchedLabel.current = inv.quantityLabel;
      dispatch({
        type: "SET_INVOICE_SETTINGS",
        payload: { quantityLabel: inv.quantityLabel },
      });
    }

    dispatch({ type: "SET_INVOICE_ITEMS", payload: inv.items });
  };

  const deleteInvoice = (num: string) => {
    if (confirm(`Delete invoice ${num}?`)) {
      const updatedInvoices = { ...state.invoices };
      delete updatedInvoices[num];
      dispatch({ type: "SET_INVOICES", payload: updatedInvoices });
    }
  };

  // Toggle an invoice's payment status (was missing — no way to mark a saved
  // invoice as paid). The status is stored on the invoice object and persists
  // to the cloud blob with the rest of the invoice data.
  const markInvoicePaid = (num: string, paid: boolean) => {
    const inv = state.invoices[num];
    if (!inv) return;
    dispatch({
      type: "SET_INVOICES",
      payload: {
        ...state.invoices,
        [num]: { ...inv, status: paid ? "paid" : "unpaid" },
      },
    });
  };

  // Collect payment for a SAVED invoice (was missing — the "Collect via M-PESA"
  // card only worked for the in-progress draft, not for saved invoices).
  const collectSavedInvoice = (num: string) => {
    const inv = state.invoices[num];
    if (!inv) return;
    navigateToTab("livetransaction", {
      phone: inv.customer?.phone || "",
      amount: inv.totalAmount || 0,
      account_reference: inv.customer?.name || num,
      transaction_desc: `Invoice ${num} payment`,
      openStkPush: true,
    } satisfies StkPushPrefill);
  };

  const editBankInfo = () => {
    const bankName =
      prompt("Bank Name:", state.companyData.bankName) ||
      state.companyData.bankName;
    const branchName =
      prompt("Branch Name:", state.companyData.branchName) ||
      state.companyData.branchName;
    const accountHolder =
      prompt("Account Holder Name:", state.companyData.accountHolder) ||
      state.companyData.accountHolder;
    const accountNumber =
      prompt("Account Number:", state.companyData.accountNumber) ||
      state.companyData.accountNumber;

    dispatch({
      type: "SET_COMPANY_DATA",
      payload: {
        ...state.companyData,
        bankName,
        branchName,
        accountHolder,
        accountNumber,
      },
    });

    toastSuccess("Bank details updated successfully!");
  };

  const sendAIMessage = async () => {
    if (!aiMessage.trim() || aiLoading) return;

    setAiLoading(true);
    setAiResponse("");

    try {
      // Local AI analysis for invoice — computed instantly, no artificial delay
      const items = state.invoiceItems;
      const itemSummary = items
        .map(
          (item: any, i: number) =>
            // BUGFIX: items use `desc`, not `name` — previously printed
            // "undefined: 1 x Ksh 200 = Ksh 200".
            `${i + 1}. ${item.desc || "(no description)"}: ${item.qty || 0} ${quantityLabel} x ${currencySymbol}${formatNumber(item.price || 0)} = ${currencySymbol}${formatNumber((item.qty || 0) * (item.price || 0))}`,
        )
        .join("\n");
      // There is no per-item VAT field; compute the analysis subtotal as the
      // sum of item totals (which already equals totalDue). Previously the
      // code referenced a non-existent `item.vat`, always showing "VAT: 0".
      const subtotal = items.reduce(
        (s: number, i: any) => s + (i.total || (i.qty || 0) * (i.price || 0)),
        0,
      );
      const localResponse = `**Invoice Analysis**\n\n**Invoice #${getInvoiceNumber()}**\n**Customer:** ${customerName || "Walk-in"}\n**Date:** ${invoiceDate}\n\n**Items (${items.length}):**\n${itemSummary}\n\n**Totals:**\n• Subtotal: ${currencySymbol}${formatNumber(subtotal)}\n• **Total Due: ${currencySymbol}${formatNumber(totalDue)}**\n\n💡 *Add more items or proceed to save this invoice.*`;
      setAiResponse(localResponse);
      /*
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: aiMessage,
          context: { type: 'invoice_analysis', invoice_data: invoiceContext, timestamp: new Date().toISOString() }
        }),
      });
      const data = await response.json();
      setAiResponse(data.response || 'AI Assistant is currently offline.');
      */
    } catch (error) {
      console.error("AI Error:", error);
      setAiResponse(
        "FuelPro AI Assistant is temporarily unavailable. Please check your subscription or try again later.",
      );
    } finally {
      setAiLoading(false);
      setAiMessage("");
    }
  };

  const exportHandlers = {
    pdf: async () => {
      if (!customerName || state.invoiceItems.length === 0) {
        toastError(
          "Please add customer details and invoice items before exporting.",
        );
        return;
      }
      await exportInvoicePDF({
        ...state,
        customerName,
        customerAddress,
        customerPhone,
        invoiceDate,
        totalDue,
        invoiceNumber: getInvoiceNumber(),
        invoiceItems: state.invoiceItems,
        quantityLabel: quantityLabel,
      });
    },
    excel: () => {
      if (!customerName || state.invoiceItems.length === 0) {
        toastError(
          "Please add customer details and invoice items before exporting.",
        );
        return;
      }
      exportInvoiceExcel({
        ...state,
        customerName,
        customerAddress,
        customerPhone,
        invoiceDate,
        invoiceNumber: getInvoiceNumber(),
        invoiceItems: state.invoiceItems,
        quantityLabel: quantityLabel,
        totalDue,
      });
    },
    txt: () => {
      if (!customerName || state.invoiceItems.length === 0) {
        toastError(
          "Please add customer details and invoice items before exporting.",
        );
        return;
      }
      exportInvoiceTXT({
        ...state,
        customerName,
        customerAddress,
        customerPhone,
        invoiceDate,
        invoiceNumber: getInvoiceNumber(),
        invoiceItems: state.invoiceItems,
        quantityLabel: quantityLabel,
        totalDue,
      });
    },
    whatsapp: () => {
      if (!customerName || state.invoiceItems.length === 0) {
        toastError(
          "Please add customer details and invoice items before sharing.",
        );
        return;
      }
      const data = getInvoiceData();
      const companyName = state.companyData.name;
      if (!companyName) {
        toastError(
          "Please set your company name in business info before sharing.",
        );
        return;
      }
      const msg = `*${companyName}*\n\n*INVOICE ${getInvoiceNumber()}*\n\n${data}\n\n*CONTACTS:* ${state.companyData.contacts}\n*EMAIL:* ${state.companyData.email}`;
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      if (!customerName || state.invoiceItems.length === 0) {
        toastError(
          "Please add customer details and invoice items before emailing.",
        );
        return;
      }
      const data = getInvoiceData();
      const companyName = state.companyData.name;
      if (!companyName) {
        toastError(
          "Please set your company name in business info before emailing.",
        );
        return;
      }
      const subject = `Invoice ${getInvoiceNumber()} from ${companyName}`;
      const body = `Dear ${customerName},\n\nPlease find your invoice details below:\n\n${data}\n\nThank you for your business!\n\nBest regards,\n${companyName}\n\nContacts: ${state.companyData.contacts}\nEmail: ${state.companyData.email}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  const getInvoiceData = () => {
    const itemsList = state.invoiceItems
      .map(
        (i) =>
          `${i.desc} | ${i.qty} ${quantityLabel.replace("Qty ", "").replace("(", "").replace(")", "")} | ${currencySymbol}${formatNumber(i.price)} | ${currencySymbol}${formatNumber(i.total)}`,
      )
      .join("\n");

    return `Bill To: ${customerName}\nInvoice #: ${getInvoiceNumber()}\nDate: ${invoiceDate}\n\nDescription | ${quantityLabel} | Unit Price | Total\n${itemsList}\n\n Total Due: ${currencySymbol}${formatNumber(totalDue)}`;
  };

  return (
    <div className="p-6 space-y-3">
      {/* Sub-tab switcher: Invoice generator vs Sales Invoices module */}
      <SubTabBar
        tabs={[
          { id: "invoice", label: "Invoice", icon: Receipt },
          { id: "sales-invoices", label: "Sales Invoices", icon: FileText },
        ]}
        active={activeView}
        onChange={(id) => setActiveView(id as "invoice" | "sales-invoices")}
      />

      {activeView === "sales-invoices" ? (
        <SalesInvoices />
      ) : (
        <>
          {/* Professional Invoice Preview */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-4xl mx-auto">
            {/* Logo and Company Header */}
            <div className="flex justify-between items-start mb-8">
              <div className="flex-1">
                {state.companyData.logo && (
                  <img
                    src={state.companyData.logo}
                    alt="Logo"
                    className="h-16 w-auto mb-4"
                  />
                )}
                <div className="text-3xl font-bold text-blue-900 mb-2">
                  INVOICE
                </div>
                {state.companyData.name && (
                  <div className="text-xl font-semibold text-gray-800 mb-2">
                    {state.companyData.name}
                  </div>
                )}
                {(state.companyData.poBox || state.companyData.contacts) && (
                  <div className="text-sm text-gray-600 mb-1">
                    {state.companyData.poBox &&
                      `P.O. Box: ${state.companyData.poBox}`}
                    {state.companyData.poBox &&
                      state.companyData.contacts &&
                      " "}
                    {state.companyData.contacts}
                  </div>
                )}
                {state.companyData.email && (
                  <div className="text-sm text-gray-600">
                    {state.companyData.email}
                  </div>
                )}
              </div>
            </div>

            {/* Invoice Details */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <div className="font-semibold text-gray-800 mb-4">Bill To:</div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Client Name"
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Client Address"
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone Number"
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="text-right">
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <span className="font-semibold mr-4">Invoice #:</span>
                    <span className="bg-gray-100 px-3 py-1 rounded">
                      {getInvoiceNumber()}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <span className="font-semibold mr-4">Date:</span>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Quantity Label Customization */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-blue-900 dark:text-blue-200 whitespace-nowrap">
                  Quantity Column Label:
                </label>
                <input
                  type="text"
                  value={quantityLabel}
                  onChange={(e) => updateQuantityLabel(e.target.value)}
                  placeholder="e.g., Qty (DAYS), Litres, Units, Hours"
                  className="flex-1 px-3 py-2 border border-blue-300 dark:border-blue-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  This label will appear in all exports (PDF, Excel, TXT)
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="mb-8">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-300 p-3 text-left font-semibold">
                      Description
                    </th>
                    <th className="border border-gray-300 p-3 text-center font-semibold">
                      {quantityLabel}
                    </th>
                    <th className="border border-gray-300 p-3 text-right font-semibold">
                      Unit Price
                    </th>
                    <th className="border border-gray-300 p-3 text-right font-semibold">
                      Total
                    </th>
                    <th className="border border-gray-300 p-3 text-center font-semibold w-20">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.invoiceItems.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="border border-gray-300 p-3">
                        <input
                          type="text"
                          value={item.desc}
                          onChange={(e) =>
                            updateInvoiceItem(index, "desc", e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none"
                          placeholder="Item description"
                        />
                        {fuelTypeApi.getPriceFor(item.desc) != null && (
                          <span className="text-[9px] text-gray-500 dark:text-gray-400">
                            Fuel price: {currencySymbol}{" "}
                            {fuelTypeApi.getPriceFor(item.desc)?.toFixed(2)}/L
                          </span>
                        )}
                      </td>
                      <td className="border border-gray-300 p-3 text-center">
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) =>
                            updateInvoiceItem(index, "qty", e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none text-center"
                          min="1"
                        />
                      </td>
                      <td className="border border-gray-300 p-3 text-right">
                        <div className="flex items-center justify-end">
                          <span className="mr-1">{currencySymbol}</span>
                          <input
                            type="number"
                            value={item.price}
                            onChange={(e) =>
                              updateInvoiceItem(index, "price", e.target.value)
                            }
                            className="w-24 bg-transparent border-none outline-none text-right"
                            min="0"
                          />
                        </div>
                        {fuelTypeApi.getPriceFor(item.desc) != null && (
                          <button
                            onClick={() =>
                              updateInvoiceItem(
                                index,
                                "price",
                                String(
                                  resolveContractPrice(
                                    customerName,
                                    item.desc,
                                    fuelTypeApi.getPriceFor(item.desc),
                                    customerPriceRules,
                                  ) ?? item.price,
                                ),
                              )
                            }
                            className="text-[9px] text-indigo-600 hover:underline mt-0.5"
                            title="Use the station's configured fuel price (or your customer's contract price if set)"
                          >
                            use fuel price
                          </button>
                        )}
                      </td>
                      <td className="border border-gray-300 p-3 text-right font-medium">
                        {currencySymbol}
                        {formatNumber(item.total)}
                      </td>
                      <td className="border border-gray-300 p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() =>
                              navigateToTab("fueltypes", {
                                fuelType: item.desc,
                                price: Number(item.price) || undefined,
                              } as FuelPricePrefill)
                            }
                            className="text-indigo-600 hover:text-indigo-800 p-1"
                            title="Edit fuel type / price in Fuel Type Manager"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => deleteInvoiceItem(index)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Delete item"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex justify-between items-center">
                <button onClick={addInvoiceItem} className="btn btn-primary">
                  <Plus size={16} />
                  Add Item
                </button>

                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-900">
                    Total Due: {currencySymbol}
                    {formatNumber(totalDue)}
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Information */}
            <div className="border-t border-gray-300 pt-6">
              <div className="mb-4">
                <div className="flex justify-between items-center mb-4">
                  <div className="font-semibold text-gray-800">
                    Payment Should Be Made Through
                  </div>
                  <button
                    onClick={editBankInfo}
                    className="btn btn-outline btn-sm"
                    title="Edit bank details"
                  >
                    <Building2 size={14} />
                    Edit Bank Details
                  </button>
                </div>

                {state.companyData.bankName ||
                state.companyData.branchName ||
                state.companyData.accountHolder ||
                state.companyData.accountNumber ? (
                  <div className="space-y-1 text-sm text-gray-700">
                    {state.companyData.bankName && (
                      <div>
                        <strong>BANK:</strong> {state.companyData.bankName}
                      </div>
                    )}
                    {state.companyData.branchName && (
                      <div>
                        <strong>BRANCH:</strong> {state.companyData.branchName}
                      </div>
                    )}
                    {state.companyData.accountHolder && (
                      <div>{state.companyData.accountHolder}</div>
                    )}
                    {state.companyData.accountNumber && (
                      <div>
                        <strong>ACCOUNT NO:</strong>{" "}
                        {state.companyData.accountNumber}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm italic">
                    Click "Edit Bank Details" to add payment information
                  </div>
                )}
              </div>

              <div className="mt-8 pt-4">
                <div className="text-sm text-gray-600">
                  Signature:…………………………..
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Save Invoice */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Save Invoice</h3>
                <button onClick={saveInvoice} className="btn btn-primary">
                  <Save size={16} />
                  Save
                </button>
              </div>
              <div className="text-sm text-gray-600">
                Save this invoice to your records and generate the invoice
                number.
              </div>
            </div>

            {/* Collect Payment — interlinks with the Live Transaction Monitor.
                Sends the customer + invoice total to the M-PESA STK Push flow. */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <FileText size={20} className="text-emerald-600" />
                  Collect Payment
                </h3>
                <button
                  onClick={() =>
                    navigateToTab("livetransaction", {
                      phone: customerPhone || "",
                      amount: totalDue,
                      account_reference: customerName || getInvoiceNumber(),
                      transaction_desc: `Invoice ${getInvoiceNumber()} payment`,
                      openStkPush: true,
                    } satisfies StkPushPrefill)
                  }
                  disabled={totalDue <= 0}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
                  title="Collect this invoice via M-PESA STK Push"
                >
                  Collect via M-PESA
                </button>
              </div>
              <div className="text-sm text-gray-600">
                Send the invoice total ({formatNumber(totalDue)}{" "}
                {currencySymbol}) as an M-PESA STK Push to the customer's phone
                via the Live Transaction Monitor.
              </div>
            </div>

            {/* Silent Print */}
            <div className="card">
              <div className="mb-4">
                <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Printer size={20} className="text-blue-600" />
                  Silent Print
                </h3>
                <div className="text-sm text-gray-600 mb-4">
                  Print directly to connected printer (works offline)
                </div>
              </div>
              <button
                onClick={handleSilentPrint}
                disabled={
                  isPrinting || !customerName || state.invoiceItems.length === 0
                }
                className="btn btn-primary w-full flex items-center justify-center gap-2 fp-icon-only"
                title="Print"
                aria-label="Print"
              >
                {isPrinting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Printing...
                  </>
                ) : (
                  <>
                    <Printer size={16} />
                    Print Invoice
                  </>
                )}
              </button>
              {printError && (
                <div className="mt-2 text-sm text-red-600">{printError}</div>
              )}
            </div>

            {/* Export Options */}
            <div className="card">
              <div className="mb-4">
                <h3 className="text-xl font-bold mb-2">Export Invoice</h3>
                <div className="text-sm text-gray-600 mb-4">
                  Export invoice in multiple formats for sharing and printing.
                </div>
              </div>
              <ExportDropdown
                onExport={exportHandlers}
                title="Export Invoice"
              />
            </div>

            {/* AI Assistant */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Bot className="text-blue-600" size={20} />
                  AI Assistant
                </h3>
                <button
                  onClick={() => setShowAIAssistant(!showAIAssistant)}
                  className="btn btn-outline"
                >
                  <MessageCircle size={16} />
                  {showAIAssistant ? "Hide" : "Show"}
                </button>
              </div>

              {showAIAssistant && (
                <div className="space-y-2">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg min-h-[120px]">
                    {aiResponse ? (
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {aiResponse}
                      </div>
                    ) : (
                      <div className="text-gray-500 text-sm italic">
                        Ask FuelPro AI about this invoice - analysis,
                        calculations, payment terms, or business insights...
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiMessage}
                      onChange={(e) => setAiMessage(e.target.value)}
                      placeholder="Ask FuelPro AI about this invoice..."
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      onKeyPress={(e) => e.key === "Enter" && sendAIMessage()}
                      disabled={aiLoading}
                    />
                    <button
                      onClick={sendAIMessage}
                      disabled={aiLoading || !aiMessage.trim()}
                      className="btn btn-primary px-4"
                    >
                      {aiLoading ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      ) : (
                        <Send size={16} />
                      )}
                    </button>
                  </div>

                  <div className="text-xs text-gray-500">
                    FuelPro AI powered by Google Gemini AI - Invoice analysis,
                    payment insights, and business recommendations.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saved Invoices */}
          {Object.keys(state.invoices).length > 0 && (
            <div className="card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h3 className="text-xl font-bold">Saved Invoices</h3>
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Search by invoice # or customer…"
                  className="w-full sm:w-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.keys(state.invoices)
                  .filter((key) => {
                    if (!invoiceSearch) return true;
                    const q = invoiceSearch.toLowerCase();
                    const inv = state.invoices[key];
                    return (
                      key.toLowerCase().includes(q) ||
                      inv.customer?.name?.toLowerCase().includes(q)
                    );
                  })
                  .map((key) => {
                    const inv = state.invoices[key];
                    const paid = inv.status === "paid";
                    return (
                      <div
                        key={key}
                        className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-semibold text-blue-900">
                            {key}
                          </div>
                          <span
                            className={`text-xs px-2 py-1 rounded-full ${paid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {paid ? "Paid" : "Unpaid"}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          Customer: {inv.customer?.name || "N/A"}
                        </div>
                        <div className="text-sm font-medium text-green-600 mb-3">
                          {currencySymbol}
                          {formatNumber(inv.totalAmount ?? 0)}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => loadInvoice(key)}
                            className="btn btn-sm btn-outline flex-1"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => collectSavedInvoice(key)}
                            className="btn btn-sm btn-outline text-emerald-600 hover:bg-emerald-50"
                            title="Collect via M-PESA STK Push"
                          >
                            Collect
                          </button>
                          <button
                            onClick={() => markInvoicePaid(key, !paid)}
                            className={`btn btn-sm btn-outline ${paid ? "text-amber-600 hover:bg-amber-50" : "text-green-600 hover:bg-green-50"}`}
                            title={paid ? "Mark as unpaid" : "Mark as paid"}
                          >
                            {paid ? "Unpaid" : "Paid"}
                          </button>
                          <button
                            onClick={() => deleteInvoice(key)}
                            className="btn btn-sm btn-outline text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
