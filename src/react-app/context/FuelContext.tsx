import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
// Unified pricing - single source of truth for all fuel prices
import {
  KENYA_BASE_PRICES,
  getCountryPrice,
  normalizeFuelType,
} from "@/react-app/config/pricing";
// Cross-device cloud storage (Supabase app_kv-backed) — replaces /api/user-data
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  getDetectedCountryCode,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
// Fuel interlink bus — in-device pub/sub for instant price/type propagation
import {
  emitFuelPriceChange,
  onFuelPriceChange,
} from "@/react-app/lib/fuel-interlink-bus";
import { recordPriceChange } from "@/react-app/lib/price-history";
import type { PriceSchedule } from "@/react-app/lib/forecourt-features";
import type { CustomFuelType } from "@/react-app/components/FuelTypesManager";

// Resolve default prices from the detected country (world-wide, not Kenya-only)
const _detectedCC = (() => {
  try {
    return getDetectedCountryCode();
  } catch {
    return "";
  }
})();
const _detectedPrices = _detectedCC
  ? getCountryPrice(_detectedCC, "petrol")
  : null;
const DEFAULT_PMS_PRICE = _detectedPrices?.price ?? KENYA_BASE_PRICES.petrol;
const DEFAULTAGO_PRICE = _detectedCC
  ? getCountryPrice(_detectedCC, "diesel").price
  : KENYA_BASE_PRICES.diesel;

/**
 * Build the station-scoped compact-blob cloud key. Each station gets its own
 * isolated FuelContext blob so companyData, salesHistory, debtHistory, etc.
 * differ per station. Falls back to the legacy user-scoped key (no station
 * segment) when there is no current station (Combined View, or pre-station
 * migration), preserving backward compatibility.
 */
function compactCloudKey(
  userId: string | undefined,
  stationId: string | undefined,
): string {
  const uid = userId ? `user_${userId}` : "guest";
  return stationId ? `${uid}_${stationId}_compact` : `${uid}_compact`;
}

// Types
export interface Station {
  id: string;
  name: string;
  location?: string;
  createdAt: string;
}

export interface CompanyData {
  name: string;
  poBox: string;
  contacts: string;
  email: string;
  logo: string;
  currency: string;
  // Explicit currency CODE (e.g. "USD") stored separately from `currency`
  // (which historically held a symbol like "$" / "KSh"). Resolved at display
  // time via resolveCurrencySymbol() so cross-currency reloads stay correct.
  companyCurrency?: string;
  // ISO country code for the station (e.g. "US", "KE") used for tax-regime
  // detection. `county` below is the sub-national region (Kenya county).
  country?: string;
  bankName: string;
  branchName: string;
  accountHolder: string;
  accountNumber: string;
  // Tax compliance configuration (KRA eTIMS/ETR in Kenya, VAT/Tax ID elsewhere)
  kraPin: string;
  vatRegNo: string;
  physicalAddress: string;
  county: string;
  town: string;
  etrSerialNo: string;
  cuSerialNo: string;
  etrInvoicePrefix: string;
  // KRA eTIMS OSCU credentials (Kenya only) — obtained from the KRA eTIMS
  // portal. When present, POS sales are ACTUALLY submitted to KRA and the
  // receipt carries the real KRA control-unit signature instead of a local
  // stand-in.
  etimsBhfId?: string; // branch id ("00" for HQ)
  etimsCmcKey?: string; // CMC key from the eTIMS portal
  etimsEnvironment?: "sandbox" | "production";
}

export interface DeliveryColumn {
  key: string;
  label: string;
  editable: boolean;
}

export interface DeliveryRow {
  [key: string]: string | number;
  date: string;
  reg: string;
  fuel: string;
  litres: number;
  amount: number;
  name: string;
  debt: number;
}

export interface DeliveryData {
  columns: DeliveryColumn[];
  rows: DeliveryRow[];
  totals: {
    totalSupplied: number;
    totalPayments: number;
    balanceDue: number;
  };
}

export interface InvoiceItem {
  [key: string]: string | number;
  desc: string;
  qty: number;
  price: number;
  total: number;
}

export interface InvoiceSettings {
  quantityLabel: string;
}

export interface Pump {
  [key: string]: string | number;
  id: string;
  openingKsh: number;
  closingKsh: number;
  openingL: number;
  closingL: number;
  salesL: number;
  salesKsh: number;
}

export interface Expense {
  desc: string;
  amount: number;
}

export interface OffloadingRecord {
  id: string;
  date: string;
  time: string;
  truckReg: string;
  driverName: string;
  // Widened from "PMS" | "AGO" to string so the offloading form can capture
  // ANY station fuel type (kerosene/IK, LPG, V-Power, premium diesel, CNG…).
  // The previous 2-value union silently dropped/blocked every non-PMS/AGO fuel
  // type and made the totals (which only counted PMS + AGO) undercount stock.
  fuelType: string;
  quantity: number;
  rate: number;
  totalAmount: number;
  supplier: string;
  invoiceNo: string;
  remarks: string;
}

export interface TabVisibility {
  dashboard: boolean;
  delivery: boolean;
  offloading: boolean;
  invoice: boolean;
  debt: boolean;
  sales: boolean;
  reports: boolean;
  mpesa: boolean;
  payroll: boolean;
  data: boolean;
  documents: boolean;
  communication: boolean;
  livetransaction: boolean;
  fuelsalesreport: boolean;
  pos: boolean;
  customers: boolean; // Customer loyalty tab
}

export interface TabConfiguration {
  id: string;
  label: string;
  originalLabel: string;
  description: string;
  order: number;
  visible: boolean;
}

