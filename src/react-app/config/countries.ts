// Comprehensive country-specific configurations for FuelPro
// Each country profile includes: currency, mobile money, revenue authority, payment methods, units, language, etc.

export interface MobileMoneyProvider {
  id: string;
  name: string;
  shortCode: string; // e.g., *100#, *185#
  paybillNumber?: string; // e.g., 522522
  apiEndpoint?: string;
  stkPushSupported: boolean;
  transferSupported: boolean;
  agentNetwork: string; // description of agent network
}

export interface RevenueAuthority {
  name: string;
  shortName: string;
  pinLabel: string; // e.g., "KRA PIN", "TIN"
  vatRate: number; // percentage
  vatName: string; // e.g., "VAT", "Value Added Tax"
  withholdingTax: number;
  exciseDuty: number; // for fuel
  regulatoryLevy: number;
  roadMaintenanceLevy: number;
  petroleumDevelopmentLevy: number;
  customsDuty: number;
  website: string;
  supportPhone: string;
  supportEmail: string;
  eFilingPortal: string;
  etimsRequired: boolean;
  electronicInvoiceRequired: boolean;
  fiscalDeviceRequired: boolean;
  monthlyReturnDue: string; // e.g., "20th of following month"
  annualReturnDue: string;
}

export interface PayrollConfig {
  payeThreshold: number; // tax-free threshold
  payeRates: { from: number; to: number; rate: number }[];
  nssfRequired: boolean;
  nssfLabel: string; // e.g., "NSSF", "Social Security"
  nssfEmployeeRate: number;
  nssfEmployerRate: number;
  nhifRequired: boolean;
  nhifLabel: string; // e.g., "NHIF", "Health Insurance"
  nhifRates: { minSalary: number; maxSalary: number; amount: number }[];
  housingLevy: boolean;
  housingLevyRate: number;
  pensionFund: boolean;
  pensionRate: number;
  statutoryHolidays: string[]; // ISO dates or month-day
  minimumWage: number; // monthly
  workingHoursPerWeek: number;
  overtimeRate: number; // multiplier
  severancePayRequired: boolean;
  severanceFormula: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  icon: string;
  available: boolean;
  processingFee: number; // percentage
  settlementTime: string;
}

export interface CommunicationConfig {
  smsGateway: string;
  smsShortcode: string;
  whatsappFormat: string; // e.g., "254XXXXXXXXX"
  phoneFormat: string;
  countryCode: string;
  emergencyNumbers: { label: string; number: string }[];
  localCarriers: string[];
  defaultMessage?: string;
  whatsappEnabled?: boolean;
}

export interface UnitMeasures {
  fuelVolume: string; // "liters", "gallons", "litres"
  volume?: string; // alias for fuelVolume
  currency?: string; // "KES", "USD"
  distance: string; // "km", "miles"
  weight: string; // "kg", "lbs"
  tankCapacity: string;
  fuelEfficiency: string; // "km/L", "mpg"
}

export interface NewsSource {
  name: string;
  url: string;
  category: string;
}

export interface ComplianceDocument {
  name: string;
  required: boolean;
  frequency: string; // "monthly", "quarterly", "annual"
  authority: string;
}

export interface CountryProfile {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  region: string;
  languages: string[];
  defaultLanguage: string;
  currency: {
    code: string;
    symbol: string;
    name: string;
    isoCode: string;
    subunit: string; // e.g., "cents", "tambala"
    exchangeRateToUSD: number; // approximate
  };
  mobileMoney: MobileMoneyProvider[];
  revenueAuthority: RevenueAuthority;
  payroll: PayrollConfig;
  paymentMethods: PaymentMethod[];
  communication: CommunicationConfig;
  units: UnitMeasures;
  dateFormat: string;
  timeFormat: string; // 12h or 24h
  numberFormat: string; // "1,000.00" or "1.000,00"
  newsSources: NewsSource[];
  complianceDocuments: ComplianceDocument[];
  fuelRegulations: {
    priceControlled: boolean; // government sets fuel prices
    priceSettingBody: string; // e.g., "EPRA", "EWURA"
    priceReviewFrequency: string;
    licensingRequired: boolean;
    licenseBody: string;
    environmentalLevy: number;
    qualityStandardsBody: string;
  };
  timezone: string;
  capital: string; // capital city, used as default station city fallback
}

