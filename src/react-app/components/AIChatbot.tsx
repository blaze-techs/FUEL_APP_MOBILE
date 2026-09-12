import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Mic,
  MicOff,
  X,
  Volume2,
  VolumeX,
  Bot,
  User,
  Minimize2,
  Maximize2,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { getCurrencySymbol, isKenyaStation } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { CANONICAL_FUEL_TYPES } from "@/react-app/config/pricing";
import {
  switchToTab,
  navigateToTab,
} from "@/react-app/lib/mpesa-integration-service";
import {
  searchSubTabs,
  SITE_SUBTABS,
  SITE_ACTIONS,
  type SubTabEntry,
  type QuickActionEntry,
} from "@/react-app/lib/site-search-index";
import { useStations } from "@/react-app/context/StationContext";
import {
  listUserDocuments,
  describeDocuments,
  findDocuments,
  downloadDocumentByName,
  exportAllUserData,
  analyzeSalesTrend,
  forecastSales,
  buildSummaryText,
  printTextDocument,
  sendSummaryEmail,
  sendSummaryWhatsApp,
  evalArithmetic,
} from "@/react-app/lib/chatbot-actions";
import {
  exportSalesPDF,
  exportSalesExcel,
  exportSalesTXT,
  exportDeliveryPDF,
  exportDeliveryExcel,
  exportDeliveryTXT,
  exportDebtPDF,
  exportDebtExcel,
  exportDebtTXT,
} from "@/react-app/utils/exportUtils";

// Declare Speech Recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognitionResult {
  [index: number]: {
    transcript: string;
    confidence: number;
  };
  length: number;
}

interface SpeechRecognitionEvent {
  results: {
    [index: number]: SpeechRecognitionResult;
    length: number;
  };
}

interface MessageAction {
  label: string;
  run: () => Promise<void>;
}

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  errorCode?: string;
  canRetry?: boolean;
  suggestions?: string[];
  isError?: boolean;
  /** One-shot executable action rendered as a button under the message. */
  action?: MessageAction;
  actionDone?: boolean;
}