export interface ThemeSettings {
  colorScheme: string;
  customColors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export interface EmployeeData {
  id: string;
  name: string;
  phone: string;
  email: string;
  position: string;
  basicSalary: number;
  allowances: Record<string, number>;
  deductions: Record<string, number>;
  paymentMethod: string;
  isActive: boolean;
  dateJoined: string;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  period: string;
  basicSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  netSalary: number;
  paymentStatus: string;
  paymentDate?: string;
  notes?: string;
}

export interface MPESATransaction {
  id: string;
  date: string;
  time: string;
  type: string;
  amount: number;
  reference: string;
  description: string;
  balance: number;
  phoneNumber?: string;
  merchantCode?: string;
}

export interface ReportSettings {
  dateRange: {
    start: string;
    end: string;
  };
  reportType: string;
  includeGraphics: boolean;
  includeTables: boolean;
  customFilters: Record<string, any>;
}

export interface UserPreferences {
  language: string;
  dateFormat: string;
  timeFormat: string;
  currency: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  autoSave: boolean;
  autoBackup: boolean;
}

// Station-specific data structure for multi-station support
export interface StationData {
  companyData: CompanyData;
  pmsPumps: Pump[];
  agoPumps: Pump[];
  pmsTankOpening: number;
  pmsTankClosing: number;
  agoTankOpening: number;
  agoTankClosing: number;
  pmsPrice: number;
  agoPrice: number;
  offloadingRecords: OffloadingRecord[];
  salesHistory: Record<string, any>;
  employees: EmployeeData[];
}

export interface FuelState {
  theme: "light" | "dark";
  themeSettings: ThemeSettings;
  userPreferences: UserPreferences;
  // Multi-station support
  stations: Station[];
  currentStationId: string | null;
  // Station-specific data (keyed by stationId)
  stationData: Record<string, StationData>;
  companyData: CompanyData;
  signatures: {
    manager: string;
    director: string;
  };
  deliveryData: DeliveryData;
  invoiceItems: InvoiceItem[];
  invoiceSettings: InvoiceSettings;
  invoiceCounter: number;
  clients: Record<string, any>;
  invoices: Record<string, any>;
  debtHistory: Record<string, any>;
  salesHistory: Record<string, any>;
  pmsPumps: Pump[];
  agoPumps: Pump[];
  /**
   * Dynamic per-fuel-type pump store keyed by canonical fuel type
   * ("petrol" | "diesel" | "kerosene" | "vpower" | "premium_diesel" |
   * "lpg" | "cng") plus any custom raw fuel-type name. This is the single
   * source of truth for pumps of fuels beyond PMS/AGO; the legacy
   * pmsPumps/agoPumps arrays are kept in sync for backward compatibility
   * (they mirror the "petrol"/"diesel" entries here).
   */
  fuelPumpsByType: Record<string, Pump[]>;
  /** Dynamic per-fuel-type prices keyed by canonical fuel type. */
  fuelPricesByType: Record<string, number>;
  /**
   * Dynamic per-fuel-type tank inventory (opening/closing litres) keyed by
   * canonical fuel type. Replaces the hardcoded PMS/AGO-only tank fields for
   * stations with other fuels (Kerosene, V-Power, LPG, etc.).
   */
  fuelTankValuesByType: Record<string, { opening: number; closing: number }>;
  expenses: Expense[];
  tillPayment: number;
  salesDate: string;
  shift: string;
  pmsTankOpening: number;
  pmsTankClosing: number;
  agoTankOpening: number;
  agoTankClosing: number;
  pmsPrice: number;
  agoPrice: number;
  petrolPrice: number;
  dieselPrice: number;
  kerosenePrice: number;
  fuelTypes: CustomFuelType[];
  deliveredTo: string;
  totalOrder: string;
  deliveryYear: number;
  offloadingRecords: OffloadingRecord[];
  tabVisibility: TabVisibility;
  tabConfigurations: TabConfiguration[];
  employees: EmployeeData[];
  payrollRecords: PayrollRecord[];
  mpesaTransactions: MPESATransaction[];
  reportSettings: ReportSettings;
  chatHistory: Array<{
    id: string;
    message: string;
    response: string;
    timestamp: string;
  }>;
  dataBackups: Array<{
    id: string;
    name: string;
    date: string;
    size: string;
    data: any;
  }>;
}

type FuelAction =
  | { type: "SET_THEME"; payload: "light" | "dark" }
  | { type: "SET_THEME_SETTINGS"; payload: ThemeSettings }
  | { type: "SET_USER_PREFERENCES"; payload: UserPreferences }
  | { type: "SET_COMPANY_DATA"; payload: CompanyData }
  | { type: "SET_SIGNATURES"; payload: { manager?: string; director?: string } }
  | { type: "SET_DELIVERY_DATA"; payload: DeliveryData }
  | { type: "SET_INVOICE_ITEMS"; payload: InvoiceItem[] }
  | { type: "SET_INVOICE_SETTINGS"; payload: InvoiceSettings }
  | { type: "SET_INVOICE_COUNTER"; payload: number }
  | { type: "SET_CLIENTS"; payload: Record<string, any> }
  | { type: "SET_INVOICES"; payload: Record<string, any> }
  | { type: "SET_DEBT_HISTORY"; payload: Record<string, any> }
  | { type: "SET_SALES_HISTORY"; payload: Record<string, any> }
  | { type: "SET_PMS_PUMPS"; payload: Pump[] }
  | { type: "SET_AGO_PUMPS"; payload: Pump[] }
  | {
      type: "SET_FUEL_PUMPS_BY_TYPE";
      payload: Record<string, Pump[]>;
    }
  | { type: "ADD_FUEL_PUMP"; payload: { fuelType: string; pump: Pump } }
  | { type: "UPDATE_FUEL_PUMP"; payload: { fuelType: string; pump: Pump } }
  | { type: "REMOVE_FUEL_PUMP"; payload: { fuelType: string; pumpId: string } }
  | {
      type: "SET_FUEL_PRICES_BY_TYPE";
      payload: Record<string, number>;
    }
  | { type: "SET_EXPENSES"; payload: Expense[] }
  | { type: "SET_TILL_PAYMENT"; payload: number }
  | { type: "SET_SALES_DATE"; payload: string }
  | { type: "SET_SHIFT"; payload: string }
  | {
      type: "SET_TANK_VALUES";
      payload: {
        pmsTankOpening?: number;
        pmsTankClosing?: number;
        agoTankOpening?: number;
        agoTankClosing?: number;
        fuelTankValuesByType?: Record<
          string,
          { opening: number; closing: number }
        >;
      };
    }
  | {
      type: "SET_PRICES";
      payload: {
        pmsPrice?: number;
        agoPrice?: number;
        petrolPrice?: number;
        dieselPrice?: number;
      };
    }
  | {
      type: "SET_DELIVERY_INFO";
      payload: {
        deliveredTo?: string;
        totalOrder?: string;
        deliveryYear?: number;
      };
    }
  | { type: "SET_OFFLOADING_RECORDS"; payload: OffloadingRecord[] }
  | { type: "SET_TAB_VISIBILITY"; payload: TabVisibility }
  | { type: "SET_TAB_CONFIGURATIONS"; payload: TabConfiguration[] }
  | { type: "SET_EMPLOYEES"; payload: EmployeeData[] }
  | { type: "SET_PAYROLL_RECORDS"; payload: PayrollRecord[] }
  | { type: "SET_MPESA_TRANSACTIONS"; payload: MPESATransaction[] }
  | { type: "SET_REPORT_SETTINGS"; payload: ReportSettings }
  | {
      type: "SET_CHAT_HISTORY";
      payload: Array<{
        id: string;
        message: string;
        response: string;
        timestamp: string;
      }>;
    }
  | {
      type: "SET_DATA_BACKUPS";
      payload: Array<{
        id: string;
        name: string;
        date: string;
        size: string;
        data: any;
      }>;
    }
  | { type: "LOAD_FROM_STORAGE"; payload: Partial<FuelState> }
  // Station management actions
  | { type: "ADD_STATION"; payload: Station }
  | {
      type: "UPDATE_STATION";
      payload: { id: string; name: string; location?: string };
    }
  | { type: "DELETE_STATION"; payload: string }
  | { type: "SET_CURRENT_STATION"; payload: string }
  | { type: "SET_STATIONS"; payload: Station[] };

const initialState: FuelState = {
  theme: "dark",
  themeSettings: {
    colorScheme: "Ocean Blue",
    customColors: {
      primary: "rgb(59, 130, 246)",
      secondary: "rgb(219, 234, 254)",
      accent: "rgb(16, 185, 129)",
    },
  },
  userPreferences: {
    language: "en",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    currency: getCurrencySymbol(),
    notifications: {
      email: true,
      push: true,
      sms: false,
    },
    autoSave: true,
    autoBackup: true,
  },
  // Multi-station support - initialize with default station
  stations: [
    {
      id: "default_station",
      name: "Main Station",
      location: "",
      createdAt: new Date().toISOString(),
    },
  ],
  currentStationId: "default_station",
  stationData: {},
  companyData: {
    name: "",
    poBox: "",
    contacts: "",
    email: "",
    logo: "",
    currency: getCurrencySymbol(),
    bankName: "",
    branchName: "",
    accountHolder: "",
    accountNumber: "",
    kraPin: "",
    vatRegNo: "",
    physicalAddress: "",
    county: "",
    town: "",
    etrSerialNo: "",
    cuSerialNo: "",
    etrInvoicePrefix: "INV",
  },
  signatures: {
    manager: "",
    director: "",
  },
  deliveryData: {
    columns: [
      { key: "date", label: "Date", editable: true },
      { key: "reg", label: "Reg No", editable: true },
      { key: "fuel", label: "Fuel Type", editable: true },
      { key: "litres", label: "Litres", editable: true },
      {
        key: "amount",
        label: `Amount (${getCurrencySymbol()})`,
        editable: true,
      },
      { key: "name", label: "Name", editable: true },
      {
        key: "debt",
        label: `Balance/Debt (${getCurrencySymbol()})`,
        editable: true,
      },
    ],
    rows: [],
    totals: {
      totalSupplied: 0,
      totalPayments: 0,
      balanceDue: 0,
    },
  },
  invoiceItems: [],
  invoiceSettings: {
    quantityLabel: "Qty (DAYS)",
  },
  invoiceCounter: 1,
  clients: {},
  invoices: {},
  debtHistory: {},
  salesHistory: {},
  pmsPumps: [],
  agoPumps: [],
  fuelPumpsByType: {},
  fuelPricesByType: {},
  fuelTankValuesByType: {},
  expenses: [],
  tillPayment: 0,
  salesDate: new Date().toISOString().split("T")[0],
  shift: "Day",
  pmsTankOpening: 0,
  pmsTankClosing: 0,
  agoTankOpening: 0,
  agoTankClosing: 0,
  pmsPrice: DEFAULT_PMS_PRICE,
  agoPrice: DEFAULTAGO_PRICE,
  petrolPrice: DEFAULT_PMS_PRICE,
  dieselPrice: DEFAULTAGO_PRICE,
  kerosenePrice: 0,
  fuelTypes: [],
  deliveredTo: "",
  totalOrder: "",
  deliveryYear: new Date().getFullYear(), // Auto-set to current year
  offloadingRecords: [],
  tabVisibility: {
    dashboard: true,
    delivery: true,
    offloading: true,
    invoice: true,
    debt: true,
    sales: true,
    reports: true,
    mpesa: true,
    payroll: true,
    data: true,
    documents: true,
    communication: true,
    livetransaction: true,
    fuelsalesreport: true,
    pos: true,
    customers: true, // CRITICAL: Enable loyalty/customers tab
  },
  tabConfigurations: [
    // ─── DAILY OPERATIONS TABS (Most Frequently Used) ───
    {
      id: "dashboard",
      label: "Dashboard",
      originalLabel: "Dashboard",
      description: "Main overview and statistics",
      order: 0,
      visible: true,
    },
    {
      id: "pos",
      label: "Point of Sale",
      originalLabel: "Point of Sale",
      description: "Quick sales with receipt printing",
      order: 1,
      visible: true,
    },
    {
      id: "sales",
      label: "Sales Tracking",
      originalLabel: "Sales Tracking",
      description: "Monitor pump sales and daily operations",
      order: 2,
      visible: true,
    },
    {
      id: "livetransaction",
      label: "Live Transaction",
      originalLabel: "Live Transaction",
      description: "Real-time payment monitoring",
      order: 3,
      visible: true,
    },
    {
      id: "offloading",
      label: "Fuel Offloading",
      originalLabel: "Fuel Offloading",
      description: "Record fuel received from suppliers",
      order: 4,
      visible: true,
    },
    {
      id: "delivery",
      label: "Fuel Statement Report",
      originalLabel: "Delivery Tracker",
      description: "Track fuel deliveries to customers",
      // Deliveries happen daily; Stock Management is weekly/periodic, so
      // Delivery outranks it in the day-to-day ordering.
      order: 5,
      visible: true,
    },
    {
      id: "inventory",
      label: "Stock Management",
      originalLabel: "Inventory",
      description:
        "Products catalog, stock adjustments, transfers, counts, wastage & auto-reorders",
      order: 6,
      visible: true,
    },
    {
      id: "fuelsalesreport",
      label: "Fuel Sales Report",
      originalLabel: "Fuel Sales Report",
      description: "Monthly fuel sales reporting",
      order: 7,
      visible: true,
    },
    // ─── REGULAR MANAGEMENT TABS (Frequently Used) ───
    {
      id: "invoice",
      label: "Invoice",
      originalLabel: "Invoice",
      description: "Generate & manage customer invoices and sales invoices",
      order: 8,
      visible: true,
    },
    {
      id: "credit",
      label: "Credit",
      originalLabel: "Credit",
      description: "Manage customer credit accounts",
      order: 9,
      visible: true,
    },
    {
      id: "customers",
      label: "Customers",
      originalLabel: "Customers",
      description: "Customer loyalty & rewards program",
      order: 10,
      visible: true,
    },
    {
      id: "mpesa",
      label: "M-PESA Analyzer",
      originalLabel: "M-PESA Analyzer",
      description: "Analyze mobile money transactions",
      order: 11,
      visible: true,
    },
    {
      id: "payroll",
      label: "Payroll System",
      originalLabel: "Payroll System",
      description: "Manage employee payments",
      order: 12,
      visible: true,
    },
    {
      id: "suppliers",
      label: "Supplier Management",
      originalLabel: "Supplier Management",
      description: "Manage fuel suppliers, purchase orders & purchases",
      order: 13,
      visible: true,
    },
    {
      id: "expenses",
      label: "Expenses",
      originalLabel: "Expenses",
      description: "Track operational expenses & approvals",
      order: 14,
      visible: true,
    },
    {
      id: "fueltypes",
      label: "Fuel Type Manager",
      originalLabel: "Fuel Type Manager",
      description:
        "Manage fuel products, pump settings, price board & quality testing",
      order: 15,
      visible: true,
    },
    {
      id: "team",
      label: "Team Manager",
      originalLabel: "Team Manager",
      description: "Invite & manage team access and shift scheduling",
      order: 16,
      visible: true,
    },
    {
      id: "maintenance",
      label: "Maintenance",
      originalLabel: "Maintenance",
      description: "Equipment maintenance & servicing schedules",
      order: 17,
      visible: true,
    },
    // ─── ANALYTICS & REPORTING TABS (Regularly Used) ───
    {
      id: "reports",
      label: "Reports Center",
      originalLabel: "Reports Center",
      description: "Generate business reports and analytics",
      order: 18,
      visible: true,
    },
    {
      id: "analytics",
      label: "Analytics",
      originalLabel: "Analytics",
      description: "Predictions, trends & business intelligence",
      order: 19,
      visible: true,
    },
    {
      id: "audit",
      label: "Audit Trail",
      originalLabel: "Audit Trail",
      description: "Complete activity log for compliance",
      order: 20,
      visible: true,
    },
    {
      id: "pumpmapping",
      label: "Pump Mapping V1",
      originalLabel: "Pump Mapping V1",
      description: "AI-powered pump ledger parsing & extraction",
      order: 21,
      visible: true,
    },
    // ─── ADMINISTRATIVE TABS (Occasionally Used) ───
    {
      id: "communication",
      label: "Communication",
      originalLabel: "Communication",
      description: "Client relationship management",
      order: 22,
      visible: true,
    },
    {
      id: "documents",
      label: "Document Center",
      originalLabel: "Document Center",
      description: "Smart document management & format conversion",
      order: 23,
      visible: true,
    },
    {
      id: "data",
      label: "Data Manager",
      originalLabel: "Data Manager",
      description: "Backup, restore & cloud sync",
      order: 24,
      visible: true,
    },
    {
      id: "integration",
      label: "Integration Hub",
      originalLabel: "Integration Hub",
      description:
        "Country-specific integrations & payment setup (M-PESA, Kopo Kopo, KRA, banks)",
      order: 25,
      visible: true,
    },
    {
      id: "regional",
      label: "Compliance",
      originalLabel: "Compliance",
      description:
        "Country-specific regulations & compliance for all 195+ countries",
      order: 26,
      visible: true,
    },
    {
      id: "news",
      label: "News",
      originalLabel: "News",
      description: "Fuel industry news, regulations, and price updates",
      order: 27,
      visible: true,
    },
    // ─── SPECIALIZED TABS (Rarely Used) ───
    {
      id: "terminal",
      label: "Terminal Sessions",
      originalLabel: "Terminal Sessions",
      description: "POS terminal session open/close & reconciliation",
      order: 28,
      visible: true,
    },
    {
      id: "automation",
      label: "Automation Engine",
      originalLabel: "Automation Engine",
      description:
        "The site's brain — auto-reorder, auto-sync, auto-refresh, activity log",
      order: 29,
      visible: true,
    },
    {
      id: "price-finder",
      label: "Fuel Price Finder",
      originalLabel: "Fuel Price Finder",
      description:
        "GPS-based nearby fuel price locator & auto fuel price comparison",
      order: 30,
      visible: true,
    },
    {
      id: "settings",
      label: "Settings",
      originalLabel: "Settings",
      description:
        "Admin control center — manage tabs, features, integrations, branding, security & system config",
      order: 31,
      visible: true,
    },
  ],
  employees: [],
  payrollRecords: [],
  mpesaTransactions: [],
  reportSettings: {
    dateRange: {
      start: new Date().toISOString().split("T")[0],
      end: new Date().toISOString().split("T")[0],
    },
    reportType: "daily",
    includeGraphics: true,
    includeTables: true,
    customFilters: {},
  },
  chatHistory: [],
  dataBackups: [],
};

/**
 * Merge two companyData objects so an incoming EMPTY string/zero value never
 * overwrites a non-empty existing value. This prevents a stale cloud/local
 * blob (e.g. one where `name: ""` because it was saved before the field
 * existed) from clobbering a populated in-memory value on reload or station
 * switch. For each field, the incoming value wins ONLY when it is truthy
 * (non-empty/non-zero); otherwise the existing value is kept.
 */
function mergeCompanyData(
  existing: CompanyData,
  incoming?: Partial<CompanyData> | null,
): CompanyData {
  if (!incoming) return { ...existing };
  const merged = { ...existing };
  (Object.keys(incoming) as (keyof CompanyData)[]).forEach((key) => {
    const inc = incoming[key];
    // Always let falsy incoming values fall back to the existing value,
    // EXCEPT `currency` (default "KSh") and `etrInvoicePrefix` (default
    // "INV") which are legitimately short strings we still want to carry.
    if (inc !== undefined && inc !== null && inc !== "") {
      (merged as Record<keyof CompanyData, unknown>)[key] = inc;
    }
  });
  return merged;
}

/**
 * Count how many invoice line items carry REAL content (non-empty
 * description OR non-zero price). Used by LOAD_FROM_STORAGE to decide
 * whether an incoming items blob should overwrite the current in-progress
 * draft: a stale all-empty-items blob (default rows) must not clobber a
 * draft the user is actively editing.
 */
function itemsHaveContent(items?: InvoiceItem[] | null): number {
  if (!items || !Array.isArray(items)) return 0;
  return items.filter(
    (it) => (it.desc && it.desc.trim() !== "") || it.price > 0,
  ).length;
}

/**
 * Tab IDs that have been DEPRECATED as top-level tabs and merged into parent
 * components as inner sub-tabs. A stale cloud blob may still list these as
 * standalone tabs, causing duplicates in the nav bar. This set is used to
 * filter them out whenever tabConfigurations are loaded from storage/cloud.
 */
export const DEPRECATED_TOP_LEVEL_TAB_IDS = new Set([
  "priceboard", // merged into Fuel Type Manager
  "shifts", // merged into Team Manager
  "quality", // merged into Fuel Type Manager
  "docconverter", // merged into Document Center
  "purchases", // merged into Supplier Management
  "sales-invoices", // merged into Invoice
  "debt", // merged into Credit Management
  "integrations-settings", // merged into Integration Hub
]);

/**
 * Sanitize tabConfigurations loaded from storage/cloud:
 * 1. Remove any tab whose id is in DEPRECATED_TOP_LEVEL_TAB_IDS.
 * 2. Merge in any NEW tabs from initialState that the blob is missing
 *    (so newly-added tabs appear for existing users).
 * 3. Preserve the user's customizations (visibility, order, label) for
 *    tabs that still exist.
 */
function sanitizeTabConfigs(
  saved: TabConfiguration[] | undefined,
): TabConfiguration[] {
  const authoritative = initialState.tabConfigurations;
  if (!saved || !Array.isArray(saved) || saved.length === 0) {
    return authoritative;
  }
  // Filter out deprecated tabs from the saved list.
  const filtered = saved.filter(
    (t) => t && t.id && !DEPRECATED_TOP_LEVEL_TAB_IDS.has(t.id),
  );
  // Build a map of authoritative tab ids for quick lookup.
  const authoritativeIds = new Set(authoritative.map((t) => t.id));
  // Keep saved customizations for tabs that still exist (not deprecated).
  const savedMap = new Map(filtered.map((t) => [t.id, t]));
  // Merge: start with authoritative (ensures new tabs are present), then
  // overlay saved customizations (visibility/order) for tabs that exist.
  const merged = authoritative.map((t) => {
    const savedTab = savedMap.get(t.id);
    return savedTab
      ? {
          ...t,
          visible: savedTab.visible ?? t.visible,
          order: savedTab.order ?? t.order,
        }
      : t;
  });
  // Also include any saved tabs that are NOT in authoritative (custom user tabs),
  // as long as they're not deprecated.
  const extraCustom = filtered.filter((t) => !authoritativeIds.has(t.id));
  return [...merged, ...extraCustom];
}

function fuelReducer(state: FuelState, action: FuelAction): FuelState {
  switch (action.type) {
    case "SET_THEME":
      return { ...state, theme: action.payload };
    case "SET_THEME_SETTINGS":
      return { ...state, themeSettings: action.payload };
    case "SET_USER_PREFERENCES":
      return { ...state, userPreferences: action.payload };
    case "SET_COMPANY_DATA":
      return { ...state, companyData: action.payload };
    case "SET_SIGNATURES":
      return {
        ...state,
        signatures: { ...state.signatures, ...action.payload },
      };
    case "SET_DELIVERY_DATA":
      return { ...state, deliveryData: action.payload };
    case "SET_INVOICE_ITEMS":
      return { ...state, invoiceItems: action.payload };
    case "SET_INVOICE_SETTINGS":
      return {
        ...state,
        invoiceSettings: { ...state.invoiceSettings, ...action.payload },
      };
    case "SET_INVOICE_COUNTER":
      return { ...state, invoiceCounter: action.payload };
    case "SET_CLIENTS":
      return { ...state, clients: action.payload };
    case "SET_INVOICES":
      return { ...state, invoices: action.payload };
    case "SET_DEBT_HISTORY":
      return { ...state, debtHistory: action.payload };
    case "SET_SALES_HISTORY":
      return { ...state, salesHistory: action.payload };
    case "SET_PMS_PUMPS":
      return {
        ...state,
        pmsPumps: action.payload,
        fuelPumpsByType: { ...state.fuelPumpsByType, petrol: action.payload },
      };
    case "SET_AGO_PUMPS":
      return {
        ...state,
        agoPumps: action.payload,
        fuelPumpsByType: { ...state.fuelPumpsByType, diesel: action.payload },
      };
    case "SET_FUEL_PUMPS_BY_TYPE": {
      const byType = { ...action.payload };
      // Keep legacy pmsPumps/agoPumps in sync with the petrol/diesel entries.
      const pms = byType.petrol ?? state.pmsPumps;
      const ago = byType.diesel ?? state.agoPumps;
      return {
        ...state,
        fuelPumpsByType: byType,
        pmsPumps: pms,
        agoPumps: ago,
      };
    }
    case "ADD_FUEL_PUMP": {
      const { fuelType, pump } = action.payload;
      const list = state.fuelPumpsByType[fuelType] ?? [];
      const next = [...list, pump];
      const byType = { ...state.fuelPumpsByType, [fuelType]: next };
      const updates: Partial<FuelState> = {};
      if (fuelType === "petrol") updates.pmsPumps = next;
      if (fuelType === "diesel") updates.agoPumps = next;
      return { ...state, fuelPumpsByType: byType, ...updates };
    }
    case "UPDATE_FUEL_PUMP": {
      const { fuelType, pump } = action.payload;
      const list = state.fuelPumpsByType[fuelType] ?? [];
      const next = list.map((p) => (p.id === pump.id ? pump : p));
      const byType = { ...state.fuelPumpsByType, [fuelType]: next };
      const updates: Partial<FuelState> = {};
      if (fuelType === "petrol") updates.pmsPumps = next;
      if (fuelType === "diesel") updates.agoPumps = next;
      return { ...state, fuelPumpsByType: byType, ...updates };
    }
    case "REMOVE_FUEL_PUMP": {
      const { fuelType, pumpId } = action.payload;
      const list = state.fuelPumpsByType[fuelType] ?? [];
      const next = list.filter((p) => p.id !== pumpId);
      const byType = { ...state.fuelPumpsByType, [fuelType]: next };
      const updates: Partial<FuelState> = {};
      if (fuelType === "petrol") updates.pmsPumps = next;
      if (fuelType === "diesel") updates.agoPumps = next;
      return { ...state, fuelPumpsByType: byType, ...updates };
    }
    case "SET_FUEL_PRICES_BY_TYPE": {
      const prices = { ...action.payload };
      // Mirror petrol/diesel into legacy scalars for backward compatibility.
      const updates: Partial<FuelState> = {};
      if (typeof prices.petrol === "number") {
        updates.pmsPrice = prices.petrol;
        updates.petrolPrice = prices.petrol;
      }
      if (typeof prices.diesel === "number") {
        updates.agoPrice = prices.diesel;
        updates.dieselPrice = prices.diesel;
      }
      if (typeof prices.kerosene === "number")
        updates.kerosenePrice = prices.kerosene;
      return {
        ...state,
        fuelPricesByType: { ...state.fuelPricesByType, ...prices },
        ...updates,
      };
    }
    case "SET_EXPENSES":
      return { ...state, expenses: action.payload };
    case "SET_TILL_PAYMENT":
      return { ...state, tillPayment: action.payload };
    case "SET_SALES_DATE":
      return { ...state, salesDate: action.payload };
    case "SET_SHIFT":
      return { ...state, shift: action.payload };
    case "SET_TANK_VALUES": {
      const { fuelTankValuesByType, ...rest } = action.payload;
      return {
        ...state,
        ...rest,
        ...(fuelTankValuesByType
          ? {
              fuelTankValuesByType: {
                ...state.fuelTankValuesByType,
                ...fuelTankValuesByType,
              },
            }
          : {}),
      };
    }
    case "SET_PRICES":
      return { ...state, ...action.payload };
    case "SET_DELIVERY_INFO":
      return { ...state, ...action.payload };
    case "SET_OFFLOADING_RECORDS":
      return { ...state, offloadingRecords: action.payload };
    case "SET_TAB_VISIBILITY":
      return { ...state, tabVisibility: action.payload };
    case "SET_TAB_CONFIGURATIONS":
      return { ...state, tabConfigurations: action.payload };
    case "SET_EMPLOYEES":
      return { ...state, employees: action.payload };
    case "SET_PAYROLL_RECORDS":
      return { ...state, payrollRecords: action.payload };
    case "SET_MPESA_TRANSACTIONS":
      return { ...state, mpesaTransactions: action.payload };
    case "SET_REPORT_SETTINGS":
      return { ...state, reportSettings: action.payload };
    case "SET_CHAT_HISTORY":
      return { ...state, chatHistory: action.payload };
    case "SET_DATA_BACKUPS":
      return { ...state, dataBackups: action.payload };
    case "LOAD_FROM_STORAGE": {
      const incoming = action.payload;
      // Protect the in-progress invoice draft (invoiceItems) from being
      // clobbered by a stale all-empty-items blob on reload/real-time echo.
      const incomingItems = incoming.invoiceItems;
      const currentItems = state.invoiceItems;
      const invoiceItems =
        incomingItems &&
        itemsHaveContent(incomingItems) >= itemsHaveContent(currentItems)
          ? incomingItems
          : currentItems;
      // Protect salesHistory, debtHistory, invoices, clients from being
      // clobbered by a stale/empty real-time echo. An incoming collection
      // wins ONLY when it has MORE entries than the current in-memory one;
      // otherwise keep the current data so a just-saved record survives a
      // delayed echo from an earlier (pre-save) cloud write.
      const mergeCollections = (
        current: Record<string, any> | any[] | undefined,
        inc: Record<string, any> | any[] | undefined,
      ) => {
        const curLen = Array.isArray(current)
          ? current.length
          : current
            ? Object.keys(current).length
            : 0;
        const incLen = Array.isArray(inc)
          ? inc.length
          : inc
            ? Object.keys(inc).length
            : 0;
        if (incLen >= curLen) return inc ?? current;
        return current ?? inc;
      };
      const salesHistory = mergeCollections(
        state.salesHistory,
        incoming.salesHistory,
      );
      const debtHistory = mergeCollections(
        state.debtHistory,
        incoming.debtHistory,
      );
      const invoices = mergeCollections(state.invoices, incoming.invoices);
      const clients = mergeCollections(state.clients, incoming.clients);
      const stationData =
        incoming.stationData && Object.keys(incoming.stationData).length > 0
          ? incoming.stationData
          : state.stationData;
      // PRICE STABILITY GUARD: fuel_types_config is the single source of truth
      // for fuel prices. The compact blob also stores legacy scalar prices
      // (pmsPrice/agoPrice/petrolPrice/dieselPrice) for backward compat, but
      // these can be STALE (an older device's value) or ZERO (a freshly-created
      // station that hasn't synced fuel_types_config yet). If we blindly apply
      // them via the `...incoming` spread, prices flicker/revert on every
      // refresh or cross-device load. Instead: keep the CURRENT price unless the
      // incoming value is a POSITIVE number that DIFFERS from current (i.e. a
      // genuine price update from another device). Never let a 0/undefined
      // incoming value overwrite a positive current price.
      const pickPrice = (
        currentVal: number | undefined,
        incomingVal: number | undefined,
      ): number => {
        const cur =
          typeof currentVal === "number" && currentVal > 0 ? currentVal : 0;
        const inc =
          typeof incomingVal === "number" && incomingVal > 0 ? incomingVal : 0;
        // If incoming is 0/stale, keep current (preserves fuel_types_config price).
        if (inc === 0) return cur;
        // Both positive: the fuel_types_config effect will reconcile; prefer the
        // incoming value only if it differs (a real remote edit).
        return inc;
      };
      return {
        ...state,
        ...incoming,
        companyData: mergeCompanyData(state.companyData, incoming.companyData),
        // Sanitize tabConfigurations: filter out deprecated top-level tabs that
        // were merged into parent components as sub-tabs (priceboard, shifts,
        // quality, docconverter). A stale cloud blob may still contain these,
        // causing duplicate tabs to appear in the nav bar. Always merge with the
        // authoritative initial state so new tabs are included and deprecated
        // ones are removed.
        tabConfigurations: sanitizeTabConfigs(
          incoming.tabConfigurations ?? state.tabConfigurations,
        ),
        // Stable prices — never revert to 0/stale values from the compact blob.
        pmsPrice: pickPrice(state.pmsPrice, incoming.pmsPrice),
        agoPrice: pickPrice(state.agoPrice, incoming.agoPrice),
        petrolPrice: pickPrice(state.petrolPrice, incoming.petrolPrice),
        dieselPrice: pickPrice(state.dieselPrice, incoming.dieselPrice),
        // Merge (not replace) the dynamic per-fuel-type stores so a stale
        // cloud blob can't wipe pumps/prices/tank-values the user just set.
        fuelPumpsByType: {
          ...state.fuelPumpsByType,
          ...(incoming.fuelPumpsByType || {}),
        },
        fuelPricesByType: {
          ...state.fuelPricesByType,
          ...(incoming.fuelPricesByType || {}),
        },
        fuelTankValuesByType: {
          ...state.fuelTankValuesByType,
          ...(incoming.fuelTankValuesByType || {}),
        },
        invoiceItems,
        salesHistory,
        debtHistory,
        invoices,
        clients,
        stationData,
      };
    }
    // Station management
    case "ADD_STATION":
      return {
        ...state,
        stations: [...state.stations, action.payload],
        stationData: {
          ...state.stationData,
          [action.payload.id]: {
            companyData: { ...state.companyData, name: action.payload.name },
            pmsPumps: [],
            agoPumps: [],
            pmsTankOpening: 0,
            pmsTankClosing: 0,
            agoTankOpening: 0,
            agoTankClosing: 0,
            pmsPrice: 0,
            agoPrice: 0,
            offloadingRecords: [],
            salesHistory: {},
            employees: [],
          },
        },
      };
    case "UPDATE_STATION":
      return {
        ...state,
        stations: state.stations.map((s) =>
          s.id === action.payload.id
            ? {
                ...s,
                name: action.payload.name,
                location: action.payload.location || s.location,
              }
            : s,
        ),
      };
    case "DELETE_STATION": {
      const deletedStationData = { ...state.stationData };
      delete deletedStationData[action.payload];
      return {
        ...state,
        stations: state.stations.filter((s) => s.id !== action.payload),
        stationData: deletedStationData,
        currentStationId:
          state.currentStationId === action.payload
            ? state.stations.find((s) => s.id !== action.payload)?.id || null
            : state.currentStationId,
      };
    }
    case "SET_CURRENT_STATION": {
      // Save current station's data before switching
      const savedStationData = state.currentStationId
        ? {
            ...state.stationData,
            [state.currentStationId]: {
              companyData: state.companyData,
              pmsPumps: state.pmsPumps,
              agoPumps: state.agoPumps,
              pmsTankOpening: state.pmsTankOpening,
              pmsTankClosing: state.pmsTankClosing,
              agoTankOpening: state.agoTankOpening,
              agoTankClosing: state.agoTankClosing,
              pmsPrice: state.pmsPrice,
              agoPrice: state.agoPrice,
              offloadingRecords: state.offloadingRecords,
              salesHistory: state.salesHistory,
              employees: state.employees,
            },
          }
        : state.stationData;

      // Load new station's data
      const loadedStation = savedStationData[action.payload];
      if (loadedStation) {
        return {
          ...state,
          currentStationId: action.payload,
          stationData: savedStationData,
          companyData: mergeCompanyData(
            state.companyData,
            loadedStation.companyData,
          ),
          pmsPumps: loadedStation.pmsPumps || [],
          agoPumps: loadedStation.agoPumps || [],
          pmsTankOpening: loadedStation.pmsTankOpening || 0,
          pmsTankClosing: loadedStation.pmsTankClosing || 0,
          agoTankOpening: loadedStation.agoTankOpening || 0,
          agoTankClosing: loadedStation.agoTankClosing || 0,
          pmsPrice: loadedStation.pmsPrice || 0,
          agoPrice: loadedStation.agoPrice || 0,
          offloadingRecords: loadedStation.offloadingRecords || [],
          salesHistory: loadedStation.salesHistory || {},
          employees: loadedStation.employees || [],
        };
      }
      return {
        ...state,
        currentStationId: action.payload,
        stationData: savedStationData,
      };
    }
    case "SET_STATIONS":
      return { ...state, stations: action.payload };
    default:
      return state;
  }
}

interface FuelContextType {
  state: FuelState;
  dispatch: React.Dispatch<FuelAction>;
  saveToStorage: () => void;
  loadFromStorage: () => void;
  saveToCloud: () => Promise<void>;
  loadFromCloud: () => Promise<void>;
  isCloudSaving: boolean;
  lastCloudSave: Date | null;
  /**
   * Propagate a fuel-price change from FuelContext to the shared
   * `fuel_types_config` cloud key (so FuelTypesManager / PriceBoard / POS /
   * Invoice / Reports all see the new price), AND broadcast it on the
   * in-device fuel-interlink bus for instant same-page updates. Call this
   * alongside dispatch(SET_PRICES) from any component that edits a station
   * pump price (PumpSettingsPanel, "Set as my price" actions, etc.).
   */
  syncPriceToFuelTypes: (
    raw: string,
    price: number,
    changedBy?: string,
  ) => void;
}

const FuelContext = createContext<FuelContextType | undefined>(undefined);

export function FuelProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(fuelReducer, initialState);
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [isCloudSaving, setIsCloudSaving] = React.useState(false);
  const [lastCloudSave, setLastCloudSave] = React.useState<Date | null>(null);

