// ============================================================
// REGIONAL REGULATORY CONFIGURATIONS — ALL 250+ COUNTRIES
// Country-specific compliance, tax, and operational settings
// ============================================================

import { WORLD_PAYMENT_CONFIGS } from "./worldPaymentConfigs";

export interface RegionalConfig {
  country: string;
  countryCode: string;
  currency: string;
  currencySymbol: string;
  taxAuthority: string;
  taxAuthorityShort: string;
  vatRate: number;
  vatName: string;
  hasETR: boolean;
  etrName: string;
  etrFormat: string;
  fuelRegulator: string;
  fuelRegulatorShort: string;
  fuelTypes: FuelTypeConfig[];
  requiredPermits: string[];
  reportingFrequency: string;
  receiptRequirements: string[];
  complianceFeatures: ComplianceFeature[];
  holidays: string[];
  dateFormat: string;
  timeZone: string;
  decimalSeparator: string;
  thousandSeparator: string;
  units: { volume: string; distance: string; temperature: string };
  languages: string[];
  phoneCode: string;
  bankSupport: BankConfig[];
  paymentMethods: PaymentMethod[];
}

interface FuelTypeConfig {
  code: string;
  name: string;
  localName: string;
  taxRate: number;
  levyRate: number;
  regulatoryBody: string;
}

interface ComplianceFeature {
  id: string;
  name: string;
  description: string;
  required: boolean;
  category: string;
}

interface BankConfig {
  code: string;
  name: string;
  supportsApi: boolean;
  supportsStatementImport: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  provider: string;
  chargeRate: number;
}

// ─── Tax rates for all countries ───
const TAX_RATES: Record<string, number> = {
  KE: 0.16,
  UG: 0.18,
  TZ: 0.18,
  NG: 0.075,
  ZA: 0.15,
  GH: 0.15,
  RW: 0.18,
  ET: 0.15,
  US: 0,
  CA: 0.13,
  GB: 0.2,
  DE: 0.19,
  FR: 0.2,
  IT: 0.22,
  ES: 0.21,
  NL: 0.21,
  BE: 0.21,
  AT: 0.2,
  PT: 0.23,
  GR: 0.24,
  FI: 0.24,
  SE: 0.25,
  NO: 0.25,
  DK: 0.25,
  CH: 0.077,
  AE: 0.05,
  SA: 0.15,
  QA: 0,
  KW: 0,
  BH: 0.1,
  OM: 0.05,
  JO: 0.16,
  LB: 0.11,
  IN: 0.18,
  PK: 0.17,
  BD: 0.15,
  LK: 0.12,
  NP: 0.13,
  CN: 0.13,
  JP: 0.1,
  KR: 0.1,
  SG: 0.09,
  MY: 0.1,
  TH: 0.07,
  VN: 0.1,
  ID: 0.11,
  PH: 0.12,
  AU: 0.1,
  NZ: 0.15,
  BR: 0.17,
  MX: 0.16,
  AR: 0.21,
  CL: 0.19,
  CO: 0.19,
  PE: 0.18,
  UY: 0.22,
  RU: 0.2,
  UA: 0.2,
  PL: 0.23,
  CZ: 0.21,
  HU: 0.27,
  RO: 0.19,
  BG: 0.2,
  HR: 0.25,
  ZM: 0.16,
  ZW: 0.15,
  BW: 0.14,
  MZ: 0.17,
  MW: 0.165,
  NA: 0.15,
  SZ: 0.15,
  DZ: 0.19,
  MA: 0.2,
  TN: 0.19,
  LY: 0,
  EG: 0.14,
  SD: 0,
  SS: 0.18,
  ML: 0.18,
  BF: 0.18,
  SN: 0.18,
  CI: 0.18,
  TG: 0.18,
  BJ: 0.18,
  CM: 0.1925,
  CD: 0.16,
  CG: 0.16,
  GA: 0.18,
  GQ: 0.15,
  ST: 0,
  GA_2: 0.15,
  SL: 0.15,
  LR: 0.1,
  GN: 0.18,
  GW: 0.15,
  MR: 0.16,
  NE: 0.19,
  TD: 0.19,
  CF: 0.19,
  DJ: 0.1,
  ER: 0.1,
  SO: 0.1,
  KM: 0,
  MG: 0.2,
  MU: 0.15,
  SC: 0.15,
  CV: 0.155,
  GM: 0.15,
};

