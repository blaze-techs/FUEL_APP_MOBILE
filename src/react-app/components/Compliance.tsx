import { useState, useMemo, useEffect } from "react";
import {
  Globe,
  Shield,
  Receipt,
  Fuel,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  Building,
  Landmark,
  Calendar,
  Scale,
  ChevronDown,
  FileText,
  Printer,
  Upload,
  Download,
  Info,
  ShieldCheck,
  X,
} from "lucide-react";
import SafetyInspectionLog from "@/react-app/components/SafetyInspectionLog";
import HsePermitToWorkLog from "@/react-app/components/HsePermitToWorkLog";
import ComplianceDocuments from "@/react-app/components/ComplianceDocuments";
import SubTabBar from "@/react-app/components/SubTabBar";
import {
  getComplianceConfig,
  type ComplianceConfig,
} from "@/react-app/config/compliance";
import {
  CUSTOM_REQUIRED_PERMITS_KEY,
  addCustomRequiredPermit,
  mergeRequiredPermits,
  removeCustomRequiredPermit,
} from "@/react-app/lib/compliance-documents";
import { toastSuccess } from "@/react-app/lib/toast";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export default function Compliance() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const companyLogo = state?.companyData?.logo;
  const companyName = state?.companyData?.name;
  const [selectedCountryCode, setSelectedCountryCode] = useState(() => {
    // Prefer the station's explicit country, then the unified detector, then a
    // localStorage hint, then timezone — never hard-default to Kenya.
    const stationCountry =
      (currentStation as any)?.country ||
      (state?.companyData as any)?.country ||
      (state?.companyData as any)?.companyCountry;
    if (stationCountry && stationCountry.length === 2) {
      return stationCountry.toUpperCase();
    }
    const detected = getDetectedCountryCode();
    if (detected) return detected.toUpperCase();
    try {
      const saved = localStorage.getItem("fuelpro_location_country");
      if (saved) {
        const parsed = JSON.parse(saved);
        return (parsed.currentCountry || parsed.country || "US").toUpperCase();
      }
    } catch {}
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes("Nairobi")) return "KE";
    if (tz.includes("Lagos")) return "NG";
    if (tz.includes("Johannesburg")) return "ZA";
    if (tz.includes("Dar")) return "TZ";
    if (tz.includes("Kampala")) return "UG";
    if (tz.includes("Accra")) return "GH";
    return "US";
  });

  const [expandedSection, setExpandedSection] = useState<string | null>(
    "overview",
  );
  const [activeSubTab, setActiveSubTab] = useState("rules");

  const config = useMemo(
    () => getComplianceConfig(selectedCountryCode),
    [selectedCountryCode],
  );

  // ── Custom required compliance documents ─────────────────────────────────
  // Uploaded documents that don't match a country default are NEVER dismissed
  // — their type is registered here so it becomes part of the station's
  // required compliance set. Cloud-synced per station + country.
  const customPermitsKey = `${CUSTOM_REQUIRED_PERMITS_KEY}_${selectedCountryCode.toLowerCase()}`;
  const [customPermits, setCustomPermits] = useState<string[]>(() => {
    const cached = cloudStorageService.getCached<string[]>(
      customPermitsKey,
      currentStation?.id,
    );
    return Array.isArray(cached) ? cached : [];
  });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      const cloud = await cloudStorageService.get<string[]>(
        customPermitsKey,
        currentStation?.id,
      );
      if (!cancelled && Array.isArray(cloud)) setCustomPermits(cloud);
      unsub = cloudStorageService.subscribe<string[]>(
        customPermitsKey,
        currentStation?.id,
        (val) => {
          if (Array.isArray(val)) setCustomPermits(val);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [customPermitsKey, currentStation?.id]);

  const persistCustomPermits = (list: string[]) => {
    setCustomPermits(list);
    cloudStorageService
      .set(customPermitsKey, list, currentStation?.id)
      .catch(() => {});
  };

  const handleAddCustomPermit = (permit: string) => {
    const { list, added } = addCustomRequiredPermit(customPermits, permit);
    if (added) {
      persistCustomPermits(list);
      toastSuccess(`"${permit}" added to your required compliance documents.`);
    }
  };

  const handleRemoveCustomPermit = (permit: string) => {
    persistCustomPermits(removeCustomRequiredPermit(customPermits, permit));
  };

  const requiredPermits = useMemo(
    () => mergeRequiredPermits(config.requiredPermits, customPermits),
    [config, customPermits],
  );

  const subTabs = [
    { id: "rules", label: "Country Rules", icon: Globe },
    { id: "documents", label: "My Documents", icon: Upload },
    { id: "safety", label: "Safety & HSSE", icon: ShieldCheck },
  ];

  const sections = [
    { id: "overview", label: "Compliance Overview", icon: Globe },
    { id: "tax", label: "Tax & Revenue", icon: Shield },
    { id: "fuel", label: "Fuel Regulation", icon: Fuel },
    { id: "permits", label: "Required Permits & Licenses", icon: FileCheck },
    { id: "receipts", label: "Receipt & Invoice Rules", icon: Receipt },
    { id: "features", label: "Compliance Features", icon: CheckCircle2 },
    { id: "payments", label: "Payment Compliance", icon: Landmark },
    { id: "template", label: "Compliance Template", icon: FileText },
  ];

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    const data = JSON.stringify(config, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance_${config.countryCode}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Print-only header with logo */}
      <div className="hidden print:block text-center mb-4">
        {companyLogo && (
          <img
            src={companyLogo}
            alt={companyName ? `${companyName} logo` : "Company logo"}
            className="mx-auto mb-2 max-h-20 max-w-[150px] object-contain"
            crossOrigin="anonymous"
          />
        )}
        {companyName && <h1 className="text-xl font-bold">{companyName}</h1>}
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
          <Globe size={24} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Compliance
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Country-specific regulations, permits, tax rules, and compliance
            requirements for every nation
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={handlePrint}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-all"
            title="Print"
          >
            <Printer size={18} />
          </button>
          <button
            onClick={handleExport}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-all"
            title="Export JSON"
          >
            <Download size={18} />
          </button>
          <button
            onClick={() => switchToTab("reports")}
            className="px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-medium transition-all"
            title="Open Reports Center"
          >
            <FileText size={16} className="inline mr-1" />
            Reports
          </button>
          <button
            onClick={() => switchToTab("integration")}
            className="px-3 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 text-sm font-medium transition-all"
            title="Open Integration Hub (ETR / tax devices)"
          >
            <Landmark size={16} className="inline mr-1" />
            Integrations
          </button>
          <button
            onClick={() => switchToTab("pos")}
            className="px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-600 dark:text-amber-400 text-sm font-medium transition-all"
            title="Open Point of Sale"
          >
            <Receipt size={16} className="inline mr-1" />
            POS
          </button>
        </div>
      </div>

      {/* Country Selector */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="w-full max-w-md">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            Select Country
          </label>
          <SearchableCountryDropdown
            value={selectedCountryCode}
            onChange={setSelectedCountryCode}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
          <Info size={12} />
          Compliance rules automatically adjust based on your selected country.
          Choose a country above or let us detect it from your location.
        </p>
      </div>

      {/* Country Overview Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <OverviewItem icon={Globe} label="Country" value={config.country} />
          <OverviewItem
            icon={Receipt}
            label="VAT/GST Rate"
            value={`${(config.vatRate * 100).toFixed(1)}% ${config.vatName}`}
          />
          <OverviewItem
            icon={Shield}
            label="Tax Authority"
            value={config.taxAuthorityShort}
          />
          <OverviewItem
            icon={Fuel}
            label="Fuel Regulator"
            value={config.fuelRegulatorShort}
          />
          <OverviewItem
            icon={Building}
            label="Currency"
            value={`${config.currencySymbol} ${config.currency}`}
          />
          <OverviewItem
            icon={Calendar}
            label="Reporting"
            value={config.reportingFrequency}
          />
          <OverviewItem
            icon={Scale}
            label={config.hasETR ? "ETR Required" : "Invoice Std"}
            value={config.hasETR ? config.etrName : "Standard"}
          />
          <OverviewItem
            icon={FileCheck}
            label="Permits"
            value={`${config.requiredPermits.length} required`}
          />
        </div>
      </div>

      {/* Sub-tab navigation */}
      <SubTabBar
        tabs={subTabs}
        active={activeSubTab}
        onChange={setActiveSubTab}
      />

      {activeSubTab === "rules" && (
        <>
          {/* Expandable country-rule sections */}
          <div className="space-y-3">
            {sections.map((section) => {
              const isExpanded = expandedSection === section.id;
              const SectionIcon = section.icon;
              return (
                <div
                  key={section.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedSection(isExpanded ? null : section.id)
                    }
                    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                  >
                    <SectionIcon size={18} className="text-blue-500" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 text-left">
                      {section.label}
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-700 p-4">
                      {section.id === "overview" && (
                        <OverviewSection config={config} />
                      )}
                      {section.id === "tax" && <TaxSection config={config} />}
                      {section.id === "fuel" && <FuelSection config={config} />}
                      {section.id === "permits" && (
                        <PermitsSection
                          config={config}
                          customPermits={customPermits}
                          onRemoveCustom={handleRemoveCustomPermit}
                        />
                      )}
                      {section.id === "receipts" && (
                        <ReceiptsSection config={config} />
                      )}
                      {section.id === "features" && (
                        <FeaturesSection config={config} />
                      )}
                      {section.id === "payments" && (
                        <PaymentsSection config={config} />
                      )}
                      {section.id === "template" && (
                        <TemplateSection config={config} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ETR Info Banner */}
          {config.hasETR && (
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={18}
                  className="text-amber-500 flex-shrink-0 mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {config.etrName} Compliance Required
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    All fuel sales in {config.country} must be invoiced through
                    the {config.taxAuthorityShort} registered
                    {config.etrName} system. Format: {config.etrFormat}. Ensure
                    your ETR device is connected via the Integration Hub.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Data Residency Banner */}
          <div className="bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4">
            <div className="flex items-start gap-3">
              <Shield
                size={18}
                className="text-indigo-500 flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">
                  Data Residency: {config.country}
                </p>
                <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1">
                  Per {config.country}&apos;s data protection regulations, all
                  transaction data, audit logs, and customer records are stored
                  and processed within {config.country}&apos;s jurisdiction.
                  Cross-border data transfers require explicit consent and
                  follow {config.taxAuthorityShort} guidelines.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {activeSubTab === "documents" && (
        <ComplianceDocuments
          requiredPermits={requiredPermits}
          onAddRequiredPermit={handleAddCustomPermit}
        />
      )}

      {activeSubTab === "safety" && (
        <div className="space-y-6">
          <SafetyInspectionLog />
          <HsePermitToWorkLog />
        </div>
      )}
    </div>
  );
}

function OverviewItem({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-blue-400" />
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function OverviewSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoCard
          title="Country Code"
          value={config.countryCode}
          desc={`Timezone: ${config.timeZone}`}
        />
        <InfoCard
          title="Currency"
          value={`${config.currency} (${config.currencySymbol})`}
          desc={`Decimal: "${config.decimalSeparator}" | Thousands: "${config.thousandSeparator}"`}
        />
        <InfoCard
          title="Reporting"
          value={config.reportingFrequency}
          desc={`Date Format: ${config.dateFormat}`}
        />
        <InfoCard
          title="Units"
          value={`${config.units.volume} / ${config.units.distance}`}
          desc={`Temperature: ${config.units.temperature}`}
        />
        <InfoCard
          title="Languages"
          value={config.languages.join(", ")}
          desc={`Phone: ${config.phoneCode}`}
        />
        <InfoCard
          title="Public Holidays"
          value={`${config.holidays.length} recognized`}
          desc={config.holidays.slice(0, 3).join(", ")}
        />
      </div>
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
          Compliance Summary for {config.country}
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Operating a fuel station in {config.country} requires{" "}
          {config.requiredPermits.length} permits, compliance with{" "}
          {config.taxAuthorityShort} regulations, and adherence to{" "}
          {config.fuelRegulatorShort}
          fuel quality standards.{" "}
          {config.hasETR
            ? `All sales must use ${config.etrName} for invoicing.`
            : "Standard invoicing applies."}
        </p>
      </div>
    </div>
  );
}

function TaxSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoCard
          title="Tax Authority"
          value={config.taxAuthority}
          desc={`Short: ${config.taxAuthorityShort}`}
        />
        <InfoCard
          title="VAT/GST Rate"
          value={`${(config.vatRate * 100).toFixed(1)}%`}
          desc={config.vatName}
        />
        <InfoCard
          title="Reporting Frequency"
          value={config.reportingFrequency}
          desc="VAT returns due"
        />
        <InfoCard
          title="Date Format"
          value={config.dateFormat}
          desc={`Timezone: ${config.timeZone}`}
        />
      </div>
      {config.hasETR && (
        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
            {config.etrName}
          </p>
          <p className="text-xs text-indigo-600 dark:text-indigo-400">
            Format: {config.etrFormat}
          </p>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
            Integration required for all fuel sales. Connect via Integration Hub
            → ETR Settings.
          </p>
        </div>
      )}
    </div>
  );
}

function FuelSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Regulated by: <strong>{config.fuelRegulator}</strong> (
        {config.fuelRegulatorShort})
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {config.fuelTypes.map((ft) => (
          <div
            key={ft.code}
            className="p-3 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {ft.localName}
              </p>
              <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                {ft.code}
              </span>
            </div>
            <p className="text-xs text-gray-500">{ft.name}</p>
            {ft.taxRate > 0 && (
              <p className="text-xs text-amber-600 mt-1">Tax: {ft.taxRate}%</p>
            )}
            {ft.levyRate > 0 && (
              <p className="text-xs text-amber-600">Levy: {ft.levyRate}%</p>
            )}
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              Body: {ft.regulatoryBody}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermitsSection({
  config,
  customPermits = [],
  onRemoveCustom,
}: {
  config: ComplianceConfig;
  customPermits?: string[];
  onRemoveCustom?: (permit: string) => void;
}) {
  const storageKey = `compliance_permits_${config.countryCode}`;
  const [obtained, setObtained] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return new Set<string>(JSON.parse(saved));
    } catch {
      /* */
    }
    return new Set<string>();
  });
  const [loaded, setLoaded] = useState(false);

  // Load from cloud (cross-device) + realtime
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      const cloud = await cloudStorageService.get<string[]>(storageKey);
      if (!cancelled && Array.isArray(cloud)) {
        setObtained(new Set<string>(cloud));
      }
      setLoaded(true);
      unsub = cloudStorageService.subscribe<string[]>(
        storageKey,
        undefined,
        (val) => {
          if (Array.isArray(val)) setObtained(new Set<string>(val));
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [storageKey]);

  const toggle = (permit: string) => {
    const next = new Set<string>(obtained);
    if (next.has(permit)) next.delete(permit);
    else next.add(permit);
    setObtained(next);
    const arr = Array.from(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(arr));
    } catch {
      /* */
    }
    cloudStorageService.set(storageKey, arr).catch(() => {});
  };

  const obtainedCount = obtained.size;
  const total = config.requiredPermits.length + customPermits.length;
  const pct = total > 0 ? Math.round((obtainedCount / total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          {total} permits/licenses required to operate a fuel station:
        </p>
        {loaded && (
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {obtainedCount}/{total} obtained ({pct}%)
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {config.requiredPermits.map((permit, i) => {
        const isObtained = obtained.has(permit);
        return (
          <button
            key={i}
            onClick={() => toggle(permit)}
            className="w-full flex items-center gap-2 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800 transition-all text-left"
          >
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isObtained ? "bg-green-500 border-green-500" : "border-gray-300 dark:border-gray-600"}`}
            >
              {isObtained && (
                <CheckCircle2
                  size={12}
                  className="text-gray-900 dark:text-white"
                />
              )}
            </div>
            <span
              className={`text-xs ${isObtained ? "text-gray-500 line-through" : "text-gray-700 dark:text-gray-300"}`}
            >
              {permit}
            </span>
          </button>
        );
      })}
      {customPermits.length > 0 && (
        <div className="pt-2 mt-1 border-t border-dashed border-gray-200 dark:border-gray-700">
          <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mb-1.5">
            Added from your uploaded documents:
          </p>
          {customPermits.map((permit) => {
            const isObtained = obtained.has(permit);
            return (
              <div
                key={permit}
                className="w-full flex items-center gap-2 p-2 mb-1 bg-indigo-50/60 dark:bg-indigo-900/10 rounded-lg text-left"
              >
                <button
                  onClick={() => toggle(permit)}
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isObtained ? "bg-green-500 border-green-500" : "border-gray-300 dark:border-gray-600"}`}
                  aria-label={
                    isObtained ? "Mark not obtained" : "Mark obtained"
                  }
                >
                  {isObtained && (
                    <CheckCircle2
                      size={12}
                      className="text-gray-900 dark:text-white"
                    />
                  )}
                </button>
                <span
                  className={`text-xs flex-1 ${isObtained ? "text-gray-500 line-through" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {permit}
                </span>
                {onRemoveCustom && (
                  <button
                    onClick={() => onRemoveCustom(permit)}
                    className="text-gray-400 hover:text-red-500 p-0.5"
                    title={`Remove "${permit}" from required documents`}
                    aria-label={`Remove ${permit}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle size={12} className="inline mr-1" />
          Operating without these permits may result in fines, license
          revocation, or legal action by {config.fuelRegulatorShort}. Tick each
          permit as you obtain it — your checklist syncs across devices.
        </p>
      </div>
    </div>
  );
}

function ReceiptsSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 mb-2">
        Every receipt/invoice must include:
      </p>
      {config.receiptRequirements.map((req, i) => (
        <div
          key={i}
          className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
        >
          <Receipt size={14} className="text-blue-500 flex-shrink-0" />
          <span className="text-xs text-gray-700 dark:text-gray-300">
            {req}
          </span>
        </div>
      ))}
    </div>
  );
}

function FeaturesSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-2">
      {config.complianceFeatures.map((f) => (
        <div
          key={f.id}
          className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
        >
          <div
            className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${f.required ? "bg-red-500" : "bg-gray-400"}`}
          />
          <div>
            <p className="text-xs font-medium text-gray-900 dark:text-white">
              {f.name}
              {f.required && (
                <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                  Required
                </span>
              )}
              {!f.required && (
                <span className="ml-2 text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                  Recommended
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500">{f.description}</p>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {f.category}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentsSection({ config }: { config: ComplianceConfig }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {config.paymentMethods.map((pm) => (
          <div
            key={pm.id}
            className="p-3 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {pm.name}
              </p>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  pm.type === "mobile"
                    ? "bg-green-100 text-green-700"
                    : pm.type === "card"
                      ? "bg-blue-100 text-blue-700"
                      : pm.type === "bank"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-700"
                }`}
              >
                {pm.type}
              </span>
            </div>
            {pm.provider && (
              <p className="text-xs text-gray-500">{pm.provider}</p>
            )}
            {pm.chargeRate > 0 && (
              <p className="text-xs text-amber-600">Fee: {pm.chargeRate}%</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
          Supported Banks
        </p>
        <div className="flex flex-wrap gap-2 mt-1">
          {config.bankSupport.map((b) => (
            <span
              key={b.code}
              className="text-[10px] px-2 py-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
            >
              {b.name}{" "}
              {b.supportsApi && <span className="text-green-500">API</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateSection({ config }: { config: ComplianceConfig }) {
  const template = generateComplianceTemplate(config);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Example compliance template for {config.country}:
        </p>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(template, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `compliance_template_${config.countryCode.toLowerCase()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700"
        >
          <Download size={12} /> Download Template
        </button>
      </div>
      <div className="p-4 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg font-mono text-xs text-gray-700 dark:text-gray-300 overflow-x-auto">
        <pre>{JSON.stringify(template, null, 2)}</pre>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  value,
  desc,
}: {
  title: string;
  value: string;
  desc?: string;
}) {
  return (
    <div className="p-3 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">
        {title}
      </p>
      <p className="text-sm font-bold text-gray-900 dark:text-white">{value}</p>
      {desc && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">{desc}</p>
      )}
    </div>
  );
}

function generateComplianceTemplate(config: ComplianceConfig) {
  return {
    template_id: `compliance_${config.countryCode.toLowerCase()}_v1`,
    version: "1.0",
    region: config.countryCode,
    country: config.country,
    generated_at: new Date().toISOString(),
    fuel_station_compliance: {
      registration: {
        business_name: `[Your Business Name]`,
        trading_name: `[Trading Name]`,
        tax_id: `[${config.taxAuthorityShort} Registration Number]`,
        fuel_license: `[${config.fuelRegulatorShort} License Number]`,
        vat_number: `[VAT Registration Number]`,
        date_format: config.dateFormat,
        currency: config.currency,
      },
      permits: config.requiredPermits.map((p) => ({
        name: p,
        status: "pending",
        issued_by: config.fuelRegulatorShort,
        valid_until: `[YYYY-MM-DD]`,
      })),
      fuel_operations: config.fuelTypes.map((ft) => ({
        type: ft.code,
        name: ft.localName,
        tax_rate: ft.taxRate,
        levy_rate: ft.levyRate,
        max_retail_price: `[${config.currencySymbol} XX.XX]`,
        current_stock_litres: `[Volume]`,
      })),
      reporting_schedule: {
        frequency: config.reportingFrequency,
        next_due: `[YYYY-MM-DD]`,
        tax_authority: config.taxAuthority,
        etr_system: config.hasETR ? config.etrName : "Not Required",
      },
      receipt_template: {
        required_fields: config.receiptRequirements,
        etr_format: config.etrFormat,
        sample_receipt_number: `[AUTO-GENERATED]`,
      },
      payment_methods: config.paymentMethods.map((pm) => ({
        id: pm.id,
        name: pm.name,
        type: pm.type,
        provider: pm.provider,
        charge_rate: pm.chargeRate,
        enabled: true,
      })),
      data_retention: {
        transaction_records: "7 years",
        audit_logs: "10 years",
        customer_data: config.isEU ? "GDPR compliant" : "Per local regulations",
        jurisdiction: config.country,
      },
    },
  };
}
