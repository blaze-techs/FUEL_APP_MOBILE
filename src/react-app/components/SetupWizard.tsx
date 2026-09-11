import React, { useState, useEffect } from "react";
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  Fuel,
  Gauge,
  DollarSign,
  FileCheck,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  Plus,
  Minus,
  Loader2,
  RefreshCw,
  Link2,
  Trash2,
} from "lucide-react";
import { useFuel } from "../context/FuelContext";
import { useStations } from "../context/StationContext";
import {
  getFuelPrices,
  getDisplayPrices,
  FuelPrices,
} from "../services/FuelPriceService";
import { getCountryFromLocation } from "../lib/world-country-utils";
import { getCurrencySymbol as getCurrencySymbolForCode } from "../lib/currency";
import {
  getCountryPrice,
  getVATRate,
  currencySymbolFor,
  CANONICAL_FUEL_TYPES,
  getFuelLabel,
  getFuelCode,
  type CanonicalFuelType,
} from "../config/pricing";
import { getRegionalConfig } from "../config/regions";
import SearchableCountryDropdown from "./SearchableCountryDropdown";
import { resolveCountryFromBrowser } from "../lib/geo-utils";
import cloudStorageService from "../lib/cloud-storage-service";

const DEFAULT_CURRENCY = "$ ";

/** Resolve the currency symbol for a country code using the world-wide
 * pricing table (covers all 250+ countries, never defaults to "KSh"). */
function getCountrySymbol(countryCode: string): string {
  const p = getCountryPrice(countryCode, "petrol");
  return p.symbol;
}

interface WizardData {
  // Step 1: Station Info
  stationName: string;
  location: string;
  contacts: string;
  email: string;
  countryCode: string;
  // Step 2: Tanks
  pmsTankCapacity: number;
  agoTankCapacity: number;
  pmsTankOpening: number;
  agoTankOpening: number;
  // Step 3: Pumps
  pmsCount: number;
  agoCount: number;
  // Step 4: Pricing
  pmsPrice: number;
  agoPrice: number;
  // Step 5: Tax / Compliance (optional, country-aware)
  kraPin: string;
  vatRegNo: string;
  physicalAddress: string;
  etrSerialNo: string;
  /**
   * Extra fuel types beyond the default PMS/AGO (Kerosene, LPG, V-Power,
   * etc.). Each carries a pump count + per-litre price. The wizard is no
   * longer limited to only PMS & AGO — a station can configure as many
   * fuel types as it sells at sign-up.
   */
  extraFuels: ExtraFuel[];
}

/** An additional fuel type configured in the wizard (beyond PMS/AGO). */
export interface ExtraFuel {
  id: string;
  /** Canonical fuel-type key (kerosene | vpower | premium_diesel | lpg | cng). */
  type: CanonicalFuelType;
  /** Display label for the fuel (e.g. "Kerosene"). */
  label?: string;
  /** Number of pumps configured for this fuel type. */
  pumpCount?: number;
  /** Optional short code override (defaults to type.toUpperCase()). */
  code?: string;
  count: number;
  price: number;
}

const STEPS = [
  { id: 1, title: "Station Info", icon: Building2 },
  { id: 2, title: "Fuel Tanks", icon: Fuel },
  { id: 3, title: "Pumps", icon: Gauge },
  { id: 4, title: "Pricing", icon: DollarSign },
  { id: 5, title: "Tax & Compliance", icon: FileCheck },
];

interface SetupWizardProps {
  onComplete: () => void;
  /** When provided, shows a link to access a shared station instead of creating one. */
  onAccessShared?: () => void;
}

