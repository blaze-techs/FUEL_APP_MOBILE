import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  Filter,
  FileText,
  Receipt,
  Building2,
  Printer,
  Download,
  CheckCircle2,
  ShoppingCart,
  Package,
  BookOpen,
  Landmark,
  Calculator,
} from "lucide-react";
import DayBook from "@/react-app/components/DayBook";
import LossControl from "@/react-app/components/LossControl";
import BankLedger from "@/react-app/components/BankLedger";
import CashFlowReport from "@/react-app/components/CashFlowReport";
import StationPnlSummary from "@/react-app/components/StationPnlSummary";
import { useFuel } from "@/react-app/context/FuelContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
  getDetectedCountryCode,
  isKenyaStation,
} from "@/react-app/lib/currency";
import {
  navigateToTab,
  type FuelPricePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import { getVATRate, getFuelLabel } from "@/react-app/config/pricing";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { loadLogoAsDataURL } from "@/react-app/utils/exportUtils";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

type ReportType =
  | "overall"
  | "daybook"
  | "losscontrol"
  | "bankledger"
  | "cashflow"
  | "stationpnl"
  | "profit-loss"
  | "expenses"
  | "vat-return"
  | "daily-sales"
  | "kra-summary";
type ReportPeriod = "daily" | "weekly" | "monthly" | "yearly";

export default function ReportsCenter() {
  const { state } = useFuel();

  // Country-aware VAT rate + label (replaces hardcoded "16%")
  const VAT_RATE = getVATRate(getDetectedCountryCode());
  const vatPercentLabel = `${(VAT_RATE * 100).toFixed(0)}%`;
  const isKenya = isKenyaStation();

  // Total POS revenue for a sale across ALL fuel types (legacy PMS/AGO plus
  // any byTypeAmount entries for custom fuels), so reports aren't limited to
  // just petrol/diesel.
  const posRevenueFor = (sale: any): number => {
    const ps = sale?.posSales;
    if (!ps) return 0;
    let total = (ps.pmsAmount || 0) + (ps.agoAmount || 0);
    if (ps.byTypeAmount && typeof ps.byTypeAmount === "object") {
      for (const amt of Object.values(ps.byTypeAmount)) {
        total += (amt as number) || 0;
      }
    }
    return total;
  };

  // Total fuel revenue for a sale across ALL fuel types — legacy pmsPumps/
  // agoPumps PLUS dynamic fuelPumpsByType (Kerosene, V-Power, LPG, …).
  // Without this, reports silently drop revenue from any non-PMS/AGO fuel.
  const fuelRevenueFor = (sale: any): number => {
    let total = 0;
    // Legacy PMS/AGO
    total += (sale.pmsPumps || []).reduce(
      (s: number, p: any) => s + (p.salesKsh || 0),
      0,
    );
    total += (sale.agoPumps || []).reduce(
      (s: number, p: any) => s + (p.salesKsh || 0),
      0,
    );
    // Dynamic: all fuel types in fuelPumpsByType (including petrol/diesel
    // if they were stored there instead of in pmsPumps/agoPumps)
    if (sale.fuelPumpsByType && typeof sale.fuelPumpsByType === "object") {
      for (const pumps of Object.values(sale.fuelPumpsByType)) {
        total += (pumps as any[]).reduce(
          (s: number, p: any) => s + (p.salesKsh || 0),
          0,
        );
      }
    }
    // Dynamic POS sales by fuel type
    if (sale.posSales?.byTypeAmount) {
      for (const amt of Object.values(sale.posSales.byTypeAmount)) {
        total += (amt as number) || 0;
      }
    }
    return total;
  };

  // Total fuel litres for a sale across ALL fuel types.
  const fuelLitresFor = (sale: any): number => {
    let total = 0;
    total += (sale.pmsPumps || []).reduce(
      (s: number, p: any) => s + (p.salesL || 0),
      0,
    );
    total += (sale.agoPumps || []).reduce(
      (s: number, p: any) => s + (p.salesL || 0),
      0,
    );
    if (sale.fuelPumpsByType && typeof sale.fuelPumpsByType === "object") {
      for (const pumps of Object.values(sale.fuelPumpsByType)) {
        total += (pumps as any[]).reduce(
          (s: number, p: any) => s + (p.salesL || 0),
          0,
        );
      }
    }
    // POS litres
    const ps = sale.posSales;
    if (ps) {
      total += (ps.pmsLitres || 0) + (ps.agoLitres || 0);
      if (ps.byTypeLitres) {
        for (const l of Object.values(ps.byTypeLitres)) {
          total += (l as number) || 0;
        }
      }
    }
    return total;
  };

  // Country-aware locale for date formatting (replaces hardcoded "en-KE")
  const countryCode = getDetectedCountryCode();
  const reportLocale = countryCode
    ? new Intl.Locale(countryCode).toString()
    : undefined;
  const formatGeneratedDate = () =>
    new Date().toLocaleString(reportLocale || undefined);
  const [activeReport, setActiveReport] = useState<ReportType>("overall");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("daily");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [endDate, setEndDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  // Expenses recorded via the Expenses tab live in a SEPARATE cloud store
  // (key `expenses_data`, written by ExpenseTracker), NOT inside
  // state.salesHistory[sale].expenses. Load them here so the Expenses,
  // Profit & Loss, and Overall reports reflect the real expenses a user
  // actually recorded — otherwise every cost line shows $0 even when the
  // Expenses tab has data.
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  const [cloudExpenses, setCloudExpenses] = useState<any[]>(() => {
    // Instant first render from the synchronous in-memory cache so there is
    // no blank flash before the async cloud fetch resolves.
    const cached = cloudStorageService.getCached<unknown>(
      "expenses_data",
      stationId,
    );
    if (Array.isArray(cached)) return cached as any[];
    return [];
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cloud = await cloudStorageService.get<unknown>(
        "expenses_data",
        stationId,
      );
      // Only overwrite if the cloud returned real data — avoids wiping the
      // cached display with an empty/null result during a transient fetch.
      if (!cancelled && Array.isArray(cloud) && cloud.length > 0)
        setCloudExpenses(cloud as any[]);
    };
    load();
    const unsub = cloudStorageService.subscribe<unknown>(
      "expenses_data",
      stationId,
      (val) => {
        if (Array.isArray(val) && val.length > 0)
          setCloudExpenses(val as any[]);
      },
    );
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user, stationId]);

  // Filter cloud expenses by the active report date range + period, summed
  // per period (mirrors the groupByPeriod structure the report renderers use).
  const cloudExpensesByPeriod = () => {
    const filtered = filterByDateRange(cloudExpenses);
    return groupByPeriod(filtered);
  };

  // Helper function to filter data by date range
  const filterByDateRange = (data: any[], dateField: string = "date") => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include full end date

    return data.filter((item) => {
      const itemDate = new Date(item[dateField]);
      return itemDate >= start && itemDate <= end;
    });
  };

  // Helper function to group data by period
  const groupByPeriod = (data: any[], dateField: string = "date") => {
    const grouped: { [key: string]: any[] } = {};

    data.forEach((item) => {
      const date = new Date(item[dateField]);
      let key = "";

      switch (reportPeriod) {
        case "daily":
          key = date.toISOString().split("T")[0];
          break;
        case "weekly": {
          const week = getWeekNumber(date);
          key = `${date.getFullYear()}-W${week}`;
          break;
        }
        case "monthly":
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          break;
        case "yearly":
          key = date.getFullYear().toString();
          break;
      }

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });

    return grouped;
  };

  // Helper function to get week number
  const getWeekNumber = (date: Date) => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear =
      (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  };

  // Country-aware VAT rate
  // Calculate VAT from inclusive amount
  const calculateVAT = (inclusiveAmount: number) => {
    const vatAmount = inclusiveAmount - inclusiveAmount / (1 + VAT_RATE);
    const netAmount = inclusiveAmount - vatAmount;
    return { vatAmount, netAmount, inclusiveAmount };
  };

  // Calculate VAT Return Report
  const calculateVATReturn = () => {
    const salesHistory = Object.values(state.salesHistory);
    const filteredSales = filterByDateRange(salesHistory);

    // Output VAT (Sales) — DYNAMIC: iterate all configured fuel types via
    // fuelPumpsByType (was hardcoded PMS/AGO only). Falls back to legacy
    // pmsPumps/agoPumps for backward compatibility.
    const totalSalesRevenue = filteredSales.reduce((sum, sale) => {
      let fuelRevenue = 0;
      // Legacy PMS/AGO pumps
      const pmsRevenue = (sale.pmsPumps || []).reduce(
        (pmsSum: number, pump: any) => pmsSum + (pump.salesKsh || 0),
        0,
      );
      const agoRevenue = (sale.agoPumps || []).reduce(
        (agoSum: number, pump: any) => agoSum + (pump.salesKsh || 0),
        0,
      );
      fuelRevenue += pmsRevenue + agoRevenue;
      // Dynamic: all other fuel types (Kerosene, V-Power, LPG, …)
      if (sale.fuelPumpsByType && typeof sale.fuelPumpsByType === "object") {
        for (const [ft, pumps] of Object.entries(sale.fuelPumpsByType)) {
          if (ft === "petrol" || ft === "diesel") continue; // already counted
          fuelRevenue += (pumps as any[]).reduce(
            (s: number, p: any) => s + (p.salesKsh || 0),
            0,
          );
        }
      }
      const posRevenue = posRevenueFor(sale);
      // Dynamic POS sales by fuel type
      if (sale.posSales?.byTypeAmount) {
        for (const [ft, amt] of Object.entries(sale.posSales.byTypeAmount)) {
          if (ft === "petrol" || ft === "diesel") continue;
          fuelRevenue += (amt as number) || 0;
        }
      }
      return sum + fuelRevenue + posRevenue;
    }, 0);

    const outputVAT = calculateVAT(totalSalesRevenue);

    // Input VAT (Purchases - from offloading)
    const offloadingRecords = filterByDateRange(state.offloadingRecords);
    const totalPurchases = offloadingRecords.reduce(
      (sum, offload) => sum + (offload.totalAmount || 0),
      0,
    );
    const inputVAT = calculateVAT(totalPurchases);

    // Net VAT payable
    const netVATPayable = outputVAT.vatAmount - inputVAT.vatAmount;

    return {
      period: `${startDate} to ${endDate}`,
      outputVAT,
      inputVAT,
      netVATPayable,
      transactionCount: filteredSales.length,
      purchaseCount: offloadingRecords.length,
    };
  };

  // Calculate Daily Sales Register (KRA Requirement)
  const calculateDailySalesRegister = () => {
    const salesHistory = Object.values(state.salesHistory);
    const filteredSales = filterByDateRange(salesHistory);
    const groupedSales = groupByPeriod(filteredSales);

    return Object.entries(groupedSales)
      .map(([date, sales]: [string, any[]]) => {
        let receiptNo = 1;
        const transactions = sales.flatMap((sale: any) => {
          const items: any[] = [];

          // PMS Sales
          (sale.pmsPumps || []).forEach((pump: any) => {
            if (pump.salesKsh > 0) {
              const vat = calculateVAT(pump.salesKsh);
              items.push({
                receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                time: sale.date?.split("T")[1]?.substring(0, 5) || "00:00",
                description: `${getFuelLabel("PMS")} - Pump ${pump.id}`,
                quantity: pump.salesL || 0,
                unit: "L",
                unitPrice: pump.salesL > 0 ? pump.salesKsh / pump.salesL : 0,
                grossAmount: pump.salesKsh,
                vatAmount: vat.vatAmount,
                netAmount: vat.netAmount,
                vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
              });
            }
          });

          // AGO Sales
          (sale.agoPumps || []).forEach((pump: any) => {
            if (pump.salesKsh > 0) {
              const vat = calculateVAT(pump.salesKsh);
              items.push({
                receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                time: sale.date?.split("T")[1]?.substring(0, 5) || "00:00",
                description: `${getFuelLabel("AGO")} - Pump ${pump.id}`,
                quantity: pump.salesL || 0,
                unit: "L",
                unitPrice: pump.salesL > 0 ? pump.salesKsh / pump.salesL : 0,
                grossAmount: pump.salesKsh,
                vatAmount: vat.vatAmount,
                netAmount: vat.netAmount,
                vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
              });
            }
          });

          // DYNAMIC: all other configured fuel types (Kerosene, V-Power, LPG, …)
          if (
            sale.fuelPumpsByType &&
            typeof sale.fuelPumpsByType === "object"
          ) {
            for (const [ft, pumps] of Object.entries(sale.fuelPumpsByType)) {
              if (ft === "petrol" || ft === "diesel") continue;
              (pumps as any[]).forEach((pump: any) => {
                if (pump.salesKsh > 0) {
                  const vat = calculateVAT(pump.salesKsh);
                  items.push({
                    receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                    time: sale.date?.split("T")[1]?.substring(0, 5) || "00:00",
                    description: `${getFuelLabel(ft)} - Pump ${pump.id}`,
                    quantity: pump.salesL || 0,
                    unit: "L",
                    unitPrice:
                      pump.salesL > 0 ? pump.salesKsh / pump.salesL : 0,
                    grossAmount: pump.salesKsh,
                    vatAmount: vat.vatAmount,
                    netAmount: vat.netAmount,
                    vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
                  });
                }
              });
            }
          }

          // Dynamic POS sales by fuel type (byTypeAmount / byTypeLitres).
          // Falls back to legacy pmsAmount/agoAmount for older records.
          if (sale.posSales?.byTypeAmount && sale.posSales?.byTypeLitres) {
            const posByType = sale.posSales.byTypeAmount as Record<
              string,
              number
            >;
            const litresByType = sale.posSales.byTypeLitres as Record<
              string,
              number
            >;
            for (const [ft, amt] of Object.entries(posByType)) {
              if (!amt || amt <= 0) continue;
              const vat = calculateVAT(amt);
              const litres = litresByType[ft] || 0;
              items.push({
                receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                time: "12:00",
                description: `${getFuelLabel(ft)} - POS Transaction`,
                quantity: litres,
                unit: "L",
                unitPrice: litres > 0 ? amt / litres : 0,
                grossAmount: amt,
                vatAmount: vat.vatAmount,
                netAmount: vat.netAmount,
                vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
              });
            }
          } else if (sale.posSales) {
            if (sale.posSales.pmsAmount > 0) {
              const vat = calculateVAT(sale.posSales.pmsAmount);
              items.push({
                receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                time: "12:00",
                description: `${getFuelLabel("PMS")} - POS Transaction`,
                quantity: sale.posSales.pmsLitres || 0,
                unit: "L",
                unitPrice:
                  sale.posSales.pmsLitres > 0
                    ? sale.posSales.pmsAmount / sale.posSales.pmsLitres
                    : 0,
                grossAmount: sale.posSales.pmsAmount,
                vatAmount: vat.vatAmount,
                netAmount: vat.netAmount,
                vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
              });
            }
            if (sale.posSales.agoAmount > 0) {
              const vat = calculateVAT(sale.posSales.agoAmount);
              items.push({
                receiptNo: `${state.companyData.etrInvoicePrefix || "ETR"}${String(receiptNo++).padStart(6, "0")}`,
                time: "12:00",
                description: `${getFuelLabel("AGO")} - POS Transaction`,
                quantity: sale.posSales.agoLitres || 0,
                unit: "L",
                unitPrice:
                  sale.posSales.agoLitres > 0
                    ? sale.posSales.agoAmount / sale.posSales.agoLitres
                    : 0,
                grossAmount: sale.posSales.agoAmount,
                vatAmount: vat.vatAmount,
                netAmount: vat.netAmount,
                vatRate: `${(VAT_RATE * 100).toFixed(0)}%`,
              });
            }
          }

          return items;
        });

        const totals = transactions.reduce(
          (acc, t) => ({
            grossAmount: acc.grossAmount + t.grossAmount,
            vatAmount: acc.vatAmount + t.vatAmount,
            netAmount: acc.netAmount + t.netAmount,
            quantity: acc.quantity + t.quantity,
          }),
          { grossAmount: 0, vatAmount: 0, netAmount: 0, quantity: 0 },
        );

        return { date, transactions, totals };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // Calculate KRA Summary Report
  const calculateKRASummary = () => {
    const vatReturn = calculateVATReturn();
    const dailySales = calculateDailySalesRegister();
    const overall = calculateOverallReport();

    const totalTransactions = dailySales.reduce(
      (sum, day) => sum + day.transactions.length,
      0,
    );
    const totalGross = dailySales.reduce(
      (sum, day) => sum + day.totals.grossAmount,
      0,
    );
    const totalVAT = dailySales.reduce(
      (sum, day) => sum + day.totals.vatAmount,
      0,
    );
    const totalNet = dailySales.reduce(
      (sum, day) => sum + day.totals.netAmount,
      0,
    );
    const totalLitres = dailySales.reduce(
      (sum, day) => sum + day.totals.quantity,
      0,
    );

    return {
      businessInfo: {
        name: state.companyData.name,
        kraPin: state.companyData.kraPin || "NOT SET",
        vatRegNo: state.companyData.vatRegNo || "NOT SET",
        physicalAddress: state.companyData.physicalAddress || "",
        county: state.companyData.county || "",
        town: state.companyData.town || "",
        etrSerialNo: state.companyData.etrSerialNo || "NOT SET",
        cuSerialNo: state.companyData.cuSerialNo || "NOT SET",
      },
      period: `${startDate} to ${endDate}`,
      summary: {
        totalTransactions,
        totalGross,
        totalVAT,
        totalNet,
        totalLitres,
        inputVAT: vatReturn.inputVAT.vatAmount,
        netVATPayable: vatReturn.netVATPayable,
      },
      dailyBreakdown: dailySales,
      profitLoss: {
        grossRevenue: overall.grossRevenue,
        totalCosts: overall.totalCosts,
        netProfit: overall.netProfit,
        profitMargin: overall.profitMargin,
      },
    };
  };

  // Calculate expenses report
  const calculateExpensesReport = () => {
    const salesHistory = Object.values(state.salesHistory);
    const filteredSales = filterByDateRange(salesHistory);
    const groupedSales = groupByPeriod(filteredSales);

    // Cloud expenses from the Expenses tab (expenses_data) — grouped by the
    // same period key so they merge into the legacy salesHistory breakdown.
    const cloudByPeriod = cloudExpensesByPeriod();

    const expensesData = Object.entries(groupedSales).map(
      ([period, sales]: [string, any[]]) => {
        const totalExpenses = sales.reduce((sum, sale) => {
          return (
            sum +
            (sale.expenses || []).reduce(
              (expSum: number, exp: any) => expSum + (exp.amount || 0),
              0,
            )
          );
        }, 0);

        const expenseBreakdown = sales.reduce((breakdown: any, sale) => {
          (sale.expenses || []).forEach((exp: any) => {
            if (exp.desc) {
              breakdown[exp.desc] =
                (breakdown[exp.desc] || 0) + (exp.amount || 0);
            }
          });
          return breakdown;
        }, {});

        return {
          period,
          totalExpenses,
          breakdown: expenseBreakdown,
          transactionCount: sales.length,
        };
      },
    );

    // Merge cloud expenses (Expenses tab) into the report. Add a row for any
    // period that has cloud expenses but no salesHistory expenses.
    const cloudPeriods = Object.entries(cloudByPeriod).map(
      ([period, exps]: [string, any[]]) => {
        const breakdown: Record<string, number> = {};
        let totalExpenses = 0;
        exps.forEach((exp: any) => {
          const label = exp.description || exp.category || "Uncategorized";
          breakdown[label] = (breakdown[label] || 0) + (exp.amount || 0);
          totalExpenses += exp.amount || 0;
        });
        return {
          period,
          totalExpenses,
          breakdown,
          transactionCount: exps.length,
        };
      },
    );

    const merged = [...expensesData, ...cloudPeriods].reduce(
      (acc: Record<string, any>, entry) => {
        if (!acc[entry.period]) {
          acc[entry.period] = {
            ...entry,
            breakdown: { ...entry.breakdown },
          };
        } else {
          acc[entry.period].totalExpenses += entry.totalExpenses;
          acc[entry.period].transactionCount += entry.transactionCount;
          Object.entries(entry.breakdown).forEach(([k, v]) => {
            acc[entry.period].breakdown[k] =
              (acc[entry.period].breakdown[k] || 0) + (v as number);
          });
        }
        return acc;
      },
      {},
    );

    return Object.values(merged).sort((a: any, b: any) =>
      a.period.localeCompare(b.period),
    );
  };

  // Calculate profit & loss report
  const calculateProfitLossReport = () => {
    const salesHistory = Object.values(state.salesHistory);
    const filteredSales = filterByDateRange(salesHistory);
    const groupedSales = groupByPeriod(filteredSales);

    // Cloud expenses from the Expenses tab, grouped per period.
    const cloudByPeriod = cloudExpensesByPeriod();
    const cloudExpenseTotalByPeriod: Record<string, number> = {};
    Object.entries(cloudByPeriod).forEach(([period, exps]: [string, any[]]) => {
      cloudExpenseTotalByPeriod[period] = exps.reduce(
        (sum: number, exp: any) => sum + (exp.amount || 0),
        0,
      );
    });

    const profitLossData = Object.entries(groupedSales).map(
      ([period, sales]: [string, any[]]) => {
        const totalRevenue = sales.reduce((sum, sale) => {
          // DYNAMIC: includes ALL fuel types via fuelRevenueFor (was
          // hardcoded PMS/AGO only, silently dropping Kerosene/LPG/etc.)
          return sum + fuelRevenueFor(sale);
        }, 0);

        const totalExpenses =
          sales.reduce((sum, sale) => {
            return (
              sum +
              (sale.expenses || []).reduce(
                (expSum: number, exp: any) => expSum + (exp.amount || 0),
                0,
              )
            );
          }, 0) + (cloudExpenseTotalByPeriod[period] || 0);

        const tillPayments = sales.reduce(
          (sum, sale) => sum + (sale.tillPayment || 0),
          0,
        );
        const grossProfit = totalRevenue - totalExpenses;
        const netProfit = grossProfit;
        const profitMargin =
          totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        return {
          period,
          totalRevenue,
          totalExpenses,
          tillPayments,
          grossProfit,
          netProfit,
          profitMargin,
        };
      },
    );

    // Add periods that have cloud expenses but no sales (still a cost period).
    Object.entries(cloudExpenseTotalByPeriod).forEach(([period, expTotal]) => {
      if (!groupedSales[period]) {
        profitLossData.push({
          period,
          totalRevenue: 0,
          totalExpenses: expTotal,
          tillPayments: 0,
          grossProfit: -expTotal,
          netProfit: -expTotal,
          profitMargin: 0,
        });
      }
    });

    return profitLossData.sort((a, b) => a.period.localeCompare(b.period));
  };

  // Calculate overall report
  const calculateOverallReport = () => {
    const salesHistory = Object.values(state.salesHistory);
    const filteredSales = filterByDateRange(salesHistory);
    const deliveryRecords = filterByDateRange(state.deliveryData.rows);
    const offloadingRecords = filterByDateRange(state.offloadingRecords);

    const totalSalesRevenue = filteredSales.reduce((sum, sale) => {
      // DYNAMIC: includes ALL fuel types via fuelRevenueFor (was hardcoded
      // PMS/AGO only, silently dropping Kerosene/LPG/V-Power revenue)
      return sum + fuelRevenueFor(sale);
    }, 0);

    // Separate POS revenue tracking
    const totalPOSRevenue = filteredSales.reduce(
      (sum, sale) => sum + posRevenueFor(sale),
      0,
    );

    const totalExpenses =
      filteredSales.reduce((sum, sale) => {
        return (
          sum +
          (sale.expenses || []).reduce(
            (expSum: number, exp: any) => expSum + (exp.amount || 0),
            0,
          )
        );
      }, 0) +
      // Plus real expenses recorded via the Expenses tab (expenses_data).
      filterByDateRange(cloudExpenses).reduce(
        (sum, exp: any) => sum + (exp.amount || 0),
        0,
      );

    const totalDeliveryRevenue = deliveryRecords.reduce(
      (sum, delivery) => sum + (delivery.amount || 0),
      0,
    );
    const totalOffloadingCosts = offloadingRecords.reduce(
      (sum, offload) => sum + (offload.totalAmount || 0),
      0,
    );
    const totalTillPayments = filteredSales.reduce(
      (sum, sale) => sum + (sale.tillPayment || 0),
      0,
    );

    const totalFuelSold = filteredSales.reduce((sum, sale) => {
      // DYNAMIC: includes ALL fuel types via fuelLitresFor (was hardcoded
      // PMS/AGO only, silently dropping Kerosene/LPG/V-Power litres)
      return sum + fuelLitresFor(sale);
    }, 0);

    const totalFuelPurchased = offloadingRecords.reduce(
      (sum, offload) => sum + (offload.quantity || 0),
      0,
    );

    const grossRevenue = totalSalesRevenue + totalDeliveryRevenue;
    const totalCosts = totalExpenses + totalOffloadingCosts;
    const netProfit = grossRevenue - totalCosts;
    const profitMargin =
      grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    return {
      grossRevenue,
      totalSalesRevenue,
      totalPOSRevenue,
      totalDeliveryRevenue,
      totalCosts,
      totalExpenses,
      totalOffloadingCosts,
      netProfit,
      profitMargin,
      totalTillPayments,
      totalFuelSold,
      totalFuelPurchased,
      fuelInventoryChange: totalFuelPurchased - totalFuelSold,
      transactionCounts: {
        sales: filteredSales.length,
        deliveries: deliveryRecords.length,
        offloading: offloadingRecords.length,
      },
    };
  };

  // Export functions
  const exportToPDF = async () => {
    const doc = new jsPDF();
    const reportTitle = getReportTitle();
    const pageWidth = doc.internal.pageSize.getWidth();
    const currency = resolveCurrencySymbol(
      state.companyData?.currency,
      currentStation?.currency,
    );

    // Pre-load the logo as a base64 data URL (handles Supabase Storage URLs).
    const logoDataUrl = await loadLogoAsDataURL(state.companyData?.logo);

    // Professional Header with KRA Compliance
    const addProfessionalHeader = (y: number) => {
      // Company Logo
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, "PNG", 15, 10, 35, 15);
        } catch {
          /* Skip if logo fails */
        }
      }

      // Company Name - Bold and prominent
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 58, 95); // Dark blue
      doc.text(state.companyData.name || "Fuel Station", pageWidth / 2, y, {
        align: "center",
      });

      y += 6;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);

      // Address line
      const address = [
        state.companyData.physicalAddress,
        state.companyData.town,
        state.companyData.county,
      ]
        .filter(Boolean)
        .join(", ");
      if (address) {
        doc.text(address, pageWidth / 2, y, { align: "center" });
        y += 4;
      }

      // Contact info
      const contacts = [state.companyData.contacts, state.companyData.email]
        .filter(Boolean)
        .join(" | ");
      if (contacts) {
        doc.text(contacts, pageWidth / 2, y, { align: "center" });
        y += 4;
      }

      // KRA Info Box (Kenya only)
      if (isKenya) {
        y += 4;
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(15, y, pageWidth - 30, 18, 2, 2, "F");

        doc.setFontSize(8);
        doc.setTextColor(60);
        doc.setFont("helvetica", "bold");
        doc.text("KRA PIN:", 20, y + 6);
        doc.text("VAT REG:", 70, y + 6);
        doc.text("ETR S/N:", 120, y + 6);
        doc.text("CU S/N:", 160, y + 6);

        doc.setFont("helvetica", "normal");
        doc.text(state.companyData.kraPin || "N/A", 20, y + 12);
        doc.text(state.companyData.vatRegNo || "N/A", 70, y + 12);
        doc.text(state.companyData.etrSerialNo || "N/A", 120, y + 12);
        doc.text(state.companyData.cuSerialNo || "N/A", 160, y + 12);

        y += 24;
      }

      // Report Title
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(212, 175, 55); // Gold
      doc.text(reportTitle, pageWidth / 2, y, { align: "center" });

      y += 6;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont("helvetica", "normal");
      doc.text(`Period: ${startDate} to ${endDate}`, pageWidth / 2, y, {
        align: "center",
      });

      y += 4;
      doc.text(`Generated: ${formatGeneratedDate()}`, pageWidth / 2, y, {
        align: "center",
      });

      return y + 10;
    };

    // Add compliance footer
    const addComplianceFooter = () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(
        isKenya
          ? "This is a computer-generated document. KRA eTIMS Compliant."
          : "This is a computer-generated document.",
        pageWidth / 2,
        pageHeight - 15,
        { align: "center" },
      );
      doc.text(
        `Report ID: ${Date.now()} | ${state.companyData.name}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" },
      );
    };

    let y = addProfessionalHeader(20);

    if (activeReport === "overall") {
      const data = calculateOverallReport();

      // Revenue Section
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 58, 95);
      doc.text("REVENUE SUMMARY", 15, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        head: [["Description", "Amount (" + currency + ")"]],
        body: [
          ["Fuel Sales Revenue", formatNumber(data.totalSalesRevenue)],
          ["POS Transactions", formatNumber(data.totalPOSRevenue)],
          ["Delivery Revenue", formatNumber(data.totalDeliveryRevenue)],
          ["GROSS REVENUE", formatNumber(data.grossRevenue)],
        ],
        theme: "grid",
        headStyles: { fillColor: [26, 58, 95], textColor: 255 },
        footStyles: { fillColor: [240, 240, 240], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 250, 250] },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      // Costs Section
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("COSTS & EXPENSES", 15, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        head: [["Description", "Amount (" + currency + ")"]],
        body: [
          ["Operating Expenses", formatNumber(data.totalExpenses)],
          ["Fuel Purchase Costs", formatNumber(data.totalOffloadingCosts)],
          ["TOTAL COSTS", formatNumber(data.totalCosts)],
        ],
        theme: "grid",
        headStyles: { fillColor: [180, 50, 50], textColor: 255 },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      // Profit Summary Box
      doc.setFillColor(
        data.netProfit >= 0 ? 230 : 255,
        data.netProfit >= 0 ? 255 : 230,
        data.netProfit >= 0 ? 230 : 230,
      );
      doc.roundedRect(15, y, pageWidth - 30, 25, 3, 3, "F");

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(
        data.netProfit >= 0 ? 34 : 180,
        data.netProfit >= 0 ? 139 : 50,
        data.netProfit >= 0 ? 34 : 50,
      );
      doc.text("NET PROFIT", 25, y + 10);
      doc.setFontSize(16);
      doc.text(`${currency} ${formatNumber(data.netProfit)}`, 25, y + 20);

      doc.setFontSize(12);
      doc.text("PROFIT MARGIN", pageWidth - 70, y + 10);
      doc.setFontSize(16);
      doc.text(
        `${formatNumber(data.profitMargin, 1)}%`,
        pageWidth - 70,
        y + 20,
      );
    } else if (activeReport === "vat-return") {
      const data = calculateVATReturn();

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 58, 95);
      doc.text("VAT RETURN SUMMARY (" + vatPercentLabel + ")", 15, y);
      y += 8;

      autoTable(doc, {
        startY: y,
        head: [
          [
            "Category",
            "Gross (" + currency + ")",
            "Net (" + currency + ")",
            "VAT (" + currency + ")",
          ],
        ],
        body: [
          [
            "OUTPUT VAT (Sales)",
            formatNumber(data.outputVAT.inclusiveAmount),
            formatNumber(data.outputVAT.netAmount),
            formatNumber(data.outputVAT.vatAmount),
          ],
          [
            "INPUT VAT (Purchases)",
            formatNumber(data.inputVAT.inclusiveAmount),
            formatNumber(data.inputVAT.netAmount),
            formatNumber(data.inputVAT.vatAmount),
          ],
        ],
        theme: "grid",
        headStyles: { fillColor: [26, 58, 95], textColor: 255 },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      // VAT Payable Box
      const isRefund = data.netVATPayable < 0;
      doc.setFillColor(
        isRefund ? 230 : 255,
        isRefund ? 255 : 250,
        isRefund ? 230 : 230,
      );
      doc.roundedRect(15, y, pageWidth - 30, 20, 3, 3, "F");

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(60);
      doc.text(
        isRefund
          ? "VAT REFUNDABLE:"
          : isKenya
            ? "VAT PAYABLE TO KRA:"
            : "VAT PAYABLE:",
        25,
        y + 13,
      );
      doc.setFontSize(14);
      doc.setTextColor(
        isRefund ? 34 : 180,
        isRefund ? 139 : 50,
        isRefund ? 34 : 50,
      );
      doc.text(
        `${currency} ${formatNumber(Math.abs(data.netVATPayable))}`,
        pageWidth - 50,
        y + 13,
      );
    } else if (activeReport === "daily-sales") {
      const dailyData = calculateDailySalesRegister();

      dailyData.forEach((day, index) => {
        if (index > 0) {
          doc.addPage();
          y = addProfessionalHeader(20);
        }

        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(26, 58, 95);
        doc.text(`DAILY SALES REGISTER - ${day.date}`, 15, y);
        y += 6;

        if (day.transactions.length > 0) {
          autoTable(doc, {
            startY: y,
            head: [
              [
                "Receipt #",
                "Description",
                "Qty (L)",
                "Unit Price",
                "Gross",
                "VAT",
                "Net",
              ],
            ],
            body: day.transactions.map((t) => [
              t.receiptNo,
              t.description,
              formatNumber(t.quantity, 2),
              formatNumber(t.unitPrice, 2),
              formatNumber(t.grossAmount),
              formatNumber(t.vatAmount),
              formatNumber(t.netAmount),
            ]),
            foot: [
              [
                "",
                "TOTALS",
                formatNumber(day.totals.quantity, 2),
                "",
                formatNumber(day.totals.grossAmount),
                formatNumber(day.totals.vatAmount),
                formatNumber(day.totals.netAmount),
              ],
            ],
            theme: "grid",
            headStyles: {
              fillColor: [26, 58, 95],
              textColor: 255,
              fontSize: 8,
            },
            bodyStyles: { fontSize: 8 },
            footStyles: {
              fillColor: [240, 240, 240],
              fontStyle: "bold",
              fontSize: 8,
            },
          });
        } else {
          doc.setFontSize(10);
          doc.setTextColor(150);
          doc.text("No transactions recorded for this date.", 15, y + 10);
        }
      });
    } else if (activeReport === "kra-summary") {
      const data = calculateKRASummary();

      // Summary Statistics
      autoTable(doc, {
        startY: y,
        head: [["KRA COMPLIANCE SUMMARY", ""]],
        body: [
          ["Total Transactions", data.summary.totalTransactions.toString()],
          [
            "Total Litres Sold",
            formatNumber(data.summary.totalLitres, 2) + " L",
          ],
          [
            "Gross Sales",
            currency + " " + formatNumber(data.summary.totalGross),
          ],
          [
            "Total Output VAT (" + vatPercentLabel + ")",
            currency + " " + formatNumber(data.summary.totalVAT),
          ],
          ["Net Sales", currency + " " + formatNumber(data.summary.totalNet)],
          [
            "Input VAT (Purchases)",
            currency + " " + formatNumber(data.summary.inputVAT),
          ],
          [
            "NET VAT PAYABLE",
            currency + " " + formatNumber(data.summary.netVATPayable),
          ],
        ],
        theme: "grid",
        headStyles: { fillColor: [26, 58, 95], textColor: 255 },
        columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      // Profitability Summary
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("PROFITABILITY ANALYSIS", 15, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        body: [
          [
            "Gross Revenue",
            currency + " " + formatNumber(data.profitLoss.grossRevenue),
          ],
          [
            "Total Costs",
            currency + " " + formatNumber(data.profitLoss.totalCosts),
          ],
          [
            "Net Profit",
            currency + " " + formatNumber(data.profitLoss.netProfit),
          ],
          [
            "Profit Margin",
            formatNumber(data.profitLoss.profitMargin, 1) + "%",
          ],
        ],
        theme: "plain",
        columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
      });
    } else {
      // Original reports (expenses, profit-loss)
      if (activeReport === "profit-loss") {
        const data = calculateProfitLossReport();
        data.forEach((periodData, index) => {
          autoTable(doc, {
            startY: index === 0 ? y : (doc as any).lastAutoTable.finalY + 10,
            head: [[periodData.period, "Amount (" + currency + ")"]],
            body: [
              ["Revenue", formatNumber(periodData.totalRevenue)],
              ["Expenses", formatNumber(periodData.totalExpenses)],
              ["Net Profit", formatNumber(periodData.netProfit)],
              ["Profit Margin", formatNumber(periodData.profitMargin, 1) + "%"],
            ],
            theme: "grid",
            headStyles: {
              fillColor:
                periodData.netProfit >= 0 ? [34, 139, 34] : [180, 50, 50],
            },
          });
        });
      } else if (activeReport === "expenses") {
        const data = calculateExpensesReport();
        data.forEach((periodData, index) => {
          const breakdownRows = Object.entries(periodData.breakdown).map(
            ([desc, amt]) => [desc, formatNumber(amt as number)],
          );
          autoTable(doc, {
            startY: index === 0 ? y : (doc as any).lastAutoTable.finalY + 10,
            head: [
              [periodData.period + " - Expenses", "Amount (" + currency + ")"],
            ],
            body: [
              ...breakdownRows,
              ["TOTAL", formatNumber(periodData.totalExpenses)],
            ],
            theme: "grid",
            headStyles: { fillColor: [180, 50, 50] },
            footStyles: { fontStyle: "bold" },
          });
        });
      }
    }

    addComplianceFooter();
    doc.save(`${reportTitle.replace(/ /g, "_")}_${startDate}_${endDate}.pdf`);
  };

  const getReportTitle = () => {
    const titles: Record<ReportType, string> = {
      daybook: "Day Book",
      losscontrol: "Loss Control (Shrinkage)",
      bankledger: "Bank & Cash Ledger",
      cashflow: "Cash Flow",
      stationpnl: "Station P&L",
      overall: "Overall Financial Report",
      "profit-loss": "Profit & Loss Statement",
      expenses: "Expenses Report",
      "vat-return": "VAT Return Summary",
      "daily-sales": "Daily Sales Register",
      "kra-summary": "KRA Compliance Summary",
    };
    return titles[activeReport];
  };

  const exportToExcel = () => {
    const reportTitle = getReportTitle();
    const wb = XLSX.utils.book_new();

    const ws_data: any[][] = [
      [reportTitle],
      [state.companyData.name],
      isKenya
        ? [
            `KRA PIN: ${state.companyData.kraPin || "N/A"} | VAT Reg: ${state.companyData.vatRegNo || "N/A"}`,
          ]
        : [`VAT Reg: ${state.companyData.vatRegNo || "N/A"}`],
      [`Period: ${startDate} to ${endDate}`],
      [`Generated: ${formatGeneratedDate()}`],
      [],
    ];

    if (activeReport === "overall") {
      const data = calculateOverallReport();
      ws_data.push(
        ["REVENUE SUMMARY", ""],
        ["Sales Revenue", data.totalSalesRevenue],
        ["POS Transactions", data.totalPOSRevenue],
        ["Delivery Revenue", data.totalDeliveryRevenue],
        ["Gross Revenue", data.grossRevenue],
        [],
        ["COSTS & EXPENSES", ""],
        ["Operating Expenses", data.totalExpenses],
        ["Fuel Purchase Costs", data.totalOffloadingCosts],
        ["Total Costs", data.totalCosts],
        [],
        ["PROFITABILITY", ""],
        ["Net Profit", data.netProfit],
        ["Profit Margin", `${formatNumber(data.profitMargin, 1)}%`],
        [],
        ["OPERATIONAL METRICS", ""],
        ["Fuel Sold (L)", data.totalFuelSold],
        ["Fuel Purchased (L)", data.totalFuelPurchased],
        ["Sales Records", data.transactionCounts.sales],
        ["Deliveries", data.transactionCounts.deliveries],
        ["Offloading Records", data.transactionCounts.offloading],
      );
    } else if (activeReport === "vat-return") {
      const data = calculateVATReturn();
      ws_data.push(
        ["VAT RETURN SUMMARY (" + vatPercentLabel + ")", ""],
        [],
        ["Category", "Gross", "Net", "VAT"],
        [
          "OUTPUT VAT (Sales)",
          data.outputVAT.inclusiveAmount,
          data.outputVAT.netAmount,
          data.outputVAT.vatAmount,
        ],
        [
          "INPUT VAT (Purchases)",
          data.inputVAT.inclusiveAmount,
          data.inputVAT.netAmount,
          data.inputVAT.vatAmount,
        ],
        [],
        ["NET VAT PAYABLE", data.netVATPayable],
      );
    } else if (activeReport === "daily-sales") {
      const dailyData = calculateDailySalesRegister();
      dailyData.forEach((day) => {
        ws_data.push(
          [],
          [`DAILY SALES - ${day.date}`],
          [
            "Receipt #",
            "Description",
            "Qty (L)",
            "Unit Price",
            "Gross",
            "VAT",
            "Net",
          ],
        );
        day.transactions.forEach((t) => {
          ws_data.push([
            t.receiptNo,
            t.description,
            t.quantity,
            t.unitPrice,
            t.grossAmount,
            t.vatAmount,
            t.netAmount,
          ]);
        });
        ws_data.push([
          "TOTALS",
          "",
          day.totals.quantity,
          "",
          day.totals.grossAmount,
          day.totals.vatAmount,
          day.totals.netAmount,
        ]);
      });
    } else if (activeReport === "kra-summary") {
      const data = calculateKRASummary();
      ws_data.push(
        ["KRA COMPLIANCE SUMMARY", ""],
        ["Total Transactions", data.summary.totalTransactions],
        ["Total Litres Sold", data.summary.totalLitres],
        ["Gross Sales", data.summary.totalGross],
        ["Output VAT (" + vatPercentLabel + ")", data.summary.totalVAT],
        ["Net Sales", data.summary.totalNet],
        ["Input VAT", data.summary.inputVAT],
        ["Net VAT Payable", data.summary.netVATPayable],
        [],
        ["PROFITABILITY", ""],
        ["Gross Revenue", data.profitLoss.grossRevenue],
        ["Total Costs", data.profitLoss.totalCosts],
        ["Net Profit", data.profitLoss.netProfit],
        ["Profit Margin", `${formatNumber(data.profitLoss.profitMargin, 1)}%`],
      );
    } else if (activeReport === "profit-loss") {
      const data = calculateProfitLossReport();
      ws_data.push(["Period", "Revenue", "Expenses", "Net Profit", "Margin"]);
      data.forEach((p) => {
        ws_data.push([
          p.period,
          p.totalRevenue,
          p.totalExpenses,
          p.netProfit,
          `${formatNumber(p.profitMargin, 1)}%`,
        ]);
      });
    } else if (activeReport === "expenses") {
      const data = calculateExpensesReport();
      data.forEach((p) => {
        ws_data.push([], [p.period], ["Category", "Amount"]);
        Object.entries(p.breakdown).forEach(([desc, amt]) =>
          ws_data.push([desc, amt]),
        );
        ws_data.push(["TOTAL", p.totalExpenses]);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws["!cols"] = [
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(
      wb,
      `${reportTitle.replace(/ /g, "_")}_${startDate}_${endDate}.xlsx`,
    );
  };

  const exportToTXT = () => {
    const reportTitle = getReportTitle();
    const currency = resolveCurrencySymbol(
      state.companyData?.currency,
      currentStation?.currency,
    );
    let txt = `${"=".repeat(60)}\n`;
    txt += `${state.companyData.name}\n`;
    txt += `${"=".repeat(60)}\n\n`;
    txt += `${reportTitle}\n`;
    txt += `Period: ${startDate} to ${endDate}\n`;
    txt += `Generated: ${formatGeneratedDate()}\n\n`;
    if (isKenya) {
      txt += `KRA PIN: ${state.companyData.kraPin || "N/A"}\n`;
    }
    txt += `VAT Reg: ${state.companyData.vatRegNo || "N/A"}\n`;
    if (isKenya) {
      txt += `ETR S/N: ${state.companyData.etrSerialNo || "N/A"}\n`;
    }
    txt += `\n${"-".repeat(60)}\n\n`;

    if (activeReport === "overall") {
      const data = calculateOverallReport();
      txt += `REVENUE SUMMARY\n`;
      txt += `  Sales Revenue:      ${currency} ${formatNumber(data.totalSalesRevenue)}\n`;
      txt += `  POS Transactions:   ${currency} ${formatNumber(data.totalPOSRevenue)}\n`;
      txt += `  Delivery Revenue:   ${currency} ${formatNumber(data.totalDeliveryRevenue)}\n`;
      txt += `  GROSS REVENUE:      ${currency} ${formatNumber(data.grossRevenue)}\n\n`;
      txt += `COSTS & EXPENSES\n`;
      txt += `  Operating Expenses: ${currency} ${formatNumber(data.totalExpenses)}\n`;
      txt += `  Fuel Purchases:     ${currency} ${formatNumber(data.totalOffloadingCosts)}\n`;
      txt += `  TOTAL COSTS:        ${currency} ${formatNumber(data.totalCosts)}\n\n`;
      txt += `${"=".repeat(40)}\n`;
      txt += `  NET PROFIT:         ${currency} ${formatNumber(data.netProfit)}\n`;
      txt += `  PROFIT MARGIN:      ${formatNumber(data.profitMargin, 1)}%\n`;
      txt += `${"=".repeat(40)}\n`;
    } else if (activeReport === "vat-return") {
      const data = calculateVATReturn();
      txt += `VAT RETURN SUMMARY (${vatPercentLabel})\n\n`;
      txt += `OUTPUT VAT (Sales):\n`;
      txt += `  Gross:  ${currency} ${formatNumber(data.outputVAT.inclusiveAmount)}\n`;
      txt += `  Net:    ${currency} ${formatNumber(data.outputVAT.netAmount)}\n`;
      txt += `  VAT:    ${currency} ${formatNumber(data.outputVAT.vatAmount)}\n\n`;
      txt += `INPUT VAT (Purchases):\n`;
      txt += `  Gross:  ${currency} ${formatNumber(data.inputVAT.inclusiveAmount)}\n`;
      txt += `  Net:    ${currency} ${formatNumber(data.inputVAT.netAmount)}\n`;
      txt += `  VAT:    ${currency} ${formatNumber(data.inputVAT.vatAmount)}\n\n`;
      txt += `${"=".repeat(40)}\n`;
      txt += `NET VAT PAYABLE: ${currency} ${formatNumber(data.netVATPayable)}\n`;
    } else if (activeReport === "kra-summary") {
      const data = calculateKRASummary();
      txt += `KRA COMPLIANCE SUMMARY\n\n`;
      txt += `Total Transactions: ${data.summary.totalTransactions}\n`;
      txt += `Total Litres Sold:  ${formatNumber(data.summary.totalLitres, 2)} L\n`;
      txt += `Gross Sales:        ${currency} ${formatNumber(data.summary.totalGross)}\n`;
      txt += `Output VAT (${vatPercentLabel}):   ${currency} ${formatNumber(data.summary.totalVAT)}\n`;
      txt += `Net Sales:          ${currency} ${formatNumber(data.summary.totalNet)}\n`;
      txt += `Input VAT:          ${currency} ${formatNumber(data.summary.inputVAT)}\n\n`;
      txt += `${"=".repeat(40)}\n`;
      txt += `NET VAT PAYABLE:    ${currency} ${formatNumber(data.summary.netVATPayable)}\n`;
    }

    txt += `\n${"-".repeat(60)}\n`;
    txt += isKenya
      ? `This is a computer-generated document. KRA eTIMS Compliant.\n`
      : `This is a computer-generated document.\n`;

    const blob = new Blob([txt], { type: "text/plain" });
    saveAs(
      blob,
      `${reportTitle.replace(/ /g, "_")}_${startDate}_${endDate}.txt`,
    );
  };

  const exportHandlers = {
    pdf: exportToPDF,
    excel: exportToExcel,
    txt: exportToTXT,
    whatsapp: () => {
      const reportTitle = getReportTitle();
      const currency = resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      );
      let msg = `*${state.companyData.name}*\n`;
      if (isKenya) {
        msg += `KRA PIN: ${state.companyData.kraPin || "N/A"}\n`;
      }
      msg += `\n`;
      msg += `*${reportTitle}*\n`;
      msg += `Period: ${startDate} to ${endDate}\n\n`;

      if (activeReport === "overall" || activeReport === "kra-summary") {
        const data = calculateOverallReport();
        msg += `Revenue: ${currency} ${formatNumber(data.grossRevenue)}\n`;
        msg += `Costs: ${currency} ${formatNumber(data.totalCosts)}\n`;
        msg += `${data.netProfit >= 0 ? "Profit:" : "Loss:"} ${currency} ${formatNumber(data.netProfit)}\n`;
        msg += `Margin: ${formatNumber(data.profitMargin, 1)}%`;
      } else if (activeReport === "vat-return") {
        const data = calculateVATReturn();
        msg += `Output VAT: ${currency} ${formatNumber(data.outputVAT.vatAmount)}\n`;
        msg += `Input VAT: ${currency} ${formatNumber(data.inputVAT.vatAmount)}\n`;
        msg += `Net VAT: ${currency} ${formatNumber(data.netVATPayable)}`;
      }

      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      const reportTitle = getReportTitle();
      const currency = resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      );
      const subject = `${reportTitle} - ${state.companyData.name}`;
      let body = `${state.companyData.name}\n`;
      if (isKenya) {
        body += `KRA PIN: ${state.companyData.kraPin || "N/A"}\n`;
      }
      body += `\n`;
      body += `${reportTitle}\n`;
      body += `Period: ${startDate} to ${endDate}\n\n`;

      if (activeReport === "overall" || activeReport === "kra-summary") {
        const data = calculateOverallReport();
        body += `Revenue: ${currency} ${formatNumber(data.grossRevenue)}\n`;
        body += `Costs: ${currency} ${formatNumber(data.totalCosts)}\n`;
        body += `Profit: ${currency} ${formatNumber(data.netProfit)}\n`;
        body += `Margin: ${formatNumber(data.profitMargin, 1)}%`;
      }

      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  const renderExpensesReport = () => {
    const data = calculateExpensesReport();

    if (data.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500">
          <TrendingDown size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">
            No expense records found for the selected period.
          </p>
          <p className="text-sm mt-1">
            Record expenses via Sales Tracking or the Expenses tab, then return
            here to view the report.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {data.map((periodData, index) => (
          <div
            key={index}
            className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg border border-red-200 dark:border-red-700"
          >
            <h4 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-4">
              {periodData.period} - Total Expenses: {currencySymbol}{" "}
              {formatNumber(periodData.totalExpenses)}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h5 className="font-medium mb-2">Expense Breakdown:</h5>
                <div className="space-y-2">
                  {Object.entries(periodData.breakdown).map(
                    ([desc, amount]: [string, any]) => (
                      <div
                        key={desc}
                        className="flex justify-between items-center p-2 bg-white dark:bg-gray-800 rounded"
                      >
                        <span className="text-sm">{desc}</span>
                        <span className="font-medium">
                          {currencySymbol} {formatNumber(amount)}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="text-center">
                <div className="text-3xl font-bold text-red-600">
                  {currencySymbol} {formatNumber(periodData.totalExpenses)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                  from {periodData.transactionCount} transactions
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderProfitLossReport = () => {
    const data = calculateProfitLossReport();

    if (data.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500">
          <TrendingUp size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">
            No profit &amp; loss data for the selected period.
          </p>
          <p className="text-sm mt-1">
            Record sales and expenses, then return here to view your
            profitability.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {data.map((periodData, index) => (
          <div
            key={index}
            className={`p-6 rounded-lg border ${
              periodData.netProfit >= 0
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700"
            }`}
          >
            <h4
              className={`text-lg font-semibold mb-4 ${
                periodData.netProfit >= 0
                  ? "text-green-800 dark:text-green-200"
                  : "text-red-800 dark:text-red-200"
              }`}
            >
              {periodData.period} - Net Profit: {currencySymbol}{" "}
              {formatNumber(periodData.netProfit)}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                <h6 className="text-sm font-medium text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-2">
                  Revenue
                </h6>
                <div className="text-2xl font-bold text-green-600">
                  {currencySymbol} {formatNumber(periodData.totalRevenue)}
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                <h6 className="text-sm font-medium text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-2">
                  Expenses
                </h6>
                <div className="text-2xl font-bold text-red-600">
                  {currencySymbol} {formatNumber(periodData.totalExpenses)}
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                <h6 className="text-sm font-medium text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-2">
                  Profit Margin
                </h6>
                <div
                  className={`text-2xl font-bold ${periodData.profitMargin >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {formatNumber(periodData.profitMargin, 1)}%
                </div>
              </div>
            </div>

            <div className="mt-4 text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
              Till Payments: {currencySymbol}{" "}
              {formatNumber(periodData.tillPayments)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderOverallReport = () => {
    const data = calculateOverallReport();
    const hasData =
      data.transactionCounts.sales > 0 ||
      data.transactionCounts.deliveries > 0 ||
      data.transactionCounts.offloading > 0;

    if (!hasData) {
      return (
        <div className="text-center py-12 text-gray-500">
          <BarChart3 size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">
            No financial activity for the selected period.
          </p>
          <p className="text-sm mt-1">
            Record sales, deliveries, or fuel purchases, then return here to
            view your overall financial report.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
            <h6 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">
              Gross Revenue
            </h6>
            <div className="text-2xl font-bold text-blue-600">
              {currencySymbol} {formatNumber(data.grossRevenue)}
            </div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-700">
            <h6 className="text-sm font-medium text-green-700 dark:text-green-300 mb-2">
              Net Profit
            </h6>
            <div
              className={`text-2xl font-bold ${data.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {currencySymbol} {formatNumber(data.netProfit)}
            </div>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-700">
            <h6 className="text-sm font-medium text-yellow-700 dark:text-yellow-300 mb-2">
              Profit Margin
            </h6>
            <div
              className={`text-2xl font-bold ${data.profitMargin >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatNumber(data.profitMargin, 1)}%
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
            <h6 className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">
              Fuel Sold
            </h6>
            <div className="text-2xl font-bold text-purple-600">
              {formatNumber(data.totalFuelSold)} L
            </div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Revenue Breakdown */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
            <h5 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp size={20} className="text-green-600" />
              Revenue Breakdown
            </h5>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Sales Revenue</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.totalSalesRevenue)}
                </span>
              </div>
              {data.totalPOSRevenue > 0 && (
                <div className="flex justify-between items-center text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 pl-4">
                  <span>↳ POS Transactions</span>
                  <span>
                    {currencySymbol} {formatNumber(data.totalPOSRevenue)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span>Delivery Revenue</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.totalDeliveryRevenue)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="font-semibold">Total Revenue</span>
                <span className="font-bold text-green-600">
                  {currencySymbol} {formatNumber(data.grossRevenue)}
                </span>
              </div>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
            <h5 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingDown size={20} className="text-red-600" />
              Cost Breakdown
            </h5>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Operating Expenses</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.totalExpenses)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Fuel Purchase Costs</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.totalOffloadingCosts)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="font-semibold">Total Costs</span>
                <span className="font-bold text-red-600">
                  {currencySymbol} {formatNumber(data.totalCosts)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Operational Metrics */}
        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
          <h5 className="text-lg font-semibold mb-4">Operational Metrics</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {data.transactionCounts.sales}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                Sales Records
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {data.transactionCounts.deliveries}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                Deliveries
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {data.transactionCounts.offloading}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                Offloading Records
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <span>Till/Mobile Payments</span>
              <span className="font-bold text-blue-600">
                {currencySymbol} {formatNumber(data.totalTillPayments)}
              </span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span>Fuel Inventory Change</span>
              <span
                className={`font-bold ${data.fuelInventoryChange >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {data.fuelInventoryChange >= 0 ? "+" : ""}
                {formatNumber(data.fuelInventoryChange)} L
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render VAT Return Report
  const renderVATReturnReport = () => {
    const data = calculateVATReturn();

    return (
      <div className="space-y-6">
        {/* KRA Info Banner (Kenya only) */}
        {isKenya && (
          <div className="bg-gradient-to-r from-green-600 to-green-700 text-gray-900 dark:text-white p-4 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Building2 size={24} />
              <span className="font-bold text-lg">
                Kenya Revenue Authority - VAT Return
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="opacity-75">KRA PIN:</span>{" "}
                <span className="font-medium">
                  {state.companyData.kraPin || "Not Set"}
                </span>
              </div>
              <div>
                <span className="opacity-75">VAT Reg:</span>{" "}
                <span className="font-medium">
                  {state.companyData.vatRegNo || "Not Set"}
                </span>
              </div>
              <div>
                <span className="opacity-75">Period:</span>{" "}
                <span className="font-medium">
                  {startDate} to {endDate}
                </span>
              </div>
              <div>
                <span className="opacity-75">Transactions:</span>{" "}
                <span className="font-medium">{data.transactionCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* VAT Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Output VAT */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border-2 border-blue-200 dark:border-blue-700">
            <h5 className="text-lg font-semibold mb-4 flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Receipt size={20} />
              OUTPUT VAT (Sales)
            </h5>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Gross Sales (VAT Inclusive)</span>
                <span className="font-medium">
                  {currencySymbol}{" "}
                  {formatNumber(data.outputVAT.inclusiveAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Net Sales</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.outputVAT.netAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2 bg-blue-50 dark:bg-blue-900/30 -mx-2 px-2 py-2 rounded">
                <span className="font-semibold">
                  VAT Collected ({vatPercentLabel})
                </span>
                <span className="font-bold text-blue-600 text-lg">
                  {currencySymbol} {formatNumber(data.outputVAT.vatAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Input VAT */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border-2 border-orange-200 dark:border-orange-700">
            <h5 className="text-lg font-semibold mb-4 flex items-center gap-2 text-orange-700 dark:text-orange-300">
              <Receipt size={20} />
              INPUT VAT (Purchases)
            </h5>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Gross Purchases (VAT Inclusive)</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.inputVAT.inclusiveAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Net Purchases</span>
                <span className="font-medium">
                  {currencySymbol} {formatNumber(data.inputVAT.netAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2 bg-orange-50 dark:bg-orange-900/30 -mx-2 px-2 py-2 rounded">
                <span className="font-semibold">
                  VAT Paid ({vatPercentLabel})
                </span>
                <span className="font-bold text-orange-600 text-lg">
                  {currencySymbol} {formatNumber(data.inputVAT.vatAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Net VAT Payable */}
        <div
          className={`p-6 rounded-lg ${data.netVATPayable >= 0 ? "bg-red-50 dark:bg-red-900/20 border-2 border-red-300" : "bg-green-50 dark:bg-green-900/20 border-2 border-green-300"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h5 className="text-xl font-bold mb-1">
                {data.netVATPayable >= 0
                  ? isKenya
                    ? "VAT Payable to KRA"
                    : "VAT Payable"
                  : isKenya
                    ? "VAT Refundable from KRA"
                    : "VAT Refundable"}
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                Output VAT - Input VAT = Net VAT
              </p>
            </div>
            <div
              className={`text-3xl font-bold ${data.netVATPayable >= 0 ? "text-red-600" : "text-green-600"}`}
            >
              {currencySymbol} {formatNumber(Math.abs(data.netVATPayable))}
            </div>
          </div>
        </div>

        {/* Quick Actions + Cross-Tab Navigation */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-gray-900 dark:text-white rounded-lg hover:bg-red-700"
          >
            <Download size={16} /> Download VAT Return PDF
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700"
          >
            <FileText size={16} /> Export to Excel
          </button>
          <button
            onClick={() => navigateToTab("pos")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-gray-900 dark:text-white rounded-lg hover:bg-indigo-700"
          >
            <ShoppingCart size={16} /> New Sale
          </button>
          <button
            onClick={() => navigateToTab("expenses")}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-gray-900 dark:text-white rounded-lg hover:bg-amber-700"
          >
            <Receipt size={16} /> Record Expense
          </button>
          <button
            onClick={() => navigateToTab("analytics")}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-gray-900 dark:text-white rounded-lg hover:bg-cyan-700"
          >
            <BarChart3 size={16} /> Analytics
          </button>
        </div>
      </div>
    );
  };

  // Render Daily Sales Register
  const renderDailySalesReport = () => {
    const dailyData = calculateDailySalesRegister();

    return (
      <div className="space-y-6">
        {/* KRA Compliance Badge (Kenya only) */}
        {isKenya && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-gray-900 dark:text-white p-4 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText size={24} />
              <div>
                <span className="font-bold text-lg">Daily Sales Register</span>
                <p className="text-sm opacity-90">KRA eTIMS Compliant Format</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} />
              <span className="text-sm">
                ETR: {state.companyData.etrSerialNo || "Not Set"}
              </span>
            </div>
          </div>
        )}

        {dailyData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p>No sales transactions found for the selected period.</p>
          </div>
        ) : (
          dailyData.map((day, index) => (
            <div
              key={index}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Day Header */}
              <div className="bg-gray-100 dark:bg-gray-700 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar size={18} />
                  <span className="font-bold">{day.date}</span>
                  <span className="text-sm text-gray-500">
                    ({day.transactions.length} transactions)
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-gray-500">Day Total:</span>
                  <span className="font-bold ml-2">
                    {currencySymbol} {formatNumber(day.totals.grossAmount)}
                  </span>
                </div>
              </div>

              {/* Transactions Table */}
              {day.transactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left">Receipt #</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-right">Qty (L)</th>
                        <th className="px-3 py-2 text-right">Unit Price</th>
                        <th className="px-3 py-2 text-right">Gross</th>
                        <th className="px-3 py-2 text-right">
                          VAT ({vatPercentLabel})
                        </th>
                        <th className="px-3 py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.transactions.map((t, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-700"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {t.receiptNo}
                          </td>
                          <td className="px-3 py-2">
                            {t.description}{" "}
                            <button
                              onClick={() =>
                                navigateToTab("fueltypes", {
                                  fuelType: t.description,
                                  price: Number(t.unitPrice) || undefined,
                                } as FuelPricePrefill)
                              }
                              className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
                              title="Edit this fuel type / price in Fuel Type Manager"
                            >
                              edit
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(t.quantity, 2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(t.unitPrice, 2)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatNumber(t.grossAmount)}
                          </td>
                          <td className="px-3 py-2 text-right text-blue-600">
                            {formatNumber(t.vatAmount)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(t.netAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-100 dark:bg-gray-700 font-bold">
                      <tr>
                        <td colSpan={2} className="px-3 py-2">
                          TOTALS
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(day.totals.quantity, 2)}
                        </td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(day.totals.grossAmount)}
                        </td>
                        <td className="px-3 py-2 text-right text-blue-600">
                          {formatNumber(day.totals.vatAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(day.totals.netAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  No transactions
                </div>
              )}
            </div>
          ))
        )}

        {/* Export Button + Cross-Tab Navigation */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-gray-900 dark:text-white rounded-lg hover:bg-blue-700"
          >
            <Printer size={16} /> Print Daily Register
          </button>
          <button
            onClick={() => navigateToTab("pos")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-gray-900 dark:text-white rounded-lg hover:bg-indigo-700"
          >
            <ShoppingCart size={16} /> New Sale
          </button>
          <button
            onClick={() => navigateToTab("sales")}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-gray-900 dark:text-white rounded-lg hover:bg-emerald-700"
          >
            <TrendingUp size={16} /> Sales Tracking
          </button>
          <button
            onClick={() => navigateToTab("invoice")}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-gray-900 dark:text-white rounded-lg hover:bg-purple-700"
          >
            <FileText size={16} /> Create Invoice
          </button>
          <button
            onClick={() => navigateToTab("inventory")}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-gray-900 dark:text-white rounded-lg hover:bg-orange-700"
          >
            <Package size={16} /> Stock Management
          </button>
          <button
            onClick={() => navigateToTab("analytics")}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-gray-900 dark:text-white rounded-lg hover:bg-cyan-700"
          >
            <BarChart3 size={16} /> Analytics
          </button>
        </div>
      </div>
    );
  };

  // Render KRA Summary Report
  const renderKRASummaryReport = () => {
    const data = calculateKRASummary();

    return (
      <div className="space-y-6">
        {/* Business Info Header */}
        <div className="bg-gradient-to-r from-green-700 to-green-800 text-gray-900 dark:text-white p-6 rounded-lg">
          <div className="flex items-center gap-3 mb-4">
            <Building2 size={28} />
            <div>
              <h3 className="text-xl font-bold">{data.businessInfo.name}</h3>
              <p className="text-sm opacity-90">
                KRA Compliance Summary Report
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-100 dark:bg-white/10 p-3 rounded">
              <div className="opacity-75 text-xs">KRA PIN</div>
              <div className="font-bold">{data.businessInfo.kraPin}</div>
            </div>
            <div className="bg-gray-100 dark:bg-white/10 p-3 rounded">
              <div className="opacity-75 text-xs">VAT Registration</div>
              <div className="font-bold">{data.businessInfo.vatRegNo}</div>
            </div>
            <div className="bg-gray-100 dark:bg-white/10 p-3 rounded">
              <div className="opacity-75 text-xs">ETR Serial No.</div>
              <div className="font-bold">{data.businessInfo.etrSerialNo}</div>
            </div>
            <div className="bg-gray-100 dark:bg-white/10 p-3 rounded">
              <div className="opacity-75 text-xs">CU Serial No.</div>
              <div className="font-bold">{data.businessInfo.cuSerialNo}</div>
            </div>
          </div>
          {data.businessInfo.physicalAddress && (
            <div className="mt-4 text-sm opacity-90">
              {data.businessInfo.physicalAddress}, {data.businessInfo.town},{" "}
              {data.businessInfo.county}
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200">
            <div className="text-sm text-blue-700 dark:text-blue-300 mb-1">
              Total Transactions
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {data.summary.totalTransactions}
            </div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200">
            <div className="text-sm text-purple-700 dark:text-purple-300 mb-1">
              Litres Sold
            </div>
            <div className="text-2xl font-bold text-purple-600">
              {formatNumber(data.summary.totalLitres, 0)} L
            </div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200">
            <div className="text-sm text-green-700 dark:text-green-300 mb-1">
              Gross Sales
            </div>
            <div className="text-2xl font-bold text-green-600">
              {currencySymbol} {formatNumber(data.summary.totalGross)}
            </div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-200">
            <div className="text-sm text-orange-700 dark:text-orange-300 mb-1">
              VAT Collected
            </div>
            <div className="text-2xl font-bold text-orange-600">
              {currencySymbol} {formatNumber(data.summary.totalVAT)}
            </div>
          </div>
        </div>

        {/* VAT Summary */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
          <h5 className="text-lg font-semibold mb-4">
            VAT Computation Summary
          </h5>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2">
              <span>Output VAT (Sales @ {vatPercentLabel})</span>
              <span className="font-medium text-blue-600">
                {currencySymbol} {formatNumber(data.summary.totalVAT)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span>Less: Input VAT (Purchases @ {vatPercentLabel})</span>
              <span className="font-medium text-orange-600">
                ({currencySymbol} {formatNumber(data.summary.inputVAT)})
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-t-2 border-gray-200 dark:border-gray-600">
              <span className="font-bold text-lg">Net VAT Payable</span>
              <span
                className={`font-bold text-xl ${data.summary.netVATPayable >= 0 ? "text-red-600" : "text-green-600"}`}
              >
                {currencySymbol} {formatNumber(data.summary.netVATPayable)}
              </span>
            </div>
          </div>
        </div>

        {/* Profitability */}
        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
          <h5 className="text-lg font-semibold mb-4">Profitability Analysis</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">Gross Revenue</div>
              <div className="text-xl font-bold">
                {currencySymbol} {formatNumber(data.profitLoss.grossRevenue)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Total Costs</div>
              <div className="text-xl font-bold text-red-600">
                {currencySymbol} {formatNumber(data.profitLoss.totalCosts)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Net Profit</div>
              <div
                className={`text-xl font-bold ${data.profitLoss.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {currencySymbol} {formatNumber(data.profitLoss.netProfit)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Profit Margin</div>
              <div
                className={`text-xl font-bold ${data.profitLoss.profitMargin >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {formatNumber(data.profitLoss.profitMargin, 1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Export Actions */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700"
          >
            <Download size={16} /> Download KRA Report
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-gray-900 dark:text-white rounded-lg hover:bg-blue-700"
          >
            <FileText size={16} /> Export to Excel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
              <BarChart3 size={24} />
              Reports Center
            </h2>
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Synced
            </span>
          </div>
          <ExportDropdown onExport={exportHandlers} title="Export Report" />
        </div>

        {/* Report Type Selection */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { id: "overall", label: "Overall Report", icon: BarChart3 },
            { id: "daybook", label: "Day Book", icon: BookOpen },
            { id: "losscontrol", label: "Loss Control", icon: TrendingDown },
            { id: "bankledger", label: "Bank & Cash Ledger", icon: Landmark },
            { id: "cashflow", label: "Cash Flow", icon: TrendingUp },
            { id: "stationpnl", label: "Station P&L", icon: Calculator },
            { id: "profit-loss", label: "Profit & Loss", icon: TrendingUp },
            { id: "expenses", label: "Expenses Report", icon: TrendingDown },
            { id: "vat-return", label: "VAT Return", icon: Receipt },
            { id: "daily-sales", label: "Daily Sales", icon: FileText },
            ...(isKenya
              ? [{ id: "kra-summary", label: "KRA Summary", icon: Building2 }]
              : []),
          ].map((report) => {
            const Icon = report.icon;
            const isKRA =
              isKenya &&
              ["vat-return", "daily-sales", "kra-summary"].includes(report.id);
            return (
              <button
                key={report.id}
                onClick={() => setActiveReport(report.id as ReportType)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  activeReport === report.id
                    ? isKRA
                      ? "bg-green-600 text-gray-900 dark:text-white shadow-lg"
                      : "bg-blue-600 text-gray-900 dark:text-white shadow-lg"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                <Icon size={16} />
                {report.label}
                {isKRA && activeReport !== report.id && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">
                    KRA
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Period and Date Selection */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="form-group">
            <label className="flex items-center gap-2">
              <Filter size={16} />
              Report Period
            </label>
            <select
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value as ReportPeriod)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div className="form-group">
            <label className="flex items-center gap-2">
              <Calendar size={16} />
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="flex items-center gap-2">
              <Calendar size={16} />
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Currency</label>
            <div className="bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg font-medium">
              {currencySymbol}
            </div>
          </div>
        </div>

        {/* Report Content */}
        <div className="report-content">
          {activeReport === "daybook" ? (
            <DayBook />
          ) : activeReport === "losscontrol" ? (
            <LossControl />
          ) : activeReport === "bankledger" ? (
            <BankLedger />
          ) : activeReport === "cashflow" ? (
            <CashFlowReport />
          ) : activeReport === "stationpnl" ? (
            <StationPnlSummary />
          ) : (
            <>
              {activeReport === "expenses" && renderExpensesReport()}
              {activeReport === "profit-loss" && renderProfitLossReport()}
              {activeReport === "overall" && renderOverallReport()}
              {activeReport === "vat-return" && renderVATReturnReport()}
              {activeReport === "daily-sales" && renderDailySalesReport()}
              {activeReport === "kra-summary" && renderKRASummaryReport()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
