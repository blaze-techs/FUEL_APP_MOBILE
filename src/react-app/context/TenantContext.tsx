import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

// ═══════════════════════════════════════════════
// MULTI-TENANCY CONTEXT v1
// Company → Station Hierarchy with Data Isolation
// ═══════════════════════════════════════════════

export interface Company {
  id: string;
  legalName: string;
  tradingName: string;
  hqCountryCode: string;
  hqCity: string;
  taxId: string;
  defaultCurrency: string;
  timezone: string;
  phone: string;
  email: string;
  industry: string;
  logo?: string;
  createdAt: string;
  updatedAt: string;
  settings: CompanySettings;
}

export interface CompanySettings {
  enableMultiStation: boolean;
  enableKRAIntegration: boolean;
  enableMPesa?: boolean;
  enableCloudSync: boolean;
  enableAutoReports: boolean;
  enableAI: boolean;
  enableWhatsApp: boolean;
  enableEmail: boolean;
  taxRate: number;
  currency: string;
  language: string;
  dateFormat: string;
  fuelUnit: "liters" | "gallons";
  receiptFooter: string;
  receiptHeader: string;
}

export interface StationProfile {
  id: string;
  companyId: string;
  name: string;
  location: string;
  city: string;
  countryCode: string;
  timezone: string;
  coordinates: { lat: number; lng: number } | null;
  phone: string;
  email: string;
  kraPin: string;
  etrSerial: string;
  taxRate: number;
  theme: string;
  logo: string;
  description: string;
  fuelTypes: string[];
  pumpCount: number;
  tankCount: number;
  managerName: string;
  managerPhone: string;
  licenseNumber: string;
  operatingHours: string;
  status: "active" | "inactive" | "suspended";
  createdAt: string;
  updatedAt: string;
  data: Record<string, any>;
}

// Feature flag definitions - controlled by company + location
export interface FeatureFlags {
  // Core
  pos: boolean;
  inventory: boolean;
  sales: boolean;
  analytics: boolean;
  payroll: boolean;
  expenses: boolean;
  customers: boolean;
  suppliers: boolean;
  documents: boolean;
  // Payments
  mpesa: boolean;
  creditCards: boolean;
  cash: boolean;
  bankTransfer: boolean;
  mobileMoney: boolean;
  // Regional
  kraIntegration: boolean;
  etims: boolean;
  efd: boolean;
  etr: boolean;
  vatReporting: boolean;
  // Advanced
  ai: boolean;
  cloudSync: boolean;
  webhooks: boolean;
  integrations: boolean;
  audit: boolean;
  compliance: boolean;
  loyalty: boolean;
  priceboard: boolean;
  fueltypes: boolean;
  maintenance: boolean;
  quality: boolean;
  // Communication
  whatsapp: boolean;
  email: boolean;
  sms: boolean;
  // Company-level
  founderAccess: boolean;
  combinedView: boolean;
}

const COMPANY_KEY = "fuelpro_company_v1";
const STATIONS_KEY = "fuelpro_tenant_stations_v1";
const CURRENT_COMPANY_KEY = "fuelpro_current_company_v1";
const CURRENT_STATION_KEY = "fuelpro_current_tenant_station_v1";

function loadCompany(): Company | null {
  try {
    const raw = localStorage.getItem(COMPANY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate: remove stale enableMPesa:false defaults so country-based
      // auto-enable (?? isKenya) takes effect. Only keep explicit opt-in (true).
      if (parsed?.settings && parsed.settings.enableMPesa === false) {
        delete parsed.settings.enableMPesa;
      }
      return parsed;
    }
  } catch {}
  return null;
}