export default function SetupWizard({
  onComplete,
  onAccessShared,
}: SetupWizardProps) {
  const { state, dispatch } = useFuel();
  const { createStation, switchStation } = useStations();
  const [currentStep, setCurrentStep] = useState(1);
  const [autoDetectedPrices, setAutoDetectedPrices] =
    useState<FuelPrices | null>(null);
  const [isDetectingPrices, setIsDetectingPrices] = useState(false);
  const [priceDetectionError, setPriceDetectionError] = useState<string | null>(
    null,
  );

  // Get default prices - try to auto-detect on mount
  const getDefaultPrices = () => {
    const displayPrices = getDisplayPrices();
    // Pre-select the browser-detected country so the wizard is world-wide
    // from the first render (no Kenya assumption). resolveCountryFromBrowser
    // maps 250+ timezones, falling back to a neutral "US" default rather
    // than Kenya.
    const detectedCc = resolveCountryFromBrowser();
    const cc = detectedCc || "US";
    const countryPrice = getCountryPrice(cc, "petrol");
    const dieselPrice = getCountryPrice(cc, "diesel");
    return {
      stationName: "",
      location: "Auto-detected",
      contacts: "",
      email: "",
      countryCode: cc,
      pmsTankCapacity: 20000,
      agoTankCapacity: 20000,
      pmsTankOpening: 0,
      agoTankOpening: 0,
      pmsCount: 2,
      agoCount: 2,
      pmsPrice: displayPrices.pmsPrice || countryPrice.price,
      agoPrice: displayPrices.agoPrice || dieselPrice.price,
      kraPin: "",
      vatRegNo: "",
      physicalAddress: "Auto-detected location",
      etrSerialNo: "",
      extraFuels: [],
    };
  };

  const [data, setData] = useState<WizardData>(getDefaultPrices);

  // When the user picks a country, re-seed the default prices and tax rate for
  // that country so the wizard reflects the correct currency / fuel price.
  const handleCountryChange = (cc: string) => {
    setData((prev) => {
      const countryPrice = getCountryPrice(cc, "petrol");
      const dieselPrice = getCountryPrice(cc, "diesel");
      return {
        ...prev,
        countryCode: cc,
        pmsPrice: countryPrice.price,
        agoPrice: dieselPrice.price,
      };
    });
  };

  // Auto-detect fuel prices on component mount (runs once per day)
  useEffect(() => {
    const detectPrices = async () => {
      setIsDetectingPrices(true);
      setPriceDetectionError(null);

      try {
        const prices = await getFuelPrices(data.location || undefined);
        setAutoDetectedPrices(prices);

        // Update the data state with detected prices
        setData((prev) => ({
          ...prev,
          pmsPrice: prices.petrolPrice,
          agoPrice: prices.dieselPrice,
        }));

        console.log("[SetupWizard] Auto-detected prices:", prices);
      } catch (error) {
        console.error("[SetupWizard] Failed to detect prices:", error);
        setPriceDetectionError(
          "Could not auto-detect prices. Using default values.",
        );
      } finally {
        setIsDetectingPrices(false);
      }
    };

    detectPrices();
    // Re-detect when the user-entered location changes so prices track the
    // station's real country instead of the CDN/browser timezone.
  }, [data.location]);

  // Function to manually refresh prices
  const refreshPrices = async () => {
    setIsDetectingPrices(true);
    setPriceDetectionError(null);

    try {
      const prices = await getFuelPrices(data.location || undefined);
      setAutoDetectedPrices(prices);
      setData((prev) => ({
        ...prev,
        pmsPrice: prices.petrolPrice,
        agoPrice: prices.dieselPrice,
      }));
    } catch (error) {
      setPriceDetectionError("Failed to refresh prices. Please try again.");
    } finally {
      setIsDetectingPrices(false);
    }
  };

  const updateField = (field: keyof WizardData, value: string | number) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  // --- Extra fuel types (beyond PMS/AGO) management ---
  // Available canonical fuel types that can be added as extra fuels.
  const EXTRA_FUEL_OPTIONS: CanonicalFuelType[] = [
    "kerosene",
    "vpower",
    "premium_diesel",
    "lpg",
    "cng",
  ];
  const usedExtraTypes = new Set(data.extraFuels.map((f) => f.type));
  const availableExtraFuels = EXTRA_FUEL_OPTIONS.filter(
    (t) => !usedExtraTypes.has(t),
  );

  const addExtraFuel = (type: CanonicalFuelType) => {
    const ef: ExtraFuel = {
      id: `ef-${type}-${Date.now()}`,
      type,
      count: 1,
      price: getCountryPrice(data.countryCode || "US", type as any)?.price || 0,
    };
    setData((prev) => ({ ...prev, extraFuels: [...prev.extraFuels, ef] }));
  };

  const updateExtraFuel = (id: string, patch: Partial<ExtraFuel>) => {
    setData((prev) => ({
      ...prev,
      extraFuels: prev.extraFuels.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    }));
  };

  const removeExtraFuel = (id: string) => {
    setData((prev) => ({
      ...prev,
      extraFuels: prev.extraFuels.filter((f) => f.id !== id),
    }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return data.stationName.trim() !== "";
      case 2:
        return data.pmsTankCapacity > 0 || data.agoTankCapacity > 0;
      case 3:
        return (
          data.pmsCount > 0 || data.agoCount > 0 || data.extraFuels.length > 0
        );
      case 4:
        return (
          data.pmsPrice > 0 ||
          data.agoPrice > 0 ||
          data.extraFuels.some((f) => f.price > 0)
        );
      case 5:
        return true; // KRA is optional
      default:
        return true;
    }
  };

  const handleComplete = () => {
    // Create pumps based on count
    const pmsPumps = Array.from({ length: data.pmsCount }, (_, i) => ({
      id: `pms-${i + 1}`,
      openingKsh: 0,
      closingKsh: 0,
      openingL: 0,
      closingL: 0,
      salesL: 0,
      salesKsh: 0,
    }));

    const agoPumps = Array.from({ length: data.agoCount }, (_, i) => ({
      id: `ago-${i + 1}`,
      openingKsh: 0,
      closingKsh: 0,
      openingL: 0,
      closingL: 0,
      salesL: 0,
      salesKsh: 0,
    }));

    // Update company data
    const regionalConfig = getRegionalConfig(data.countryCode || "US");
    dispatch({
      type: "SET_COMPANY_DATA",
      payload: {
        ...state.companyData,
        name: data.stationName,
        contacts: data.contacts,
        email: data.email,
        kraPin: data.kraPin,
        vatRegNo: data.vatRegNo,
        physicalAddress: data.physicalAddress || data.location,
        etrSerialNo: data.etrSerialNo,
        // Store the currency CODE (e.g. "USD"), not the symbol ("$"), so
        // downstream components resolve the correct symbol at display time.
        currency: regionalConfig.currency || "USD",
        companyCurrency: regionalConfig.currency || "USD",
        country: data.countryCode || "US",
      },
    });

    // Update pumps
    dispatch({ type: "SET_PMS_PUMPS", payload: pmsPumps });
    dispatch({ type: "SET_AGO_PUMPS", payload: agoPumps });

    // Update tank levels
    dispatch({
      type: "SET_TANK_VALUES",
      payload: {
        pmsTankOpening: data.pmsTankOpening,
        agoTankOpening: data.agoTankOpening,
        pmsTankClosing: data.pmsTankOpening,
        agoTankClosing: data.agoTankOpening,
      },
    });

    // Update prices
    dispatch({
      type: "SET_PRICES",
      payload: {
        pmsPrice: data.pmsPrice,
        agoPrice: data.agoPrice,
      },
    });

    // Dispatch extra fuel types (Kerosene, LPG, V-Power, etc.) — the wizard
    // is no longer limited to only PMS & AGO. Each extra fuel gets its own
    // pump array (fuelPumpsByType) + price (fuelPricesByType).
    const extraPumpsByType: Record<string, typeof pmsPumps> = {};
    const extraPricesByType: Record<string, number> = {};
    for (const ef of data.extraFuels) {
      const code = getFuelCode(ef.type);
      const pumps = Array.from({ length: ef.count || 0 }, (_, i) => ({
        id: `${code}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
        openingKsh: 0,
        closingKsh: 0,
        openingL: 0,
        closingL: 0,
        salesL: 0,
        salesKsh: 0,
      }));
      extraPumpsByType[ef.type] = pumps;
      if (ef.price > 0) extraPricesByType[ef.type] = ef.price;
    }
    if (Object.keys(extraPumpsByType).length > 0) {
      dispatch({ type: "SET_FUEL_PUMPS_BY_TYPE", payload: extraPumpsByType });
    }
    if (Object.keys(extraPricesByType).length > 0) {
      dispatch({ type: "SET_FUEL_PRICES_BY_TYPE", payload: extraPricesByType });
    }

    // Seed the fuel_types_config catalog so the new station's configured fuel
    // types (PMS/AGO + extras) are immediately available to POS, Dashboard,
    // Price Board, etc. — without the user having to open Fuel Type Manager.
    let seededFuelTypes: Array<Record<string, unknown>> = [];
    try {
      seededFuelTypes = [
        {
          id: `ft-petrol-${Date.now()}`,
          code: "PMS",
          name: CANONICAL_FUEL_TYPES.petrol.label,
          localName: CANONICAL_FUEL_TYPES.petrol.label,
          price: data.pmsPrice,
          costPrice: 0,
          taxRate: 0,
          levyRate: 0,
          color: "#22c55e",
          icon: "Fuel",
          pumpCount: data.pmsCount,
          active: true,
          description: "Premium Motor Spirit (Petrol)",
        },
        {
          id: `ft-diesel-${Date.now()}`,
          code: "AGO",
          name: CANONICAL_FUEL_TYPES.diesel.label,
          localName: CANONICAL_FUEL_TYPES.diesel.label,
          price: data.agoPrice,
          costPrice: 0,
          taxRate: 0,
          levyRate: 0,
          color: "#f59e0b",
          icon: "Fuel",
          pumpCount: data.agoCount,
          active: true,
          description: "Automotive Gas Oil (Diesel)",
        },
        ...data.extraFuels.map((ef) => ({
          id: ef.id,
          code: getFuelCode(ef.type),
          name: getFuelLabel(ef.type),
          localName: getFuelLabel(ef.type),
          price: ef.price,
          costPrice: 0,
          taxRate: 0,
          levyRate: 0,
          color:
            ef.type === "kerosene"
              ? "#f43f5e"
              : ef.type === "lpg"
                ? "#6366f1"
                : "#0ea5e9",
          icon: "Fuel",
          pumpCount: ef.count,
          active: true,
          description: getFuelLabel(ef.type),
        })),
      ];
      // Persist to cloud AFTER station creation (below) using newStationId,
      // because state.currentStationId is stale here (the station hasn't
      // been created yet). We store the array for the deferred save.
    } catch (e) {
      console.error("[SetupWizard] Failed to seed fuel_types_config:", e);
    }

    // Mark setup as complete (localStorage + cloud, so a returning user on a
    // new device offline is not sent back to the wizard). The cloud key
    // `setup_complete` is read by Home.tsx on mount to hydrate the local flag.
    localStorage.setItem("fuelpro_setup_complete", "true");
    cloudStorageService.set("setup_complete", true, undefined).catch(() => {});

    // Derive country-aware settings (currency, timezone, tax rate) from the
    // user's selected country so the station is genuinely world-wide — never
    // hardcoded to Kenya/Nairobi/16%.
    // (regionalConfig is already declared above for the SET_COMPANY_DATA dispatch)
    const countryTaxRate = Math.round(
      (regionalConfig.vatRate || getVATRate(data.countryCode || "US")) * 100,
    );
    const countryTimezone = regionalConfig.timeZone || "UTC";

    // Create the station in StationContext so it's registered and loaded
    let newStationId = "";
    // Build a description that includes ALL configured fuel types (not just
    // PMS/AGO) so the station record reflects the user's actual setup.
    const fuelDescParts: string[] = [];
    if (data.pmsCount > 0) fuelDescParts.push(`PMS: ${data.pmsCount} pumps`);
    if (data.agoCount > 0) fuelDescParts.push(`AGO: ${data.agoCount} pumps`);
    for (const ef of data.extraFuels) {
      fuelDescParts.push(`${ef.label}: ${ef.pumpCount} pumps`);
    }
    const stationDescription =
      fuelDescParts.join(", ") || "No pumps configured";
    const allFuelTypeCodes = [
      ...(data.pmsCount > 0 ? ["PMS"] : []),
      ...(data.agoCount > 0 ? ["AGO"] : []),
      ...data.extraFuels.map((ef) => ef.code || ef.type.toUpperCase()),
    ];
    try {
      const newStation = createStation({
        name: data.stationName || "My Fuel Station",
        location: data.location || "Auto-detected",
        description: stationDescription,
        // Pass through the contact/tax details captured in the wizard so the
        // station record (and downstream cloud sync) carries them instead of
        // defaulting to empty strings.
        phone: data.contacts || "",
        email: data.email || "",
        kraPin: data.kraPin || "",
        etrSerial: data.etrSerialNo || "",
        taxRate: countryTaxRate,
        // Persist the selected country + derived currency/timezone on the
        // station itself so the entire app (Dashboard, LocationSelector,
        // pricing, tax) is world-wide and reflects the user's choice on
        // every device — never silently overridden by GPS/timezone defaults.
        country: data.countryCode || "US",
        currency: regionalConfig.currency || "USD",
        currencySymbol: currencySymbolFor(regionalConfig.currency || "USD"),
        timezone: countryTimezone,
      });
      if (newStation && newStation.id) {
        newStationId = newStation.id;
        // Switch to the new station immediately
        switchStation(newStation.id);
      }
    } catch (err) {
      console.error("Station creation failed:", err);
    }

    // Now that we have newStationId, persist the seeded fuel_types_config to
    // cloud with the correct station-scoped row id. This was previously saved
    // with state.currentStationId (stale/undefined) so it never reached the
    // cloud — causing POS/Dashboard to show wrong/default fuel prices on
    // fresh devices.
    if (seededFuelTypes.length > 0 && newStationId) {
      cloudStorageService
        .set("fuel_types_config", seededFuelTypes, newStationId)
        .catch((e) =>
          console.error(
            "[SetupWizard] fuel_types_config cloud save failed:",
            e,
          ),
        );
    }

    // Also write directly to localStorage as fallback
    // This ensures the station is available even if state hasn't propagated
    try {
      const fallbackStation = {
        id: newStationId || `st_${Date.now()}`,
        name: data.stationName || "My Fuel Station",
        location: data.location || "Auto-detected",
        description: stationDescription,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fuelTypes:
          allFuelTypeCodes.length > 0
            ? allFuelTypeCodes
            : ["PMS", "AGO", "IK", "LPG", "VPW"],
        pumpCount:
          (data.pmsCount || 0) +
          (data.agoCount || 0) +
          data.extraFuels.reduce((s, f) => s + (f.pumpCount || 0), 0),
        tankCount: 2,
        managerName: "",
        operatingHours: "24/7",
        kraPin: data.kraPin || "",
        phone: data.contacts || "",
        email: data.email || "",
        data: {},
        theme: "dark",
        logo: "",
        licenseNumber: "",
        city: "",
        countryCode: data.countryCode || "US",
        timezone: countryTimezone,
        coordinates: null,
        managerPhone: "",
        etrSerial: data.etrSerialNo || "",
        taxRate: countryTaxRate,
        access: [
          {
            username: (data.stationName || "station")
              .toLowerCase()
              .replace(/\s+/g, "_"),
            passwordHash: "",
            role: "owner" as const,
            permissions: ["all"],
            grantedAt: new Date().toISOString(),
            grantedBy: "system",
          },
        ],
        sharedUsers: [],
      };

      // Read existing stations
      const existingData = localStorage.getItem("fuelpro_stations_v3");
      const existing = existingData
        ? JSON.parse(existingData)
        : { stations: [], version: "3.0" };

      // Add new station if not exists
      if (!existing.stations.some((s: any) => s.id === fallbackStation.id)) {
        existing.stations = [...(existing.stations || []), fallbackStation];
        localStorage.setItem("fuelpro_stations_v3", JSON.stringify(existing));
      }

      // Set current station
      localStorage.setItem("fuelpro_current_station_v3", fallbackStation.id);
      newStationId = fallbackStation.id;
    } catch (e) {
      console.error("Fallback station save failed:", e);
    }

    // Save wizard data to station-specific storage
    // Use detected location as fallback instead of hardcoded text
    const detectedLocation = (() => {
      try {
        const saved = localStorage.getItem("fuelpro_location_country");
        if (saved) {
          const p = JSON.parse(saved);
          return p.address || p.city || p.countryName;
        }
      } catch {
        /* */
      }
      return null;
    })();
    localStorage.setItem(
      `fuelpro_station_${newStationId || "default"}_name`,
      data.stationName || "My Fuel Station",
    );
    localStorage.setItem(
      `fuelpro_station_${newStationId || "default"}_location`,
      data.location || detectedLocation || "Main Station Location",
    );

    // Mark setup complete and signal completion
    // Home.tsx will handle the reload
    onComplete();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <StationInfoStep
            data={data}
            updateField={updateField}
            onCountryChange={handleCountryChange}
          />
        );
      case 2:
        return <TanksStep data={data} updateField={updateField} />;
      case 3:
        return (
          <PumpsStep
            data={data}
            updateField={updateField}
            availableExtraFuels={availableExtraFuels}
            onAddExtraFuel={addExtraFuel}
            onUpdateExtraFuel={updateExtraFuel}
            onRemoveExtraFuel={removeExtraFuel}
          />
        );
      case 4:
        return (
          <PricingStep
            data={data}
            updateField={updateField}
            isDetectingPrices={isDetectingPrices}
            autoDetectedPrices={autoDetectedPrices}
            onRefreshPrices={refreshPrices}
            priceDetectionError={priceDetectionError}
            availableExtraFuels={availableExtraFuels}
            onAddExtraFuel={addExtraFuel}
            onUpdateExtraFuel={updateExtraFuel}
            onRemoveExtraFuel={removeExtraFuel}
          />
        );
      case 5:
        return <KRAStep data={data} updateField={updateField} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl mb-4 shadow-lg">
            <Fuel className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome to FuelPro
          </h1>
          <p className="text-blue-200">
            Let's set up your fuel station in a few easy steps
          </p>
          {onAccessShared && (
            <button
              onClick={onAccessShared}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline transition-colors"
            >
              <Link2 size={13} /> Access a shared station instead
            </button>
          )}
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8 gap-2">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;

            return (
              <React.Fragment key={step.id}>
                <div className="flex flex-col items-center">
                  <div
                    className={`
                    w-10 h-10 rounded-full flex items-center justify-center transition-all
                    ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isActive
                          ? "bg-amber-500 text-white ring-4 ring-amber-500/30"
                          : "bg-slate-700 text-slate-400"
                    }
                  `}
                  >
                    {isCompleted ? <Check size={18} /> : <StepIcon size={18} />}
                  </div>
                  <span
                    className={`text-xs mt-1 hidden md:block ${isActive ? "text-amber-400" : "text-slate-500"}`}
                  >
                    {step.title}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`w-8 h-0.5 ${isCompleted ? "bg-green-500" : "bg-slate-700"}`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Content Card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-8">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
            {STEPS[currentStep - 1].title}
          </h2>

          {renderStepContent()}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setCurrentStep((s) => s - 1)}
              disabled={currentStep === 1}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
              Back
            </button>

            {currentStep < 5 ? (
              <button
                onClick={() => setCurrentStep((s) => s + 1)}
                disabled={!canProceed()}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/30"
              >
                Continue
                <ChevronRight size={18} />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium rounded-lg transition-all shadow-lg shadow-green-500/30"
              >
                <Sparkles size={18} />
                Complete Setup
              </button>
            )}
          </div>
        </div>

        {/* Skip option */}
        {currentStep === 1 && (
          <button
            onClick={() => {
              localStorage.setItem("fuelpro_setup_complete", "true");
              cloudStorageService
                .set("setup_complete", true, undefined)
                .catch(() => {});
              onComplete();
            }}
            className="w-full mt-4 text-center text-sm text-slate-400 hover:text-white transition-colors"
          >
            Skip setup and configure later
          </button>
        )}
      </div>
    </div>
  );
}

// Step Components
interface StepProps {
  data: WizardData;
  updateField: (field: keyof WizardData, value: string | number) => void;
}

function StationInfoStep({
  data,
  updateField,
  onCountryChange,
}: StepProps & { onCountryChange?: (cc: string) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Station Name *
        </label>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={data.stationName}
            onChange={(e) => updateField("stationName", e.target.value)}
            placeholder="e.g., Sunrise Petrol Station"
            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Country / Region *
        </label>
        <SearchableCountryDropdown
          value={data.countryCode}
          onChange={(cc) => onCountryChange?.(cc)}
          label=""
          placeholder="Search your country…"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Location
        </label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={data.location}
            onChange={(e) => updateField("location", e.target.value)}
            placeholder="e.g., 123 Main Street, City"
            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Phone Number
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="tel"
              value={data.contacts}
              onChange={(e) => updateField("contacts", e.target.value)}
              placeholder="e.g., +1 555 123 4567"
              className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={data.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="e.g., info@station.com"
              className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TanksStep({ data, updateField }: StepProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Configure your fuel storage tanks. You can adjust capacities and current
        stock levels.
      </p>

      {/* PMS Tank */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-5 border border-green-200 dark:border-green-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <h3 className="font-semibold text-green-800 dark:text-green-300">
            PMS (Petrol) Tank
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-green-700 dark:text-green-400 mb-1">
              Capacity (Litres)
            </label>
            <input
              type="number"
              value={data.pmsTankCapacity}
              onChange={(e) =>
                updateField("pmsTankCapacity", Number(e.target.value))
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-green-300 dark:border-green-700 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-green-700 dark:text-green-400 mb-1">
              Current Stock (Litres)
            </label>
            <input
              type="number"
              value={data.pmsTankOpening}
              onChange={(e) =>
                updateField("pmsTankOpening", Number(e.target.value))
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-green-300 dark:border-green-700 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-slate-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* AGO Tank */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-5 border border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full bg-amber-500"></div>
          <h3 className="font-semibold text-amber-800 dark:text-amber-300">
            AGO (Diesel) Tank
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-amber-700 dark:text-amber-400 mb-1">
              Capacity (Litres)
            </label>
            <input
              type="number"
              value={data.agoTankCapacity}
              onChange={(e) =>
                updateField("agoTankCapacity", Number(e.target.value))
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-amber-700 dark:text-amber-400 mb-1">
              Current Stock (Litres)
            </label>
            <input
              type="number"
              value={data.agoTankOpening}
              onChange={(e) =>
                updateField("agoTankOpening", Number(e.target.value))
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 dark:text-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PumpsStep({
  data,
  updateField,
  availableExtraFuels,
  onAddExtraFuel,
  onUpdateExtraFuel,
  onRemoveExtraFuel,
}: StepProps & {
  availableExtraFuels?: CanonicalFuelType[];
  onAddExtraFuel?: (type: CanonicalFuelType) => void;
  onUpdateExtraFuel?: (id: string, patch: Partial<ExtraFuel>) => void;
  onRemoveExtraFuel?: (id: string) => void;
}) {
  const PumpCounter = ({
    label,
    value,
    onChange,
    color,
  }: {
    label: string;
    value: number;
    onChange: (n: number) => void;
    color: string;
  }) => (
    <div className={`p-5 rounded-xl border ${color}`}>
      <h3 className="font-medium mb-4">{label}</h3>
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center transition-colors"
        >
          <Minus size={18} />
        </button>
        <span className="text-4xl font-bold w-16 text-center">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center transition-colors"
        >
          <Plus size={18} />
        </button>
      </div>
      <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-2">
        {value === 1 ? "1 pump" : `${value} pumps`}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        How many dispensing pumps does your station have for each fuel type?
      </p>

      <div className="grid grid-cols-2 gap-4">
        <PumpCounter
          label="PMS Pumps"
          value={data.pmsCount}
          onChange={(n) => updateField("pmsCount", n)}
          color="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
        />
        <PumpCounter
          label="AGO Pumps"
          value={data.agoCount}
          onChange={(n) => updateField("agoCount", n)}
          color="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
        />
        {data.extraFuels.map((ef) => (
          <div
            key={ef.id}
            className="relative p-5 rounded-xl border bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200"
          >
            <button
              onClick={() => onRemoveExtraFuel?.(ef.id)}
              className="absolute top-2 right-2 text-slate-400 hover:text-rose-500"
              title="Remove this fuel type"
            >
              <Trash2 size={16} />
            </button>
            <h3 className="font-medium mb-4">{getFuelLabel(ef.type)} Pumps</h3>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() =>
                  onUpdateExtraFuel?.(ef.id, {
                    count: Math.max(0, ef.count - 1),
                  })
                }
                className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center transition-colors"
              >
                <Minus size={18} />
              </button>
              <span className="text-4xl font-bold w-16 text-center">
                {ef.count}
              </span>
              <button
                onClick={() =>
                  onUpdateExtraFuel?.(ef.id, { count: ef.count + 1 })
                }
                className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-2">
              {ef.count === 1 ? "1 pump" : `${ef.count} pumps`}
            </p>
          </div>
        ))}
      </div>

      {/* Add extra fuel type */}
      {availableExtraFuels && availableExtraFuels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Add another fuel type:
          </span>
          {availableExtraFuels.map((t) => (
            <button
              key={t}
              onClick={() => onAddExtraFuel?.(t)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-800 text-sm font-medium"
            >
              <Plus size={14} /> {getFuelLabel(t)}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          You can add more pumps, fuel types, or rename them later from the
          Sales Tracking or Fuel Type Manager sections.
        </p>
      </div>
    </div>
  );
}

function PricingStep({
  data,
  updateField,
  isDetectingPrices,
  autoDetectedPrices,
  onRefreshPrices,
  priceDetectionError,
  availableExtraFuels,
  onAddExtraFuel,
  onUpdateExtraFuel,
  onRemoveExtraFuel,
}: StepProps & {
  isDetectingPrices?: boolean;
  autoDetectedPrices?: FuelPrices | null;
  onRefreshPrices?: () => void;
  priceDetectionError?: string | null;
  availableExtraFuels?: CanonicalFuelType[];
  onAddExtraFuel?: (type: CanonicalFuelType) => void;
  onUpdateExtraFuel?: (id: string, patch: Partial<ExtraFuel>) => void;
  onRemoveExtraFuel?: (id: string) => void;
}) {
  // Determine currency symbol. The selected country takes priority (it's the
  // authoritative source of the station's currency), then the entered
  // location, then auto-detected prices. Never default to Kenyan "KSh" for a
  // non-Kenyan station.
  const getCurrencySymbol = () => {
    if (data.countryCode) {
      const sym = getCountrySymbol(data.countryCode);
      if (sym) return sym + " ";
    }
    if (data.location) {
      const country = getCountryFromLocation(data.location);
      if (country?.currency) {
        const sym = getCurrencySymbolForCode(country.currency);
        if (sym) return sym + " ";
      }
    }
    if (autoDetectedPrices?.currencySymbol) {
      return autoDetectedPrices.currencySymbol + " ";
    }
    return "$ ";
  };

  return (
    <div className="space-y-6">
      {/* Auto-detection status banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isDetectingPrices ? (
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            ) : autoDetectedPrices ? (
              <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                <Check size={12} className="text-white" />
              </div>
            ) : (
              <div className="w-5 h-5 bg-slate-400 rounded-full flex items-center justify-center">
                <MapPin size={12} className="text-white" />
              </div>
            )}
            <div>
              {isDetectingPrices ? (
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Detecting location and fuel prices...
                </p>
              ) : autoDetectedPrices ? (
                <>
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">
                    Prices auto-detected for {autoDetectedPrices.location}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Source: {autoDetectedPrices.source}
                  </p>
                </>
              ) : priceDetectionError ? (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Using default prices
                </p>
              ) : (
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Prices will be auto-detected based on your location
                </p>
              )}
            </div>
          </div>
          {!isDetectingPrices && (
            <button
              onClick={onRefreshPrices}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
              title="Refresh prices"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        Set your current fuel prices. These are used for sales calculations and
        receipts. Prices have been pre-filled based on your detected location.
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* PMS Price */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-5 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-sm font-medium text-green-800 dark:text-green-300">
              PMS (Petrol)
            </span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-green-600 dark:text-green-400">
              {getCurrencySymbol()}
            </span>
            <input
              type="number"
              value={data.pmsPrice}
              onChange={(e) => updateField("pmsPrice", Number(e.target.value))}
              className="w-full pl-14 pr-4 py-4 text-2xl font-bold bg-white dark:bg-slate-700 border border-green-300 dark:border-green-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-slate-900 dark:text-white text-center"
            />
          </div>
          <p className="text-xs text-center text-green-600 dark:text-green-400 mt-2">
            per litre
          </p>
        </div>

        {/* AGO Price */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-5 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              AGO (Diesel)
            </span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-amber-600 dark:text-amber-400">
              {getCurrencySymbol()}
            </span>
            <input
              type="number"
              value={data.agoPrice}
              onChange={(e) => updateField("agoPrice", Number(e.target.value))}
              className="w-full pl-14 pr-4 py-4 text-2xl font-bold bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 dark:text-white text-center"
            />
          </div>
          <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-2">
            per litre
          </p>
        </div>

        {/* Extra fuel type prices (Kerosene, LPG, V-Power, etc.) */}
        {data.extraFuels.map((ef) => (
          <div
            key={ef.id}
            className="relative bg-gradient-to-br from-sky-50 to-indigo-50 dark:from-sky-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-sky-200 dark:border-sky-800"
          >
            <button
              onClick={() => onRemoveExtraFuel?.(ef.id)}
              className="absolute top-2 right-2 text-slate-400 hover:text-rose-500"
              title="Remove this fuel type"
            >
              <Trash2 size={16} />
            </button>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-sky-500"></div>
              <span className="text-sm font-medium text-sky-800 dark:text-sky-300">
                {getFuelLabel(ef.type)} ({getFuelCode(ef.type)})
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-sky-600 dark:text-sky-400">
                {getCurrencySymbol()}
              </span>
              <input
                type="number"
                value={ef.price}
                onChange={(e) =>
                  onUpdateExtraFuel?.(ef.id, {
                    price: Number(e.target.value),
                  })
                }
                className="w-full pl-14 pr-4 py-4 text-2xl font-bold bg-white dark:bg-slate-700 border border-sky-300 dark:border-sky-700 rounded-xl focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 dark:text-white text-center"
              />
            </div>
            <p className="text-xs text-center text-sky-600 dark:text-sky-400 mt-2">
              per litre
            </p>
          </div>
        ))}
      </div>

      {/* Add extra fuel type (pricing) */}
      {availableExtraFuels && availableExtraFuels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Add another fuel type:
          </span>
          {availableExtraFuels.map((t) => (
            <button
              key={t}
              onClick={() => onAddExtraFuel?.(t)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-800 text-sm font-medium"
            >
              <Plus size={14} /> {getFuelLabel(t)}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
        <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
          Prices can be updated anytime from the Sales Tracking or Point of Sale
          tabs
        </p>
      </div>
    </div>
  );
}

function KRAStep({ data, updateField }: StepProps) {
  // Derive the tax authority name + VAT rate for the selected country so this
  // step is world-wide (not Kenya-only "KRA"). For Kenya it shows "KRA PIN";
  // for other countries it shows the local tax authority.
  const regionalConfig = getRegionalConfig(data.countryCode || "US");
  const taxAuthorityName =
    regionalConfig.taxAuthorityShort ||
    regionalConfig.taxAuthority ||
    `${regionalConfig.country} Tax Authority`;
  const vatName = regionalConfig.vatName || "VAT";
  const vatPct = Math.round((regionalConfig.vatRate || 0) * 100);
  const isKenya = (data.countryCode || "").toUpperCase() === "KE";
  return (
    <div className="space-y-5">
      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 mb-6">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          This section is optional. You can configure {taxAuthorityName} tax
          compliance ({vatName} {vatPct}%) later from Settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {isKenya ? "KRA PIN" : `${taxAuthorityName} Tax ID`}
          </label>
          <input
            type="text"
            value={data.kraPin}
            onChange={(e) =>
              updateField("kraPin", e.target.value.toUpperCase())
            }
            placeholder={isKenya ? "e.g., P001234567X" : "Your tax ID"}
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            VAT Registration No.
          </label>
          <input
            type="text"
            value={data.vatRegNo}
            onChange={(e) => updateField("vatRegNo", e.target.value)}
            placeholder="Optional"
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Physical Address
        </label>
        <input
          type="text"
          value={data.physicalAddress}
          onChange={(e) => updateField("physicalAddress", e.target.value)}
          placeholder="e.g., 123 Main Street, City"
          className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          {isKenya ? "ETR Serial Number" : "Tax Device Serial No."}
        </label>
        <input
          type="text"
          value={data.etrSerialNo}
          onChange={(e) => updateField("etrSerialNo", e.target.value)}
          placeholder="Optional - from your tax receipting device"
          className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white"
        />
      </div>

      <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mt-6">
        <p className="text-sm text-green-700 dark:text-green-300">
          You're almost done! Click "Complete Setup" to start using FuelPro.
        </p>
      </div>
    </div>
  );
}