// ─── Timezone map ───
const TIMEZONES: Record<string, string> = {
  KE: "Africa/Nairobi",
  UG: "Africa/Kampala",
  TZ: "Africa/Dar_es_Salaam",
  NG: "Africa/Lagos",
  ZA: "Africa/Johannesburg",
  GH: "Africa/Accra",
  RW: "Africa/Kigali",
  ET: "Africa/Addis_Ababa",
  US: "America/New_York",
  CA: "America/Toronto",
  GB: "Europe/London",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  AT: "Europe/Vienna",
  PT: "Europe/Lisbon",
  GR: "Europe/Athens",
  FI: "Europe/Helsinki",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  CH: "Europe/Zurich",
  IE: "Europe/Dublin",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
  OM: "Asia/Muscat",
  JO: "Asia/Amman",
  LB: "Asia/Beirut",
  IN: "Asia/Kolkata",
  PK: "Asia/Karachi",
  BD: "Asia/Dhaka",
  LK: "Asia/Colombo",
  NP: "Asia/Kathmandu",
  CN: "Asia/Shanghai",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  ID: "Asia/Jakarta",
  PH: "Asia/Manila",
  TW: "Asia/Taipei",
  HK: "Asia/Hong_Kong",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago",
  CO: "America/Bogota",
  PE: "America/Lima",
  UY: "America/Montevideo",
  RU: "Europe/Moscow",
  UA: "Europe/Kiev",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  HU: "Europe/Budapest",
  RO: "Europe/Bucharest",
  BG: "Europe/Sofia",
  HR: "Europe/Zagreb",
  ZM: "Africa/Lusaka",
  ZW: "Africa/Harare",
  BW: "Africa/Gaborone",
  MZ: "Africa/Maputo",
  MW: "Africa/Blantyre",
  NA: "Africa/Windhoek",
  SZ: "Africa/Mbabane",
  DZ: "Africa/Algiers",
  MA: "Africa/Casablanca",
  TN: "Africa/Tunis",
  LY: "Africa/Tripoli",
  EG: "Africa/Cairo",
  SD: "Africa/Khartoum",
  SS: "Africa/Juba",
  ML: "Africa/Bamako",
  BF: "Africa/Ouagadougou",
  SN: "Africa/Dakar",
  CI: "Africa/Abidjan",
  TG: "Africa/Lome",
  BJ: "Africa/Porto-Novo",
  CM: "Africa/Douala",
  CD: "Africa/Kinshasa",
  CG: "Africa/Brazzaville",
  GA: "Africa/Libreville",
  GQ: "Africa/Malabo",
  ST: "Africa/Sao_Tome",
};

// ─── Phone code map ───
const PHONE_CODES: Record<string, string> = {
  KE: "+254",
  UG: "+256",
  TZ: "+255",
  NG: "+234",
  ZA: "+27",
  GH: "+233",
  RW: "+250",
  ET: "+251",
  US: "+1",
  CA: "+1",
  GB: "+44",
  DE: "+49",
  FR: "+33",
  IT: "+39",
  ES: "+34",
  NL: "+31",
  BE: "+32",
  AT: "+43",
  PT: "+351",
  GR: "+30",
  FI: "+358",
  SE: "+46",
  NO: "+47",
  DK: "+45",
  CH: "+41",
  IE: "+353",
  AE: "+971",
  SA: "+966",
  QA: "+974",
  KW: "+965",
  BH: "+973",
  OM: "+968",
  JO: "+962",
  LB: "+961",
  IN: "+91",
  PK: "+92",
  BD: "+880",
  LK: "+94",
  NP: "+977",
  CN: "+86",
  JP: "+81",
  KR: "+82",
  SG: "+65",
  MY: "+60",
  TH: "+66",
  VN: "+84",
  ID: "+62",
  PH: "+63",
  TW: "+886",
  HK: "+852",
  AU: "+61",
  NZ: "+64",
  BR: "+55",
  MX: "+52",
  AR: "+54",
  CL: "+56",
  CO: "+57",
  PE: "+51",
  UY: "+598",
  RU: "+7",
  UA: "+380",
  PL: "+48",
  CZ: "+420",
  HU: "+36",
  RO: "+40",
  BG: "+359",
  HR: "+385",
};

