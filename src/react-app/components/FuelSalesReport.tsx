import { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Printer,
  Download,
  Loader2,
  ShoppingCart,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import {
  getFuelLabel,
  type CanonicalFuelType,
} from "@/react-app/config/pricing";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import SubTabBar from "@/react-app/components/SubTabBar";
import FuelMixReport from "@/react-app/components/FuelMixReport";
import VehicleSalesTracker from "@/react-app/components/VehicleSalesTracker";
import CarWashServices from "@/react-app/components/CarWashServices";
import PaymentReconByPump from "@/react-app/components/PaymentReconByPump";
import NozzleAnalysis from "@/react-app/components/NozzleAnalysis";
import { TrendingUp, Coins, Banknote, PieChart } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { silentPrintService } from "@/react-app/lib/silent-print-service";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

interface SalesEntry {
  date: string;
  shift: "DAY" | "NIGHT";
  /** Per-fuel-type sales: { petrol: {sales, litres}, diesel: {...}, kerosene: {...}, ... } */
  fuelSales: Record<string, { sales: number; litres: number }>;
  totalSales: number;
}

export default function FuelSalesReport() {
  const { state } = useFuel();
  const fuelTypeApi = useStationFuelTypes();
  const [innerView, setInnerView] = useState<
    "report" | "analysis" | "vehicles" | "services" | "payrecon" | "mix"
  >("report");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("fuelsalesreport", setInnerView);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [reportData, setReportData] = useState<SalesEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [totals, setTotals] = useState<
    Record<string, { sales: number; litres: number }>
  >({});

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Generate year options for a sensible range (10 years back, 5 forward)
  const generateYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 10;
    const endYear = currentYear + 5;
    const years = [];

    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }

    return years;
  };

  const yearOptions = generateYearOptions();

  // DYNAMIC fuel types — the station's configured fuel types (Kerosene,
  // V-Power, LPG, …) instead of hardcoded Petrol/Diesel. Falls back to
  // petrol+diesel only when no fuel types are configured (first run).
  const trackedFuelTypes: CanonicalFuelType[] = useMemo(() => {
    const active = fuelTypeApi.activeFuelTypes;
    const set = new Set<CanonicalFuelType>();
    for (const ft of active) {
      const c = fuelTypeApi.canonicalOf(ft.name);
      if (c) set.add(c);
    }
    if (set.size === 0) {
      set.add("petrol");
      set.add("diesel");
    }
    return Array.from(set);
  }, [fuelTypeApi]);

  // Helper: compute sales (litres + currency) for ONE fuel type from a saved
  // sales-tracking record. Reads fuelPumpsByType[type] (dynamic) with a
  // fallback to pmsPumps/agoPumps (legacy) for petrol/diesel, and
  // fuelTankValuesByType[type] / pmsTank* / agoTank* for tank-delta fallback.
  const computeFuelSales = (salesData: any, ft: CanonicalFuelType) => {
    let sales = 0;
    let litres = 0;
    const pumps =
      ft === "petrol"
        ? salesData.pmsPumps || salesData.fuelPumpsByType?.petrol || []
        : ft === "diesel"
          ? salesData.agoPumps || salesData.fuelPumpsByType?.diesel || []
          : salesData.fuelPumpsByType?.[ft] || [];
    const price =
      ft === "petrol"
        ? Number(salesData.pmsPrice) ||
          Number(salesData.petrolPrice) ||
          Number(salesData.fuelPricesByType?.petrol) ||
          0
        : ft === "diesel"
          ? Number(salesData.agoPrice) ||
            Number(salesData.dieselPrice) ||
            Number(salesData.fuelPricesByType?.diesel) ||
            0
          : Number(salesData.fuelPricesByType?.[ft]) || 0;
    (pumps || []).forEach((pump: any) => {
      const openingKsh = Number(pump.openingKsh) || 0;
      const closingKsh = Number(pump.closingKsh) || 0;
      const openingL = Number(pump.openingL) || 0;
      const closingL = Number(pump.closingL) || 0;
      sales += Math.max(0, closingKsh - openingKsh);
      litres += Math.max(0, closingL - openingL);
    });
    // If pumps had no Ksh sales but had litre readings, compute value.
    if (sales === 0 && litres === 0 && price > 0) {
      (pumps || []).forEach((pump: any) => {
        litres += Math.max(
          0,
          (Number(pump.closingL) || 0) - (Number(pump.openingL) || 0),
        );
      });
      sales = Math.round(litres * price * 100) / 100;
    }
    // Tank-delta fallback.
    if (sales === 0 && litres === 0) {
      const tank =
        ft === "petrol"
          ? {
              opening: Number(salesData.pmsTankOpening) || 0,
              closing: Number(salesData.pmsTankClosing) || 0,
            }
          : ft === "diesel"
            ? {
                opening: Number(salesData.agoTankOpening) || 0,
                closing: Number(salesData.agoTankClosing) || 0,
              }
            : salesData.fuelTankValuesByType?.[ft] || {
                opening: 0,
                closing: 0,
              };
      const delta = Number(tank.closing) - Number(tank.opening);
      if (delta > 0 && price > 0) {
        litres = Math.round(delta * 100) / 100;
        sales = Math.round(delta * price * 100) / 100;
      }
    }
    sales = Math.round(sales * 100) / 100;
    return { sales, litres };
  };

  useEffect(() => {
    generateReport();
  }, [selectedMonth, selectedYear, state.salesHistory, trackedFuelTypes]);

  const generateReport = () => {
    // Get real sales data EXCLUSIVELY from saved Sales Tracking records
    const entries: SalesEntry[] = [];

    if (state.salesHistory && typeof state.salesHistory === "object") {
      Object.entries(state.salesHistory).forEach(
        ([dateKey, salesData]: [string, any]) => {
          // Parse the dateKey which is in format YYYY-MM-DD_Shift or similar
          const [datePart] = dateKey.split("_");
          const salesDate = new Date(datePart);

          // Ensure valid date and check if it matches selected month/year
          if (
            !isNaN(salesDate.getTime()) &&
            salesDate.getMonth() + 1 === selectedMonth &&
            salesDate.getFullYear() === selectedYear
          ) {
            // Check if we have ANY fuel data (pumps OR tank readings) across
            // ALL configured fuel types — not just PMS/AGO.
            const hasAnyData = trackedFuelTypes.some((ft) => {
              const r = computeFuelSales(salesData, ft);
              return r.sales > 0 || r.litres > 0;
            });
            if (!hasAnyData) return;

            // DYNAMIC: compute sales per fuel type.
            const fuelSales: Record<string, { sales: number; litres: number }> =
              {};
            let totalSales = 0;
            for (const ft of trackedFuelTypes) {
              const r = computeFuelSales(salesData, ft);
              fuelSales[ft] = r;
              totalSales += r.sales;
            }
            totalSales = Math.round(totalSales * 100) / 100;

            // Format date as DD/MM/YYYY(SHIFT)
            const day = salesDate.getDate().toString().padStart(2, "0");
            const month = selectedMonth.toString().padStart(2, "0");
            const year = selectedYear.toString();
            const shift =
              salesData.shift === "Night" || salesData.shift === "NIGHT"
                ? "NIGHT"
                : "DAY";
            const formattedDate = `${day}/${month}/${year}(${shift})`;

            entries.push({
              date: formattedDate,
              shift: shift as "DAY" | "NIGHT",
              fuelSales,
              totalSales,
            });
          }
        },
      );
    }

    // Sort entries by date for better presentation
    entries.sort((a, b) => {
      const dateA = new Date(
        a.date.split("(")[0].split("/").reverse().join("-"),
      );
      const dateB = new Date(
        b.date.split("(")[0].split("/").reverse().join("-"),
      );
      return dateA.getTime() - dateB.getTime();
    });

    setReportData(entries);

    // DYNAMIC totals per fuel type
    const newTotals: Record<string, { sales: number; litres: number }> = {};
    for (const ft of trackedFuelTypes) {
      const salesTotal = entries.reduce(
        (sum, e) => sum + (e.fuelSales[ft]?.sales || 0),
        0,
      );
      const litresTotal = entries.reduce(
        (sum, e) => sum + (e.fuelSales[ft]?.litres || 0),
        0,
      );
      newTotals[ft] = {
        sales: Math.round(salesTotal * 100) / 100,
        litres: Math.round(litresTotal * 100) / 100,
      };
    }
    setTotals(newTotals);
  };

  const handlePrint = () => {
    const printContent = document.getElementById("report-content");
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Fuel Sales Report - ${months[selectedMonth - 1]} ${selectedYear}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 20px; 
              background: white; 
              color: black;
            }
            .logo { 
              text-align: center; 
              margin-bottom: 20px; 
            }
            .report-logo {
              max-width: 150px;
              max-height: 60px;
              margin: 0 auto 16px auto;
              display: block;
              object-fit: contain;
            }
            .company-name { 
              font-size: 18px; 
              font-weight: bold; 
              text-align: center; 
              margin: 10px 0; 
            }
            .report-title { 
              font-size: 16px; 
              font-weight: bold; 
              text-align: center; 
              margin: 10px 0; 
            }
            .month-year { 
              text-align: center; 
              margin: 15px 0; 
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin: 20px 0; 
            }
            th, td { 
              border: 1px solid #333; 
              padding: 8px; 
              text-align: center; 
            }
            th { 
              background-color: #f0f0f0; 
              font-weight: bold; 
            }
            .totals { 
              margin: 20px 0; 
              font-weight: bold; 
            }
            .contact-info { 
              margin-top: 30px; 
            }
            @media print {
              body { margin: 0; }
              .report-logo {
                max-width: 120px;
                max-height: 50px;
              }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  // Silent print using print service
  const handleSilentPrint = async () => {
    if (reportData.length === 0) return;

    setIsPrinting(true);
    try {
      const reportHTML = document.getElementById("report-content");
      const reportDataForPrint = {
        stationName: state.companyData.name || "",
        monthYear: `${months[selectedMonth - 1]} ${selectedYear}`,
        period: `${months[selectedMonth - 1]} ${selectedYear}`,
        currency: resolveCurrencySymbol(state.companyData.currency, undefined),
        fuelTypes: trackedFuelTypes,
        entries: reportData.map((entry) => ({
          date: entry.date,
          fuelSales: entry.fuelSales,
          totalSales: entry.totalSales,
        })),
        totals: Object.fromEntries(
          trackedFuelTypes.map((ft) => [ft, totals[ft]?.sales || 0]),
        ),
      };

      await silentPrintService.queueSalesReport(reportDataForPrint);

      setTimeout(() => setIsPrinting(false), 1500);
    } catch (error) {
      console.error("Silent print error:", error);
      setIsPrinting(false);
    }
  };

  const handleSaveReport = async () => {
    try {
      setIsSaving(true);

      const reportContent = document.getElementById("report-content");
      if (!reportContent) return;

      // Create a clean version for PDF generation
      const clonedContent = reportContent.cloneNode(true) as HTMLElement;

      // Apply PDF-specific styles to the cloned content
      const style = document.createElement("style");
      style.textContent = `
        .report-logo {
          max-width: 150px !important;
          max-height: 60px !important;
          margin: 0 auto 16px auto !important;
          display: block !important;
          object-fit: contain !important;
        }
        .logo {
          text-align: center !important;
          margin-bottom: 20px !important;
        }
        .company-name {
          font-size: 18px !important;
          font-weight: bold !important;
          text-align: center !important;
          margin: 10px 0 !important;
          color: #000 !important;
        }
        .report-title {
          font-size: 16px !important;
          font-weight: bold !important;
          text-align: center !important;
          margin: 10px 0 !important;
          color: #000 !important;
        }
        .month-year {
          text-align: center !important;
          margin: 15px 0 !important;
          color: #000 !important;
        }
        .totals {
          color: #000 !important;
        }
        .contact-info {
          color: #000 !important;
        }
      `;

      document.head.appendChild(style);

      // Temporarily add the cloned content to the body for rendering
      const tempContainer = document.createElement("div");
      tempContainer.style.position = "absolute";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "0";
      tempContainer.style.background = "white";
      tempContainer.style.color = "black";
      tempContainer.style.width = "210mm"; // A4 width
      tempContainer.style.padding = "20px";
      tempContainer.appendChild(clonedContent);
      document.body.appendChild(tempContainer);

      // Generate canvas from the content
      const canvas = await html2canvas(tempContainer, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        allowTaint: true,
        width: 794, // A4 width in pixels at 96 DPI
        height: 1123, // A4 height in pixels at 96 DPI
      });

      // Create PDF
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 295; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;

      let position = 0;

      // Add image to PDF
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add new pages if content is longer than one page
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate filename
      const filename = `Fuel_Sales_Report_${months[selectedMonth - 1]}_${selectedYear}.pdf`;

      // Save the PDF
      pdf.save(filename);

      // Cleanup
      document.body.removeChild(tempContainer);
      document.head.removeChild(style);
    } catch (error) {
      console.error("Error generating PDF:", error);
      import("@/react-app/lib/toast").then(({ toastError }) =>
        toastError("Error generating PDF. Please try again."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currency = resolveCurrencySymbol(state.companyData.currency, undefined);

  return (
    <div className="p-4 md:p-6 space-y-6 text-gray-900 dark:text-white min-h-screen">
      <SubTabBar
        tabs={[
          { id: "report", label: "Monthly Report", icon: FileText },
          { id: "analysis", label: "Nozzle & Attendant", icon: TrendingUp },
          { id: "vehicles", label: "Vehicle Sales", icon: ShoppingCart },
          { id: "services", label: "Services", icon: Coins },
          { id: "payrecon", label: "Payment Recon", icon: Banknote },
          { id: "mix", label: "Fuel Mix", icon: PieChart },
        ]}
        active={innerView}
        onChange={(id) => setInnerView(id as typeof innerView)}
      />
      {innerView === "analysis" ? (
        <NozzleAnalysis />
      ) : innerView === "vehicles" ? (
        <VehicleSalesTracker />
      ) : innerView === "services" ? (
        <CarWashServices />
      ) : innerView === "payrecon" ? (
        <PaymentReconByPump />
      ) : innerView === "mix" ? (
        <FuelMixReport />
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <FileText className="text-blue-400" />
              Fuel Sales Report
            </h2>

            <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
              <div className="flex gap-2">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded p-2 text-gray-900 dark:text-white text-sm"
                >
                  {months.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded p-2 text-gray-900 dark:text-white text-sm"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveReport}
                  disabled={isSaving}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-gray-900 dark:text-white px-4 py-2 rounded flex items-center gap-2 text-sm fp-icon-only"
                  title="Download"
                  aria-label="Download"
                >
                  <Download size={16} />
                  {isSaving ? "Saving..." : "Save Report"}
                </button>

                <button
                  onClick={handlePrint}
                  className="bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white px-4 py-2 rounded flex items-center gap-2 text-sm"
                >
                  <Printer size={16} />
                  Print Report
                </button>

                <button
                  onClick={handleSilentPrint}
                  disabled={isPrinting || reportData.length === 0}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-gray-900 dark:text-white px-4 py-2 rounded flex items-center gap-2 text-sm fp-icon-only"
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
                      Silent Print
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Cross-tab interlinks — quick navigation to related tabs */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => switchToTab("sales")}
              className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
            >
              <ClipboardList size={14} />
              Sales Tracking
            </button>
            <button
              onClick={() => switchToTab("pos")}
              className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
            >
              <ShoppingCart size={14} />
              Point of Sale
            </button>
            <button
              onClick={() => switchToTab("reports")}
              className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
            >
              <BarChart3 size={14} />
              Reports Center
            </button>
          </div>

          {/* Quick Stats — DYNAMIC per configured fuel type */}
          <div
            className={`grid gap-4 ${trackedFuelTypes.length >= 3 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1 md:grid-cols-3"}`}
          >
            {trackedFuelTypes.map((ft) => {
              const label = getFuelLabel(ft);
              const t = totals[ft] || { sales: 0, litres: 0 };
              return (
                <div
                  key={ft}
                  className="bg-slate-700/30 border border-slate-500 p-4 rounded-lg"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="text-indigo-400" size={20} />
                    <span className="text-sm text-slate-300">
                      {label} Sales
                    </span>
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {currency} {t.sales.toFixed(2)}
                  </div>
                  {t.litres > 0 && (
                    <div className="text-xs text-slate-300 mt-1">
                      {t.litres.toFixed(2)} L sold
                    </div>
                  )}
                </div>
              );
            })}
            <div className="bg-purple-900/30 border border-purple-600 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="text-purple-400" size={20} />
                <span className="text-sm text-purple-300">Total Revenue</span>
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {currency}{" "}
                {trackedFuelTypes
                  .reduce((sum, ft) => sum + (totals[ft]?.sales || 0), 0)
                  .toFixed(2)}
              </div>
              {trackedFuelTypes.some((ft) => (totals[ft]?.litres || 0) > 0) && (
                <div className="text-xs text-purple-300 mt-1">
                  {trackedFuelTypes
                    .reduce((sum, ft) => sum + (totals[ft]?.litres || 0), 0)
                    .toFixed(2)}{" "}
                  L total
                </div>
              )}
            </div>
          </div>

          {/* Report Content */}
          <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden">
            <div id="report-content" className="p-6">
              {/* Header - Only show if company data exists */}
              <div className="text-center mb-6">
                {state.companyData.logo && (
                  <div className="logo mb-4">
                    <img
                      src={state.companyData.logo}
                      alt={
                        state.companyData.name
                          ? `${state.companyData.name} logo`
                          : "Company logo"
                      }
                      className="report-logo h-16 mx-auto max-w-[150px] max-h-[60px] object-contain"
                    />
                  </div>
                )}
                {state.companyData.name &&
                state.companyData.name.trim() !== "" ? (
                  <div className="company-name text-lg font-bold text-gray-900 dark:text-white mb-2">
                    {state.companyData.name}
                  </div>
                ) : (
                  <div className="company-name text-lg font-bold text-gray-900 dark:text-white mb-2">
                    Company Name
                  </div>
                )}
                <div className="report-title text-md font-semibold text-gray-200 mb-2">
                  Fuel Sales Report
                </div>
                <div className="month-year text-gray-300">
                  <div>Month: {months[selectedMonth - 1]}</div>
                  <div>Year: {selectedYear}</div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                {reportData.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText
                      size={48}
                      className="mx-auto text-gray-500 mb-4"
                    />
                    <div className="text-lg font-semibold text-gray-300 mb-2">
                      No sales recorded for this period
                    </div>
                    <div className="text-gray-500 dark:text-gray-400">
                      Sales data for {months[selectedMonth - 1]} {selectedYear}{" "}
                      will appear here once you save sales tracking records.
                    </div>
                  </div>
                ) : (
                  <table className="w-full border-collapse bg-white text-black">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-400 p-3 text-left">
                          DD/MM/YYYY(SHIFT)
                        </th>
                        {trackedFuelTypes.map((ft) => (
                          <th
                            key={ft}
                            className="border border-gray-400 p-3 text-right"
                          >
                            {getFuelLabel(ft)} (L)
                          </th>
                        ))}
                        {trackedFuelTypes.map((ft) => (
                          <th
                            key={`sales-${ft}`}
                            className="border border-gray-400 p-3 text-right"
                          >
                            {getFuelLabel(ft)} Sales ({currency})
                          </th>
                        ))}
                        <th className="border border-gray-400 p-3 text-right">
                          Total Sales/Revenue ({currency})
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((entry, index) => (
                        <tr
                          key={index}
                          className={
                            index % 2 === 0 ? "bg-white" : "bg-gray-50"
                          }
                        >
                          <td className="border border-gray-400 p-3">
                            {entry.date}
                          </td>
                          {trackedFuelTypes.map((ft) => (
                            <td
                              key={ft}
                              className="border border-gray-400 p-3 text-right"
                            >
                              {(entry.fuelSales[ft]?.litres || 0).toFixed(2)}
                            </td>
                          ))}
                          {trackedFuelTypes.map((ft) => (
                            <td
                              key={`sales-${ft}`}
                              className="border border-gray-400 p-3 text-right"
                            >
                              {(entry.fuelSales[ft]?.sales || 0).toFixed(2)}
                            </td>
                          ))}
                          <td className="border border-gray-400 p-3 text-right">
                            {entry.totalSales.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Totals - Only show if there's data */}
              {reportData.length > 0 && (
                <div className="totals mt-6 space-y-2">
                  {trackedFuelTypes.map((ft) => {
                    const label = getFuelLabel(ft);
                    const t = totals[ft] || { sales: 0, litres: 0 };
                    return (
                      <div key={ft} className="text-gray-900 dark:text-white">
                        <span className="font-semibold">
                          Monthly Total {label} Sales:
                        </span>{" "}
                        {currency} {t.sales.toFixed(2)}
                        {t.litres > 0 && (
                          <span className="text-gray-300 ml-2">
                            ({t.litres.toFixed(2)} L)
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div className="text-gray-900 dark:text-white text-lg">
                    <span className="font-bold">
                      Total Monthly Sales/Revenue:
                    </span>{" "}
                    {currency}{" "}
                    {trackedFuelTypes
                      .reduce((sum, ft) => sum + (totals[ft]?.sales || 0), 0)
                      .toFixed(2)}
                  </div>
                </div>
              )}

              {/* Contact Info - Only show if actual data exists */}
              {((state.companyData.poBox &&
                state.companyData.poBox.trim() !== "") ||
                (state.companyData.contacts &&
                  state.companyData.contacts.trim() !== "") ||
                (state.companyData.email &&
                  state.companyData.email.trim() !== "")) && (
                <div className="contact-info mt-8 text-gray-300 space-y-1">
                  {state.companyData.poBox &&
                    state.companyData.poBox.trim() !== "" && (
                      <div>P.O. Box: {state.companyData.poBox}</div>
                    )}
                  {state.companyData.contacts &&
                    state.companyData.contacts.trim() !== "" && (
                      <div>Contacts: {state.companyData.contacts}</div>
                    )}
                  {state.companyData.email &&
                    state.companyData.email.trim() !== "" && (
                      <div>Email: {state.companyData.email}</div>
                    )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