  // Ref that always points to the latest state, so save/load callbacks can read
  // current state WITHOUT being recreated on every state change. This breaks the
  // save/load race where the load effect (which depended on saveToStorage) re-fired
  // on every edit and overwrote fresh edits with stale localStorage data before the
  // 300ms save debounce could persist them.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Ref that always points to the current station id, so saveToCloud/loadFromCloud
  // (which are memoized on [user]) can scope the compact blob per-station without
  // being recreated on every station switch. Each station gets its own isolated
  // compact blob (companyData, salesHistory, debtHistory, etc.) so a user with
  // multiple stations has independent data per station. Combined View aggregates.
  const stationIdRef = useRef<string | undefined>(stationId);
  useEffect(() => {
    stationIdRef.current = stationId;
  }, [stationId]);

  // PRICE SCHEDULER — apply due scheduled price changes APP-WIDE on login.
  // Previously the scheduler only fired when the Fuel Type Manager tab was
  // open (a mount effect inside PriceScheduler), so a queued price change
  // never applied unless the owner happened to open that tab. FuelContext
  // mounts with the app shell, so due schedules now apply on any login.
  // Application flows through syncPriceToFuelTypes → fuel_types_config +
  // the shared price-history trail (Rate History) records it automatically.
  const schedulesAppliedRef = useRef<string>("");
  useEffect(() => {
    if (!user || !stationId) return;
    const scopeKey = `${user.id}:${stationId}`;
    if (schedulesAppliedRef.current === scopeKey) return;
    let cancelled = false;
    (async () => {
      try {
        const schedules =
          (await cloudStorageService.get<PriceSchedule[]>(
            "price_schedules",
            stationId,
          )) || [];
        const now = new Date();
        const due = schedules.filter(
          (s) =>
            s &&
            s.status === "pending" &&
            Number.isFinite(s.price) &&
            s.price > 0 &&
            new Date(s.effectiveOn) <= now,
        );
        if (due.length === 0 || cancelled) {
          schedulesAppliedRef.current = scopeKey;
          return;
        }
        for (const s of due) {
          // Declared later in this component body; effects run after render,
          // so the binding is initialized by the time this closure executes.
          syncPriceToFuelTypes(
            s.label || s.fuelType,
            s.price,
            "Price Scheduler (auto)",
          );
        }
        const appliedIds = new Set(due.map((d) => d.id));
        await cloudStorageService.set(
          "price_schedules",
          schedules.map((s) =>
            appliedIds.has(s.id) ? { ...s, status: "applied" as const } : s,
          ),
          stationId,
        );
      } catch {
        /* best-effort — the tab-level check is the fallback */
      } finally {
        if (!cancelled) schedulesAppliedRef.current = scopeKey;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stationId]);

  // WORLDWIDE: reconcile companyData.currency with the STATION's currency.
  // companyData.currency defaults to "KSh" (Kenya) and is persisted to the
  // cloud blob that way — so a German (EUR) or US (USD) station ended up with
  // companyData.currency = "KSh", leaking Kenya currency into invoices and
  // reports. When the current station has an explicit currency, ensure
  // companyData.currency (and userPreferences.currency) matches it. This is a
  // one-way reconcile (station is the source of truth for currency); it only
  // fires when they actually differ to avoid a save loop.
  const stationCurrency = currentStation?.currency;
  useEffect(() => {
    if (!stationCurrency) return;
    const cur = stateRef.current;
    const companyMismatch = cur.companyData?.currency !== stationCurrency;
    const prefsMismatch = cur.userPreferences?.currency !== stationCurrency;
    if (companyMismatch || prefsMismatch) {
      if (companyMismatch) {
        dispatch({
          type: "SET_COMPANY_DATA",
          payload: {
            ...cur.companyData,
            currency: stationCurrency,
          },
        });
      }
      if (prefsMismatch) {
        dispatch({
          type: "SET_USER_PREFERENCES",
          payload: {
            ...cur.userPreferences,
            currency: stationCurrency,
          },
        });
      }
    }
  }, [stationCurrency]);

  // CRITICAL: Guards the cross-device cloud-sync race. On login, the
  // aggressive auto-save effect (1500ms) can fire BEFORE loadFromCloud has
  // finished hydrating state from Supabase app_kv. When that happens,
  // saveToCloud overwrites the cloud blob with the default/empty in-memory
  // state, silently WIPING all data entered on another device. This ref
  // blocks saveToCloud until the initial cloud load has completed. It is
  // reset to false whenever the user changes (so each login re-loads).
  const cloudLoadCompleteRef = useRef(false);
  useEffect(() => {
    cloudLoadCompleteRef.current = false;
  }, [user]);

  // Real-time echo guard: set before saveToCloud writes so the real-time
  // subscription knows to skip the echo of our own write.
  const skipRemoteUpdateRef = useRef(false);
  // Tracks the timestamp of our most recent successful cloud save. Used for
  // conflict resolution when two devices are open simultaneously: a real-time
  // update from the other device is only applied if it is NEWER than our last
  // save, preventing a stale remote write from clobbering our unsaved edits.
  const lastLocalSaveTsRef = useRef(0);

  // ============================================================
  // FUEL TYPE / PRICE INTERLINK (FuelContext <-> fuel_types_config)
  // ------------------------------------------------------------
  // fuel_types_config (edited by FuelTypesManager) is the rich source of
  // truth for the station's fuel types + their per-litre prices. FuelContext
  // keeps legacy scalar pmsPrice/agoPrice for backwards compatibility. These
  // two are kept in sync: when fuel_types_config loads (or changes via
  // real-time), the active petrol/diesel entries drive pmsPrice/agoPrice; and
  // syncPriceToFuelTypes() writes a FuelContext price change back into
  // fuel_types_config + broadcasts on the interlink bus. This makes a price
  // edited anywhere (Dashboard, PriceBoard, "Set as my price", PumpSettings)
  // reflect everywhere instantly.
  const fuelTypesRef = useRef<CustomFuelType[]>([]);
  // Guard the FuelContext -> fuel_types_config derivation so we don't loop:
  // while WE are applying a fuel_types_config change to pmsPrice/agoPrice, we
  // must not re-broadcast it as a FuelContext change.
  const applyingFuelTypesRef = useRef(false);
  // Track the last price values we broadcast so the price-propagation effect
  // only emits when a price actually changes (not on every state render).
  const lastBroadcastPriceRef = useRef<{
    pms: number | null;
    ago: number | null;
  }>({
    pms: null,
    ago: null,
  });

  const saveToStorage = useCallback(() => {
    try {
      const s = stateRef.current;
      // Compact storage: single compressed JSON blob, station-scoped so each
      // station's local cache is independent (matches the cloud key).
      const userKey = compactCloudKey(user?.id, stationIdRef.current);

      // Create compact data object with only non-empty values
      const compactData: any = {
        theme: s.theme,
        themeSettings: s.themeSettings,
        userPreferences: s.userPreferences,
      };

      // Only include non-empty data to minimize storage
      // Always save companyData if it exists (even without name, for logo persistence)
      if (s.companyData) compactData.companyData = s.companyData;
      if (s.signatures?.manager || s.signatures?.director)
        compactData.signatures = s.signatures;
      if (s.invoiceCounter > 1) compactData.invoiceCounter = s.invoiceCounter;
      if (Object.keys(s.clients).length > 0) compactData.clients = s.clients;
      if (Object.keys(s.invoices).length > 0) compactData.invoices = s.invoices;
      if (Object.keys(s.debtHistory).length > 0)
        compactData.debtHistory = s.debtHistory;
      if (Object.keys(s.salesHistory).length > 0)
        compactData.salesHistory = s.salesHistory;
      if (s.deliveryData?.rows?.length > 0)
        compactData.deliveryData = s.deliveryData;
      if (s.invoiceItems?.length > 0) compactData.invoiceItems = s.invoiceItems;
      // Always save invoiceSettings — the old "!== Qty (DAYS)" conditional caused
      // the label to be dropped from storage, then the load effect overwrote the
      // user's custom label with the default on every state change.
      compactData.invoiceSettings = s.invoiceSettings;
      if (s.tillPayment !== 0) compactData.tillPayment = s.tillPayment;
      if (s.pmsPumps?.length > 0) compactData.pmsPumps = s.pmsPumps;
      if (s.agoPumps?.length > 0) compactData.agoPumps = s.agoPumps;
      if (s.fuelPumpsByType && Object.keys(s.fuelPumpsByType).length > 0)
        compactData.fuelPumpsByType = s.fuelPumpsByType;
      if (s.fuelPricesByType && Object.keys(s.fuelPricesByType).length > 0)
        compactData.fuelPricesByType = s.fuelPricesByType;
      if (
        s.fuelTankValuesByType &&
        Object.keys(s.fuelTankValuesByType).length > 0
      )
        compactData.fuelTankValuesByType = s.fuelTankValuesByType;
      if (s.expenses?.length > 0) compactData.expenses = s.expenses;
      if (s.salesDate !== new Date().toISOString().split("T")[0])
        compactData.salesDate = s.salesDate;
      if (s.shift !== "Day") compactData.shift = s.shift;
      if (s.pmsTankOpening !== 0) compactData.pmsTankOpening = s.pmsTankOpening;
      if (s.pmsTankClosing !== 0) compactData.pmsTankClosing = s.pmsTankClosing;
      if (s.agoTankOpening !== 0) compactData.agoTankOpening = s.agoTankOpening;
      if (s.agoTankClosing !== 0) compactData.agoTankClosing = s.agoTankClosing;
      compactData.pmsPrice = s.pmsPrice; // always save (station-specific)
      compactData.agoPrice = s.agoPrice; // always save (station-specific)
      // always save
      compactData.petrolPrice = s.petrolPrice; // always save (station-specific)
      // always save
      compactData.dieselPrice = s.dieselPrice; // always save (station-specific)
      if (s.deliveredTo) compactData.deliveredTo = s.deliveredTo;
      if (s.totalOrder) compactData.totalOrder = s.totalOrder;
      if (s.deliveryYear !== initialState.deliveryYear)
        compactData.deliveryYear = s.deliveryYear;
      if (s.offloadingRecords?.length > 0)
        compactData.offloadingRecords = s.offloadingRecords;
      if (
        JSON.stringify(s.tabVisibility) !==
        JSON.stringify(initialState.tabVisibility)
      )
        compactData.tabVisibility = s.tabVisibility;
      if (
        s.tabConfigurations?.some(
          (t) => t.label !== t.originalLabel || !t.visible,
        )
      )
        compactData.tabConfigurations = s.tabConfigurations;
      if (s.employees?.length > 0) compactData.employees = s.employees;
      if (s.payrollRecords?.length > 0)
        compactData.payrollRecords = s.payrollRecords;
      if (s.mpesaTransactions?.length > 0)
        compactData.mpesaTransactions = s.mpesaTransactions;
      // Multi-station support - always save station data
      if (s.stations?.length > 0) compactData.stations = s.stations;
      if (s.currentStationId) compactData.currentStationId = s.currentStationId;
      if (Object.keys(s.stationData || {}).length > 0)
        compactData.stationData = s.stationData;
      if (
        JSON.stringify(s.reportSettings) !==
        JSON.stringify(initialState.reportSettings)
      )
        compactData.reportSettings = s.reportSettings;
      if (s.chatHistory?.length > 0)
        compactData.chatHistory = s.chatHistory.slice(-50); // Keep only last 50 messages
      if (s.dataBackups?.length > 0)
        compactData.dataBackups = s.dataBackups.slice(-5); // Keep only last 5 backups

      // Save as single compressed JSON string
      localStorage.setItem(userKey, JSON.stringify(compactData));

      // CRITICAL: Always save companyData to individual key for logo persistence
      // This ensures logo survives even if compact storage has issues
      if (s.companyData) {
        localStorage.setItem(
          `${userKey}companyData`,
          JSON.stringify(s.companyData),
        );
      }

      // Clean up old individual keys EXCEPT companyData (keep for logo backup)
      const oldUserKey = user?.id ? `user_${user.id}_` : "guest_";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(oldUserKey) && !key.endsWith("companyData")) {
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error("Error saving to localStorage:", error);
    }
  }, [user]);

  // Cloud storage with compression
  const saveToCloud = useCallback(async () => {
    if (!user) return;
    // Block cloud saves until the initial cloud load has completed. Without
    // this, the auto-save effect (1500ms) races ahead of loadFromCloud and
    // overwrites the cloud blob with default/empty state, destroying all
    // data entered on another device.
    if (!cloudLoadCompleteRef.current) {
      console.log(
        "[FuelContext] Skipping cloud save — initial cloud load not yet complete",
      );
      return;
    }

    try {
      setIsCloudSaving(true);

      const s = stateRef.current;
      // Create compact data object (same as localStorage logic)
      const compactData: any = {
        theme: s.theme,
        themeSettings: s.themeSettings,
        userPreferences: s.userPreferences,
      };

      // Only include non-default/non-empty values for maximum compression
      // Always save companyData if it exists (even without name, for logo persistence)
      if (s.companyData) compactData.companyData = s.companyData;
      if (s.signatures?.manager || s.signatures?.director)
        compactData.signatures = s.signatures;
      if (s.invoiceCounter > 1) compactData.invoiceCounter = s.invoiceCounter;
      if (Object.keys(s.clients).length > 0) compactData.clients = s.clients;
      if (Object.keys(s.invoices).length > 0) compactData.invoices = s.invoices;
      if (Object.keys(s.debtHistory).length > 0)
        compactData.debtHistory = s.debtHistory;
      if (Object.keys(s.salesHistory).length > 0)
        compactData.salesHistory = s.salesHistory;
      if (s.deliveryData?.rows?.length > 0)
        compactData.deliveryData = s.deliveryData;
      if (s.invoiceItems?.length > 0) compactData.invoiceItems = s.invoiceItems;
      // Always save invoiceSettings (see saveToStorage comment).
      compactData.invoiceSettings = s.invoiceSettings;
      if (s.tillPayment !== 0) compactData.tillPayment = s.tillPayment;
      if (s.pmsPumps?.length > 0) compactData.pmsPumps = s.pmsPumps;
      if (s.agoPumps?.length > 0) compactData.agoPumps = s.agoPumps;
      if (s.fuelPumpsByType && Object.keys(s.fuelPumpsByType).length > 0)
        compactData.fuelPumpsByType = s.fuelPumpsByType;
      if (s.fuelPricesByType && Object.keys(s.fuelPricesByType).length > 0)
        compactData.fuelPricesByType = s.fuelPricesByType;
      if (
        s.fuelTankValuesByType &&
        Object.keys(s.fuelTankValuesByType).length > 0
      )
        compactData.fuelTankValuesByType = s.fuelTankValuesByType;
      if (s.expenses?.length > 0) compactData.expenses = s.expenses;
      if (s.salesDate !== new Date().toISOString().split("T")[0])
        compactData.salesDate = s.salesDate;
      if (s.shift !== "Day") compactData.shift = s.shift;
      if (s.pmsTankOpening !== 0) compactData.pmsTankOpening = s.pmsTankOpening;
      if (s.pmsTankClosing !== 0) compactData.pmsTankClosing = s.pmsTankClosing;
      if (s.agoTankOpening !== 0) compactData.agoTankOpening = s.agoTankOpening;
      if (s.agoTankClosing !== 0) compactData.agoTankClosing = s.agoTankClosing;
      compactData.pmsPrice = s.pmsPrice; // always save (station-specific)
      compactData.agoPrice = s.agoPrice; // always save (station-specific)
      // always save
      compactData.petrolPrice = s.petrolPrice; // always save (station-specific)
      // always save
      compactData.dieselPrice = s.dieselPrice; // always save (station-specific)
      if (s.deliveredTo) compactData.deliveredTo = s.deliveredTo;
      if (s.totalOrder) compactData.totalOrder = s.totalOrder;
      if (s.deliveryYear !== initialState.deliveryYear)
        compactData.deliveryYear = s.deliveryYear;
      if (s.offloadingRecords?.length > 0)
        compactData.offloadingRecords = s.offloadingRecords;
      if (
        JSON.stringify(s.tabVisibility) !==
        JSON.stringify(initialState.tabVisibility)
      )
        compactData.tabVisibility = s.tabVisibility;
      if (
        s.tabConfigurations?.some(
          (t) => t.label !== t.originalLabel || !t.visible,
        )
      )
        compactData.tabConfigurations = s.tabConfigurations;
      if (s.employees?.length > 0) compactData.employees = s.employees;
      if (s.payrollRecords?.length > 0)
        compactData.payrollRecords = s.payrollRecords;
      if (s.mpesaTransactions?.length > 0)
        compactData.mpesaTransactions = s.mpesaTransactions.slice(-100); // Keep only last 100 transactions
      // Multi-station support - always save station data
      if (s.stations?.length > 0) compactData.stations = s.stations;
      if (s.currentStationId) compactData.currentStationId = s.currentStationId;
      if (Object.keys(s.stationData || {}).length > 0)
        compactData.stationData = s.stationData;
      if (
        JSON.stringify(s.reportSettings) !==
        JSON.stringify(initialState.reportSettings)
      )
        compactData.reportSettings = s.reportSettings;
      if (s.chatHistory?.length > 0)
        compactData.chatHistory = s.chatHistory.slice(-50); // Keep only last 50 messages
      if (s.dataBackups?.length > 0)
        compactData.dataBackups = s.dataBackups.slice(-3); // Keep only last 3 backups in cloud

      // Timestamp for conflict resolution: when two devices are open
      // simultaneously, a real-time update from the other device should only
      // overwrite local state if it is NEWER than our last save. This prevents
      // a stale remote echo from clobbering unsaved local edits.
      compactData.lastSavedAt = Date.now();

      // Persist to Supabase app_kv (cross-device). Keyed per-user + per-station
      // so each station has its own isolated FuelContext blob (companyData,
      // salesHistory, debtHistory, etc.). RLS-protected by owner_id. localStorage
      // remains a read-through cache via saveToStorage for offline reads.
      const cloudKey = compactCloudKey(user?.id, stationIdRef.current);
      // Set the echo-skip flag so the real-time subscription doesn't
      // re-dispatch our own write as if it came from another device.
      skipRemoteUpdateRef.current = true;
      // Record our save timestamp so the real-time handler can reject stale
      // remote updates that predate our latest local write.
      lastLocalSaveTsRef.current = compactData.lastSavedAt;
      await cloudStorageService.set(
        cloudKey,
        compactData,
        stationIdRef.current,
      );

      setLastCloudSave(new Date());

      // Calculate and log storage savings
      const fullSize = JSON.stringify(s).length;
      const compactSize = JSON.stringify(compactData).length;
      const savings = ((1 - compactSize / fullSize) * 100).toFixed(1);
      console.log(`Compact data saved to cloud (${savings}% smaller)`);
    } catch (error) {
      console.error("Error saving to cloud:", error);
    } finally {
      setIsCloudSaving(false);
    }
  }, [user]);

  const loadFromCloud = useCallback(async () => {
    if (!user) return;

    try {
      // Read the station-scoped compact data blob from Supabase app_kv
      // (cross-device). Each station has its own blob. Falls back to the
      // legacy user-scoped blob (and then legacy bare-key) via
      // cloudStorageService.get so existing data migrates transparently on
      // first read. localStorage is only a read-through cache.
      const cloudKey = compactCloudKey(user.id, stationIdRef.current);
      const compactData = (await cloudStorageService.get<
        Record<string, unknown>
      >(cloudKey, stationIdRef.current)) as Record<string, unknown> | null;

      if (compactData && Object.keys(compactData).length > 0) {
        // Validate that the loaded data has meaningful content. The check
        // MUST include ALL business-data collections (salesHistory,
        // debtHistory, expenses, invoices, clients, etc.) — not just a
        // subset. Previously salesHistory was missing from this list, so a
        // user whose only data was saved sales records would see an empty
        // Fuel Sales tab on a new device (the blob existed in the cloud but
        // was never loaded → false "no data" → stale default state).
        const cd = compactData as any;
        const hasData =
          cd.companyData?.name ||
          cd.companyData?.logo ||
          (cd.deliveryData?.rows && cd.deliveryData.rows.length > 0) ||
          (cd.invoiceItems && cd.invoiceItems.length > 0) ||
          (cd.pmsPumps && cd.pmsPumps.length > 0) ||
          (cd.agoPumps && cd.agoPumps.length > 0) ||
          (cd.stations && cd.stations.length > 0) ||
          (cd.salesHistory && Object.keys(cd.salesHistory).length > 0) ||
          (cd.debtHistory && Object.keys(cd.debtHistory).length > 0) ||
          (cd.invoices && Object.keys(cd.invoices).length > 0) ||
          (cd.clients && Object.keys(cd.clients).length > 0) ||
          (cd.expenses && cd.expenses.length > 0) ||
          (cd.employees && cd.employees.length > 0) ||
          (cd.payrollRecords && cd.payrollRecords.length > 0) ||
          (cd.offloadingRecords && cd.offloadingRecords.length > 0) ||
          (cd.mpesaTransactions && cd.mpesaTransactions.length > 0) ||
          (cd.stationData && Object.keys(cd.stationData).length > 0) ||
          cd.tillPayment;

        if (hasData || cd.theme || cd.tabConfigurations) {
          dispatch({ type: "LOAD_FROM_STORAGE", payload: cd });
          console.log("Data loaded from cloud (Supabase) successfully");
        } else {
          console.log("Cloud data appears empty, keeping current state");
        }
      } else {
        console.log("No data found in cloud storage");
      }
    } catch (error) {
      console.error("Error loading from cloud:", error);
      // Re-throw so the caller can fall back to loadFromStorage.
      throw error;
    }
  }, [user]);

  const loadFromStorage = useCallback(() => {
    try {
      const userKey = compactCloudKey(user?.id, stationIdRef.current);

      // Try loading from compact storage first
      const compactData = localStorage.getItem(userKey);

      if (compactData) {
        // Load from compact JSON blob
        const parsed = JSON.parse(compactData);

        // CRITICAL: Always check individual companyData key for logo (more reliable)
        const individualCompanyData = localStorage.getItem(
          `${userKey}companyData`,
        );
        if (individualCompanyData) {
          parsed.companyData = JSON.parse(individualCompanyData);
        }

        const loadedData: Partial<FuelState> = {
          ...initialState, // Start with defaults
          ...parsed, // Overlay saved values
        };
        dispatch({ type: "LOAD_FROM_STORAGE", payload: loadedData });
      } else {
        // Fallback to old individual keys for backward compatibility
        const oldUserKey = user?.id ? `user_${user.id}_` : "guest_";

        const savedTheme =
          (localStorage.getItem(`${oldUserKey}theme`) as "light" | "dark") ||
          "dark";
        const savedThemeSettings = localStorage.getItem(
          `${oldUserKey}themeSettings`,
        );
        const savedUserPreferences = localStorage.getItem(
          `${oldUserKey}userPreferences`,
        );
        const savedCompany = localStorage.getItem(`${oldUserKey}companyData`);
        const savedSignatures = localStorage.getItem(`${oldUserKey}signatures`);
        const savedInvoiceCounter = localStorage.getItem(
          `${oldUserKey}invoiceCounter`,
        );
        const savedClients = localStorage.getItem(`${oldUserKey}clients`);
        const savedInvoices = localStorage.getItem(`${oldUserKey}invoices`);
        const savedDebtHistory = localStorage.getItem(
          `${oldUserKey}debtHistory`,
        );
        const savedSalesHistory = localStorage.getItem(
          `${oldUserKey}salesHistory`,
        );
        const savedDelivery = localStorage.getItem(
          `${oldUserKey}fuelDeliveryData`,
        );
        const savedInvoiceItems = localStorage.getItem(
          `${oldUserKey}invoiceItems`,
        );
        const savedInvoiceSettings = localStorage.getItem(
          `${oldUserKey}invoiceSettings`,
        );
        const savedTillPayment = localStorage.getItem(
          `${oldUserKey}tillPayment`,
        );
        const savedPmsPumps = localStorage.getItem(
          `${oldUserKey}fuelPumps_pms`,
        );
        const savedAgoPumps = localStorage.getItem(
          `${oldUserKey}fuelPumps_ago`,
        );
        const savedExpenses = localStorage.getItem(`${oldUserKey}fuelExpenses`);
        const savedSalesDate = localStorage.getItem(`${oldUserKey}salesDate`);
        const savedShift = localStorage.getItem(`${oldUserKey}shift`);
        const savedPmsTankOpening = localStorage.getItem(
          `${oldUserKey}pmsTankOpening`,
        );
        const savedPmsTankClosing = localStorage.getItem(
          `${oldUserKey}pmsTankClosing`,
        );
        const savedAgoTankOpening = localStorage.getItem(
          `${oldUserKey}agoTankOpening`,
        );
        const savedAgoTankClosing = localStorage.getItem(
          `${oldUserKey}agoTankClosing`,
        );
        const savedPmsPrice = localStorage.getItem(`${oldUserKey}pmsPrice`);
        const savedAgoPrice = localStorage.getItem(`${oldUserKey}agoPrice`);
        const savedPetrolPrice = localStorage.getItem(
          `${oldUserKey}petrolPrice`,
        );
        const savedDieselPrice = localStorage.getItem(
          `${oldUserKey}dieselPrice`,
        );
        const savedDeliveredTo = localStorage.getItem(
          `${oldUserKey}deliveredTo`,
        );
        const savedTotalOrder = localStorage.getItem(`${oldUserKey}totalOrder`);
        const savedDeliveryYear = localStorage.getItem(
          `${oldUserKey}deliveryYear`,
        );
        const savedOffloadingRecords = localStorage.getItem(
          `${oldUserKey}offloadingRecords`,
        );
        const savedTabVisibility = localStorage.getItem(
          `${oldUserKey}tabVisibility`,
        );
        const savedTabConfigurations = localStorage.getItem(
          `${oldUserKey}tabConfigurations`,
        );
        const savedEmployees = localStorage.getItem(`${oldUserKey}employees`);
        const savedPayrollRecords = localStorage.getItem(
          `${oldUserKey}payrollRecords`,
        );
        const savedMpesaTransactions = localStorage.getItem(
          `${oldUserKey}mpesaTransactions`,
        );
        const savedReportSettings = localStorage.getItem(
          `${oldUserKey}reportSettings`,
        );
        const savedChatHistory = localStorage.getItem(
          `${oldUserKey}chatHistory`,
        );
        const savedDataBackups = localStorage.getItem(
          `${oldUserKey}dataBackups`,
        );

        const loadedData: Partial<FuelState> = {
          theme: savedTheme,
          themeSettings: savedThemeSettings
            ? JSON.parse(savedThemeSettings)
            : initialState.themeSettings,
          userPreferences: savedUserPreferences
            ? JSON.parse(savedUserPreferences)
            : initialState.userPreferences,
          companyData: savedCompany
            ? JSON.parse(savedCompany)
            : initialState.companyData,
          signatures: savedSignatures
            ? JSON.parse(savedSignatures)
            : initialState.signatures,
          invoiceCounter: savedInvoiceCounter
            ? parseInt(savedInvoiceCounter)
            : initialState.invoiceCounter,
          clients: savedClients
            ? JSON.parse(savedClients)
            : initialState.clients,
          invoices: savedInvoices
            ? JSON.parse(savedInvoices)
            : initialState.invoices,
          debtHistory: savedDebtHistory
            ? JSON.parse(savedDebtHistory)
            : initialState.debtHistory,
          salesHistory: savedSalesHistory
            ? JSON.parse(savedSalesHistory)
            : initialState.salesHistory,
          deliveryData: savedDelivery
            ? JSON.parse(savedDelivery)
            : initialState.deliveryData,
          invoiceItems: savedInvoiceItems
            ? JSON.parse(savedInvoiceItems)
            : initialState.invoiceItems,
          invoiceSettings: savedInvoiceSettings
            ? JSON.parse(savedInvoiceSettings)
            : initialState.invoiceSettings,
          tillPayment: savedTillPayment
            ? parseFloat(savedTillPayment)
            : initialState.tillPayment,
          pmsPumps: savedPmsPumps
            ? JSON.parse(savedPmsPumps)
            : initialState.pmsPumps,
          agoPumps: savedAgoPumps
            ? JSON.parse(savedAgoPumps)
            : initialState.agoPumps,
          expenses: savedExpenses
            ? JSON.parse(savedExpenses)
            : initialState.expenses,
          salesDate: savedSalesDate || initialState.salesDate,
          shift: savedShift || initialState.shift,
          pmsTankOpening: savedPmsTankOpening
            ? parseFloat(savedPmsTankOpening)
            : initialState.pmsTankOpening,
          pmsTankClosing: savedPmsTankClosing
            ? parseFloat(savedPmsTankClosing)
            : initialState.pmsTankClosing,
          agoTankOpening: savedAgoTankOpening
            ? parseFloat(savedAgoTankOpening)
            : initialState.agoTankOpening,
          agoTankClosing: savedAgoTankClosing
            ? parseFloat(savedAgoTankClosing)
            : initialState.agoTankClosing,
          pmsPrice: savedPmsPrice
            ? parseFloat(savedPmsPrice)
            : initialState.pmsPrice,
          agoPrice: savedAgoPrice
            ? parseFloat(savedAgoPrice)
            : initialState.agoPrice,
          petrolPrice: savedPetrolPrice
            ? parseFloat(savedPetrolPrice)
            : initialState.petrolPrice,
          dieselPrice: savedDieselPrice
            ? parseFloat(savedDieselPrice)
            : initialState.dieselPrice,
          deliveredTo: savedDeliveredTo || initialState.deliveredTo,
          totalOrder: savedTotalOrder || initialState.totalOrder,
          deliveryYear: savedDeliveryYear
            ? parseInt(savedDeliveryYear)
            : initialState.deliveryYear,
          offloadingRecords: savedOffloadingRecords
            ? JSON.parse(savedOffloadingRecords)
            : initialState.offloadingRecords,
          tabVisibility: savedTabVisibility
            ? JSON.parse(savedTabVisibility)
            : initialState.tabVisibility,
          tabConfigurations: savedTabConfigurations
            ? sanitizeTabConfigs(JSON.parse(savedTabConfigurations))
            : initialState.tabConfigurations,
          employees: savedEmployees
            ? JSON.parse(savedEmployees)
            : initialState.employees,
          payrollRecords: savedPayrollRecords
            ? JSON.parse(savedPayrollRecords)
            : initialState.payrollRecords,
          mpesaTransactions: savedMpesaTransactions
            ? JSON.parse(savedMpesaTransactions)
            : initialState.mpesaTransactions,
          reportSettings: savedReportSettings
            ? JSON.parse(savedReportSettings)
            : initialState.reportSettings,
          chatHistory: savedChatHistory
            ? JSON.parse(savedChatHistory)
            : initialState.chatHistory,
          dataBackups: savedDataBackups
            ? JSON.parse(savedDataBackups)
            : initialState.dataBackups,
        };

        dispatch({ type: "LOAD_FROM_STORAGE", payload: loadedData });
      }
    } catch (error) {
      console.error("Error loading from localStorage:", error);
    }
  }, [user]);

  // INSTANT LOCAL AUTO-SAVE - saves to browser storage immediately for zero data loss
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToStorage();
    }, 100); // 100ms — near-instant, batches only rapid keystrokes

    return () => clearTimeout(timeoutId);
  }, [state]);

  // AGGRESSIVE AUTO-SAVE to cloud - ensures all business data is always saved.
  // Debounced to 2s so a burst of edits (typing, rapid line-item changes)
  // collapses into ONE cloud write + ONE realtime broadcast instead of one
  // per keystroke. This is a major realtime/egress saving on the Free plan
  // (each cloud write echoes a postgres_changes event to every subscribed
  // device). The echo guard (skipRemoteUpdateRef) and the local 100ms save
  // keep data safe; the 2s window only delays the *cloud* mirror.
  useEffect(() => {
    if (!user) return;

    const immediateCloudSave = setTimeout(() => {
      saveToCloud();
    }, 2000); // 2s — batches rapid edits into a single cloud sync

    return () => clearTimeout(immediateCloudSave);
  }, [user, state]);

  // Load data on mount AND when user changes.
  // Cloud (Supabase app_kv) is the source of truth — it is always consulted so
  // that data entered on another device/browser is reflected here. localStorage
  // is only a read-through cache (per cloud-storage-service.ts) and is used as a
  // fallback when the network/auth is unavailable. Previously this effect skipped
  // loadFromCloud whenever localStorage had data, which meant a refresh on the
  // SAME browser never pulled the latest cloud state — so a logo (or any field)
  // updated elsewhere vanished. It also broke cross-device sync entirely.
  useEffect(() => {
    let cancelled = false;
    // HYDRATE INSTANTLY from localStorage — no setTimeout delay. The UI shows
    // cached data on the very first paint, then cloud data updates it.
    loadFromStorage();

    if (user) {
      (async () => {
        try {
          await loadFromCloud();
          if (!cancelled) {
            saveToStorage();
          }
        } catch (error) {
          console.warn("Failed to load from cloud, using local cache:", error);
        } finally {
          if (!cancelled) cloudLoadCompleteRef.current = true;
        }
      })();
    } else {
      cloudLoadCompleteRef.current = true;
    }
    return () => {
      cancelled = true;
    };
  }, [user, loadFromCloud, loadFromStorage, saveToStorage]);

  // CRITICAL: Reload cloud data when the current station changes. Each station
  // has its own isolated FuelContext blob (companyData, salesHistory,
  // debtHistory, etc.). Without this, switching stations keeps the previous
  // station's data in memory, so edits bleed across stations. We:
  // 1. Block saves (cloudLoadCompleteRef = false) so the auto-save effect
  //    can't overwrite the new station's cloud blob with the old station's
  //    in-memory state during the ~200-500ms load window.
  // 2. Load the new station's blob from cloud (falling back to localStorage
  //    cache, then defaults).
  // 3. Unblock saves in finally.
  // We skip the very first run (the mount effect above handles it) by tracking
  // whether a station was previously selected.
  const prevStationRef = useRef<string | undefined>(stationId);
  useEffect(() => {
    // Only react to an actual station CHANGE, not the initial mount.
    if (prevStationRef.current === stationId) return;
    prevStationRef.current = stationId;

    if (!user) return;

    let cancelled = false;
    // Block saves until the new station's data is loaded.
    cloudLoadCompleteRef.current = false;
    loadFromStorage();
    (async () => {
      try {
        await loadFromCloud();
        if (!cancelled) saveToStorage();
      } catch (error) {
        console.warn("Failed to load station cloud data:", error);
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, stationId, loadFromCloud, loadFromStorage, saveToStorage]);

  // REAL-TIME cross-device sync: subscribe to postgres_changes on the compact
  // blob. When another device/browser writes to the same app_kv row (e.g. the
  // user edits company data on their phone), this subscription fires INSTANTLY
  // and dispatches LOAD_FROM_STORAGE so the new data is reflected here with
  // zero delay — no polling, no reload required.
  //
  // A `skipRemoteUpdateRef` guard prevents echo: when THIS device writes, the
  // real-time event comes back to us. We skip it because saveToCloud already
  // updated local state synchronously.
  useEffect(() => {
    if (!user || !stationId) return;

    const cloudKey = compactCloudKey(user.id, stationId);
    const unsub = cloudStorageService.subscribe<Record<string, unknown>>(
      cloudKey,
      stationId,
      (value) => {
        // Skip our own echo.
        if (skipRemoteUpdateRef.current) {
          skipRemoteUpdateRef.current = false;
          return;
        }
        if (value && Object.keys(value).length > 0) {
          const cd = value as any;
          // CONFLICT RESOLUTION (two devices open simultaneously): only apply
          // the remote update if it is NEWER than our last local save. If we
          // have unsaved-or-just-saved local edits that are newer, keep them —
          // applying a stale remote write would revert our changes and cause
          // the "data keeps conflicting" flicker. The first load (lastLocalSaveTs
          // === 0) always accepts the remote value.
          const remoteTs =
            typeof cd.lastSavedAt === "number" ? cd.lastSavedAt : 0;
          if (
            lastLocalSaveTsRef.current > 0 &&
            remoteTs > 0 &&
            remoteTs < lastLocalSaveTsRef.current
          ) {
            console.log(
              "[FuelContext] Skipping stale remote update (remote ts",
              remoteTs,
              "< local ts",
              lastLocalSaveTsRef.current,
              ")",
            );
            return;
          }
          const hasData =
            cd.companyData?.name ||
            cd.companyData?.logo ||
            (cd.deliveryData?.rows && cd.deliveryData.rows.length > 0) ||
            (cd.invoiceItems && cd.invoiceItems.length > 0) ||
            (cd.pmsPumps && cd.pmsPumps.length > 0) ||
            (cd.agoPumps && cd.agoPumps.length > 0) ||
            (cd.stations && cd.stations.length > 0) ||
            (cd.salesHistory && Object.keys(cd.salesHistory).length > 0) ||
            (cd.debtHistory && Object.keys(cd.debtHistory).length > 0) ||
            (cd.invoices && Object.keys(cd.invoices).length > 0) ||
            (cd.clients && Object.keys(cd.clients).length > 0) ||
            (cd.expenses && cd.expenses.length > 0) ||
            (cd.employees && cd.employees.length > 0) ||
            (cd.payrollRecords && cd.payrollRecords.length > 0) ||
            (cd.offloadingRecords && cd.offloadingRecords.length > 0) ||
            (cd.mpesaTransactions && cd.mpesaTransactions.length > 0) ||
            (cd.stationData && Object.keys(cd.stationData).length > 0) ||
            cd.tillPayment;
          if (hasData || cd.theme || cd.tabConfigurations) {
            dispatch({ type: "LOAD_FROM_STORAGE", payload: cd });
          }
        }
      },
    );

    return () => unsub();
  }, [user, stationId]);

  // ------------------------------------------------------------
  // OFFLINE → ONLINE SYNC: when the offline write queue is flushed (by the
  // cloudStorageService global online/visibility/interval listeners), a
  // `cloudStorageSynced` CustomEvent is dispatched. Reload from cloud so the
  // UI reflects the now-synced data immediately — this is the fix for
  // "offline changes not updated immediately when back online". Without this,
  // a component that loaded on mount would keep showing the pre-sync state.
  useEffect(() => {
    if (!user) return;
    const handler = () => {
      // Reload the compact blob from cloud (the just-flushed write is there).
      loadFromCloud().catch(() => {});
    };
    window.addEventListener("cloudStorageSynced", handler);
    return () => window.removeEventListener("cloudStorageSynced", handler);
  }, [user, loadFromCloud]);

  // ------------------------------------------------------------
  // Load fuel_types_config on mount/station change, keep fuelTypesRef in
  // sync, derive pmsPrice/agoPrice from the active petrol/diesel entries,
  // and subscribe to real-time cloud updates so a price edit in
  // FuelTypesManager on another device propagates here instantly.
  useEffect(() => {
    let cancelled = false;
    const applyFuelTypes = (list: CustomFuelType[]) => {
      if (cancelled) return;
      fuelTypesRef.current = list;
      const s = stateRef.current;
      const petrol = list.find(
        (ft) => ft.active && normalizeFuelType(ft.name) === "petrol",
      );
      const diesel = list.find(
        (ft) => ft.active && normalizeFuelType(ft.name) === "diesel",
      );
      const updates: Partial<{ pmsPrice: number; agoPrice: number }> = {};
      if (
        petrol &&
        typeof petrol.price === "number" &&
        petrol.price > 0 &&
        petrol.price !== s.pmsPrice
      ) {
        updates.pmsPrice = petrol.price;
      }
      if (
        diesel &&
        typeof diesel.price === "number" &&
        diesel.price > 0 &&
        diesel.price !== s.agoPrice
      ) {
        updates.agoPrice = diesel.price;
      }
      // Mirror EVERY active fuel-type price into fuelPricesByType so the
      // dynamic per-fuel price store stays in sync (kerosene, LPG, V-Power…).
      const priceByType: Record<string, number> = {};
      for (const ft of list) {
        if (!ft.active) continue;
        const canonical = normalizeFuelType(ft.name);
        if (canonical && typeof ft.price === "number" && ft.price > 0) {
          priceByType[canonical] = ft.price;
        }
      }
      if (Object.keys(priceByType).length > 0) {
        dispatch({ type: "SET_FUEL_PRICES_BY_TYPE", payload: priceByType });
      }
      if (Object.keys(updates).length > 0) {
        applyingFuelTypesRef.current = true;
        dispatch({ type: "SET_PRICES", payload: updates });
        // Broadcast so same-page consumers (Dashboard, PriceBoard) update.
        if (updates.pmsPrice != null) {
          emitFuelPriceChange({
            fuelType: "Super Petrol",
            canonical: "petrol",
            price: updates.pmsPrice,
            source: "FuelContext.fuelTypesSync",
          });
        }
        if (updates.agoPrice != null) {
          emitFuelPriceChange({
            fuelType: "Diesel",
            canonical: "diesel",
            price: updates.agoPrice,
            source: "FuelContext.fuelTypesSync",
          });
        }
        applyingFuelTypesRef.current = false;
      }
    };

    (async () => {
      try {
        const data = await cloudStorageService.get<CustomFuelType[]>(
          "fuel_types_config",
          stationId,
        );
        if (data && Array.isArray(data)) applyFuelTypes(data);
      } catch {
        /* ignore */
      }
    })();

    const unsub = cloudStorageService.subscribe<CustomFuelType[]>(
      "fuel_types_config",
      stationId,
      (val) => {
        if (val && Array.isArray(val)) applyFuelTypes(val);
      },
    );
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [stationId]);

  // ------------------------------------------------------------
  // syncPriceToFuelTypes: write a FuelContext price change back into
  // fuel_types_config (so FuelTypesManager/PriceBoard/POS/Invoice/Reports see
  // it) and broadcast on the interlink bus. Exposed via context for any
  // component that edits a station pump price.
  const syncPriceToFuelTypes = useCallback(
    (raw: string, price: number, changedBy?: string) => {
      if (typeof price !== "number" || !isFinite(price) || price <= 0) return;
      const canonical = normalizeFuelType(raw);
      if (!canonical) return;
      // Update the matching fuel_types_config entry (if any) and persist.
      const list = fuelTypesRef.current;
      let oldPrice: number | null = null;
      if (list.length > 0) {
        const idx = list.findIndex(
          (ft) => normalizeFuelType(ft.name) === canonical,
        );
        if (idx >= 0 && list[idx].price !== price) {
          oldPrice = list[idx].price ?? null;
          const next = list.slice();
          next[idx] = { ...next[idx], price };
          fuelTypesRef.current = next;
          cloudStorageService
            .set("fuel_types_config", next, stationIdRef.current)
            .catch(() => {});
        }
      }
      // Record the change in the shared price-history trail so Rate History
      // (and the whole Fuel Type Manager matrix) sees changes from EVERY
      // source — Price Board, Price Scheduler, Dashboard, Fuel Price Finder.
      // Deduped inside recordPriceChange so double-callers don't double-log.
      if (oldPrice !== null && oldPrice !== price) {
        void recordPriceChange({
          fuelType: raw,
          oldPrice,
          newPrice: price,
          changedBy: changedBy || "Station",
          stationId: stationIdRef.current,
        });
      }
      // Also keep the legacy FuelContext scalar fields in sync for petrol/diesel.
      if (canonical === "petrol" || canonical === "diesel") {
        dispatch({
          type: "SET_PRICES",
          payload:
            canonical === "petrol" ? { pmsPrice: price } : { agoPrice: price },
        });
      }
      // Broadcast for instant same-page updates (Dashboard, PriceBoard, …).
      emitFuelPriceChange({
        fuelType: raw,
        canonical,
        price,
        source: "FuelContext.syncPriceToFuelTypes",
      });
    },
    [],
  );

  // Listen for price changes broadcast by OTHER components on the bus (e.g.
  // FuelPriceLocator "Set as my price") and mirror them into FuelContext +
  // fuel_types_config, so those actions update the Dashboard/legacy fields too.
  useEffect(() => {
    const unsub = onFuelPriceChange((p) => {
      if (applyingFuelTypesRef.current) return; // avoid loop with our own emit
      const canonical = p.canonical ?? normalizeFuelType(p.fuelType);
      if (!canonical) return;
      const list = fuelTypesRef.current;
      if (list.length > 0) {
        const idx = list.findIndex(
          (ft) => normalizeFuelType(ft.name) === canonical,
        );
        if (idx >= 0 && list[idx].price !== p.price) {
          const next = list.slice();
          next[idx] = { ...next[idx], price: p.price };
          fuelTypesRef.current = next;
          cloudStorageService
            .set("fuel_types_config", next, stationIdRef.current)
            .catch(() => {});
        }
      }
      if (canonical === "petrol" || canonical === "diesel") {
        dispatch({
          type: "SET_PRICES",
          payload:
            canonical === "petrol"
              ? { pmsPrice: p.price }
              : { agoPrice: p.price },
        });
      }
    });
    return () => unsub();
  }, []);

  // ------------------------------------------------------------
  // Universal price-propagation effect: when ANY legacy scalar price field
  // changes via dispatch(SET_PRICES) — e.g. DeliveryTracker's Petrol/Diesel
  // Price inputs, SetupWizard price setup, or a restored LOAD_FROM_STORAGE —
  // mirror the change into fuel_types_config + broadcast on the interlink
  // bus so EVERY consumer (Dashboard cards, POS cart, Invoice hints,
  // PriceBoard, Reports) stays in sync from a single source of truth.
  // Note: petrol/diesel have TWO legacy fields each (petrolPrice/pmsPrice,
  // dieselPrice/agoPrice) used by different components. We track all four and
  // propagate any that changes.
  useEffect(() => {
    if (applyingFuelTypesRef.current) return;
    // Resolve the effective petrol/diesel price: prefer pmsPrice/agoPrice, but
    // also react to petrolPrice/dieselPrice edits (DeliveryTracker/SetupWizard).
    const effectivePms = state.pmsPrice || state.petrolPrice;
    const effectiveAgo = state.agoPrice || state.dieselPrice;
    const last = lastBroadcastPriceRef.current;

    const propagate = (
      canonical: "petrol" | "diesel",
      price: number,
      label: string,
    ) => {
      if (price <= 0) return;
      const list = fuelTypesRef.current;
      if (list.length > 0) {
        const idx = list.findIndex(
          (ft) => normalizeFuelType(ft.name) === canonical,
        );
        if (idx >= 0 && list[idx].price !== price) {
          const next = list.slice();
          next[idx] = { ...next[idx], price };
          fuelTypesRef.current = next;
          cloudStorageService
            .set("fuel_types_config", next, stationIdRef.current)
            .catch(() => {});
        }
      }
      emitFuelPriceChange({
        fuelType: label,
        canonical,
        price,
        source: "FuelContext.pricePropagate",
      });
    };

    if (effectivePms > 0 && effectivePms !== last.pms) {
      last.pms = effectivePms;
      propagate("petrol", effectivePms, "Super Petrol");
    }
    if (effectiveAgo > 0 && effectiveAgo !== last.ago) {
      last.ago = effectiveAgo;
      propagate("diesel", effectiveAgo, "Diesel");
    }
  }, [state.pmsPrice, state.agoPrice, state.petrolPrice, state.dieselPrice]);

  // Apply theme to body - robust for all browsers
  useEffect(() => {
    try {
      const isDark = state.theme === "dark";
      const html = document.documentElement;
      const body = document.body;

      if (isDark) {
        html.classList.add("dark");
        html.classList.remove("light");
        html.setAttribute("data-theme", "dark");
        body?.classList?.add("dark-mode");
        body?.classList?.remove("light-mode");
        body.style.colorScheme = "dark";
      } else {
        html.classList.remove("dark");
        html.classList.add("light");
        html.setAttribute("data-theme", "light");
        body?.classList?.remove("dark-mode");
        body?.classList?.add("light-mode");
        body.style.colorScheme = "light";
      }
    } catch {
      // DOM not ready
    }
  }, [state.theme]);

  return (
    <FuelContext.Provider
      value={{
        state,
        dispatch,
        saveToStorage,
        loadFromStorage,
        saveToCloud,
        loadFromCloud,
        isCloudSaving,
        lastCloudSave,
        syncPriceToFuelTypes,
      }}
    >
      {children}
    </FuelContext.Provider>
  );
}

export function useFuel() {
  const context = useContext(FuelContext);
  if (context === undefined) {
    throw new Error("useFuel must be used within a FuelProvider");
  }
  return context;
}