function loadStations(): StationProfile[] {
  try {
    const raw = localStorage.getItem(STATIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function defaultSettings(): CompanySettings {
  return {
    enableMultiStation: true,
    enableKRAIntegration: false,
    enableCloudSync: false,
    enableAutoReports: true,
    enableAI: true,
    enableWhatsApp: false,
    enableEmail: true,
    taxRate: 16,
    currency: "USD",
    language: "en",
    dateFormat: "MM/DD/YYYY",
    fuelUnit: "liters",
    receiptFooter: "Thank you for your business!",
    receiptHeader: "FuelPro Station",
  };
}

// Resolve feature flags based on company settings + detected country
function resolveFeatureFlags(
  company: Company | null,
  countryCode: string,
): FeatureFlags {
  const isKenya = countryCode === "KE";
  const isTanzania = countryCode === "TZ";
  const isUganda = countryCode === "UG";
  const isNigeria = countryCode === "NG";
  const isSouthAfrica = countryCode === "ZA";
  const isUSA = countryCode === "US";
  const isUK = countryCode === "GB";
  const isEU = ["DE", "FR", "IT", "ES", "NL", "BE", "AT"].includes(countryCode);
  const isEastAfrica = isKenya || isTanzania || isUganda;

  // Mobile money availability
  const hasMobileMoney =
    isEastAfrica ||
    isNigeria ||
    isSouthAfrica ||
    countryCode === "GH" ||
    countryCode === "ZA";
  const hasMPesa = isKenya || isTanzania;

  return {
    // Core
    pos: true,
    inventory: true,
    sales: true,
    analytics: true,
    payroll: true,
    expenses: true,
    customers: true,
    suppliers: true,
    documents: true,
    // Payments - ONLY show what's relevant to the country
    mpesa: hasMPesa && (company?.settings?.enableMPesa ?? isKenya),
    creditCards: isUSA || isUK || isEU || isSouthAfrica || true, // Most places accept cards
    cash: true, // Universal
    bankTransfer: true,
    mobileMoney: hasMobileMoney,
    // Regional compliance
    kraIntegration:
      isKenya && (company?.settings?.enableKRAIntegration ?? false),
    etims: isKenya,
    efd: isTanzania || isUganda,
    etr: isKenya,
    vatReporting: isEU || isUK || isSouthAfrica || isKenya || isNigeria,
    // Advanced
    ai: company?.settings?.enableAI ?? true,
    cloudSync: company?.settings?.enableCloudSync ?? false,
    webhooks: true,
    integrations: true,
    audit: true,
    compliance: true,
    loyalty: true,
    priceboard: true,
    fueltypes: true,
    maintenance: true,
    quality: true,
    // Communication
    whatsapp: company?.settings?.enableWhatsApp ?? isEastAfrica,
    email: company?.settings?.enableEmail ?? true,
    sms: isEastAfrica || isNigeria || isSouthAfrica,
    // Company-level
    founderAccess: true,
    combinedView: true,
  };
}

// Tab visibility based on feature flags
export function getVisibleTabs(
  flags: FeatureFlags,
  isAdmin: boolean,
): string[] {
  const tabs: { id: string; required: keyof FeatureFlags }[] = [
    { id: "dashboard", required: "pos" },
    { id: "pos", required: "pos" },
    { id: "sales", required: "sales" },
    { id: "inventory", required: "inventory" },
    { id: "delivery", required: "inventory" },
    { id: "offloading", required: "inventory" },
    { id: "mpesa", required: "mpesa" },
    { id: "customers", required: "customers" },
    { id: "credit", required: "customers" },
    { id: "payroll", required: "payroll" },
    { id: "shifts", required: "payroll" },
    { id: "team", required: "payroll" },
    { id: "expenses", required: "expenses" },
    { id: "documents", required: "documents" },
    { id: "suppliers", required: "suppliers" },
    { id: "invoice", required: "sales" },
    { id: "debt", required: "sales" },
    { id: "reports", required: "analytics" },
    { id: "fuelsalesreport", required: "analytics" },
    { id: "analytics", required: "analytics" },
    { id: "livetransaction", required: "pos" },
    { id: "priceboard", required: "priceboard" },
    { id: "fueltypes", required: "fueltypes" },
    { id: "quality", required: "quality" },
    { id: "maintenance", required: "maintenance" },
    { id: "regional", required: "compliance" },
    { id: "integration", required: "integrations" },
    { id: "communication", required: "email" },
    { id: "news", required: "analytics" },
    { id: "data", required: "audit" },
    { id: "audit", required: "audit" },
  ];

  const visible = tabs
    .filter((t) => {
      // Admin sees everything
      if (isAdmin) return true;
      // Check feature flag
      return !!flags[t.required];
    })
    .map((t) => t.id);

  return visible;
}

interface TenantContextType {
  // Company
  company: Company | null;
  hasCompany: boolean;
  createCompany: (data: Partial<Company>) => Company;
  updateCompany: (data: Partial<Company>) => void;
  deleteCompany: () => void;
  // Stations
  stations: StationProfile[];
  currentStation: StationProfile | null;
  createStation: (data: Partial<StationProfile>) => StationProfile;
  updateStation: (id: string, data: Partial<StationProfile>) => void;
  deleteStation: (id: string) => void;
  switchStation: (id: string) => void;
  // Feature flags
  featureFlags: FeatureFlags;
  isFeatureEnabled: (feature: keyof FeatureFlags) => boolean;
  visibleTabs: string[];
  // Location
  detectedCountry: string;
  setDetectedCountry: (code: string) => void;
  // Settings
  settings: CompanySettings;
  updateSettings: (partial: Partial<CompanySettings>) => void;
  // Loading
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType | null>(null);

export function TenantProvider({
  children,
  detectedCountry = "KE",
}: {
  children: ReactNode;
  detectedCountry?: string;
}) {
  const [company, setCompany] = useState<Company | null>(loadCompany);
  const [stations, setStations] = useState<StationProfile[]>(loadStations);
  const [currentStationId, setCurrentStationId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(CURRENT_STATION_KEY);
      } catch {
        return null;
      }
    },
  );
  const [country, setCountry] = useState(detectedCountry);
  const [isLoading, setIsLoading] = useState(true);

  const currentStation =
    stations.find((s) => s.id === currentStationId) || stations[0] || null;
  const hasCompany = !!company;
  const settings = company?.settings || defaultSettings();
  const featureFlags = resolveFeatureFlags(company, country);
  const visibleTabs = getVisibleTabs(featureFlags, false);

  useEffect(() => {
    setIsLoading(false);
  }, []);

  // Persist
  useEffect(() => {
    if (company) localStorage.setItem(COMPANY_KEY, JSON.stringify(company));
    else localStorage.removeItem(COMPANY_KEY);
  }, [company]);

  useEffect(() => {
    localStorage.setItem(STATIONS_KEY, JSON.stringify(stations));
  }, [stations]);

  useEffect(() => {
    if (currentStationId)
      localStorage.setItem(CURRENT_STATION_KEY, currentStationId);
  }, [currentStationId]);

  const createCompany = useCallback(
    (data: Partial<Company>): Company => {
      const newCompany: Company = {
        id: `comp_${Date.now()}`,
        legalName: data.legalName || "My Fuel Company",
        tradingName: data.tradingName || data.legalName || "My Fuel Company",
        hqCountryCode: data.hqCountryCode || country,
        hqCity: data.hqCity || "",
        taxId: data.taxId || "",
        defaultCurrency: data.defaultCurrency || "USD",
        timezone:
          data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        phone: data.phone || "",
        email: data.email || "",
        industry: data.industry || "fuel_retail",
        logo: data.logo || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          ...defaultSettings(),
          ...data.settings,
          currency: data.defaultCurrency || "USD",
        },
      };
      setCompany(newCompany);
      localStorage.setItem(CURRENT_COMPANY_KEY, newCompany.id);
      return newCompany;
    },
    [country],
  );

  const updateCompany = useCallback((data: Partial<Company>) => {
    setCompany((prev) =>
      prev ? { ...prev, ...data, updatedAt: new Date().toISOString() } : null,
    );
  }, []);

  const deleteCompany = useCallback(() => {
    setCompany(null);
    setStations([]);
    setCurrentStationId(null);
    localStorage.removeItem(COMPANY_KEY);
    localStorage.removeItem(STATIONS_KEY);
    localStorage.removeItem(CURRENT_STATION_KEY);
    localStorage.removeItem(CURRENT_COMPANY_KEY);
  }, []);

  const createStation = useCallback(
    (data: Partial<StationProfile>): StationProfile => {
      // Pre-fill station name from company trading name
      const prefillName = company?.tradingName || company?.legalName;
      const station: StationProfile = {
        id: `st_${Date.now()}`,
        companyId: company?.id || "",
        name: data.name || prefillName || `Station ${stations.length + 1}`,
        location: data.location || "",
        city: data.city || "",
        countryCode: data.countryCode || company?.hqCountryCode || country,
        timezone:
          data.timezone ||
          company?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        coordinates: data.coordinates || null,
        phone: data.phone || company?.phone || "",
        email: data.email || company?.email || "",
        kraPin: data.kraPin || "",
        etrSerial: data.etrSerial || "",
        taxRate: data.taxRate || settings.taxRate || 16,
        theme: data.theme || "dark",
        logo: data.logo || company?.logo || "",
        description: data.description || "",
        fuelTypes: data.fuelTypes || ["Petrol", "Diesel"],
        pumpCount: data.pumpCount || 2,
        tankCount: data.tankCount || 2,
        managerName: data.managerName || "",
        managerPhone: data.managerPhone || "",
        licenseNumber: data.licenseNumber || "",
        operatingHours: data.operatingHours || "24/7",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: {},
      };
      setStations((prev) => [...prev, station]);
      setCurrentStationId(station.id);
      return station;
    },
    [company, stations.length, settings.taxRate, country],
  );

  const updateStation = useCallback(
    (id: string, data: Partial<StationProfile>) => {
      setStations((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, ...data, updatedAt: new Date().toISOString() }
            : s,
        ),
      );
    },
    [],
  );

  const deleteStation = useCallback(
    (id: string) => {
      setStations((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (currentStationId === id) {
          setCurrentStationId(filtered[0]?.id || null);
        }
        return filtered;
      });
    },
    [currentStationId],
  );

  const switchStation = useCallback((id: string) => {
    setCurrentStationId(id);
  }, []);

  const updateSettings = useCallback((partial: Partial<CompanySettings>) => {
    setCompany((prev) =>
      prev
        ? {
            ...prev,
            settings: { ...prev.settings, ...partial },
            updatedAt: new Date().toISOString(),
          }
        : null,
    );
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: keyof FeatureFlags): boolean => {
      return !!featureFlags[feature];
    },
    [featureFlags],
  );

  return (
    <TenantContext.Provider
      value={{
        company,
        hasCompany,
        createCompany,
        updateCompany,
        deleteCompany,
        stations,
        currentStation,
        createStation,
        updateStation,
        deleteStation,
        switchStation,
        featureFlags,
        isFeatureEnabled,
        visibleTabs,
        detectedCountry: country,
        setDetectedCountry: setCountry,
        settings,
        updateSettings,
        isLoading,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextType {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    // Return safe defaults when used outside TenantProvider
    // This prevents crashes on routes like /founder that don't wrap TenantProvider
    const defaultFlags = resolveFeatureFlags(null, "US");
    return {
      company: null,
      hasCompany: false,
      createCompany: () => {
        throw new Error("TenantProvider required");
      },
      updateCompany: () => {},
      deleteCompany: () => {},
      stations: [],
      currentStation: null,
      createStation: () => {
        throw new Error("TenantProvider required");
      },
      updateStation: () => {},
      deleteStation: () => {},
      switchStation: () => {},
      featureFlags: defaultFlags,
      isFeatureEnabled: () => true,
      visibleTabs: [],
      detectedCountry: "KE",
      setDetectedCountry: () => {},
      settings: defaultSettings(),
      updateSettings: () => {},
      isLoading: false,
    };
  }
  return ctx;
}