// ============== KENYA ==============
const kenya: CountryProfile = {
  id: "KE",
  name: "Kenya",
  shortName: "Kenya",
  flag: "🇰🇪",
  region: "East Africa",
  languages: ["en", "sw"],
  defaultLanguage: "en",
  currency: {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    isoCode: "KES",
    subunit: "Cents",
    exchangeRateToUSD: 0.0077,
  },
  mobileMoney: [
    {
      id: "mpesa",
      name: "M-Pesa",
      shortCode: "*334#",
      paybillNumber: "522522",
      apiEndpoint: "/api/mpesa/stk-push",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "300,000+ agents nationwide",
    },
    {
      id: "airtel_money",
      name: "Airtel Money",
      shortCode: "*222#",
      paybillNumber: "524524",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "50,000+ agents",
    },
    {
      id: "tkash",
      name: "T-Kash",
      shortCode: "*160#",
      paybillNumber: "526526",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "20,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Kenya Revenue Authority",
    shortName: "KRA",
    pinLabel: "KRA PIN",
    vatRate: 16,
    vatName: "VAT",
    withholdingTax: 5,
    exciseDuty: 21.95, // per liter for super petrol
    regulatoryLevy: 0.75,
    roadMaintenanceLevy: 25.0,
    petroleumDevelopmentLevy: 5.4,
    customsDuty: 0,
    website: "https://www.kra.go.ke",
    supportPhone: "+254 20 2810000",
    supportEmail: "callcentre@kra.go.ke",
    eFilingPortal: "https://itax.kra.go.ke",
    etimsRequired: true,
    electronicInvoiceRequired: true,
    fiscalDeviceRequired: true,
    monthlyReturnDue: "20th of following month",
    annualReturnDue: "30th June",
  },
  payroll: {
    payeThreshold: 288000, // annual
    payeRates: [
      { from: 0, to: 288000, rate: 0 },
      { from: 288001, to: 388000, rate: 0.25 },
      { from: 388001, to: 6000000, rate: 0.3 },
      { from: 6000001, to: 9600000, rate: 0.325 },
      { from: 9600001, to: Infinity, rate: 0.35 },
    ],
    nssfRequired: true,
    nssfLabel: "NSSF",
    nssfEmployeeRate: 0.06,
    nssfEmployerRate: 0.06,
    nhifRequired: true,
    nhifLabel: "SHIF (Social Health Insurance Fund)",
    nhifRates: [
      { minSalary: 0, maxSalary: 5999, amount: 150 },
      { minSalary: 6000, maxSalary: 7999, amount: 300 },
      { minSalary: 8000, maxSalary: 11999, amount: 400 },
      { minSalary: 12000, maxSalary: 14999, amount: 500 },
      { minSalary: 15000, maxSalary: 19999, amount: 600 },
      { minSalary: 20000, maxSalary: 24999, amount: 750 },
      { minSalary: 25000, maxSalary: 29999, amount: 850 },
      { minSalary: 30000, maxSalary: 49999, amount: 1000 },
      { minSalary: 50000, maxSalary: 99999, amount: 1500 },
      { minSalary: 100000, maxSalary: Infinity, amount: 1700 },
    ],
    housingLevy: true,
    housingLevyRate: 0.015,
    pensionFund: true,
    pensionRate: 0.06,
    statutoryHolidays: [
      "01-01",
      "05-01",
      "06-01",
      "10-10",
      "10-20",
      "12-12",
      "12-25",
      "12-26",
    ],
    minimumWage: 15120,
    workingHoursPerWeek: 52,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "15 days per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "mpesa",
      name: "M-Pesa",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0.5,
      settlementTime: "1-2 business days",
    },
    {
      id: "card",
      name: "Card Payment",
      icon: "CreditCard",
      available: true,
      processingFee: 1.5,
      settlementTime: "T+1",
    },
    {
      id: "cheque",
      name: "Cheque",
      icon: "FileText",
      available: true,
      processingFee: 0,
      settlementTime: "3-5 business days",
    },
  ],
  communication: {
    smsGateway: "Twilio Africa",
    smsShortcode: "20880",
    whatsappFormat: "254XXXXXXXXX",
    phoneFormat: "+254 XXX XXX XXX",
    countryCode: "+254",
    emergencyNumbers: [
      { label: "Police", number: "999" },
      { label: "Ambulance", number: "999" },
      { label: "Fire", number: "999" },
      { label: "EPRA", number: "020 2847000" },
    ],
    localCarriers: ["Safaricom", "Airtel Kenya", "Telkom Kenya"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    {
      name: "The Standard",
      url: "https://www.standardmedia.co.ke",
      category: "general",
    },
    { name: "Daily Nation", url: "https://nation.africa", category: "general" },
    {
      name: "Business Daily",
      url: "https://www.businessdailyafrica.com",
      category: "business",
    },
    { name: "EPRA Updates", url: "https://www.epra.go.ke", category: "fuel" },
  ],
  complianceDocuments: [
    {
      name: "KRA Tax Compliance Certificate",
      required: true,
      frequency: "annual",
      authority: "KRA",
    },
    {
      name: "Nema License",
      required: true,
      frequency: "annual",
      authority: "NEMA",
    },
    {
      name: "County Business Permit",
      required: true,
      frequency: "annual",
      authority: "County Gov",
    },
    {
      name: "Fire Safety Certificate",
      required: true,
      frequency: "annual",
      authority: "Fire Dept",
    },
    {
      name: "Weights & Measures License",
      required: true,
      frequency: "annual",
      authority: "KEBS",
    },
    {
      name: "Petroleum License",
      required: true,
      frequency: "annual",
      authority: "EPRA",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Energy and Petroleum Regulatory Authority (EPRA)",
    priceReviewFrequency: "Monthly (14th of each month)",
    licensingRequired: true,
    licenseBody: "EPRA",
    environmentalLevy: 0.5,
    qualityStandardsBody: "KEBS (Kenya Bureau of Standards)",
  },
  capital: "Nairobi",
  timezone: "Africa/Nairobi",
};

// ============== UGANDA ==============
const uganda: CountryProfile = {
  id: "UG",
  name: "Uganda",
  shortName: "Uganda",
  flag: "🇺🇬",
  region: "East Africa",
  languages: ["en", "sw", "lg"],
  defaultLanguage: "en",
  currency: {
    code: "UGX",
    symbol: "USh",
    name: "Ugandan Shilling",
    isoCode: "UGX",
    subunit: "Cents",
    exchangeRateToUSD: 0.00027,
  },
  mobileMoney: [
    {
      id: "mtn_mobile_money",
      name: "MTN Mobile Money",
      shortCode: "*165#",
      paybillNumber: "555555",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "100,000+ agents",
    },
    {
      id: "airtel_money",
      name: "Airtel Money",
      shortCode: "*185#",
      paybillNumber: "444444",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "80,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Uganda Revenue Authority",
    shortName: "URA",
    pinLabel: "TIN",
    vatRate: 18,
    vatName: "VAT",
    withholdingTax: 6,
    exciseDuty: 1500, // UGX per liter
    regulatoryLevy: 200,
    roadMaintenanceLevy: 500,
    petroleumDevelopmentLevy: 100,
    customsDuty: 10,
    website: "https://www.ura.go.ug",
    supportPhone: "+256 417 338100",
    supportEmail: "info@ura.go.ug",
    eFilingPortal: "https://efiling.ura.go.ug",
    etimsRequired: true,
    electronicInvoiceRequired: true,
    fiscalDeviceRequired: false,
    monthlyReturnDue: "15th of following month",
    annualReturnDue: "31st December",
  },
  payroll: {
    payeThreshold: 235000, // monthly
    payeRates: [
      { from: 0, to: 235000, rate: 0 },
      { from: 235001, to: 335000, rate: 0.1 },
      { from: 335001, to: 410000, rate: 0.2 },
      { from: 410001, to: 10000000, rate: 0.3 },
      { from: 10000001, to: Infinity, rate: 0.4 },
    ],
    nssfRequired: true,
    nssfLabel: "NSSF",
    nssfEmployeeRate: 0.05,
    nssfEmployerRate: 0.1,
    nhifRequired: false,
    nhifLabel: "N/A",
    nhifRates: [],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.05,
    statutoryHolidays: [
      "01-01",
      "01-26",
      "03-08",
      "05-01",
      "06-03",
      "06-09",
      "10-09",
      "12-25",
      "12-26",
    ],
    minimumWage: 130000,
    workingHoursPerWeek: 48,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "One month per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "mtn_mm",
      name: "MTN Mobile Money",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "airtel_mm",
      name: "Airtel Money",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0.5,
      settlementTime: "1-2 business days",
    },
    {
      id: "card",
      name: "Card Payment",
      icon: "CreditCard",
      available: true,
      processingFee: 2,
      settlementTime: "T+2",
    },
  ],
  communication: {
    smsGateway: "MTN/Airtel SMS",
    smsShortcode: "8888",
    whatsappFormat: "256XXXXXXXXX",
    phoneFormat: "+256 XXX XXX XXX",
    countryCode: "+256",
    emergencyNumbers: [
      { label: "Police", number: "999" },
      { label: "Ambulance", number: "911" },
      { label: "URA", number: "0800 117 117" },
    ],
    localCarriers: ["MTN Uganda", "Airtel Uganda"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    {
      name: "Daily Monitor",
      url: "https://www.monitor.co.ug",
      category: "general",
    },
    {
      name: "New Vision",
      url: "https://www.newvision.co.ug",
      category: "general",
    },
    { name: "URA Updates", url: "https://www.ura.go.ug", category: "business" },
  ],
  complianceDocuments: [
    {
      name: "URA Tax Certificate",
      required: true,
      frequency: "annual",
      authority: "URA",
    },
    {
      name: "NEMA Certificate",
      required: true,
      frequency: "annual",
      authority: "NEMA",
    },
    {
      name: "Trading License",
      required: true,
      frequency: "annual",
      authority: "Local Council",
    },
    {
      name: "Petroleum License",
      required: true,
      frequency: "annual",
      authority: "Ministry of Energy",
    },
  ],
  fuelRegulations: {
    priceControlled: false,
    priceSettingBody: "Ministry of Energy and Mineral Development",
    priceReviewFrequency: "Monthly guidance",
    licensingRequired: true,
    licenseBody: "Petroleum Authority of Uganda",
    environmentalLevy: 100,
    qualityStandardsBody: "UNBS (Uganda National Bureau of Standards)",
  },
  timezone: "Africa/Kampala",
  capital: "Kampala",
};

// ============== TANZANIA ==============
const tanzania: CountryProfile = {
  id: "TZ",
  name: "Tanzania",
  shortName: "Tanzania",
  flag: "🇹🇿",
  region: "East Africa",
  languages: ["en", "sw"],
  defaultLanguage: "sw",
  currency: {
    code: "TZS",
    symbol: "TSh",
    name: "Tanzanian Shilling",
    isoCode: "TZS",
    subunit: "Senti",
    exchangeRateToUSD: 0.00037,
  },
  mobileMoney: [
    {
      id: "mpesa",
      name: "M-Pesa",
      shortCode: "*150*00#",
      paybillNumber: "123123",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "150,000+ agents",
    },
    {
      id: "tigo_pesa",
      name: "Tigo Pesa",
      shortCode: "*150*01#",
      paybillNumber: "321321",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "100,000+ agents",
    },
    {
      id: "airtel_money",
      name: "Airtel Money",
      shortCode: "*150*60#",
      paybillNumber: "456456",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "80,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Tanzania Revenue Authority",
    shortName: "TRA",
    pinLabel: "TIN",
    vatRate: 18,
    vatName: "VAT",
    withholdingTax: 5,
    exciseDuty: 349, // TZS per liter
    regulatoryLevy: 50,
    roadMaintenanceLevy: 200,
    petroleumDevelopmentLevy: 100,
    customsDuty: 0,
    website: "https://www.tra.go.tz",
    supportPhone: "+255 22 2129000",
    supportEmail: "info@tra.go.tz",
    eFilingPortal: "https:// taxpayersportal.tra.go.tz",
    etimsRequired: true,
    electronicInvoiceRequired: true,
    fiscalDeviceRequired: true,
    monthlyReturnDue: "20th of following month",
    annualReturnDue: "30th April",
  },
  payroll: {
    payeThreshold: 270000, // monthly
    payeRates: [
      { from: 0, to: 270000, rate: 0 },
      { from: 270001, to: 520000, rate: 0.08 },
      { from: 520001, to: 760000, rate: 0.2 },
      { from: 760001, to: 1000000, rate: 0.25 },
      { from: 1000001, to: Infinity, rate: 0.3 },
    ],
    nssfRequired: true,
    nssfLabel: "NSSF",
    nssfEmployeeRate: 0.1,
    nssfEmployerRate: 0.1,
    nhifRequired: true,
    nhifLabel: "NHIF",
    nhifRates: [
      { minSalary: 0, maxSalary: 200000, amount: 0 },
      { minSalary: 200001, maxSalary: 500000, amount: 10000 },
      { minSalary: 500001, maxSalary: 1000000, amount: 20000 },
      { minSalary: 1000001, maxSalary: Infinity, amount: 30000 },
    ],
    housingLevy: true,
    housingLevyRate: 0.03,
    pensionFund: true,
    pensionRate: 0.1,
    statutoryHolidays: [
      "01-01",
      "01-12",
      "04-07",
      "04-18",
      "05-01",
      "07-07",
      "08-08",
      "10-14",
      "12-09",
      "12-25",
      "12-26",
    ],
    minimumWage: 300000,
    workingHoursPerWeek: 45,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "7 days per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "mpesa",
      name: "M-Pesa",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "tigo_pesa",
      name: "Tigo Pesa",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "airtel_money",
      name: "Airtel Money",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0.5,
      settlementTime: "1-2 business days",
    },
  ],
  communication: {
    smsGateway: "Vodacom/Airtel SMS",
    smsShortcode: "15311",
    whatsappFormat: "255XXXXXXXXX",
    phoneFormat: "+255 XXX XXX XXX",
    countryCode: "+255",
    emergencyNumbers: [
      { label: "Police", number: "112" },
      { label: "Fire", number: "114" },
      { label: "Ambulance", number: "115" },
      { label: "TRA", number: "0800 110 064" },
    ],
    localCarriers: ["Vodacom Tanzania", "Airtel Tanzania", "Tigo", "Halotel"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    { name: "Daily News", url: "https://dailynews.co.tz", category: "general" },
    {
      name: "The Citizen",
      url: "https://www.thecitizen.co.tz",
      category: "general",
    },
    { name: "TRA Updates", url: "https://www.tra.go.tz", category: "business" },
  ],
  complianceDocuments: [
    {
      name: "TRA Tax Clearance",
      required: true,
      frequency: "annual",
      authority: "TRA",
    },
    {
      name: "NEMC Certificate",
      required: true,
      frequency: "annual",
      authority: "NEMC",
    },
    {
      name: "Business License",
      required: true,
      frequency: "annual",
      authority: "BRELA",
    },
    {
      name: "Petroleum License",
      required: true,
      frequency: "annual",
      authority: "EWURA",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Energy and Water Utilities Regulatory Authority (EWURA)",
    priceReviewFrequency: "Monthly",
    licensingRequired: true,
    licenseBody: "EWURA",
    environmentalLevy: 50,
    qualityStandardsBody: "TBS (Tanzania Bureau of Standards)",
  },
  timezone: "Africa/Dar_es_Salaam",
  capital: "Dar es Salaam",
};

// ============== NIGERIA ==============
const nigeria: CountryProfile = {
  id: "NG",
  name: "Nigeria",
  shortName: "Nigeria",
  flag: "🇳🇬",
  region: "West Africa",
  languages: ["en", "ha", "yo", "ig"],
  defaultLanguage: "en",
  currency: {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    isoCode: "NGN",
    subunit: "Kobo",
    exchangeRateToUSD: 0.00065,
  },
  mobileMoney: [
    {
      id: "opay",
      name: "OPay",
      shortCode: "*955#",
      paybillNumber: "888888",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "500,000+ agents",
    },
    {
      id: "palmpay",
      name: "PalmPay",
      shortCode: "*347#",
      paybillNumber: "777777",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "200,000+ agents",
    },
    {
      id: "mtn_momo",
      name: "MTN MoMo",
      shortCode: "*671#",
      paybillNumber: "666666",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "100,000+ agents",
    },
    {
      id: "flutterwave",
      name: "Flutterwave",
      shortCode: "*349#",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "Online only",
    },
  ],
  revenueAuthority: {
    name: "Federal Inland Revenue Service",
    shortName: "FIRS",
    pinLabel: "TIN",
    vatRate: 7.5,
    vatName: "VAT",
    withholdingTax: 5,
    exciseDuty: 0, // included in pump price
    regulatoryLevy: 0,
    roadMaintenanceLevy: 0,
    petroleumDevelopmentLevy: 0,
    customsDuty: 0,
    website: "https://www.firs.gov.ng",
    supportPhone: "+234 9 460 5500",
    supportEmail: "info@firs.gov.ng",
    eFilingPortal: "https://firs.gov.ng/taxpayer-portal",
    etimsRequired: false,
    electronicInvoiceRequired: false,
    fiscalDeviceRequired: false,
    monthlyReturnDue: "21st of following month",
    annualReturnDue: "31st January",
  },
  payroll: {
    payeThreshold: 300000, // annual
    payeRates: [
      { from: 0, to: 300000, rate: 0.07 },
      { from: 300001, to: 600000, rate: 0.11 },
      { from: 600001, to: 1100000, rate: 0.15 },
      { from: 1100001, to: 1600000, rate: 0.19 },
      { from: 1600001, to: 3200000, rate: 0.21 },
      { from: 3200001, to: Infinity, rate: 0.24 },
    ],
    nssfRequired: false,
    nssfLabel: "Pension Fund",
    nssfEmployeeRate: 0.08,
    nssfEmployerRate: 0.1,
    nhifRequired: false,
    nhifLabel: "N/A",
    nhifRates: [],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.18,
    statutoryHolidays: [
      "01-01",
      "04-07",
      "04-10",
      "05-01",
      "05-29",
      "10-01",
      "12-25",
      "12-26",
    ],
    minimumWage: 30000,
    workingHoursPerWeek: 40,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "One month per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "opay",
      name: "OPay",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "palmpay",
      name: "PalmPay",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "mtn_momo",
      name: "MTN MoMo",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0.5,
      settlementTime: "1-2 business days",
    },
    {
      id: "pos",
      name: "POS Terminal",
      icon: "CreditCard",
      available: true,
      processingFee: 0.75,
      settlementTime: "T+1",
    },
  ],
  communication: {
    smsGateway: "BulkSMS Nigeria",
    smsShortcode: "33118",
    whatsappFormat: "234XXXXXXXXXX",
    phoneFormat: "+234 XXX XXX XXXX",
    countryCode: "+234",
    emergencyNumbers: [
      { label: "Police", number: "112 or 199" },
      { label: "Ambulance", number: "112" },
      { label: "Fire", number: "112" },
      { label: "FIRS", number: "0700 349 7747" },
    ],
    localCarriers: ["MTN Nigeria", "Airtel Nigeria", "Glo", "9mobile"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    { name: "Punch Nigeria", url: "https://punchng.com", category: "general" },
    {
      name: "Vanguard",
      url: "https://www.vanguardngr.com",
      category: "general",
    },
    {
      name: "FIRS Updates",
      url: "https://www.firs.gov.ng",
      category: "business",
    },
  ],
  complianceDocuments: [
    {
      name: "FIRS Tax Clearance",
      required: true,
      frequency: "annual",
      authority: "FIRS",
    },
    {
      name: "DPR License",
      required: true,
      frequency: "annual",
      authority: "NUPRC (ex-DPR)",
    },
    {
      name: "State Ministry License",
      required: true,
      frequency: "annual",
      authority: "State Ministry",
    },
    {
      name: "Fire Certificate",
      required: true,
      frequency: "annual",
      authority: "Fire Service",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Nigerian National Petroleum Company (NNPC)",
    priceReviewFrequency: "As announced by NNPC",
    licensingRequired: true,
    licenseBody: "NUPRC",
    environmentalLevy: 0,
    qualityStandardsBody: "SON (Standards Organisation of Nigeria)",
  },
  timezone: "Africa/Lagos",
  capital: "Lagos",
};

// ============== SOUTH AFRICA ==============
const southAfrica: CountryProfile = {
  id: "ZA",
  name: "South Africa",
  shortName: "South Africa",
  flag: "🇿🇦",
  region: "Southern Africa",
  languages: ["en", "af", "zu"],
  defaultLanguage: "en",
  currency: {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    isoCode: "ZAR",
    subunit: "Cents",
    exchangeRateToUSD: 0.054,
  },
  mobileMoney: [
    {
      id: "vodapay",
      name: "VodaPay",
      shortCode: "*133#",
      paybillNumber: "111111",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "50,000+ agents",
    },
    {
      id: "mtn_momo",
      name: "MTN MoMo",
      shortCode: "*120*151#",
      paybillNumber: "222222",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "30,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "South African Revenue Service",
    shortName: "SARS",
    pinLabel: "Tax Reference Number",
    vatRate: 15,
    vatName: "VAT",
    withholdingTax: 0,
    exciseDuty: 3.93, // ZAR per liter (General Fuel Levy)
    regulatoryLevy: 0,
    roadMaintenanceLevy: 2.18, // RAF levy
    petroleumDevelopmentLevy: 0,
    customsDuty: 0,
    website: "https://www.sars.gov.za",
    supportPhone: "0800 00 7277",
    supportEmail: "info@sars.gov.za",
    eFilingPortal: "https://www.sarsefiling.co.za",
    etimsRequired: false,
    electronicInvoiceRequired: false,
    fiscalDeviceRequired: false,
    monthlyReturnDue: "25th/last business day of month",
    annualReturnDue: "Seasonal - per provisional tax schedule",
  },
  payroll: {
    payeThreshold: 95750, // annual under 65
    payeRates: [
      { from: 0, to: 237100, rate: 0.18 },
      { from: 237101, to: 370500, rate: 0.26 },
      { from: 370501, to: 512800, rate: 0.31 },
      { from: 512801, to: 673000, rate: 0.36 },
      { from: 673001, to: 857900, rate: 0.39 },
      { from: 857901, to: 1817000, rate: 0.41 },
      { from: 1817001, to: Infinity, rate: 0.45 },
    ],
    nssfRequired: true,
    nssfLabel: "UIF (Unemployment Insurance)",
    nssfEmployeeRate: 0.01,
    nssfEmployerRate: 0.01,
    nhifRequired: false,
    nhifLabel: "N/A",
    nhifRates: [],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.075,
    statutoryHolidays: [
      "01-01",
      "03-21",
      "04-07",
      "04-10",
      "04-27",
      "05-01",
      "06-16",
      "08-09",
      "09-24",
      "12-16",
      "12-25",
      "12-26",
    ],
    minimumWage: 3773.33, // monthly (national minimum)
    workingHoursPerWeek: 45,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "One week per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "snapscan",
      name: "SnapScan",
      icon: "QrCode",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "zapper",
      name: "Zapper",
      icon: "QrCode",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer (EFT)",
      icon: "Building2",
      available: true,
      processingFee: 0,
      settlementTime: "1-2 business days",
    },
    {
      id: "card",
      name: "Card Payment",
      icon: "CreditCard",
      available: true,
      processingFee: 1.5,
      settlementTime: "T+1",
    },
  ],
  communication: {
    smsGateway: "Clickatell",
    smsShortcode: "34001",
    whatsappFormat: "27XXXXXXXXX",
    phoneFormat: "+27 XX XXX XXXX",
    countryCode: "+27",
    emergencyNumbers: [
      { label: "Police", number: "10111" },
      { label: "Ambulance", number: "10177" },
      { label: "Fire", number: "10177" },
      { label: "SARS", number: "0800 00 7277" },
    ],
    localCarriers: ["Vodacom", "MTN", "Cell C", "Telkom"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "YYYY/MM/DD",
  timeFormat: "24h",
  numberFormat: "1 000.00",
  newsSources: [
    { name: "News24", url: "https://www.news24.com", category: "general" },
    {
      name: "Business Day",
      url: "https://www.businesslive.co.za",
      category: "business",
    },
    {
      name: "SARS Updates",
      url: "https://www.sars.gov.za",
      category: "business",
    },
  ],
  complianceDocuments: [
    {
      name: "SARS Tax Compliance",
      required: true,
      frequency: "annual",
      authority: "SARS",
    },
    {
      name: "CIPC Registration",
      required: true,
      frequency: "annual",
      authority: "CIPC",
    },
    {
      name: "Environmental License",
      required: true,
      frequency: "annual",
      authority: "DEFF",
    },
    {
      name: "DME License",
      required: true,
      frequency: "annual",
      authority: "Department of Mineral Resources and Energy",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Department of Mineral Resources and Energy (DMRE)",
    priceReviewFrequency: "First Wednesday of each month",
    licensingRequired: true,
    licenseBody: "DMRE",
    environmentalLevy: 0.1,
    qualityStandardsBody: "SABS (South African Bureau of Standards)",
  },
  timezone: "Africa/Johannesburg",
  capital: "Johannesburg",
};

// ============== ETHIOPIA ==============
const ethiopia: CountryProfile = {
  id: "ET",
  name: "Ethiopia",
  shortName: "Ethiopia",
  flag: "🇪🇹",
  region: "East Africa",
  languages: ["am", "en", "om"],
  defaultLanguage: "am",
  currency: {
    code: "ETB",
    symbol: "Br",
    name: "Ethiopian Birr",
    isoCode: "ETB",
    subunit: "Santim",
    exchangeRateToUSD: 0.0074,
  },
  mobileMoney: [
    {
      id: "telebirr",
      name: "Telebirr",
      shortCode: "*127#",
      paybillNumber: "999999",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "60,000+ agents",
    },
    {
      id: "cbe_birr",
      name: "CBE Birr",
      shortCode: "*847#",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "25,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Ethiopian Revenue and Customs Authority",
    shortName: "ERCA",
    pinLabel: "TIN",
    vatRate: 15,
    vatName: "VAT",
    withholdingTax: 2,
    exciseDuty: 0,
    regulatoryLevy: 0,
    roadMaintenanceLevy: 0,
    petroleumDevelopmentLevy: 0,
    customsDuty: 0,
    website: "https://www.erca.gov.et",
    supportPhone: "+251 11 662 0000",
    supportEmail: "info@erca.gov.et",
    eFilingPortal: "https://e-filing.erca.gov.et",
    etimsRequired: false,
    electronicInvoiceRequired: false,
    fiscalDeviceRequired: false,
    monthlyReturnDue: "End of following month",
    annualReturnDue: "Ethiopian fiscal year end (July 7)",
  },
  payroll: {
    payeThreshold: 600, // monthly in Birr
    payeRates: [
      { from: 0, to: 600, rate: 0 },
      { from: 601, to: 1650, rate: 0.1 },
      { from: 1651, to: 3200, rate: 0.15 },
      { from: 3201, to: 5250, rate: 0.2 },
      { from: 5251, to: 7800, rate: 0.25 },
      { from: 7801, to: 10900, rate: 0.3 },
      { from: 10901, to: Infinity, rate: 0.35 },
    ],
    nssfRequired: true,
    nssfLabel: "Pension",
    nssfEmployeeRate: 0.07,
    nssfEmployerRate: 0.11,
    nhifRequired: false,
    nhifLabel: "N/A",
    nhifRates: [],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.18,
    statutoryHolidays: [
      "01-01",
      "01-07",
      "01-19",
      "03-02",
      "04-14",
      "05-01",
      "05-05",
      "05-28",
      "09-11",
      "09-27",
      "12-25",
    ],
    minimumWage: 0, // no national minimum wage
    workingHoursPerWeek: 48,
    overtimeRate: 1.25,
    severancePayRequired: true,
    severanceFormula: "60-100% of monthly salary per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "telebirr",
      name: "Telebirr",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "cbe_birr",
      name: "CBE Birr",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0.5,
      settlementTime: "1-3 business days",
    },
  ],
  communication: {
    smsGateway: "Ethio Telecom",
    smsShortcode: "8888",
    whatsappFormat: "251XXXXXXXXX",
    phoneFormat: "+251 XX XXX XXXX",
    countryCode: "+251",
    emergencyNumbers: [
      { label: "Police", number: "991" },
      { label: "Ambulance", number: "907" },
      { label: "Fire", number: "939" },
    ],
    localCarriers: ["Ethio Telecom"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    {
      name: "Fana Broadcasting",
      url: "https://www.fanabc.com",
      category: "general",
    },
    {
      name: "Ethiopian News Agency",
      url: "https://www.ena.et",
      category: "general",
    },
  ],
  complianceDocuments: [
    {
      name: "ERCA Tax Certificate",
      required: true,
      frequency: "annual",
      authority: "ERCA",
    },
    {
      name: "Trade License",
      required: true,
      frequency: "annual",
      authority: "Ministry of Trade",
    },
    {
      name: "Environmental Certificate",
      required: true,
      frequency: "annual",
      authority: "EPA",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Ministry of Trade and Industry",
    priceReviewFrequency: "As announced",
    licensingRequired: true,
    licenseBody: "Ministry of Mines and Petroleum",
    environmentalLevy: 0,
    qualityStandardsBody: "ESA (Ethiopian Standards Agency)",
  },
  timezone: "Africa/Addis_Ababa",
  capital: "Addis Ababa",
};

// ============== RWANDA ==============
const rwanda: CountryProfile = {
  id: "RW",
  name: "Rwanda",
  shortName: "Rwanda",
  flag: "🇷🇼",
  region: "East Africa",
  languages: ["en", "fr", "rw"],
  defaultLanguage: "rw",
  currency: {
    code: "RWF",
    symbol: "RF",
    name: "Rwandan Franc",
    isoCode: "RWF",
    subunit: "Centime",
    exchangeRateToUSD: 0.00071,
  },
  mobileMoney: [
    {
      id: "mtn_momo",
      name: "MTN Mobile Money (MoMo)",
      shortCode: "*182#",
      paybillNumber: "111000",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "40,000+ agents",
    },
    {
      id: "airtel_money",
      name: "Airtel Money",
      shortCode: "*182*2#",
      paybillNumber: "222000",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "20,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Rwanda Revenue Authority",
    shortName: "RRA",
    pinLabel: "TIN",
    vatRate: 18,
    vatName: "VAT",
    withholdingTax: 5,
    exciseDuty: 183, // RWF per liter
    regulatoryLevy: 0,
    roadMaintenanceLevy: 0,
    petroleumDevelopmentLevy: 0,
    customsDuty: 25,
    website: "https://www.rra.gov.rw",
    supportPhone: "+250 3004",
    supportEmail: "info@rra.gov.rw",
    eFilingPortal: "https://etax.rra.gov.rw",
    etimsRequired: true,
    electronicInvoiceRequired: true,
    fiscalDeviceRequired: true,
    monthlyReturnDue: "15th of following month",
    annualReturnDue: "31st March",
  },
  payroll: {
    payeThreshold: 30000, // monthly
    payeRates: [
      { from: 0, to: 30000, rate: 0 },
      { from: 30001, to: 100000, rate: 0.2 },
      { from: 100001, to: Infinity, rate: 0.3 },
    ],
    nssfRequired: true,
    nssfLabel: "RSSB (Social Security)",
    nssfEmployeeRate: 0.03,
    nssfEmployerRate: 0.05,
    nhifRequired: true,
    nhifLabel: "CBHI (Community Health Insurance)",
    nhifRates: [{ minSalary: 0, maxSalary: Infinity, amount: 0.03 }],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.03,
    statutoryHolidays: [
      "01-01",
      "02-01",
      "04-07",
      "05-01",
      "07-01",
      "07-04",
      "08-15",
      "12-25",
      "12-26",
    ],
    minimumWage: 0,
    workingHoursPerWeek: 45,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "15 days per year of service",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "momo",
      name: "MTN MoMo",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "airtel_mm",
      name: "Airtel Money",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0,
      settlementTime: "Same day",
    },
    {
      id: "card",
      name: "Card Payment",
      icon: "CreditCard",
      available: true,
      processingFee: 1.5,
      settlementTime: "T+1",
    },
  ],
  communication: {
    smsGateway: "MTN Rwanda SMS",
    smsShortcode: "3004",
    whatsappFormat: "250XXXXXXXXX",
    phoneFormat: "+250 XXX XXX XXX",
    countryCode: "+250",
    emergencyNumbers: [
      { label: "Police", number: "112" },
      { label: "Ambulance", number: "912" },
      { label: "Fire", number: "111" },
      { label: "RRA", number: "3004" },
    ],
    localCarriers: ["MTN Rwanda", "Airtel Rwanda"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    {
      name: "The New Times",
      url: "https://www.newtimes.co.rw",
      category: "general",
    },
    {
      name: "RRA Updates",
      url: "https://www.rra.gov.rw",
      category: "business",
    },
    { name: "Rwanda Utilities", url: "https://www.rura.rw", category: "fuel" },
  ],
  complianceDocuments: [
    {
      name: "RRA Tax Clearance",
      required: true,
      frequency: "annual",
      authority: "RRA",
    },
    {
      name: "RDB Registration",
      required: true,
      frequency: "annual",
      authority: "RDB",
    },
    {
      name: "MININFRA License",
      required: true,
      frequency: "annual",
      authority: "Ministry of Infrastructure",
    },
    {
      name: "REMA Certificate",
      required: true,
      frequency: "annual",
      authority: "REMA",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "Rwanda Utilities Regulatory Authority (RURA)",
    priceReviewFrequency: "Monthly (15th)",
    licensingRequired: true,
    licenseBody: "RURA",
    environmentalLevy: 0,
    qualityStandardsBody: "RSB (Rwanda Standards Board)",
  },
  timezone: "Africa/Kigali",
  capital: "Kigali",
};

// ============== GHANA ==============
const ghana: CountryProfile = {
  id: "GH",
  name: "Ghana",
  shortName: "Ghana",
  flag: "🇬🇭",
  region: "West Africa",
  languages: ["en", "tw", "ga"],
  defaultLanguage: "en",
  currency: {
    code: "GHS",
    symbol: "GH₵",
    name: "Ghanaian Cedi",
    isoCode: "GHS",
    subunit: "Pesewas",
    exchangeRateToUSD: 0.066,
  },
  mobileMoney: [
    {
      id: "mtn_momo",
      name: "MTN Mobile Money",
      shortCode: "*170#",
      paybillNumber: "123456",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "150,000+ agents",
    },
    {
      id: "vodafone_cash",
      name: "Vodafone Cash",
      shortCode: "*110#",
      paybillNumber: "654321",
      stkPushSupported: true,
      transferSupported: true,
      agentNetwork: "80,000+ agents",
    },
    {
      id: "at_money",
      name: "AT Money",
      shortCode: "*484#",
      paybillNumber: "789012",
      stkPushSupported: false,
      transferSupported: true,
      agentNetwork: "30,000+ agents",
    },
  ],
  revenueAuthority: {
    name: "Ghana Revenue Authority",
    shortName: "GRA",
    pinLabel: "TIN",
    vatRate: 15,
    vatName: "VAT",
    withholdingTax: 5,
    exciseDuty: 1.0484, // GHS per liter (Energy Sector Levy)
    regulatoryLevy: 0.0495, // Price Stabilization Levy
    roadMaintenanceLevy: 0,
    petroleumDevelopmentLevy: 0,
    customsDuty: 0,
    website: "https://gra.gov.gh",
    supportPhone: "+233 302 904 310",
    supportEmail: "info@gra.gov.gh",
    eFilingPortal: "https://www.gra.gov.gh/taxpayer-portal",
    etimsRequired: false,
    electronicInvoiceRequired: false,
    fiscalDeviceRequired: false,
    monthlyReturnDue: "21st of following month",
    annualReturnDue: "30th April",
  },
  payroll: {
    payeThreshold: 475, // monthly
    payeRates: [
      { from: 0, to: 475, rate: 0 },
      { from: 476, to: 600, rate: 0.05 },
      { from: 601, to: 3850, rate: 0.1 },
      { from: 3851, to: 20000, rate: 0.175 },
      { from: 20001, to: 34360, rate: 0.25 },
      { from: 34361, to: 66375, rate: 0.3 },
      { from: 66376, to: Infinity, rate: 0.35 },
    ],
    nssfRequired: true,
    nssfLabel: "SSNIT",
    nssfEmployeeRate: 0.055,
    nssfEmployerRate: 0.13,
    nhifRequired: true,
    nhifLabel: "NHIS",
    nhifRates: [{ minSalary: 0, maxSalary: Infinity, amount: 0.025 }],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: 0.185,
    statutoryHolidays: [
      "01-01",
      "03-06",
      "04-07",
      "04-10",
      "05-01",
      "05-25",
      "07-01",
      "08-04",
      "09-21",
      "12-01",
      "12-25",
      "12-26",
    ],
    minimumWage: 14.88,
    workingHoursPerWeek: 40,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "Redundancy pay per labor law",
  },
  paymentMethods: [
    {
      id: "cash",
      name: "Cash",
      icon: "Banknote",
      available: true,
      processingFee: 0,
      settlementTime: "Immediate",
    },
    {
      id: "momo",
      name: "MTN MoMo",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "vodafone_cash",
      name: "Vodafone Cash",
      icon: "Smartphone",
      available: true,
      processingFee: 0,
      settlementTime: "Instant",
    },
    {
      id: "bank_transfer",
      name: "Bank Transfer",
      icon: "Building2",
      available: true,
      processingFee: 0,
      settlementTime: "1-2 business days",
    },
  ],
  communication: {
    smsGateway: "MTN Ghana SMS",
    smsShortcode: "1900",
    whatsappFormat: "233XXXXXXXXX",
    phoneFormat: "+233 XX XXX XXXX",
    countryCode: "+233",
    emergencyNumbers: [
      { label: "Police", number: "191" },
      { label: "Ambulance", number: "193" },
      { label: "Fire", number: "192" },
      { label: "GRA", number: "0302 904 310" },
    ],
    localCarriers: ["MTN Ghana", "Vodafone Ghana", "AT (AirtelTigo)"],
  },
  units: {
    fuelVolume: "Litres",
    distance: "Km",
    weight: "Kg",
    tankCapacity: "Litres",
    fuelEfficiency: "Km/L",
  },
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "1,000.00",
  newsSources: [
    {
      name: "Graphic Online",
      url: "https://www.graphic.com.gh",
      category: "general",
    },
    {
      name: "Joy News",
      url: "https://www.myjoyonline.com",
      category: "general",
    },
    { name: "GRA Updates", url: "https://gra.gov.gh", category: "business" },
    { name: "NPA Updates", url: "https://www.npa.gov.gh", category: "fuel" },
  ],
  complianceDocuments: [
    {
      name: "GRA Tax Clearance",
      required: true,
      frequency: "annual",
      authority: "GRA",
    },
    {
      name: "NPA License",
      required: true,
      frequency: "annual",
      authority: "National Petroleum Authority",
    },
    {
      name: "EPA Permit",
      required: true,
      frequency: "annual",
      authority: "EPA",
    },
    {
      name: "Fire Certificate",
      required: true,
      frequency: "annual",
      authority: "GNFS",
    },
  ],
  fuelRegulations: {
    priceControlled: true,
    priceSettingBody: "National Petroleum Authority (NPA)",
    priceReviewFrequency: "Bi-weekly (1st and 16th)",
    licensingRequired: true,
    licenseBody: "NPA",
    environmentalLevy: 0.0495,
    qualityStandardsBody: "Ghana Standards Authority (GSA)",
  },
  timezone: "Africa/Accra",
  capital: "Accra",
};

import { WORLD_PAYMENT_CONFIGS } from "./worldPaymentConfigs";
import { currencySymbolFor } from "./pricing";

// 8 core countries with full detailed profiles
const CORE_COUNTRIES: Record<string, CountryProfile> = {
  KE: kenya,
  UG: uganda,
  TZ: tanzania,
  NG: nigeria,
  ZA: southAfrica,
  ET: ethiopia,
  RW: rwanda,
  GH: ghana,
};

// Generate lightweight profiles for ALL other 240+ countries
function regionForCode(code: string): string {
  const c = code.toUpperCase();
  // Map ISO-2 country codes to a broad region. This is intentionally
  // lightweight (continent-level) so generated profiles aren't all mislabeled
  // "Africa" — the core countries have hand-authored region labels.
  const africa = new Set([
    "DZ",
    "AO",
    "BJ",
    "BW",
    "BF",
    "BI",
    "CM",
    "CV",
    "CF",
    "TD",
    "KM",
    "CG",
    "CD",
    "CI",
    "DJ",
    "EG",
    "GQ",
    "ER",
    "SZ",
    "ET",
    "GA",
    "GM",
    "GH",
    "GN",
    "GW",
    "KE",
    "LS",
    "LR",
    "LY",
    "MG",
    "MW",
    "ML",
    "MR",
    "MU",
    "MA",
    "MZ",
    "NA",
    "NE",
    "NG",
    "RW",
    "ST",
    "SN",
    "SC",
    "SL",
    "SO",
    "ZA",
    "SS",
    "SD",
    "TZ",
    "TG",
    "TN",
    "UG",
    "EH",
    "ZM",
    "ZW",
  ]);
  const europe = new Set([
    "AL",
    "AD",
    "AT",
    "BY",
    "BE",
    "BA",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "GR",
    "HU",
    "IS",
    "IE",
    "IT",
    "XK",
    "LV",
    "LI",
    "LT",
    "LU",
    "MT",
    "MD",
    "MC",
    "ME",
    "NL",
    "MK",
    "NO",
    "PL",
    "PT",
    "RO",
    "RU",
    "SM",
    "RS",
    "SK",
    "SI",
    "ES",
    "SE",
    "CH",
    "TR",
    "UA",
    "GB",
    "VA",
  ]);
  const asia = new Set([
    "AF",
    "AM",
    "AZ",
    "BH",
    "BD",
    "BT",
    "BN",
    "KH",
    "CN",
    "GE",
    "HK",
    "IN",
    "ID",
    "IR",
    "IQ",
    "IL",
    "JP",
    "JO",
    "KZ",
    "KW",
    "KG",
    "LA",
    "LB",
    "MO",
    "MY",
    "MV",
    "MN",
    "MM",
    "NP",
    "KP",
    "OM",
    "PK",
    "PS",
    "PH",
    "QA",
    "SA",
    "SG",
    "KR",
    "LK",
    "SY",
    "TW",
    "TJ",
    "TH",
    "TL",
    "AE",
    "UZ",
    "VN",
    "YE",
  ]);
  const americas = new Set([
    "AI",
    "AG",
    "AR",
    "AW",
    "BS",
    "BB",
    "BZ",
    "BM",
    "BO",
    "BR",
    "VG",
    "CA",
    "KY",
    "CL",
    "CO",
    "CR",
    "CU",
    "CW",
    "DM",
    "DO",
    "EC",
    "SV",
    "FK",
    "GF",
    "GL",
    "GD",
    "GP",
    "GT",
    "GY",
    "HT",
    "HN",
    "JM",
    "MQ",
    "MX",
    "MS",
    "NI",
    "PA",
    "PY",
    "PE",
    "PR",
    "BL",
    "KN",
    "LC",
    "MF",
    "PM",
    "VC",
    "SR",
    "TT",
    "TC",
    "VI",
    "US",
    "UY",
    "VE",
  ]);
  const oceania = new Set([
    "AS",
    "AU",
    "CK",
    "FJ",
    "PF",
    "GU",
    "KI",
    "MH",
    "FM",
    "NR",
    "NC",
    "NZ",
    "NU",
    "NF",
    "MP",
    "PW",
    "PG",
    "PN",
    "WS",
    "SB",
    "TK",
    "TO",
    "TV",
    "VU",
    "WF",
  ]);
  if (africa.has(c)) return "Africa";
  if (europe.has(c)) return "Europe";
  if (asia.has(c)) return "Asia";
  if (americas.has(c)) return "Americas";
  if (oceania.has(c)) return "Oceania";
  return "Global";
}

// Region-aware payroll defaults so generated country profiles aren't all
// Kenya clones (which would show "Min. Wage €15,000" for Germany). The values
// are approximate monthly figures in the country's own currency and are only
// used as a sane starting point until a real sync/tax-rate fetch overrides them.
function getRegionalPayroll(
  code: string,
  currency: string,
): CountryProfile["payroll"] {
  const c = code.toUpperCase();
  const region = regionForCode(c);

  // Region baselines (monthly, local currency). These are intentionally rough
  // economic-region averages — they exist so the dashboard renders a plausible
  // figure instead of a Kenya-clone value, and are replaced by synced rates.
  const REGION_BASE: Record<
    string,
    { minimumWage: number; payeThreshold: number; bands: [number, number][] }
  > = {
    Europe: {
      minimumWage: 1800,
      payeThreshold: 12000,
      bands: [
        [0, 12000],
        [12001, 30000],
        [30001, 80000],
        [80001, Infinity],
      ],
    },
    Americas: {
      minimumWage: 1500,
      payeThreshold: 12000,
      bands: [
        [0, 12000],
        [12001, 45000],
        [45001, 120000],
        [120001, Infinity],
      ],
    },
    Asia: {
      minimumWage: 1200,
      payeThreshold: 6000,
      bands: [
        [0, 6000],
        [6001, 20000],
        [20001, 60000],
        [60001, Infinity],
      ],
    },
    Oceania: {
      minimumWage: 2200,
      payeThreshold: 18000,
      bands: [
        [0, 18000],
        [18001, 45000],
        [45001, 120000],
        [120001, Infinity],
      ],
    },
    Africa: {
      minimumWage: 15000,
      payeThreshold: 24000,
      bands: [
        [0, 24000],
        [24001, 32333],
        [32334, 500000],
        [500001, 800000],
        [800001, Infinity],
      ],
    },
    Global: {
      minimumWage: 1500,
      payeThreshold: 12000,
      bands: [
        [0, 12000],
        [12001, 40000],
        [40001, 100000],
        [100001, Infinity],
      ],
    },
  };

  const base = REGION_BASE[region] || REGION_BASE.Global;
  const rates = [0, 0.2, 0.3, 0.37, 0.4].slice(0, base.bands.length);
  const payeRates = base.bands.map(([from, to], i) => ({
    from,
    to,
    rate: rates[i] ?? 0.35,
  }));

  return {
    payeThreshold: base.payeThreshold,
    payeRates,
    nssfRequired: true,
    nssfLabel: "Social Security",
    nssfEmployeeRate: 0.06,
    nssfEmployerRate: 0.06,
    nhifRequired: region === "Europe" || region === "Oceania",
    nhifLabel: "Health Insurance",
    nhifRates: [
      { minSalary: 0, maxSalary: 5999, amount: 150 },
      { minSalary: 6000, maxSalary: 9999, amount: 300 },
      { minSalary: 10000, maxSalary: 19999, amount: 500 },
      { minSalary: 20000, maxSalary: 39999, amount: 750 },
      { minSalary: 40000, maxSalary: Infinity, amount: 1000 },
    ],
    housingLevy: false,
    housingLevyRate: 0,
    pensionFund: true,
    pensionRate: region === "Europe" ? 0.093 : 0.05,
    statutoryHolidays: ["01-01", "05-01", "12-25", "12-26"],
    minimumWage: base.minimumWage,
    workingHoursPerWeek: 40,
    overtimeRate: 1.5,
    severancePayRequired: true,
    severanceFormula: "12 days per year of service",
  };
}

function generateCountryProfile(
  code: string,
  name: string,
  currency: string,
): CountryProfile {
  return {
    id: code.toUpperCase(),
    name,
    shortName: code.toUpperCase(),
    flag: getFlagEmoji(code),
    region: regionForCode(code),
    languages: ["en"],
    defaultLanguage: "en",
    currency: {
      code: currency,
      symbol: currencySymbolFor(currency),
      name: currency,
      isoCode: currency,
      subunit: "cents",
      exchangeRateToUSD: 1,
    },
    timezone: TIMEZONES[code.toUpperCase()] || "UTC",
    capital: CAPITALS[code.toUpperCase()] || name,
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    numberFormat: "1,000.00",
    mobileMoney: [],
    revenueAuthority: {
      name: `${name} Revenue Authority`,
      shortName: "RA",
      pinLabel: "Tax ID",
      website: "",
      vatRate: TAX_RATES[code.toUpperCase()] || 0,
      vatName: "VAT",
      exciseDuty: 0,
      withholdingTax: 0,
      roadMaintenanceLevy: 0,
      petroleumDevelopmentLevy: 0,
      regulatoryLevy: 0,
      customsDuty: 0,
      supportPhone: "",
      supportEmail: "",
      etimsRequired: false,
      electronicInvoiceRequired: regionForCode(code) === "Europe",
      fiscalDeviceRequired: false,
      monthlyReturnDue: "20th",
      annualReturnDue: "31st March",
      eFilingPortal: "",
    },
    payroll: getRegionalPayroll(code, currency),
    paymentMethods: [],
    communication: {
      smsGateway: "",
      smsShortcode: "",
      whatsappFormat: "",
      phoneFormat: "",
      countryCode: code.toUpperCase(),
      emergencyNumbers: [],
      localCarriers: [],
      defaultMessage: "",
      whatsappEnabled: false,
    },
    units: {
      fuelVolume: "litres",
      volume: "litres",
      currency: currency,
      distance: "km",
      weight: "kg",
      tankCapacity: "litres",
      fuelEfficiency: "km/L",
    },
    newsSources: [],
    complianceDocuments: [],
    fuelRegulations: {
      priceControlled: false,
      priceSettingBody: `${name} Energy Regulator`,
      priceReviewFrequency: "monthly",
      licensingRequired: false,
      licenseBody: `${name} Energy Regulator`,
      environmentalLevy: 0,
      qualityStandardsBody: `${name} Standards Bureau`,
    },
  };
}

// Flag emoji generator
function getFlagEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return "🏳️";
  const OFFSET = 0x1f1e6;
  return String.fromCodePoint(
    OFFSET + (upper.charCodeAt(0) - 65),
    OFFSET + (upper.charCodeAt(1) - 65),
  );
}

// Timezone map for all countries
const TIMEZONES: Record<string, string> = {
  KE: "Africa/Nairobi",
  UG: "Africa/Kampala",
  TZ: "Africa/Dar_es_Salaam",
  NG: "Africa/Lagos",
  ZA: "Africa/Johannesburg",
  GH: "Africa/Accra",
  RW: "Africa/Kigali",
  ET: "Africa/Addis_Ababa",
};

// Capital city fallback used by generateCountryProfile for the 250+ world
// countries that lack a hand-authored CountryProfile. Falls back to the
// country name when no capital is listed.
const CAPITALS: Record<string, string> = {
  KE: "Nairobi",
  UG: "Kampala",
  TZ: "Dodoma",
  NG: "Abuja",
  ZA: "Pretoria",
  GH: "Accra",
  RW: "Kigali",
  ET: "Addis Ababa",
  DE: "Berlin",
  FR: "Paris",
  GB: "London",
  US: "Washington, D.C.",
  CN: "Beijing",
  JP: "Tokyo",
  IN: "New Delhi",
  BR: "Brasília",
  AU: "Canberra",
  CA: "Ottawa",
  IT: "Rome",
  ES: "Madrid",
  NL: "Amsterdam",
  SE: "Stockholm",
  NO: "Oslo",
  CH: "Bern",
  AE: "Abu Dhabi",
  SA: "Riyadh",
  EG: "Cairo",
  MA: "Rabat",
  TH: "Bangkok",
  ID: "Jakarta",
  MY: "Kuala Lumpur",
  SG: "Singapore",
  KR: "Seoul",
  MX: "Mexico City",
  AR: "Buenos Aires",
  TR: "Ankara",
  PL: "Warsaw",
  BE: "Brussels",
  AT: "Vienna",
  PT: "Lisbon",
  IE: "Dublin",
  DK: "Copenhagen",
  FI: "Helsinki",
  NZ: "Wellington",
  ZW: "Harare",
  MZ: "Maputo",
  AO: "Luanda",
  DZ: "Algiers",
  TN: "Tunis",
  LY: "Tripoli",
  SD: "Khartoum",
  IQ: "Baghdad",
  IR: "Tehran",
  PK: "Islamabad",
  BD: "Dhaka",
  PH: "Manila",
  VN: "Hanoi",
  CO: "Bogotá",
  CL: "Santiago",
  PE: "Lima",
  VE: "Caracas",
  RO: "Bucharest",
  CZ: "Prague",
  HU: "Budapest",
  GR: "Athens",
  RU: "Moscow",
  UA: "Kyiv",
};

// Capital city coordinates (lat, lng) for weather fallback when GPS unavailable
export const CAPITAL_COORDS: Record<string, { lat: number; lng: number }> = {
  KE: { lat: -1.2921, lng: 36.8219 },
  UG: { lat: 0.3476, lng: 32.5825 },
  TZ: { lat: -6.369, lng: 34.8888 },
  NG: { lat: 9.0765, lng: 7.3986 },
  ZA: { lat: -25.7479, lng: 28.2293 },
  GH: { lat: 5.6037, lng: -0.187 },
  RW: { lat: -1.9706, lng: 30.1044 },
  ET: { lat: 9.032, lng: 38.7469 },
  DE: { lat: 52.52, lng: 13.405 },
  FR: { lat: 48.8566, lng: 2.3522 },
  GB: { lat: 51.5074, lng: -0.1278 },
  US: { lat: 38.9072, lng: -77.0369 },
  CN: { lat: 39.9042, lng: 116.4074 },
  JP: { lat: 35.6762, lng: 139.6503 },
  IN: { lat: 28.6139, lng: 77.209 },
  BR: { lat: -15.7975, lng: -47.8919 },
  AU: { lat: -35.2809, lng: 149.13 },
  CA: { lat: 45.4215, lng: -75.6972 },
  IT: { lat: 41.9028, lng: 12.4964 },
  ES: { lat: 40.4168, lng: -3.7038 },
  NL: { lat: 52.3676, lng: 4.9041 },
  SE: { lat: 59.3293, lng: 18.0686 },
  NO: { lat: 59.9139, lng: 10.7522 },
  CH: { lat: 46.948, lng: 7.4474 },
  AE: { lat: 24.4539, lng: 54.3773 },
  SA: { lat: 24.7136, lng: 46.6753 },
  EG: { lat: 30.0444, lng: 31.2357 },
  MA: { lat: 34.0209, lng: -6.8416 },
  TH: { lat: 13.7563, lng: 100.5018 },
  ID: { lat: -6.2088, lng: 106.8456 },
  MY: { lat: 3.139, lng: 101.6869 },
  SG: { lat: 1.3521, lng: 103.8198 },
  KR: { lat: 37.5665, lng: 126.978 },
  MX: { lat: 19.4326, lng: -99.1332 },
  AR: { lat: -34.6037, lng: -58.3816 },
  TR: { lat: 39.9334, lng: 32.8597 },
  PL: { lat: 52.2297, lng: 21.0122 },
  BE: { lat: 50.8503, lng: 4.3517 },
  AT: { lat: 48.2082, lng: 16.3738 },
  PT: { lat: 38.7223, lng: -9.1393 },
  IE: { lat: 53.3498, lng: -6.2603 },
  DK: { lat: 55.6761, lng: 12.5683 },
  FI: { lat: 60.1699, lng: 24.9384 },
  NZ: { lat: -41.2865, lng: 174.7762 },
  ZW: { lat: -17.8252, lng: 31.0335 },
  MZ: { lat: -25.9692, lng: 32.5732 },
  AO: { lat: -8.839, lng: 13.2894 },
  DZ: { lat: 36.7372, lng: 3.0865 },
  TN: { lat: 36.8065, lng: 10.1815 },
  LY: { lat: 32.8872, lng: 13.1913 },
  SD: { lat: 15.5007, lng: 32.5599 },
  IQ: { lat: 33.3152, lng: 44.3661 },
  IR: { lat: 35.6892, lng: 51.389 },
  PK: { lat: 33.6844, lng: 73.0479 },
  BD: { lat: 23.8103, lng: 90.4125 },
  PH: { lat: 14.5995, lng: 120.9664 },
  VN: { lat: 21.0285, lng: 105.8542 },
  CO: { lat: 4.711, lng: -74.0721 },
  CL: { lat: -33.4489, lng: -70.6693 },
  PE: { lat: -12.0464, lng: -77.0428 },
  VE: { lat: 10.4806, lng: -66.9036 },
  RO: { lat: 44.4268, lng: 26.1025 },
  CZ: { lat: 50.0755, lng: 14.4378 },
  HU: { lat: 47.4979, lng: 19.0402 },
  GR: { lat: 37.9838, lng: 23.7275 },
  RU: { lat: 55.7558, lng: 37.6173 },
  UA: { lat: 50.4501, lng: 30.5234 },
};

// Tax rates
const TAX_RATES: Record<string, number> = {
  KE: 0.16,
  UG: 0.18,
  TZ: 0.18,
  NG: 0.075,
  ZA: 0.15,
  GH: 0.15,
  RW: 0.18,
  ET: 0.15,
};

// Phone codes
const PHONE_CODES: Record<string, string> = {
  KE: "+254",
  UG: "+256",
  TZ: "+255",
  NG: "+234",
  ZA: "+27",
  GH: "+233",
  RW: "+250",
  ET: "+251",
};

// Build complete COUNTRIES with ALL 250+ from world configs
const ALL_COUNTRY_PROFILES: Record<string, CountryProfile> = {
  ...CORE_COUNTRIES,
};

// Add all remaining countries from WORLD_PAYMENT_CONFIGS
Object.entries(WORLD_PAYMENT_CONFIGS).forEach(([code, config]) => {
  if (!ALL_COUNTRY_PROFILES[code]) {
    ALL_COUNTRY_PROFILES[code] = generateCountryProfile(
      code,
      config.countryName,
      config.defaultCurrency,
    );
  }
});

export const COUNTRIES: Record<string, CountryProfile> = ALL_COUNTRY_PROFILES;
export const COUNTRY_LIST = Object.values(COUNTRIES);

export function getCountryById(id: string): CountryProfile | undefined {
  return COUNTRIES[id.toUpperCase()];
}

export function detectCountryFromTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzCountryMap: Record<string, string> = {
    "Africa/Nairobi": "KE",
    "Africa/Kampala": "UG",
    "Africa/Dar_es_Salaam": "TZ",
    "Africa/Lagos": "NG",
    "Africa/Johannesburg": "ZA",
    "Africa/Addis_Ababa": "ET",
    "Africa/Kigali": "RW",
    "Africa/Accra": "GH",
    "Africa/Mogadishu": "SO",
    "Africa/Juba": "SS",
    "Africa/Bujumbura": "BI",
    "Africa/Luanda": "AO",
    "Africa/Lusaka": "ZM",
    "Africa/Harare": "ZW",
    "Africa/Maputo": "MZ",
    "Africa/Gaborone": "BW",
    "Africa/Windhoek": "NA",
    "Africa/Maseru": "LS",
    "Africa/Mbabane": "SZ",
    "Africa/Abidjan": "CI",
    "Africa/Lome": "TG",
    "Africa/Monrovia": "LR",
    // Common non-African timezones so non-African users aren't misdetected either
    "America/New_York": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Los_Angeles": "US",
    "Europe/London": "GB",
    "Europe/Berlin": "DE",
    "Europe/Paris": "FR",
    "Europe/Madrid": "ES",
    "Asia/Kolkata": "IN",
    "Asia/Shanghai": "CN",
    "Asia/Dubai": "AE",
    "Australia/Sydney": "AU",
  };
  if (tzCountryMap[tz]) return tzCountryMap[tz];

  // Only fall back to Kenya for genuinely unmapped *African* timezones —
  // never default a non-African timezone to Kenya.
  if (tz.startsWith("Africa/")) return "KE";
  if (tz.startsWith("America/")) return "US";
  if (tz.startsWith("Europe/")) return "GB";
  if (tz.startsWith("Asia/")) return "AE";
  if (tz.startsWith("Australia/")) return "AU";
  return "US"; // neutral global default, not Kenya-biased
}

export function formatPhoneForCountry(
  phone: string,
  countryCode: string,
): string {
  const country = getCountryById(countryCode);
  if (!country) return phone;
  const code = country.communication.countryCode;
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0"))
    cleaned = code.substring(1) + cleaned.substring(1);
  if (!cleaned.startsWith(code.substring(1)))
    cleaned = code.substring(1) + cleaned;
  return "+" + cleaned;
}

export function formatCurrency(amount: number, countryCode: string): string {
  const country = getCountryById(countryCode);
  if (!country) return `${amount.toLocaleString()}`;
  return `${country.currency.symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function getFuelTaxBreakdown(
  pricePerLiter: number,
  countryCode: string,
) {
  const country = getCountryById(countryCode);
  if (!country) return null;
  const ra = country.revenueAuthority;
  return {
    basePrice:
      pricePerLiter -
      ra.exciseDuty -
      ra.roadMaintenanceLevy -
      ra.petroleumDevelopmentLevy -
      ra.regulatoryLevy,
    exciseDuty: ra.exciseDuty,
    roadLevy: ra.roadMaintenanceLevy,
    petroleumDevLevy: ra.petroleumDevelopmentLevy,
    regulatoryLevy: ra.regulatoryLevy,
    vat: pricePerLiter * (ra.vatRate / 100),
    totalTax:
      ra.exciseDuty +
      ra.roadMaintenanceLevy +
      ra.petroleumDevelopmentLevy +
      ra.regulatoryLevy +
      (pricePerLiter * ra.vatRate) / 100,
    authority: ra.shortName,
  };
}

export default COUNTRIES;