// ─── 8 core countries with detailed configs ───
export const REGIONAL_CONFIGS: Record<string, RegionalConfig> = {
  kenya: {
    country: "Kenya",
    countryCode: "KE",
    currency: "KES",
    currencySymbol: "KSh",
    taxAuthority: "Kenya Revenue Authority",
    taxAuthorityShort: "KRA",
    vatRate: 0.16,
    vatName: "VAT",
    hasETR: true,
    etrName: "ETR",
    etrFormat: "ETR-{station}-{date}-{sequence}",
    fuelRegulator: "Energy and Petroleum Regulatory Authority",
    fuelRegulatorShort: "EPRA",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Super Petrol",
        taxRate: 0.16,
        levyRate: 0,
        regulatoryBody: "EPRA",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0.16,
        levyRate: 0,
        regulatoryBody: "EPRA",
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "EPRA",
      },
    ],
    requiredPermits: [
      "KRA VAT Registration",
      "EPRA License",
      "Nema Environmental Certificate",
      "County Trade License",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: ["KRA PIN", "ETR Serial", "Date/Time", "Itemized VAT"],
    complianceFeatures: [
      {
        id: "kra-vat",
        name: "KRA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "epra-pricing",
        name: "EPRA Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
      {
        id: "kra-itax",
        name: "iTax Integration",
        description: "Electronic tax filing system",
        required: true,
        category: "Tax",
      },
      {
        id: "etims",
        name: "eTIMS Integration",
        description: "Electronic Tax Invoice Management System",
        required: true,
        category: "Tax",
      },
    ],
    holidays: [
      "Madaraka Day (Jun 1)",
      "Mashujaa Day (Oct 20)",
      "Jamhuri Day (Dec 12)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Nairobi",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English", "Swahili"],
    phoneCode: "+254",
    bankSupport: [
      {
        code: "kcb",
        name: "KCB Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "equity",
        name: "Equity Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "coop",
        name: "Co-operative Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
      {
        code: "ncba",
        name: "NCBA Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "mpesa",
        name: "M-PESA",
        type: "mobile",
        provider: "Safaricom",
        chargeRate: 0,
      },
      {
        id: "airtel-money",
        name: "Airtel Money",
        type: "mobile",
        provider: "Airtel",
        chargeRate: 0,
      },
      {
        id: "equitel",
        name: "Equitel Money",
        type: "mobile",
        provider: "Equitel",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  uganda: {
    country: "Uganda",
    countryCode: "UG",
    currency: "UGX",
    currencySymbol: "USh",
    taxAuthority: "Uganda Revenue Authority",
    taxAuthorityShort: "URA",
    vatRate: 0.18,
    vatName: "VAT",
    hasETR: true,
    etrName: "EFRIS",
    etrFormat: "EFRIS-{station}-{date}-{sequence}",
    fuelRegulator: "Ministry of Energy and Mineral Development",
    fuelRegulatorShort: "MEMD",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Petrol",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "MEMD",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "MEMD",
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "MEMD",
      },
    ],
    requiredPermits: [
      "URA TIN Certificate",
      "MEMD Petroleum License",
      "Local Government Trade License",
      "Environmental Impact Certificate",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "URA TIN",
      "EFRIS Invoice Number",
      "Date/Time",
      "VAT Amount",
      "Station Details",
    ],
    complianceFeatures: [
      {
        id: "ura-vat",
        name: "URA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "efris",
        name: "EFRIS Integration",
        description: "Electronic Fiscal Receipting and Invoicing System",
        required: true,
        category: "Tax",
      },
      {
        id: "memd-pricing",
        name: "MEMD Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: [
      "Independence Day (Oct 9)",
      "Martyr's Day (Jun 3)",
      "Boxing Day (Dec 26)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Kampala",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English", "Swahili", "Luganda"],
    phoneCode: "+256",
    bankSupport: [
      {
        code: "stanbic",
        name: "Stanbic Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "centenary",
        name: "Centenary Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
      {
        code: "dfc",
        name: "DFCU Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "mtn-momo",
        name: "MTN Mobile Money",
        type: "mobile",
        provider: "MTN",
        chargeRate: 0,
      },
      {
        id: "airtel-money",
        name: "Airtel Money",
        type: "mobile",
        provider: "Airtel",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  tanzania: {
    country: "Tanzania",
    countryCode: "TZ",
    currency: "TZS",
    currencySymbol: "TSh",
    taxAuthority: "Tanzania Revenue Authority",
    taxAuthorityShort: "TRA",
    vatRate: 0.18,
    vatName: "VAT",
    hasETR: true,
    etrName: "EFD",
    etrFormat: "EFD-{station}-{date}-{sequence}",
    fuelRegulator: "Energy and Water Utilities Regulatory Authority",
    fuelRegulatorShort: "EWURA",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Petroli",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "EWURA",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Dizeli",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "EWURA",
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Mafuta ya taa",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "EWURA",
      },
    ],
    requiredPermits: [
      "TRA TIN Certificate",
      "EWURA License",
      "Business License",
      "Fire Safety Certificate",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "TRA TIN",
      "EFD Receipt Number",
      "Date/Time",
      "VAT Amount",
    ],
    complianceFeatures: [
      {
        id: "tra-vat",
        name: "TRA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "efd",
        name: "EFD Integration",
        description: "Electronic Fiscal Device",
        required: true,
        category: "Tax",
      },
      {
        id: "ewura-pricing",
        name: "EWURA Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: [
      "Union Day (Apr 26)",
      "Saba Saba (Jul 7)",
      "Independence Day (Dec 9)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Dar_es_Salaam",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["Swahili", "English"],
    phoneCode: "+255",
    bankSupport: [
      {
        code: "crdb",
        name: "CRDB Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "nbc",
        name: "NBC Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "nmb",
        name: "NMB Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "mpesa",
        name: "M-PESA",
        type: "mobile",
        provider: "Vodacom",
        chargeRate: 0,
      },
      {
        id: "tigo-pesa",
        name: "Tigo Pesa",
        type: "mobile",
        provider: "Tigo",
        chargeRate: 0,
      },
      {
        id: "airtel-money",
        name: "Airtel Money",
        type: "mobile",
        provider: "Airtel",
        chargeRate: 0,
      },
      {
        id: "halopesa",
        name: "Halopesa",
        type: "mobile",
        provider: "Halotel",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  nigeria: {
    country: "Nigeria",
    countryCode: "NG",
    currency: "NGN",
    currencySymbol: "₦",
    taxAuthority: "Federal Inland Revenue Service",
    taxAuthorityShort: "FIRS",
    vatRate: 0.075,
    vatName: "VAT",
    hasETR: true,
    etrName: "FIRS e-Invoice",
    etrFormat: "FIRS-{station}-{date}-{sequence}",
    fuelRegulator:
      "Nigerian Midstream and Downstream Petroleum Regulatory Authority",
    fuelRegulatorShort: "NMDPRA",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Petrol",
        taxRate: 0.075,
        levyRate: 0,
        regulatoryBody: "NMDPRA",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0.075,
        levyRate: 0,
        regulatoryBody: "NMDPRA",
      },
      {
        code: "DPK",
        name: "Dual Purpose Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "NMDPRA",
      },
    ],
    requiredPermits: [
      "FIRS TIN",
      "NMDPRA License",
      "DPR Permit",
      "State Business Permit",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "FIRS TIN",
      "Invoice Number",
      "Date/Time",
      "VAT Breakdown",
    ],
    complianceFeatures: [
      {
        id: "firs-vat",
        name: "FIRS VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "nmdpra-pricing",
        name: "NMDPRA Price Control",
        description: "Regulated petroleum pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: [
      "Independence Day (Oct 1)",
      "Democracy Day (Jun 12)",
      "Workers Day (May 1)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Lagos",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English", "Hausa", "Yoruba", "Igbo"],
    phoneCode: "+234",
    bankSupport: [
      {
        code: "gtb",
        name: "GTBank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "firstbank",
        name: "First Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "access",
        name: "Access Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "zenith",
        name: "Zenith Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "opay",
        name: "OPay",
        type: "mobile",
        provider: "OPay",
        chargeRate: 0,
      },
      {
        id: "palmpay",
        name: "PalmPay",
        type: "mobile",
        provider: "PalmPay",
        chargeRate: 0,
      },
      {
        id: "paystack",
        name: "Paystack",
        type: "online",
        provider: "Paystack",
        chargeRate: 0.015,
      },
      {
        id: "flutterwave",
        name: "Flutterwave",
        type: "online",
        provider: "Flutterwave",
        chargeRate: 0.014,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  southafrica: {
    country: "South Africa",
    countryCode: "ZA",
    currency: "ZAR",
    currencySymbol: "R",
    taxAuthority: "South African Revenue Service",
    taxAuthorityShort: "SARS",
    vatRate: 0.15,
    vatName: "VAT",
    hasETR: true,
    etrName: "SARS eFiling",
    etrFormat: "SARS-{station}-{date}-{sequence}",
    fuelRegulator: "Department of Mineral Resources and Energy",
    fuelRegulatorShort: "DMRE",
    fuelTypes: [
      {
        code: "ULP93",
        name: "Unleaded Petrol 93",
        localName: "Petrol 93",
        taxRate: 0.15,
        levyRate: 0,
        regulatoryBody: "DMRE",
      },
      {
        code: "ULP95",
        name: "Unleaded Petrol 95",
        localName: "Petrol 95",
        taxRate: 0.15,
        levyRate: 0,
        regulatoryBody: "DMRE",
      },
      {
        code: "D50",
        name: "Diesel 50ppm",
        localName: "Diesel",
        taxRate: 0.15,
        levyRate: 0,
        regulatoryBody: "DMRE",
      },
      {
        code: "LPG",
        name: "Liquefied Petroleum Gas",
        localName: "LPG",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "DMRE",
      },
    ],
    requiredPermits: [
      "SARS VAT Registration",
      "DMRE License",
      "Local Municipality License",
      "Environmental Authorization",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "SARS VAT Number",
      "Tax Invoice",
      "Date/Time",
      "VAT Amount",
    ],
    complianceFeatures: [
      {
        id: "sars-vat",
        name: "SARS VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "dmre-pricing",
        name: "DMRE Fuel Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
      {
        id: "road-accident-fund",
        name: "RAF Levy",
        description: "Road Accident Fund levy collection",
        required: true,
        category: "Tax",
      },
    ],
    holidays: [
      "Freedom Day (Apr 27)",
      "Youth Day (Jun 16)",
      "Heritage Day (Sep 24)",
    ],
    dateFormat: "YYYY/MM/DD",
    timeZone: "Africa/Johannesburg",
    decimalSeparator: ".",
    thousandSeparator: " ",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English", "Afrikaans", "isiZulu", "isiXhosa"],
    phoneCode: "+27",
    bankSupport: [
      {
        code: "fnb",
        name: "First National Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "standard",
        name: "Standard Bank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "absa",
        name: "Absa",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "nedbank",
        name: "Nedbank",
        supportsApi: true,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "snapscan",
        name: "SnapScan",
        type: "mobile",
        provider: "SnapScan",
        chargeRate: 0.03,
      },
      {
        id: "zapper",
        name: "Zapper",
        type: "mobile",
        provider: "Zapper",
        chargeRate: 0.025,
      },
      { id: "eft", name: "EFT", type: "bank", provider: "Bank", chargeRate: 0 },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  ghana: {
    country: "Ghana",
    countryCode: "GH",
    currency: "GHS",
    currencySymbol: "GH₵",
    taxAuthority: "Ghana Revenue Authority",
    taxAuthorityShort: "GRA",
    vatRate: 0.15,
    vatName: "VAT",
    hasETR: true,
    etrName: "VAT Invoice",
    etrFormat: "GRA-{station}-{date}-{sequence}",
    fuelRegulator: "National Petroleum Authority",
    fuelRegulatorShort: "NPA",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Petrol",
        taxRate: 0.15,
        levyRate: 0,
        regulatoryBody: "NPA",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0.15,
        levyRate: 0,
        regulatoryBody: "NPA",
      },
      {
        code: "LPG",
        name: "Liquefied Petroleum Gas",
        localName: "LPG",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "NPA",
      },
    ],
    requiredPermits: [
      "GRA TIN",
      "NPA License",
      "EPA Permit",
      "Local Authority Permit",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "GRA TIN",
      "VAT Invoice Number",
      "Date/Time",
      "VAT Amount",
    ],
    complianceFeatures: [
      {
        id: "gra-vat",
        name: "GRA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "npa-pricing",
        name: "NPA Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: [
      "Independence Day (Mar 6)",
      "Founder's Day (Sep 21)",
      "Republic Day (Jul 1)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Accra",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English", "Twi", "Ga", "Ewe"],
    phoneCode: "+233",
    bankSupport: [
      {
        code: "gcb",
        name: "GCB Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
      {
        code: "ecobank",
        name: "Ecobank",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "absa-gh",
        name: "Absa Ghana",
        supportsApi: true,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "mtn-momo",
        name: "MTN MoMo",
        type: "mobile",
        provider: "MTN",
        chargeRate: 0,
      },
      {
        id: "vodafone-cash",
        name: "Vodafone Cash",
        type: "mobile",
        provider: "Vodafone",
        chargeRate: 0,
      },
      {
        id: "airteltigo-money",
        name: "AirtelTigo Money",
        type: "mobile",
        provider: "AirtelTigo",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  rwanda: {
    country: "Rwanda",
    countryCode: "RW",
    currency: "RWF",
    currencySymbol: "RF",
    taxAuthority: "Rwanda Revenue Authority",
    taxAuthorityShort: "RRA",
    vatRate: 0.18,
    vatName: "VAT",
    hasETR: true,
    etrName: "EBM",
    etrFormat: "EBM-{station}-{date}-{sequence}",
    fuelRegulator: "Rwanda Utilities Regulatory Authority",
    fuelRegulatorShort: "RURA",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Essence",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "RURA",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Gasoil",
        taxRate: 0.18,
        levyRate: 0,
        regulatoryBody: "RURA",
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "RURA",
      },
    ],
    requiredPermits: [
      "RRA TIN",
      "RURA License",
      "RDB Business Registration",
      "RMB Permit",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "RRA TIN",
      "EBM Invoice Number",
      "Date/Time",
      "VAT Amount",
    ],
    complianceFeatures: [
      {
        id: "rra-vat",
        name: "RRA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "ebm",
        name: "EBM Integration",
        description: "Electronic Billing Machine",
        required: true,
        category: "Tax",
      },
      {
        id: "rura-pricing",
        name: "RURA Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: [
      "Independence Day (Jul 1)",
      "Liberation Day (Jul 4)",
      "Umuganura (Aug 1)",
    ],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Kigali",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["Kinyarwanda", "English", "French"],
    phoneCode: "+250",
    bankSupport: [
      {
        code: "bok",
        name: "Bank of Kigali",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "equity-rw",
        name: "Equity Bank Rwanda",
        supportsApi: true,
        supportsStatementImport: true,
      },
      {
        code: "im",
        name: "I&M Bank",
        supportsApi: false,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "mtn-momo",
        name: "MTN MoMo",
        type: "mobile",
        provider: "MTN",
        chargeRate: 0,
      },
      {
        id: "airtel-money",
        name: "Airtel Money",
        type: "mobile",
        provider: "Airtel",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  },
  ethiopia: {
    country: "Ethiopia",
    countryCode: "ET",
    currency: "ETB",
    currencySymbol: "Br",
    taxAuthority: "Ethiopian Revenue and Customs Authority",
    taxAuthorityShort: "ERCA",
    vatRate: 0.15,
    vatName: "VAT",
    hasETR: true,
    etrName: "VAT Receipt",
    etrFormat: "ERCA-{station}-{date}-{sequence}",
    fuelRegulator: "Ethiopian Petroleum Supply Enterprise",
    fuelRegulatorShort: "EPSE",
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Benzene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "EPSE",
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "EPSE",
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: "EPSE",
      },
    ],
    requiredPermits: [
      "ERCA Taxpayer Registration",
      "EPSE Distribution License",
      "ERCA VAT/TIN Registration",
      "Trade License",
      "Environmental Certificate",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: [
      "Tax invoice",
      "Date and time",
      "VAT amount",
      "Total amount",
    ],
    complianceFeatures: [
      {
        id: "erca-vat",
        name: "ERCA VAT Filing",
        description: "Monthly VAT return filing",
        required: true,
        category: "Tax",
      },
      {
        id: "epse-pricing",
        name: "EPSE Price Control",
        description: "Government-controlled fuel pricing",
        required: true,
        category: "Pricing",
      },
    ],
    holidays: ["Victory Day (May 5)", "Enkutatash (Sept 11)"],
    dateFormat: "DD/MM/YYYY",
    timeZone: "Africa/Addis_Ababa",
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["Amharic", "English", "Oromo"],
    phoneCode: "+251",
    bankSupport: [
      {
        code: "cbe",
        name: "Commercial Bank of Ethiopia",
        supportsApi: false,
        supportsStatementImport: true,
      },
    ],
    paymentMethods: [
      {
        id: "telebirr",
        name: "Telebirr",
        type: "mobile",
        provider: "Ethio Telecom",
        chargeRate: 0,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
    ],
  },
};

// ─── Dynamic fallback config generator for ALL other countries ───
function generateDefaultConfig(
  countryCode: string,
  countryName: string,
  currency: string,
): RegionalConfig {
  const code = countryCode.toUpperCase();
  const taxRate = TAX_RATES[code] || 0;
  const tz = TIMEZONES[code] || "UTC";
  const phone = PHONE_CODES[code] || "";

  // Resolve the proper currency symbol (e.g. "$" for USD, "€" for EUR) rather
  // than using the raw currency code as the symbol. Falls back to the code
  // itself when no known symbol mapping exists.
  const symbolFor = (() => {
    try {
      const map: Record<string, string> = {
        USD: "$",
        EUR: "€",
        GBP: "£",
        JPY: "¥",
        CNY: "¥",
        INR: "₹",
        KRW: "₩",
        RUB: "₽",
        BRL: "R$",
        CHF: "Fr",
        SEK: "kr",
        NOK: "kr",
        DKK: "kr",
        PLN: "zł",
        CZK: "Kč",
        HUF: "Ft",
        TRY: "₺",
        ILS: "₪",
        THB: "฿",
        VND: "₫",
        IDR: "Rp",
        MYR: "RM",
        PHP: "₱",
        SGD: "S$",
        HKD: "HK$",
        TWD: "NT$",
        UAH: "₴",
        RON: "lei",
        BGN: "лв",
        HRK: "kn",
        ISK: "kr",
        MXN: "$",
        ARS: "$",
        CLP: "$",
        COP: "$",
        PEN: "S/",
        ZAR: "R",
        EGP: "E£",
        NGN: "₦",
        GHS: "GH₵",
        KES: "KSh",
        TZS: "TSh",
        UGX: "USh",
        RWF: "FRw",
        ETB: "Br",
        MAD: "DH",
        DZD: "DA",
        TND: "DT",
        AUD: "A$",
        NZD: "NZ$",
        CAD: "C$",
      };
      return map[currency.toUpperCase()] || currency;
    } catch {
      return currency;
    }
  })();

  return {
    country: countryName,
    countryCode: code,
    currency,
    currencySymbol: symbolFor,
    taxAuthority: `${countryName} Tax Authority`,
    taxAuthorityShort: `${code}TA`,
    vatRate: taxRate,
    vatName: taxRate > 0 ? "VAT" : "Tax",
    hasETR: taxRate > 0,
    etrName: taxRate > 0 ? "Electronic Receipt" : "",
    etrFormat: `${code}-{station}-{date}-{sequence}`,
    fuelRegulator: `${countryName} Energy/Fuel Regulatory Authority`,
    fuelRegulatorShort: `${code}ERA`,
    fuelTypes: [
      {
        code: "PMS",
        name: "Premium Motor Spirit",
        localName: "Petrol",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: `${code}ERA`,
      },
      {
        code: "AGO",
        name: "Automotive Gas Oil",
        localName: "Diesel",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: `${code}ERA`,
      },
      {
        code: "IK",
        name: "Illuminating Kerosene",
        localName: "Kerosene",
        taxRate: 0,
        levyRate: 0,
        regulatoryBody: `${code}ERA`,
      },
    ],
    requiredPermits: [
      `${countryName} Business License`,
      "Fuel Distribution License",
    ],
    reportingFrequency: "monthly",
    receiptRequirements: ["Tax invoice", "Date and time", "Total amount"],
    complianceFeatures: [
      {
        id: `${code.toLowerCase()}-vat`,
        name: "VAT Filing",
        description: "Monthly VAT return filing",
        required: taxRate > 0,
        category: "Tax",
      },
      {
        id: `${code.toLowerCase()}-pricing`,
        name: "Fuel Price Control",
        description: "Government-controlled fuel pricing",
        required: false,
        category: "Pricing",
      },
    ],
    holidays: [],
    dateFormat: "DD/MM/YYYY",
    timeZone: tz,
    decimalSeparator: ".",
    thousandSeparator: ",",
    units: { volume: "Litres", distance: "Kilometres", temperature: "Celsius" },
    languages: ["English"],
    phoneCode: phone,
    bankSupport: [
      {
        code: "default",
        name: `${countryName} National Bank`,
        supportsApi: false,
        supportsStatementImport: false,
      },
    ],
    paymentMethods: [
      {
        id: "card",
        name: "Card Payment",
        type: "card",
        provider: "Bank",
        chargeRate: 0.015,
      },
      {
        id: "bank",
        name: "Bank Transfer",
        type: "bank",
        provider: "Bank",
        chargeRate: 0,
      },
      {
        id: "cash",
        name: "Cash",
        type: "cash",
        provider: "Cash",
        chargeRate: 0,
      },
    ],
  };
}

// ─── Country name to key mapping ───
function countryKeyFromCode(code: string): string {
  const map: Record<string, string> = {
    KE: "kenya",
    UG: "uganda",
    TZ: "tanzania",
    NG: "nigeria",
    ZA: "southafrica",
    GH: "ghana",
    RW: "rwanda",
    ET: "ethiopia",
  };
  return map[code.toUpperCase()] || "";
}

// ─── Get regional config for ANY country (250+ supported) ───
export function getRegionalConfig(countryKeyOrCode: string): RegionalConfig {
  const upper = countryKeyOrCode.toUpperCase();

  // Check if it's one of the 8 detailed countries
  const key = countryKeyFromCode(upper) || countryKeyOrCode.toLowerCase();
  if (REGIONAL_CONFIGS[key]) {
    return REGIONAL_CONFIGS[key];
  }

  // Check if it's a country code we can look up in world configs
  const worldConfig = WORLD_PAYMENT_CONFIGS[upper];
  if (worldConfig) {
    return generateDefaultConfig(
      upper,
      worldConfig.countryName,
      worldConfig.defaultCurrency,
    );
  }

  // Check if countryKeyOrCode is a country name
  const byName = Object.values(WORLD_PAYMENT_CONFIGS).find(
    (c) => c.countryName.toLowerCase() === countryKeyOrCode.toLowerCase(),
  );
  if (byName) {
    return generateDefaultConfig(
      byName.countryCode,
      byName.countryName,
      byName.defaultCurrency,
    );
  }

  // Ultimate fallback: neutral international default (USD / UTC), NOT Kenya.
  // A world-wide app must never force Kenya-specific currency/timezone/tax on
  // an unknown country.
  return generateDefaultConfig("__", "International", "USD");
}

// ─── Get ALL countries (250+) ───
export function getAllCountries(): {
  key: string;
  name: string;
  code: string;
  currency: string;
}[] {
  return Object.entries(WORLD_PAYMENT_CONFIGS).map(([code, config]) => ({
    key: code.toLowerCase(),
    name: config.countryName,
    code,
    currency: config.defaultCurrency,
  }));
}

// ─── Get country by code ───
export function getCountryByCode(
  code: string,
): { key: string; name: string; code: string; currency: string } | undefined {
  const config = WORLD_PAYMENT_CONFIGS[code.toUpperCase()];
  if (!config) return undefined;
  return {
    key: code.toLowerCase(),
    name: config.countryName,
    code: code.toUpperCase(),
    currency: config.defaultCurrency,
  };
}