export default function AIChatbot() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id ?? null;
  // Unified fuel types so the AI assistant knows about ALL the station's
  // configured fuels (and their live prices), not just petrol/diesel.
  const fuelTypeApi = useStationFuelTypes();
  const mobilePayTerm = isKenyaStation() ? "M-PESA" : "digital payments";
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: `Hello! I'm your FuelPro AI Assistant — wired into all your real station data. I can answer questions, analyze & forecast sales, list and download your documents, export reports and full data backups, print summaries, and send them by email or WhatsApp. Say "help" for the full list!`,
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "error" | "checking"
  >("connected");
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(
    null,
  );
  const [retryCount, setRetryCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Build comprehensive business context from ALL state data - dynamically includes all tabs
  const buildBusinessContext = () => {
    const context: any = {
      timestamp: new Date().toISOString(),
      businessName: state.companyData.name || "Fuel Station",
      currency: state.companyData.currency || getCurrencySymbol() || "USD",
      theme: state.theme,
      currentDate: state.salesDate,
      currentShift: state.shift,
    };

    // Available Tabs Configuration (for AI to know what features exist)
    context.availableTabs = state.tabConfigurations
      .filter((t) => t.visible)
      .map((t) => ({ id: t.id, name: t.label, description: t.description }));

    // Company Information (complete)
    context.company = {
      name: state.companyData.name,
      contacts: state.companyData.contacts,
      email: state.companyData.email,
      physicalAddress: state.companyData.physicalAddress,
      poBox: state.companyData.poBox,
      county: state.companyData.county,
      town: state.companyData.town,
      kraPin: state.companyData.kraPin,
      vatRegNo: state.companyData.vatRegNo,
      etrSerialNo: state.companyData.etrSerialNo,
      bank: state.companyData.bankName
        ? {
            name: state.companyData.bankName,
            branch: state.companyData.branchName,
            accountHolder: state.companyData.accountHolder,
            accountNumber: state.companyData.accountNumber,
          }
        : null,
    };

    // Fuel Prices & Tank Levels — enriched with ALL station fuel types so the
    // AI can answer questions about any fuel the station sells (not just PMS/AGO).
    // The pms/ago/petrol/diesel scalars resolve from the CANONICAL
    // fuel_types_config (via fuelTypeApi) FIRST so a price set in Fuel Type
    // Manager / Price Board / Price Scheduler is always current — the legacy
    // FuelContext scalars (state.pmsPrice/agoPrice) only serve as a fallback
    // for stations with no configured fuel types yet.
    const petrolPrice =
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.petrol.label) ??
      state.petrolPrice ??
      state.pmsPrice;
    const dieselPrice =
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.diesel.label) ??
      state.dieselPrice ??
      state.agoPrice;
    context.fuelPrices = {
      petrol: petrolPrice,
      diesel: dieselPrice,
      pms: petrolPrice,
      ago: dieselPrice,
      allFuelTypes: fuelTypeApi.activeFuelTypes.map((ft) => ({
        name: ft.name,
        price: ft.price,
        active: ft.active,
      })),
    };

    context.tankLevels = {
      pms: {
        opening: state.pmsTankOpening,
        closing: state.pmsTankClosing,
        consumed: state.pmsTankOpening - state.pmsTankClosing,
      },
      ago: {
        opening: state.agoTankOpening,
        closing: state.agoTankClosing,
        consumed: state.agoTankOpening - state.agoTankClosing,
      },
    };

    // TODAY'S SALES - Full pump details
    const pmsTotal = state.pmsPumps.reduce(
      (sum, p) => sum + (Number(p.salesKsh) || 0),
      0,
    );
    const agoTotal = state.agoPumps.reduce(
      (sum, p) => sum + (Number(p.salesKsh) || 0),
      0,
    );
    const pmsLitres = state.pmsPumps.reduce(
      (sum, p) => sum + (Number(p.salesL) || 0),
      0,
    );
    const agoLitres = state.agoPumps.reduce(
      (sum, p) => sum + (Number(p.salesL) || 0),
      0,
    );
    const totalExpenses = state.expenses.reduce(
      (sum, e) => sum + (Number(e.amount) || 0),
      0,
    );

    context.todaySales = {
      date: state.salesDate,
      shift: state.shift,
      petrol: {
        litres: pmsLitres,
        amount: pmsTotal,
        pumpCount: state.pmsPumps.length,
        pumps: state.pmsPumps,
      },
      diesel: {
        litres: agoLitres,
        amount: agoTotal,
        pumpCount: state.agoPumps.length,
        pumps: state.agoPumps,
      },
      totalLitres: pmsLitres + agoLitres,
      totalRevenue: pmsTotal + agoTotal,
      tillPayment: state.tillPayment,
      cashInHand: pmsTotal + agoTotal - totalExpenses - state.tillPayment,
      expenses: state.expenses,
      totalExpenses,
      netIncome:
        state.tillPayment +
        (pmsTotal + agoTotal - totalExpenses - state.tillPayment),
    };

    // DELIVERY TRACKER - All delivery data
    if (state.deliveryData.rows.length > 0) {
      const deliveries = state.deliveryData.rows;
      const totalSupplied = deliveries.reduce(
        (sum, d) => sum + (Number(d.amount) || 0),
        0,
      );
      const totalDebt = deliveries.reduce(
        (sum, d) => sum + (Number(d.debt) || 0),
        0,
      );
      const uniqueCustomers = [
        ...new Set(deliveries.map((d) => d.name)),
      ].filter((n) => n);

      context.deliveryTracker = {
        totalRecords: deliveries.length,
        totalSupplied,
        totalDebt,
        uniqueCustomers: uniqueCustomers.length,
        customerNames: uniqueCustomers,
        deliveryYear: state.deliveryYear,
        deliveredTo: state.deliveredTo,
        totalOrder: state.totalOrder,
        totals: state.deliveryData.totals,
        recentDeliveries: deliveries.slice(-10),
      };
    }

    // CLIENTS - Full client data with debt details
    if (Object.keys(state.clients).length > 0) {
      const clientsList = Object.entries(state.clients).map(
        ([name, data]: [string, any]) => ({
          name,
          phone: data.phone,
          balance: data.balance || 0,
          deliveryCount: data.deliveries?.length || 0,
          recentDeliveries: data.deliveries?.slice(-3),
        }),
      );

      const clientsWithDebt = clientsList.filter((c) => c.balance > 0);

      context.clients = {
        totalClients: clientsList.length,
        clientsWithDebt: clientsWithDebt.length,
        totalDebtAmount: clientsWithDebt.reduce((sum, c) => sum + c.balance, 0),
        topDebtors: clientsWithDebt
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 10),
        allClients: clientsList,
      };
    }

    // INVOICES - Current and history
    context.invoices = {
      currentItems: state.invoiceItems,
      currentTotal: state.invoiceItems.reduce(
        (sum, item) => sum + (Number(item.total) || 0),
        0,
      ),
      invoiceCounter: state.invoiceCounter,
      invoiceSettings: state.invoiceSettings,
      savedInvoices: Object.keys(state.invoices).length,
      invoiceHistory: state.invoices,
    };

    // DEBT HISTORY
    if (Object.keys(state.debtHistory).length > 0) {
      context.debtHistory = {
        totalRecords: Object.keys(state.debtHistory).length,
        history: state.debtHistory,
      };
    }

    // OFFLOADING RECORDS - Fuel received from suppliers
    if (state.offloadingRecords.length > 0) {
      const totalOffloaded = state.offloadingRecords.reduce(
        (sum, r) => sum + (Number(r.quantity) || 0),
        0,
      );
      const totalCost = state.offloadingRecords.reduce(
        (sum, r) => sum + (Number(r.totalAmount) || 0),
        0,
      );
      const suppliers = [
        ...new Set(state.offloadingRecords.map((r) => r.supplier)),
      ].filter((s) => s);

      context.offloading = {
        totalRecords: state.offloadingRecords.length,
        totalLitres: totalOffloaded,
        totalCost,
        suppliers,
        records: state.offloadingRecords.slice(-10),
      };
    }

    // M-PESA TRANSACTIONS - All transaction data
    if (state.mpesaTransactions.length > 0) {
      const totalMpesa = state.mpesaTransactions.reduce(
        (sum, t) => sum + (Number(t.amount) || 0),
        0,
      );
      context.mpesaTransactions = {
        totalTransactions: state.mpesaTransactions.length,
        totalAmount: totalMpesa,
        transactions: state.mpesaTransactions.slice(-20),
      };
    }

    // EMPLOYEES & PAYROLL
    if (state.employees.length > 0) {
      const totalPayroll = state.employees.reduce(
        (sum, e) => sum + (Number(e.basicSalary) || 0),
        0,
      );
      const activeEmployees = state.employees.filter((e) => e.isActive);

      context.payroll = {
        totalEmployees: state.employees.length,
        activeEmployees: activeEmployees.length,
        totalMonthlyPayroll: totalPayroll,
        positions: [...new Set(state.employees.map((e) => e.position))].filter(
          (r) => r,
        ),
        employees: state.employees,
        payrollRecords: state.payrollRecords.slice(-20),
      };
    }

    // SALES HISTORY - Historical records
    if (Object.keys(state.salesHistory).length > 0) {
      const salesDates = Object.keys(state.salesHistory).sort();
      const recentSales = salesDates.slice(-10).map((key) => ({
        key,
        ...state.salesHistory[key],
      }));

      context.salesHistory = {
        totalDaysRecorded: salesDates.length,
        dateRange: {
          from: salesDates[0],
          to: salesDates[salesDates.length - 1],
        },
        recentRecords: recentSales,
      };
    }

    // REPORT SETTINGS
    context.reportSettings = state.reportSettings;

    // USER PREFERENCES
    context.userPreferences = state.userPreferences;

    // SIGNATURES
    if (state.signatures.manager || state.signatures.director) {
      context.signatures = {
        hasManager: !!state.signatures.manager,
        hasDirector: !!state.signatures.director,
      };
    }

    // DATA BACKUPS
    if (state.dataBackups.length > 0) {
      context.dataBackups = {
        count: state.dataBackups.length,
        lastBackup: state.dataBackups[state.dataBackups.length - 1]?.date,
      };
    }

    return context;
  };

  // Initialize speech recognition and synthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Speech Recognition
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          setInputMessage(transcript);
          setIsListening(false);
        };

        recognition.onerror = () => {
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }

      // Speech Synthesis
      synthRef.current = window.speechSynthesis;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Local AI response generator - analyzes business data and generates intelligent responses
  const generateLocalResponse = (message: string, context: any): string => {
    const lowerMsg = message.toLowerCase();
    const currency = context.currency || getCurrencySymbol();
    const {
      todaySales,
      deliveryTracker,
      invoices,
      tankLevels,
      payroll,
      offloading,
      salesHistory,
    } = context;

    // Today's Sales queries
    if (
      lowerMsg.includes("today") &&
      (lowerMsg.includes("sale") ||
        lowerMsg.includes("revenue") ||
        lowerMsg.includes("income"))
    ) {
      if (!todaySales || todaySales.totalRevenue === 0) {
        const fuelLines = fuelTypeApi.activeFuelTypes
          .map(
            (ft) =>
              `• ${fuelTypeApi.labelOf(ft.name)}: ${currency} ${fuelTypeApi.getPriceFor(ft.name) ?? "N/A"}/L`,
          )
          .join("\n");
        return `**Today's Sales Summary**\n\nNo sales have been recorded for today (${context.currentDate}).\n\nTo record sales:\n1. Go to **Sales Tracking** tab\n2. Enter pump opening and closing readings\n3. Add any expenses\n4. Save the data\n\nCurrent fuel prices:\n${fuelLines}`;
      }
      // Per-fuel sales block: each active station fuel type gets its own line.
      // PMS/AGO resolve to todaySales.petrol/diesel (which carry litres/amount/
      // pumpCount); other fuels fall back to their configured price only.
      const salesFuelBlock = fuelTypeApi.activeFuelTypes
        .map((ft) => {
          const canonical = fuelTypeApi.canonicalOf(ft.name);
          const sales =
            canonical === "petrol"
              ? todaySales.petrol
              : canonical === "diesel"
                ? todaySales.diesel
                : null;
          const label = fuelTypeApi.labelOf(ft.name);
          if (sales) {
            return `**${label}:**\n• Litres: ${sales?.litres?.toLocaleString() || 0} L\n• Amount: ${currency} ${sales?.amount?.toLocaleString() || 0}\n• Pumps: ${sales?.pumpCount || 0}`;
          }
          return `**${label}:**\n• Price: ${currency} ${fuelTypeApi.getPriceFor(ft.name) ?? "N/A"}/L`;
        })
        .join("\n\n");
      return `**Today's Sales Summary**\n\n**Date:** ${todaySales.date} (${todaySales.shift} Shift)\n\n${salesFuelBlock}\n\n💰 **Totals:**\n• Total Revenue: ${currency} ${todaySales.totalRevenue?.toLocaleString()}\n• Till/M-Pesa: ${currency} ${todaySales.tillPayment?.toLocaleString()}\n• Total Expenses: ${currency} ${todaySales.totalExpenses?.toLocaleString()}\n• Cash in Hand: ${currency} ${todaySales.cashInHand?.toLocaleString()}\n• Net Income: ${currency} ${todaySales.netIncome?.toLocaleString()}`;
    }

    // Debt queries
    if (
      lowerMsg.includes("debt") ||
      lowerMsg.includes("outstanding") ||
      lowerMsg.includes("owe")
    ) {
      if (!deliveryTracker || deliveryTracker.totalDebt === 0) {
        return `**Debt Status**\n\nNo outstanding debts recorded.\n\nTo track customer debts:\n1. Go to **Fuel Statement Report** tab\n2. Add deliveries with customer names\n3. The system will auto-calculate balances\n\nYou can also use the **Debt Payment Reminders** sub-tab (Credit Management) to send payment reminders.`;
      }
      return `**Outstanding Debts Summary**\n\n• Total Balance Due: ${currency} ${deliveryTracker.totalDebt?.toLocaleString()}\n• Total Records: ${deliveryTracker.totalRecords}\n• Unique Customers: ${deliveryTracker.uniqueCustomers}\n• Delivered To: ${deliveryTracker.deliveredTo || "N/A"}\n\n💡 Tip: Use the **Debt Reminder** tab to generate payment reminder letters.`;
    }

    // Invoice queries
    if (lowerMsg.includes("invoice")) {
      return `**Invoice Status**\n\n• Saved Invoices: ${invoices?.savedInvoices || 0}\n• Invoice Counter: #${invoices?.invoiceCounter || 1}\n• Quantity Label: ${invoices?.invoiceSettings?.quantityLabel || "Qty (DAYS)"}\n• Current Items: ${invoices?.currentItems?.length || 0}\n• Current Total: ${currency} ${invoices?.currentTotal?.toLocaleString() || 0}\n\n💡 Tip: Go to the **Invoice** tab to create professional invoices with your company branding.`;
    }

    // Fuel price queries
    if (lowerMsg.includes("price") || lowerMsg.includes("fuel")) {
      const allFuelLines = fuelTypeApi.activeFuelTypes
        .map(
          (ft) =>
            `• ${fuelTypeApi.labelOf(ft.name)}: ${currency} ${fuelTypeApi.getPriceFor(ft.name) ?? "N/A"}/L`,
        )
        .join("\n");
      // Per-fuel tank level / consumption lines. PMS/AGO resolve to the
      // legacy tankLevels.{pms,ago}; other fuels have no tank record yet.
      const tankLines = fuelTypeApi.activeFuelTypes
        .map((ft) => {
          const canonical = fuelTypeApi.canonicalOf(ft.name);
          const tank =
            canonical === "petrol"
              ? tankLevels?.pms
              : canonical === "diesel"
                ? tankLevels?.ago
                : null;
          const label = fuelTypeApi.labelOf(ft.name);
          if (tank) {
            const dispensed = (tank.opening || 0) - (tank.closing || 0);
            return `• ${label}: Opening ${tank.opening || 0}L → Closing ${tank.closing || 0}L (${dispensed} Litres dispensed)`;
          }
          return `• ${label}: tank data not configured`;
        })
        .join("\n");
      return `**Current Fuel Prices & Tank Levels**\n\n**Prices:**\n${allFuelLines}\n\n**Tank Levels & Consumption:**\n${tankLines}`;
    }

    // Payroll queries
    if (
      lowerMsg.includes("payroll") ||
      lowerMsg.includes("staff") ||
      lowerMsg.includes("employee") ||
      lowerMsg.includes("salary")
    ) {
      if (!payroll || payroll.totalEmployees === 0) {
        return `**Payroll Information**\n\nNo employees recorded yet.\n\nTo set up payroll:\n1. Go to **Payroll System** tab\n2. Add employees with their details\n3. Set basic salary and allowances\n4. Process monthly payroll`;
      }
      return `**Payroll Summary**\n\n• Total Employees: ${payroll.totalEmployees}\n• Active: ${payroll.activeEmployees}\n• Total Monthly Payroll: ${currency} ${payroll.totalMonthlyPayroll?.toLocaleString()}\n• Positions: ${payroll.positions?.join(", ") || "N/A"}\n\n💡 Tip: Use the **Payroll System** tab to process salaries and generate payslips.`;
    }

    // Offloading queries
    if (
      lowerMsg.includes("offload") ||
      lowerMsg.includes("supply") ||
      lowerMsg.includes("delivery from")
    ) {
      if (!offloading || offloading.totalRecords === 0) {
        return `**Fuel Offloading Records**\n\nNo offloading records found.\n\nTo record fuel received:\n1. Go to **Fuel Offloading** tab\n2. Enter truck details and fuel quantity\n3. Save the record\n\nThis helps track fuel inventory and supplier payments.`;
      }
      return `**Offloading Summary**\n\n• Total Records: ${offloading.totalRecords}\n• Total Litres Received: ${offloading.totalLitres?.toLocaleString()} L\n• Total Cost: ${currency} ${offloading.totalCost?.toLocaleString()}\n• Suppliers: ${offloading.suppliers?.join(", ") || "N/A"}`;
    }

    // M-PESA queries
    if (
      lowerMsg.includes("mpesa") ||
      lowerMsg.includes("mobile") ||
      lowerMsg.includes("payment")
    ) {
      const mpesaTxns = context.mpesaTransactions;
      if (!mpesaTxns || mpesaTxns.totalTransactions === 0) {
        return `**M-PESA Summary**\n\nNo M-PESA transactions recorded.\n\nTo analyze M-PESA:\n1. Go to **M-PESA Analyzer** tab\n2. Paste your M-PESA statement\n3. The system will categorize and summarize all transactions`;
      }
      return `**M-PESA Summary**\n\n• Total Transactions: ${mpesaTxns.totalTransactions}\n• Total Amount: ${currency} ${mpesaTxns.totalAmount?.toLocaleString()}`;
    }

    // Business overview
    if (
      lowerMsg.includes("overview") ||
      lowerMsg.includes("summary") ||
      lowerMsg.includes("status") ||
      lowerMsg.includes("business")
    ) {
      // Per-fuel sales/pump summary lines for ALL active station fuels. PMS/
      // AGO resolve to todaySales.petrol/diesel; others report their price.
      const salesOverviewLines = fuelTypeApi.activeFuelTypes
        .map((ft) => {
          const canonical = fuelTypeApi.canonicalOf(ft.name);
          const sales =
            canonical === "petrol"
              ? todaySales?.petrol
              : canonical === "diesel"
                ? todaySales?.diesel
                : null;
          const label = fuelTypeApi.labelOf(ft.name);
          if (sales) {
            return `• ${label} Sales: ${currency} ${sales?.amount?.toLocaleString() || 0} (${sales?.pumpCount || 0} pumps)`;
          }
          return `• ${label} Price: ${currency} ${fuelTypeApi.getPriceFor(ft.name) ?? "N/A"}/L`;
        })
        .join("\n");
      return `**Business Overview - ${context.businessName}**\n\n**Sales:**\n• Today's Revenue: ${currency} ${todaySales?.totalRevenue?.toLocaleString() || 0}\n${salesOverviewLines}\n\n💰 **Financials:**\n• Outstanding Debt: ${currency} ${deliveryTracker?.totalDebt?.toLocaleString() || 0}\n• Total Expenses Today: ${currency} ${todaySales?.totalExpenses?.toLocaleString() || 0}\n• Saved Invoices: ${invoices?.savedInvoices || 0}\n\n👥 **Staff:** ${payroll?.totalEmployees || 0} employees\n🚛 **Offloading:** ${offloading?.totalRecords || 0} records\n📅 **Sales History:** ${salesHistory?.totalDaysRecorded || 0} days recorded`;
    }

    // Movies / Live TV / Radio / entertainment — the AI answers about the
    // site's full streaming + broadcast catalog.
    if (
      lowerMsg.includes("movie") ||
      lowerMsg.includes("film") ||
      lowerMsg.includes("series") ||
      lowerMsg.includes("tv show") ||
      lowerMsg.includes("watch") ||
      lowerMsg.includes("live tv") ||
      lowerMsg.includes("live radio") ||
      lowerMsg.includes("channel") ||
      lowerMsg.includes("stream")
    ) {
      return `**Entertainment & Live Broadcasts**

FuelPro includes a full entertainment hub in the **News** tab:

**Movies** — full streaming catalog (movies, series, documentaries) with search, genres, seasons, and an in-app player.
📺 **Live TV** — 1,500+ live channels worldwide (news, sports, movies, kids, music…), with subtitles/AI captions.
📻 **Live Radio** — 4,000+ live stations by genre and country.

Say "watch <title>" and I'll open the Movies tab and search it for you. Or use **Quick Search (Ctrl+K)** — it searches the whole site: tabs, sub-tabs, settings, actions, and the movie catalog.`;
    }

    // Help
    if (lowerMsg.includes("help") || lowerMsg.includes("what can you do")) {
      return `**I'm your FuelPro AI Assistant!** Here's everything I can do:

📊 **Answer & Analyze** — today's sales, debts, invoices, prices, tank levels, payroll, offloading, ${mobilePayTerm}, business overview
📈 **Analyze & Forecast** — "analyze sales", "forecast sales" (real trend + projection from your history)
📁 **Documents** — "list my documents", "find document <name>", "download document <name>"
⬇️ **Reports & Data** — "download sales report" (PDF/Excel/TXT), "export all my data" (full backup)
🖨️ **Print** — "print summary"
✉️ **Send** — "send summary to name@email.com" or "send summary via whatsapp to 254712345678"
🧭 **Navigate** — "open <any tab or sub-tab>", "watch <movie>"
🧮 **General** — arithmetic, date/time, and more

Everything runs securely on your own data — sends use only the gateways YOU configured, and I always ask before sending.`;
    }

    // Site-wide feature search — the query is matched against EVERY tab,
    // sub-tab, setting, and quick action in the site. Nothing restricted.
    const allTabs: { id: string; name: string; description?: string }[] =
      context.availableTabs || [];
    const q = lowerMsg.trim();
    if (q.length >= 3) {
      const tabMatches = allTabs.filter(
        (t) =>
          t.name?.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          q.includes(t.name?.toLowerCase() || "~~~") ||
          q.includes(t.id.toLowerCase()),
      );
      const subHits = searchSubTabs(q, 5);
      const actHits = (SITE_ACTIONS || [])
        .filter((a: QuickActionEntry) =>
          `${a.label} ${a.description} ${a.keywords || ""}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 3);
      const lines: string[] = [];
      for (const t of tabMatches.slice(0, 3)) {
        lines.push(
          `• **${t.name}** (tab)${t.description ? ` — ${t.description}` : ""}`,
        );
      }
      for (const e of subHits) {
        lines.push(
          `• **${e.label}** (sub-tab)${e.description ? ` — ${e.description}` : ""}`,
        );
      }
      for (const a of actHits) {
        lines.push(`• **${a.label}** (action) — ${a.description}`);
      }
      if (lines.length > 0) {
        return `**I found ${lines.length} match${lines.length > 1 ? "es" : ""} for "${message}" in the site:**\n\n${lines.join("\n")}\n\nSay "open <name>" and I'll take you there — or use **Quick Search (Ctrl+K)** for instant access to every feature.`;
      }
    }

    // Default response
    return `I analyzed your business data for "${message}".\n\n${todaySales?.totalRevenue ? `Today's revenue is ${currency} ${todaySales.totalRevenue.toLocaleString()}.\n` : ""}${deliveryTracker?.totalDebt ? `Outstanding debt: ${currency} ${deliveryTracker.totalDebt.toLocaleString()}.\n` : ""}\n💡 Try asking me about:\n• Today's sales\n• Outstanding debts\n• Fuel prices\n• Business overview\n• Payroll summary\n\nI'm running in **local mode** using your actual business data.`;
  };

  // ------------------------------------------------------------------
  // Action intents — documents, data extraction, downloads, print, send,
  // analyze, forecast, and general questions. All run through the secure
  // owner-scoped action layer (chatbot-actions.ts). Returns null when the
  // message is NOT an action command so the normal Q&A flow continues.
  // ------------------------------------------------------------------
  const tryActionIntents = async (
    raw: string,
  ): Promise<{ text: string; action?: MessageAction } | null> => {
    const msg = raw.trim();
    const lower = msg.toLowerCase();

    // ---- Documents: list / find / download ----
    if (
      /(list|show|display)\s+(all\s+)?(my\s+)?(documents|files|docs)\b/.test(
        lower,
      ) ||
      /^(my\s+)?(documents|files|docs)$/.test(lower)
    ) {
      const docs = await listUserDocuments(stationId);
      return { text: describeDocuments(docs) };
    }

    const findDocMatch = lower.match(
      /(?:find|search(?:\s+for)?|look for)\s+(?:a\s+)?(?:document|doc|file)\s+(.+)/,
    );
    if (findDocMatch) {
      const q = findDocMatch[1].replace(/[.!?]+$/, "");
      const matches = await findDocuments(q, stationId);
      if (matches.length === 0) {
        return {
          text: `No documents match "${q}". Say "list my documents" to see everything you have stored.`,
        };
      }
      const lines = matches
        .slice(0, 10)
        .map((d) => `• **${d.name}** — ${d.category}`)
        .join("\n");
      return {
        text: `**Found ${matches.length} document${matches.length > 1 ? "s" : ""} matching "${q}":**\n\n${lines}\n\nSay "download document <name>" to fetch one.`,
      };
    }

    const dlDocMatch = lower.match(
      /(?:download|get|fetch|open|retrieve)\s+(?:the\s+)?(?:document|doc|file)\s+(.+)/,
    );
    if (dlDocMatch) {
      const name = dlDocMatch[1].replace(/[.!?]+$/, "");
      const res = await downloadDocumentByName(name, stationId);
      return { text: res.message };
    }

    // ---- Full data extraction ----
    if (
      /(export|download|backup|extract)\s+(all\s+)?(my\s+)?(data|everything|collections)/.test(
        lower,
      ) ||
      /^(export|backup)\s*(all)?\s*data$/.test(lower)
    ) {
      const res = await exportAllUserData();
      return { text: res.message };
    }

    // ---- Report downloads (sales / delivery / debt) ----
    const reportMatch = lower.match(
      /(?:download|export|generate)\s+(?:the\s+)?(sales|delivery|deliveries|debt)\s*(?:report)?\s*(pdf|excel|xlsx|csv|txt|text)?/,
    );
    if (reportMatch) {
      const kind = reportMatch[1];
      const fmt = (reportMatch[2] || "txt").toLowerCase();
      try {
        if (kind === "sales") {
          if (fmt === "pdf") await exportSalesPDF(state);
          else if (fmt === "excel" || fmt === "xlsx" || fmt === "csv")
            await exportSalesExcel(state);
          else await exportSalesTXT(state);
        } else if (kind === "debt") {
          if (fmt === "pdf") await exportDebtPDF(state);
          else if (fmt === "excel" || fmt === "xlsx" || fmt === "csv")
            exportDebtExcel(state);
          else exportDebtTXT(state);
        } else {
          if (fmt === "pdf") await exportDeliveryPDF(state);
          else if (fmt === "excel" || fmt === "xlsx" || fmt === "csv")
            await exportDeliveryExcel(state);
          else await exportDeliveryTXT(state);
        }
        return {
          text: `Your **${kind} report** (${fmt.toUpperCase()}) has been generated and downloaded — built from your live station data (fuel types, prices, pumps, expenses, tank readings).`,
        };
      } catch (e) {
        return {
          text: `The ${kind} report could not be generated: ${(e as Error).message}`,
        };
      }
    }

    // ---- Print ----
    if (
      /^print\b/.test(lower) ||
      /\bprint\s+(the\s+)?(summary|report)/.test(lower)
    ) {
      const text = buildSummaryText(state);
      printTextDocument(
        `${state.companyData?.name || "Fuel Station"} — Business Summary`,
        text,
      );
      return {
        text: 'Sent your **business summary** to the printer (the print dialog should be open). Say "print" again anytime — or ask me to print after any analysis.',
      };
    }

    // ---- Send (email / WhatsApp) — always confirm before sending ----
    const emailMatch = msg.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (
      emailMatch &&
      /(send|email|mail|share|forward)/.test(lower) &&
      !/whatsapp/.test(lower)
    ) {
      const to = emailMatch[0];
      const text = buildSummaryText(state);
      return {
        text: `Ready to email your **business summary** to **${to}**.\n\nIt includes: days recorded, total revenue, fuel sold, expenses, net, outstanding debt, invoices, and employees — all from your live data.\n\nConfirm below and I'll send it${""} (via your configured email gateway, or your mail app if none is set up).`,
        action: {
          label: `Send email to ${to}`,
          run: async () => {
            const res = await sendSummaryEmail(to, text, stationId);
            appendAssistantMessage(
              res.message,
              res.fallbackUrl
                ? {
                    label: res.fallbackLabel || "Open fallback",
                    run: async () => {
                      window.open(res.fallbackUrl, "_blank");
                    },
                  }
                : undefined,
            );
          },
        },
      };
    }

    const waPhoneMatch = msg.match(/\+?\d[\d\s-]{6,}\d/);
    if (
      waPhoneMatch &&
      /whatsapp|whats app|wa\b/.test(lower) &&
      /(send|share|forward|message)/.test(lower)
    ) {
      const phone = waPhoneMatch[0].replace(/[\s-]/g, "");
      const text = buildSummaryText(state);
      return {
        text: `Ready to send your **business summary** via WhatsApp to **${phone}**.\n\nConfirm below and I'll send it (via your WhatsApp Business gateway, or WhatsApp Web if none is set up).`,
        action: {
          label: `Send WhatsApp to ${phone}`,
          run: async () => {
            const res = await sendSummaryWhatsApp(phone, text, stationId);
            appendAssistantMessage(
              res.message,
              res.fallbackUrl
                ? {
                    label: res.fallbackLabel || "Open fallback",
                    run: async () => {
                      window.open(res.fallbackUrl, "_blank");
                    },
                  }
                : undefined,
            );
          },
        },
      };
    }

    // ---- Forecast ----
    if (/forecast|predict|projection|project sales/.test(lower)) {
      const daysMatch = lower.match(/(\d+)\s*(?:days?|day)/);
      const days = daysMatch
        ? Math.min(90, Math.max(1, Number(daysMatch[1])))
        : 7;
      return { text: forecastSales(state, days) };
    }

    // ---- Analyze (sales/business trend; M-PESA analysis stays in the Q&A flow) ----
    if (
      /(analyz|analyse|trend|performance review)/.test(lower) &&
      !/mpesa|m-pesa|mobile money/.test(lower)
    ) {
      return { text: analyzeSalesTrend(state) };
    }

    // ---- General questions: arithmetic, date/time, identity ----
    const mathMatch = msg.match(
      /(?:what(?:'s| is)\s+|calculate\s+|compute\s+)?([\d][\d\s+\-*/().xX÷%]*[\d)])\s*\??\s*$/,
    );
    if (
      mathMatch &&
      /[+\-*/xX÷%]/.test(mathMatch[1]) &&
      !/(sale|price|revenue|debt|expense|litre|liter|fuel)/.test(lower)
    ) {
      const val = evalArithmetic(mathMatch[1]);
      if (val !== null) {
        return {
          text: `**${mathMatch[1].trim()} = ${formatNumber(val, 4).replace(/\.?0+$/, "")}**\n\nNeed business math? Ask things like "what's my average daily revenue" or "forecast sales".`,
        };
      }
    }
    if (/^(what|what's)\s+(the\s+)?(date|day|time|today)/.test(lower)) {
      const now = new Date();
      return {
        text: `It's **${now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**, ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
      };
    }
    if (/who are you|what are you|your name/.test(lower)) {
      return {
        text: "I'm your **FuelPro AI Assistant** — a secure, on-device assistant wired into your station's real data. I can answer questions, analyze and forecast sales, list and download your documents, export reports and full data backups, print summaries, and send them by email or WhatsApp. Say \"help\" for the full list.",
      };
    }

    return null;
  };

  const appendAssistantMessage = (content: string, action?: MessageAction) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "assistant",
        content,
        timestamp: new Date(),
        action,
      },
    ]);
  };

  const runMessageAction = async (message: Message) => {
    if (!message.action || message.actionDone) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, actionDone: true } : m)),
    );
    try {
      await message.action.run();
    } catch (e) {
      appendAssistantMessage(`Action failed: ${(e as Error).message}`);
    }
  };

  const sendMessage = async (message: string, isRetry = false) => {
    if (!message.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: message,
      timestamp: new Date(),
    };

    if (!isRetry) {
      setMessages((prev) => [...prev, userMessage]);
    }
    setInputMessage("");
    setIsLoading(true);
    setConnectionStatus("checking");

    try {
      // Build comprehensive context from all business data
      const businessContext = buildBusinessContext();

      // Action intents first — documents, data export, downloads, print,
      // send, analyze, forecast, and general questions. If one matched, its
      // response IS the answer (no generic Q&A fallback).
      const actionResult = await tryActionIntents(message);

      // Generate local AI response — no artificial delay
      let finalResponse: string;
      let actionForMessage: MessageAction | undefined;
      if (actionResult) {
        finalResponse = actionResult.text;
        actionForMessage = actionResult.action;
      } else {
        const response = generateLocalResponse(message, businessContext);

        let navNote = "";
        const lower = message.toLowerCase();
        const openMatch = lower.match(
          /(?:open|go to|goto|show me|take me to|launch)\s+(.+)/,
        );
        const watchMatch = lower.match(/(?:watch|play|stream)\s+(.+)/);
        const tabs: { id: string; name: string }[] =
          businessContext.availableTabs || [];
        const subTargets: SubTabEntry[] = SITE_SUBTABS;
        if (watchMatch && !openMatch) {
          const title = watchMatch[1].trim();
          navigateToTab("news", { subTab: "movies", movieTitle: title });
          navNote = `\n\n🎬 Opening the **Movies** tab and searching for "${title}"…`;
        } else if (openMatch) {
          const target = openMatch[1].trim().replace(/[.!?]+$/, "");
          // Sub-tab match first (more specific), then top-level tab match.
          const sub = subTargets.find(
            (e) =>
              e.label.toLowerCase() === target ||
              e.subId.toLowerCase() === target ||
              e.label.toLowerCase().includes(target) ||
              target.includes(e.label.toLowerCase()),
          );
          if (sub) {
            navigateToTab(sub.hostTab, { subTab: sub.subId });
            navNote = `\n\n↗️ Opening **${sub.label}** now…`;
          } else {
            const hit = tabs.find(
              (t) =>
                t.name?.toLowerCase() === target ||
                t.id.toLowerCase() === target ||
                t.name?.toLowerCase().includes(target) ||
                target.includes(t.name?.toLowerCase() || "~~~"),
            );
            if (hit) {
              switchToTab(hit.id);
              navNote = `\n\n↗️ Opening **${hit.name}** now…`;
            }
          }
        }
        finalResponse = response + navNote;
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: finalResponse,
        timestamp: new Date(),
        action: actionForMessage,
        suggestions: [
          "Today's Sales",
          "Outstanding Debts",
          "Business Overview",
          "Fuel Prices",
        ],
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setConnectionStatus("connected");
      setLastFailedMessage(null);
      setRetryCount(0);

      // Speak the response if speech is enabled
      if (speechEnabled && synthRef.current) {
        speak(finalResponse);
      }
    } catch (error) {
      console.error("Chat error:", error);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content:
          "I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
        isError: true,
        canRetry: true,
        suggestions: [
          "What are today's sales?",
          "Show outstanding debts",
          "Business overview",
        ],
      };
      setMessages((prev) => [...prev, errorMessage]);
      setConnectionStatus("error");
      setLastFailedMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  const retryLastMessage = () => {
    if (lastFailedMessage && retryCount < 3) {
      setRetryCount((prev) => prev + 1);
      // Remove the last error message before retrying
      setMessages((prev) => prev.filter((_, idx) => idx !== prev.length - 1));
      sendMessage(lastFailedMessage, true);
    }
  };

  const speak = (text: string) => {
    if (!synthRef.current || !speechEnabled) return;

    // Cancel any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 0.8;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthRef.current.speak(utterance);
  };

  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputMessage);
  };

  const clearChat = () => {
    setMessages([
      {
        id: "1",
        type: "assistant",
        content:
          "Chat cleared! I still have access to all your business data. What would you like to know?",
        timestamp: new Date(),
      },
    ]);
  };

  // Quick action buttons
  const quickActions = [
    {
      label: "Today's Sales",
      query:
        "Give me a summary of today's sales including total litres and amount for petrol and diesel",
    },
    {
      label: "Outstanding Debts",
      query:
        "Show me the top customers with outstanding debts and the total debt amount",
    },
    {
      label: "Business Overview",
      query:
        "Give me a complete overview of my fuel station business including sales, debts, and recent transactions",
    },
    {
      label: "M-PESA Summary",
      query: "Summarize my recent M-PESA transactions",
    },
    {
      label: "Forecast Sales",
      query: "Forecast my sales for the next 7 days",
    },
    {
      label: "My Documents",
      query: "List my documents",
    },
    {
      label: "Analyze Sales",
      query: "Analyze my sales trend",
    },
  ];

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 md:bottom-6 right-4 md:right-6 w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-gray-900 dark:text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center z-30 md:z-50 group"
        title="Open AI Assistant"
      >
        <Sparkles size={24} />
        <div
          className={`absolute -top-2 -right-2 w-3 h-3 rounded-full animate-pulse ${
            connectionStatus === "error" ? "bg-red-500" : "bg-green-500"
          }`}
        ></div>
        <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          AI Assistant (Gemini)
        </div>
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-20 md:bottom-6 right-2 md:right-6 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 z-50 transition-all duration-300 ${
        isMinimized
          ? "w-80 h-16"
          : "w-[calc(100vw-16px)] md:w-[420px] h-[70vh] md:h-[650px] max-h-[650px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600 bg-gradient-to-r from-blue-600 to-purple-600 text-gray-900 dark:text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Sparkles size={20} />
          <span className="font-semibold">FuelPro AI</span>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
            Gemini
          </span>
          <div
            className={`w-2 h-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-400 animate-pulse"
                : connectionStatus === "checking"
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-red-400"
            }`}
            title={
              connectionStatus === "connected"
                ? "Connected"
                : connectionStatus === "checking"
                  ? "Processing..."
                  : "Connection issue"
            }
          ></div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSpeechEnabled(!speechEnabled)}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title={speechEnabled ? "Disable voice" : "Enable voice"}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {isSpeaking && (
            <button
              onClick={stopSpeaking}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              title="Stop speaking"
            >
              <VolumeX size={16} />
            </button>
          )}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title={isMinimized ? "Maximize" : "Minimize"}
          >
            {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              // Reset messages to initial state when closing
              setMessages([
                {
                  id: "1",
                  type: "assistant",
                  content: `Hello! I'm your FuelPro AI Assistant — wired into all your real station data. I can answer questions, analyze & forecast sales, list and download your documents, export reports and full data backups, print summaries, and send them by email or WhatsApp. Say "help" for the full list!`,
                  timestamp: new Date(),
                },
              ]);
            }}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Quick Actions */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-white dark:bg-gray-900/50">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {quickActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(action.query)}
                  disabled={isLoading}
                  className="flex-shrink-0 px-2.5 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 transition-colors disabled:opacity-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto h-[calc(650px-190px)] space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.type === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.type === "user"
                      ? "bg-blue-600 text-gray-900 dark:text-white"
                      : message.isError
                        ? "bg-amber-500 text-gray-900 dark:text-white"
                        : "bg-gradient-to-r from-purple-600 to-blue-600 text-gray-900 dark:text-white"
                  }`}
                >
                  {message.type === "user" ? (
                    <User size={16} />
                  ) : (
                    <Bot size={16} />
                  )}
                </div>
                <div
                  className={`max-w-[80%] ${message.type === "user" ? "text-right" : ""}`}
                >
                  <div
                    className={`inline-block p-3 rounded-2xl text-sm ${
                      message.type === "user"
                        ? "bg-blue-600 text-gray-900 dark:text-white rounded-br-sm"
                        : message.isError
                          ? "bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200 rounded-bl-sm"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-sm"
                    }`}
                  >
                    {message.content.split("\n").map((line, i) => (
                      <React.Fragment key={i}>
                        {line}
                        {i < message.content.split("\n").length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Retry button and suggestions for error messages */}
                  {message.isError && message.canRetry && (
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={retryLastMessage}
                        disabled={isLoading || retryCount >= 3}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-full disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw
                          size={12}
                          className={isLoading ? "animate-spin" : ""}
                        />
                        {retryCount >= 3 ? "Max retries reached" : "Try Again"}
                      </button>
                    </div>
                  )}

                  {/* One-shot action button (e.g. confirm a send) */}
                  {message.action && (
                    <div className="mt-2">
                      <button
                        onClick={() => runMessageAction(message)}
                        disabled={message.actionDone || isLoading}
                        className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-full disabled:opacity-50 transition-colors"
                      >
                        {message.actionDone ? "✓ Done" : message.action.label}
                      </button>
                    </div>
                  )}

                  {/* Suggestions after error or successful response */}
                  {message.suggestions && message.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.suggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => sendMessage(suggestion)}
                          disabled={isLoading}
                          className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-gray-200 dark:border-gray-600 rounded-full transition-colors disabled:opacity-50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}

                  <div
                    className={`text-xs text-gray-500 mt-1 ${message.type === "user" ? "text-right" : ""}`}
                  >
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-gray-900 dark:text-white flex items-center justify-center">
                  <RefreshCw size={16} className="animate-spin" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-2xl rounded-bl-sm">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <span>Analyzing your data</span>
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                      <div
                        className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={clearChat}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
              >
                <RefreshCw size={12} /> Clear Chat
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                |
              </span>
              <span
                className={`text-xs flex items-center gap-1 ${
                  connectionStatus === "connected"
                    ? "text-green-600 dark:text-green-400"
                    : connectionStatus === "checking"
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-red-600 dark:text-red-400"
                }`}
              >
                {connectionStatus === "connected" && "● Connected to your data"}
                {connectionStatus === "checking" && "○ Processing..."}
                {connectionStatus === "error" && (
                  <>
                    <AlertCircle size={12} />
                    Connection issue
                  </>
                )}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={`Ask about sales, debts, ${mobilePayTerm.toLowerCase()}, payroll...`}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm"
                  disabled={isLoading}
                />
                {recognitionRef.current && (
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startListening}
                    className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 rounded-full transition-colors ${
                      isListening
                        ? "bg-red-500 text-gray-900 dark:text-white animate-pulse"
                        : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                    }`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!inputMessage.trim() || isLoading}
                className="p-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-gray-900 dark:text-white rounded-full hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                title="Send message"
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
