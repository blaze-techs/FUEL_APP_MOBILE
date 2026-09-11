import { useState, useEffect, useMemo } from "react";
import DeliveryReconciliation from "@/react-app/components/DeliveryReconciliation";
import TankerRegistry from "@/react-app/components/TankerRegistry";
import { PackageCheck } from "lucide-react";
import {
  Plus,
  Save,
  Trash2,
  Truck,
  Fuel,
  FileText,
  Calendar,
  X,
  Search,
  ArrowRight,
  Edit,
} from "lucide-react";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  getFuelLabel,
  getFuelCode,
  normalizeFuelType,
} from "@/react-app/config/pricing";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { useStations } from "@/react-app/context/StationContext";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import type { OffloadingRecord } from "@/react-app/context/FuelContext";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { loadLogoAsDataURL } from "@/react-app/utils/exportUtils";
import { getLocaleForCountry } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const formatNumber = (num: number): string => {
  return new Intl.NumberFormat(getLocaleForCountry(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
};

export default function FuelOffloading() {
  const { state, dispatch } = useFuel();
  const { currentStation } = useStations();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  // Unified station fuel types so the offloading fuel-type dropdown reflects
  // the station's actual configured fuels (from Fuel Type Manager).
  const fuelTypeApi = useStationFuelTypes();
  const [selectedRecord, setSelectedRecord] = useState<OffloadingRecord | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [suppliers, setSuppliers] = useState<string[]>([]);

  // Search/filter state (was missing — no way to find a record by date/truck/
  // supplier/fuel type in a long list).
  const [search, setSearch] = useState("");
  const [fuelFilter, setFuelFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Build the fuel-type option list ONCE per render (avoids recomputing inside
  // the JSX map which re-renders the <select> on every keystroke and resets
  // its value).
  // Includes: the station's configured active fuel types + any fuel types
  // that appear in existing offloading records (so users can filter by
  // legacy/historical fuel types too).
  const fuelOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();

    // 1. Station's configured active fuel types
    for (const ft of fuelTypeApi.activeFuelTypes) {
      const code = getFuelCode(ft.name) || ft.name;
      if (!seen.has(code)) {
        seen.add(code);
        opts.push({ value: code, label: getFuelLabel(ft.name) });
      }
    }

    // 2. Fuel types from existing records (covers legacy data + fuels no
    //    longer in the station config but still in historical records)
    for (const rec of state.offloadingRecords) {
      const raw = rec.fuelType || "";
      if (!raw) continue;
      const code = getFuelCode(raw) || raw;
      if (!seen.has(code)) {
        seen.add(code);
        opts.push({ value: code, label: getFuelLabel(raw) });
      }
    }

    // 3. Fallback for stations with no configured fuel types AND no records
    if (opts.length === 0) {
      opts.push(
        { value: "PMS", label: getFuelLabel("PMS") },
        { value: "AGO", label: getFuelLabel("AGO") },
      );
    }
    return opts;
  }, [fuelTypeApi.activeFuelTypes, state.offloadingRecords]);

  // Default to the FIRST active fuel type instead of the hardcoded "PMS"
  // (which made no sense for a diesel-only or kerosene station).
  const defaultFuelType = fuelOptions[0]?.value || "PMS";

  const [formData, setFormData] = useState<Partial<OffloadingRecord>>({
    date: new Date().toISOString().split("T")[0],
    time: new Date().toTimeString().slice(0, 5),
    truckReg: "",
    driverName: "",
    fuelType: defaultFuelType,
    quantity: 0,
    rate: 0,
    totalAmount: 0,
    supplier: "",
    invoiceNo: "",
    remarks: "",
  });

  // Load saved supplier names from the cloud (Supplier Management module) so
  // the supplier field offers an autocomplete instead of forcing the user to
  // retype the same supplier name every offload (cross-device: works from any
  // browser because it reads from cloud, not localStorage).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await cloudStorageService.get<unknown[]>(
        "suppliers_data",
        currentStation?.id,
      );
      if (cancelled) return;
      if (Array.isArray(data)) {
        const names = data
          .map((s: any) => s?.name)
          .filter((n: any) => typeof n === "string" && n.trim())
          .sort((a: string, b: string) => a.localeCompare(b));
        setSuppliers(Array.from(new Set(names)) as string[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStation?.id]);

  const generateId = () => {
    return "OFF" + Date.now().toString().slice(-8);
  };

  const calculateTotal = (quantity: number, rate: number) => {
    return quantity * rate;
  };

  const handleInputChange = (field: keyof OffloadingRecord, value: any) => {
    const updatedData = { ...formData, [field]: value };

    // Auto-calculate total amount
    if (field === "quantity" || field === "rate") {
      const quantity =
        field === "quantity" ? parseFloat(value) || 0 : formData.quantity || 0;
      const rate =
        field === "rate" ? parseFloat(value) || 0 : formData.rate || 0;
      updatedData.totalAmount = calculateTotal(quantity, rate);
    }

    setFormData(updatedData);
  };

  const saveRecord = () => {
    if (
      !formData.truckReg ||
      !formData.driverName ||
      !formData.supplier ||
      !formData.quantity ||
      !formData.rate
    ) {
      toastError("Please fill in all required fields");
      return;
    }

    const record: OffloadingRecord = {
      id: selectedRecord?.id || generateId(),
      date: formData.date!,
      time: formData.time!,
      truckReg: formData.truckReg!,
      driverName: formData.driverName!,
      fuelType: formData.fuelType!,
      quantity: formData.quantity!,
      rate: formData.rate!,
      totalAmount: formData.totalAmount!,
      supplier: formData.supplier!,
      invoiceNo: formData.invoiceNo!,
      remarks: formData.remarks!,
    };

    let updatedRecords;
    if (selectedRecord) {
      // Update existing record
      updatedRecords = state.offloadingRecords.map((r) =>
        r.id === selectedRecord.id ? record : r,
      );
    } else {
      // Add new record
      updatedRecords = [...state.offloadingRecords, record];
    }

    dispatch({ type: "SET_OFFLOADING_RECORDS", payload: updatedRecords });
    resetForm();
    toastSuccess(
      selectedRecord
        ? "Record updated successfully!"
        : "Record added successfully!",
    );
  };

  const editRecord = (record: OffloadingRecord) => {
    setSelectedRecord(record);
    setFormData(record);
    setShowForm(true);
  };

  const deleteRecord = (id: string) => {
    if (confirm("Are you sure you want to delete this record?")) {
      const updatedRecords = state.offloadingRecords.filter((r) => r.id !== id);
      dispatch({ type: "SET_OFFLOADING_RECORDS", payload: updatedRecords });
    }
  };

  const resetForm = () => {
    setSelectedRecord(null);
    setShowForm(false);
    setFormData({
      date: new Date().toISOString().split("T")[0],
      time: new Date().toTimeString().slice(0, 5),
      truckReg: "",
      driverName: "",
      fuelType: defaultFuelType,
      quantity: 0,
      rate: 0,
      totalAmount: 0,
      supplier: "",
      invoiceNo: "",
      remarks: "",
    });
  };

  // Calculate totals. Previously ONLY PMS and AGO were counted (hardcoded);
  // any other fuel type (kerosene, LPG, V-Power, CNG…) was silently excluded
  // from the summary cards AND the exports. Now we compute a per-fuel-type
  // breakdown dynamically so EVERY offloaded fuel is represented.
  const totals = useMemo(() => {
    const records = state.offloadingRecords;
    const byFuel: Record<string, { quantity: number; amount: number }> = {};
    let totalQuantity = 0;
    let totalAmount = 0;
    for (const r of records) {
      const ft = r.fuelType || "UNKNOWN";
      if (!byFuel[ft]) byFuel[ft] = { quantity: 0, amount: 0 };
      byFuel[ft].quantity += r.quantity || 0;
      byFuel[ft].amount += r.totalAmount || 0;
      totalQuantity += r.quantity || 0;
      totalAmount += r.totalAmount || 0;
    }
    return { totalQuantity, totalAmount, byFuel };
  }, [state.offloadingRecords]);

  // Apply search + filters (was missing entirely).
  const filteredRecords = useMemo(() => {
    return state.offloadingRecords
      .filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          r.truckReg?.toLowerCase().includes(q) ||
          r.driverName?.toLowerCase().includes(q) ||
          r.supplier?.toLowerCase().includes(q) ||
          r.invoiceNo?.toLowerCase().includes(q) ||
          r.fuelType?.toLowerCase().includes(q)
        );
      })
      .filter((r) => !fuelFilter || r.fuelType === fuelFilter)
      .filter((r) => !dateFrom || r.date >= dateFrom)
      .filter((r) => !dateTo || r.date <= dateTo)
      .sort(
        (a, b) =>
          new Date(b.date + " " + b.time).getTime() -
          new Date(a.date + " " + a.time).getTime(),
      );
  }, [state.offloadingRecords, search, fuelFilter, dateFrom, dateTo]);

  // Export functions
  const exportToPDF = async () => {
    const doc = new jsPDF();

    let y = 20;
    if (state.companyData?.logo) {
      const logoDataUrl = await loadLogoAsDataURL(state.companyData.logo);
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, "PNG", 80, 10, 50, 20);
          y = 40;
        } catch {}
      }
    }

    doc.setFontSize(16);
    doc.setTextColor("#d4af37");
    doc.setFont("helvetica", "bold");
    doc.text(state.companyData.name, 105, y, { align: "center" });
    doc.setTextColor("#1a3a5f");

    y += 10;
    doc.setFontSize(14);
    doc.text("Fuel Offloading Report", 105, y, { align: "center" });
    y += 20;

    const headers = [
      "Date",
      "Time",
      "Truck Reg",
      "Driver",
      "Fuel Type",
      "Quantity (L)",
      "Rate",
      "Total Amount",
      "Supplier",
    ];
    const data = state.offloadingRecords.map((record) => [
      record.date,
      record.time,
      record.truckReg,
      record.driverName,
      record.fuelType,
      formatNumber(record.quantity),
      `${currencySymbol} ${formatNumber(record.rate)}`,
      `${currencySymbol} ${formatNumber(record.totalAmount)}`,
      record.supplier,
    ]);

    autoTable(doc, {
      startY: y,
      head: [headers],
      body: data,
      theme: "striped",
      headStyles: { fillColor: [26, 58, 95] },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;

    // Add totals — dynamic per-fuel-type breakdown (was hardcoded PMS/AGO only).
    doc.setFont("helvetica", "bold");
    doc.text(
      `Total Quantity: ${formatNumber(totals.totalQuantity)} L`,
      14,
      finalY,
    );
    doc.text(
      `Total Amount: ${currencySymbol} ${formatNumber(totals.totalAmount)}`,
      14,
      finalY + 8,
    );
    let lineOffset = 16;
    Object.entries(totals.byFuel).forEach(([ft, v]) => {
      doc.text(
        `${getFuelLabel(ft)} (${ft}): ${formatNumber(v.quantity)} L (${currencySymbol} ${formatNumber(v.amount)})`,
        14,
        finalY + lineOffset,
      );
      lineOffset += 8;
    });

    doc.save("Fuel_Offloading_Report.pdf");
  };

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws_data = [
      ["Fuel Offloading Report"],
      [state.companyData.name],
      [],
      [
        "Date",
        "Time",
        "Truck Reg",
        "Driver Name",
        "Fuel Type",
        "Quantity (L)",
        "Rate",
        "Total Amount",
        "Supplier",
        "Invoice No",
        "Remarks",
      ],
      ...state.offloadingRecords.map((record) => [
        record.date,
        record.time,
        record.truckReg,
        record.driverName,
        record.fuelType,
        record.quantity,
        record.rate,
        record.totalAmount,
        record.supplier,
        record.invoiceNo,
        record.remarks,
      ]),
      [],
      ["TOTALS"],
      [`Total Quantity: ${formatNumber(totals.totalQuantity)} L`],
      [`Total Amount: ${currencySymbol} ${formatNumber(totals.totalAmount)}`],
      ...Object.entries(totals.byFuel).map(([ft, v]) => [
        `${getFuelLabel(ft)} (${ft}): ${formatNumber(v.quantity)} L (${currencySymbol} ${formatNumber(v.amount)})`,
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, "Offloading Report");
    XLSX.writeFile(wb, "Fuel_Offloading_Report.xlsx");
  };

  const exportToTXT = () => {
    let txt = `=== ${state.companyData.name} ===\nFuel Offloading Report\n\n`;

    state.offloadingRecords.forEach((record) => {
      txt += `Date: ${record.date} ${record.time}\n`;
      txt += `Truck: ${record.truckReg} | Driver: ${record.driverName}\n`;
      txt += `Fuel: ${record.fuelType} | Quantity: ${formatNumber(record.quantity)} L\n`;
      txt += `Rate: ${currencySymbol} ${formatNumber(record.rate)} | Total: ${currencySymbol} ${formatNumber(record.totalAmount)}\n`;
      txt += `Supplier: ${record.supplier} | Invoice: ${record.invoiceNo}\n`;
      if (record.remarks) txt += `Remarks: ${record.remarks}\n`;
      txt += "\n";
    });

    txt += `\nTOTALS:\n`;
    txt += `Total Quantity: ${formatNumber(totals.totalQuantity)} L\n`;
    txt += `Total Amount: ${currencySymbol} ${formatNumber(totals.totalAmount)}\n`;
    Object.entries(totals.byFuel).forEach(([ft, v]) => {
      txt += `${getFuelLabel(ft)} (${ft}): ${formatNumber(v.quantity)} L (${currencySymbol} ${formatNumber(v.amount)})\n`;
    });

    const blob = new Blob([txt], { type: "text/plain" });
    saveAs(blob, "Fuel_Offloading_Report.txt");
  };

  // Build a compact fuel-breakdown summary string (used by WhatsApp + email).
  const fuelBreakdownSummary = () => {
    const parts = Object.entries(totals.byFuel).map(
      ([ft, v]) => `${getFuelLabel(ft)}: ${formatNumber(v.quantity)} L`,
    );
    return parts.length > 0 ? `\n${parts.join("\n")}` : "";
  };

  const exportHandlers = {
    pdf: exportToPDF,
    excel: exportToExcel,
    txt: exportToTXT,
    whatsapp: () => {
      const msg = `*${state.companyData.name}*\n\n*Fuel Offloading Summary*\n\nTotal Quantity: ${formatNumber(totals.totalQuantity)} L\nTotal Amount: ${currencySymbol} ${formatNumber(totals.totalAmount)}${fuelBreakdownSummary()}\n\nRecords: ${state.offloadingRecords.length}`;
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      const subject = "Fuel Offloading Report";
      const body = `${state.companyData.name}\n\nFuel Offloading Summary\n\nTotal Quantity: ${formatNumber(totals.totalQuantity)} L\nTotal Amount: ${currencySymbol} ${formatNumber(totals.totalAmount)}${fuelBreakdownSummary()}\n\nRecords: ${state.offloadingRecords.length}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  // Simple two-view toggle inside this tab (keeps sub-tab-less component
  // while adding the Delivery Audit / Reconciliation view).
  const [view, setView] = useState<"records" | "recon" | "tankers">("records");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {/* view toggle: Deliveries vs Delivery Audit (PO reconciliation) */}
      <div className="flex gap-2">
        <button
          onClick={() => setView("records")}
          className={`px-3 py-1.5 text-sm rounded-lg border ${
            view === "records"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600"
          }`}
        >
          Deliveries
        </button>
        <button
          onClick={() => setView("recon")}
          className={`px-3 py-1.5 text-sm rounded-lg border flex items-center gap-1.5 ${
            view === "recon"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600"
          }`}
        >
          <PackageCheck className="w-4 h-4" /> Delivery Audit
        </button>
        <button
          onClick={() => setView("tankers")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            view === "tankers"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600"
          }`}
        >
          <Truck className="w-4 h-4" /> Tankers
        </button>
      </div>
      {view === "recon" ? (
        <DeliveryReconciliation />
      ) : view === "tankers" ? (
        <TankerRegistry />
      ) : (
        <>
          {/* Header */}
          <div className="card">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                <Truck size={24} />
                Fuel Offloading Tracker
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowForm(true)}
                  className="btn btn-primary"
                >
                  <Plus size={16} />
                  New Offloading
                </button>
                <ExportDropdown onExport={exportHandlers} title="Export" />
              </div>
            </div>

            {/* Summary Cards — Total Quantity, Total Value, then ONE card per fuel
            type that has been offloaded (was hardcoded to ONLY PMS + AGO, so
            kerosene/LPG/V-Power/CNG offloads were invisible in the summary). */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                <div className="flex items-center gap-2 mb-2">
                  <Fuel size={20} className="text-blue-600" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Total Quantity
                  </span>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatNumber(totals.totalQuantity)} L
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-700">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={20} className="text-green-600" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-300">
                    Total Value
                  </span>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {currencySymbol} {formatNumber(totals.totalAmount)}
                </div>
              </div>

              {Object.entries(totals.byFuel).map(([ft, v]) => (
                <div
                  key={ft}
                  className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-700"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Fuel size={20} className="text-amber-600" />
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {getFuelLabel(ft)} ({ft})
                    </span>
                  </div>
                  <div className="text-lg font-bold text-amber-600">
                    {formatNumber(v.quantity)} L
                  </div>
                  <div className="text-sm text-amber-600">
                    {currencySymbol} {formatNumber(v.amount)}
                  </div>
                </div>
              ))}
            </div>

            {/* Cross-tab links — connect offloading to Fuel Statement Report + Supplier
            Management (same domain: fuel delivery). */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => switchToTab("delivery")}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700"
              >
                <ArrowRight size={12} />
                Fuel Statement Report
              </button>
              <button
                onClick={() => switchToTab("suppliers")}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-700"
              >
                <ArrowRight size={12} />
                Suppliers
              </button>
            </div>

            {/* Search + filter bar (was missing — no way to find a record in a
            long list by date/truck/supplier/fuel type). */}
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                  size={16}
                />
                <input
                  type="text"
                  placeholder="Search truck, driver, supplier, invoice, fuel…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
                />
              </div>
              <select
                value={fuelFilter}
                onChange={(e) => setFuelFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              >
                <option value="">All Fuels</option>
                {fuelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
                title="From date"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
                title="To date"
              />
              {(search || fuelFilter || dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setSearch("");
                    setFuelFilter("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Records Table */}
            <div className="table-container overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Truck Reg</th>
                    <th>Driver</th>
                    <th>Fuel Type</th>
                    <th>Quantity (L)</th>
                    <th>Rate</th>
                    <th>Total Amount</th>
                    <th>Supplier</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.offloadingRecords.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-8 text-gray-500 dark:text-gray-500 dark:text-gray-400"
                      >
                        <Truck size={48} className="mx-auto mb-2 opacity-30" />
                        <p>No offloading records found</p>
                        <p className="text-sm">
                          Add your first offloading record to get started
                        </p>
                      </td>
                    </tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-8 text-gray-500 dark:text-gray-500 dark:text-gray-400"
                      >
                        <Search size={48} className="mx-auto mb-2 opacity-30" />
                        <p>No records match your filters</p>
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <div className="flex items-center gap-1">
                            <Calendar
                              size={14}
                              className="text-gray-500 dark:text-gray-400"
                            />
                            <div>
                              <div className="font-medium">{record.date}</div>
                              <div className="text-sm text-gray-500">
                                {record.time}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="font-mono font-medium">
                          {record.truckReg}
                        </td>
                        <td>{record.driverName}</td>
                        <td>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              normalizeFuelType(record.fuelType) === "petrol"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                                : normalizeFuelType(record.fuelType) ===
                                    "diesel"
                                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                            }`}
                          >
                            {getFuelLabel(record.fuelType)}
                          </span>
                        </td>
                        <td className="font-mono">
                          {formatNumber(record.quantity)}
                        </td>
                        <td className="font-mono">
                          {currencySymbol} {formatNumber(record.rate)}
                        </td>
                        <td className="font-mono font-medium">
                          {currencySymbol} {formatNumber(record.totalAmount)}
                        </td>
                        <td>{record.supplier}</td>
                        <td>
                          <div className="flex gap-1">
                            <button
                              onClick={() => editRecord(record)}
                              className="btn btn-outline p-1"
                              title="Edit"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => deleteRecord(record.id)}
                              className="btn btn-outline p-1 text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold">
                    {selectedRecord
                      ? "Edit Offloading Record"
                      : "New Offloading Record"}
                  </h3>
                  <button
                    onClick={resetForm}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="form-group">
                    <label>Date *</label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) =>
                        handleInputChange("date", e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Time *</label>
                    <input
                      type="time"
                      value={formData.time}
                      onChange={(e) =>
                        handleInputChange("time", e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Truck Registration *</label>
                    <input
                      type="text"
                      value={formData.truckReg}
                      onChange={(e) =>
                        handleInputChange(
                          "truckReg",
                          e.target.value.toUpperCase(),
                        )
                      }
                      placeholder="Truck registration number"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Driver Name *</label>
                    <input
                      type="text"
                      value={formData.driverName}
                      onChange={(e) =>
                        handleInputChange("driverName", e.target.value)
                      }
                      placeholder="Driver full name"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Fuel Type *</label>
                    <select
                      value={formData.fuelType}
                      onChange={(e) =>
                        handleInputChange("fuelType", e.target.value)
                      }
                      required
                    >
                      {fuelOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.value} ({opt.label})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Quantity (Litres) *</label>
                    <input
                      type="number"
                      value={formData.quantity ?? ""}
                      onChange={(e) =>
                        handleInputChange(
                          "quantity",
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      step="0.1"
                      min="0"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Rate per Litre ({currencySymbol}) *</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={formData.rate ?? ""}
                        onChange={(e) =>
                          handleInputChange(
                            "rate",
                            parseFloat(e.target.value) || 0,
                          )
                        }
                        step="0.01"
                        min="0"
                        required
                        className="flex-1"
                      />
                      {(() => {
                        const label = getFuelLabel(formData.fuelType || "PMS");
                        const price = fuelTypeApi.getPriceFor(label);
                        return price != null ? (
                          <button
                            type="button"
                            onClick={() => handleInputChange("rate", price)}
                            className="px-3 py-1 text-xs rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 whitespace-nowrap"
                            title={`Use the station's current ${label} price (${price}/L)`}
                          >
                            Use {label} price ({price})
                          </button>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Total Amount ({currencySymbol})</label>
                    <input
                      type="number"
                      value={formData.totalAmount ?? ""}
                      readOnly
                      className="bg-gray-100 dark:bg-gray-700"
                    />
                  </div>

                  <div className="form-group">
                    <label>Supplier *</label>
                    <input
                      type="text"
                      list="offloading-suppliers"
                      value={formData.supplier}
                      onChange={(e) =>
                        handleInputChange("supplier", e.target.value)
                      }
                      placeholder="Supplier company name"
                      required
                    />
                    {/* Autocomplete from cloud-saved suppliers (Supplier Management).
                    A native datalist keeps this simple + accessible; the user
                    can still type any free-text name. */}
                    {suppliers.length > 0 && (
                      <datalist id="offloading-suppliers">
                        {suppliers.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Invoice Number</label>
                    <input
                      type="text"
                      value={formData.invoiceNo}
                      onChange={(e) =>
                        handleInputChange("invoiceNo", e.target.value)
                      }
                      placeholder="Invoice/Receipt number"
                    />
                  </div>

                  <div className="form-group md:col-span-2">
                    <label>Remarks</label>
                    <textarea
                      value={formData.remarks}
                      onChange={(e) =>
                        handleInputChange("remarks", e.target.value)
                      }
                      placeholder="Additional notes or remarks"
                      rows={3}
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-6">
                  <button
                    onClick={saveRecord}
                    className="btn btn-primary flex-1 fp-icon-only"
                    title="Save"
                    aria-label="Save"
                  >
                    <Save size={16} />
                    {selectedRecord ? "Update Record" : "Save Record"}
                  </button>
                  <button onClick={resetForm} className="btn btn-outline">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
