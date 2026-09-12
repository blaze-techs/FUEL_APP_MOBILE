import { useState, useEffect, useRef, useMemo } from "react";
import { CANONICAL_FUEL_TYPES } from "@/react-app/config/pricing";
import {
  Fuel,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Beaker,
  Droplets,
  Flame,
  Zap,
  Wind,
  Settings,
  ChevronDown,
  ChevronUp,
  Monitor,
  FlaskConical,
  Gauge,
  Minus,
} from "lucide-react";
import { useFuel, type Pump } from "@/react-app/context/FuelContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
} from "@/react-app/lib/currency";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import SubTabBar from "@/react-app/components/SubTabBar";
import { recordPriceChange } from "@/react-app/lib/price-history";
import PriceBoard from "@/react-app/components/PriceBoard";
import PriceScheduler from "@/react-app/components/PriceScheduler";
import FuelQualityTesting from "@/react-app/components/FuelQualityTesting";
import FuelRateHistory from "@/react-app/components/FuelRateHistory";
import {
  emitFuelTypeChange,
  emitFuelPriceChange,
  onFuelPriceChange,
  onFuelTypeChange,
  type FuelPricePrefill,
} from "@/react-app/lib/fuel-interlink-bus";
import {
  onTabPayload,
  navigateToTab,
} from "@/react-app/lib/mpesa-integration-service";
import {
  normalizeFuelType,
  getFuelLabel,
  getVATRate,
} from "@/react-app/config/pricing";
import type { CanonicalFuelType } from "@/react-app/config/pricing";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  getPricingModeSync,
  pricingModeLabel,
} from "@/react-app/lib/pricing-mode";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

// Country-aware default tax rate for preset fuels (was hardcoded 16% Kenya VAT).
const PRESET_TAX_RATE = Math.round(getVATRate(getDetectedCountryCode()) * 100);

// ============================================================
// CUSTOM FUEL TYPE MANAGER
// Add, edit, delete any fuel type (Kerosene, V-Power, etc.)
// ============================================================

export interface CustomFuelType {
  id: string;
  code: string;
  name: string;
  localName: string;
  price: number;
  costPrice: number;
  taxRate: number;
  levyRate: number;
  color: string;
  icon: string;
  pumpCount: number;
  active: boolean;
  description: string;
  /**
   * Who set this price — the pricing-taxonomy primitive that keeps prices
   * stable. "user" = the station set it (never auto-overwritten); "scheduled"
   * = a Price Scheduler entry applied it (never auto-overwritten);
   * "auto" = populated by the regulator source (eligible for re-sync);
   * undefined = legacy entry (treated as "auto").
   */
  source?: "user" | "scheduled" | "auto";
}

// Cloud key under which the custom fuel-type catalog is persisted/synced.
const FUEL_TYPES_CLOUD_KEY = "fuel_types_config";

/**
 * Hardens a single fuel-type record loaded from cloud/localStorage into a fully
 * valid CustomFuelType so render-time access (.map, .toFixed, .toLowerCase...)
 * can never throw "Cannot read properties of undefined". Mirrors the
 * SupplierManagement.tsx normalize pattern.
 */
function normalizeCustomFuelType(
  f: Partial<CustomFuelType> | null | undefined,
): CustomFuelType {
  const id =
    f?.id || `fuel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    code: f?.code ?? "",
    name: f?.name ?? "",
    localName: f?.localName ?? "",
    price: typeof f?.price === "number" ? f.price : 0,
    costPrice: typeof f?.costPrice === "number" ? f.costPrice : 0,
    taxRate: typeof f?.taxRate === "number" ? f.taxRate : 0,
    levyRate: typeof f?.levyRate === "number" ? f.levyRate : 0,
    color: f?.color ?? "",
    icon: f?.icon ?? "",
    pumpCount: typeof f?.pumpCount === "number" ? f.pumpCount : 0,
    active: typeof f?.active === "boolean" ? f.active : false,
    description: f?.description ?? "",
    source:
      f?.source === "user" || f?.source === "scheduled" || f?.source === "auto"
        ? f.source
        : undefined,
  };
}

/**
 * Hardens an array of cloud/localStorage fuel-type records. Non-array input
 * (null, undefined, partial object, etc.) collapses to [].
 */
function normalizeCustomFuelTypes(arr: unknown): CustomFuelType[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((f) => normalizeCustomFuelType(f as Partial<CustomFuelType>));
}

const PRESET_FUELS: CustomFuelType[] = [
  {
    id: "iko",
    code: CANONICAL_FUEL_TYPES.kerosene.code,
    name: "Illuminating Kerosene",
    localName: CANONICAL_FUEL_TYPES.kerosene.label,
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "amber",
    icon: "flame",
    pumpCount: 1,
    active: true,
    description: "Kerosene for lighting and cooking",
  },
  {
    id: "vpower",
    code: CANONICAL_FUEL_TYPES.vpower.code,
    name: "Shell V-Power",
    localName: CANONICAL_FUEL_TYPES.vpower.label,
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "purple",
    icon: "zap",
    pumpCount: 1,
    active: true,
    description: "Premium fuel with cleaning additives",
  },
  {
    id: "diesel-premium",
    code: CANONICAL_FUEL_TYPES.premium_diesel.code,
    name: "Premium Diesel",
    localName: CANONICAL_FUEL_TYPES.premium_diesel.label,
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "indigo",
    icon: "droplet",
    pumpCount: 1,
    active: true,
    description: "High-performance diesel",
  },
  {
    id: "lpg",
    code: CANONICAL_FUEL_TYPES.lpg.code,
    name: "Liquefied Petroleum Gas",
    localName: CANONICAL_FUEL_TYPES.lpg.label,
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "green",
    icon: "wind",
    pumpCount: 1,
    active: true,
    description: "LPG for domestic and commercial cooking",
  },
  {
    id: "cng",
    code: "CNG",
    name: "Compressed Natural Gas",
    localName: "CNG",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "cyan",
    icon: "wind",
    pumpCount: 1,
    active: true,
    description: "Compressed natural gas for vehicles",
  },
  {
    id: "biodiesel",
    code: "B20",
    name: "Biodiesel B20",
    localName: "Bio Diesel",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "emerald",
    icon: "leaf",
    pumpCount: 1,
    active: true,
    description: "20% biodiesel blend",
  },
  {
    id: "ethanol",
    code: "E10",
    name: "Ethanol Blend E10",
    localName: "Ethanol Petrol",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "yellow",
    icon: "beaker",
    pumpCount: 1,
    active: true,
    description: "10% ethanol blend petrol",
  },
  {
    id: "avgas",
    code: "AVGAS",
    name: "Aviation Gasoline",
    localName: "Avgas",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "sky",
    icon: "plane",
    pumpCount: 0,
    active: false,
    description: "Aviation fuel for small aircraft",
  },
  {
    id: "jet-a1",
    code: "JET",
    name: "Jet A-1 Fuel",
    localName: "Jet Fuel",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "slate",
    icon: "plane",
    pumpCount: 0,
    active: false,
    description: "Jet fuel for aircraft",
  },
  {
    id: "fuel-oil",
    code: "IFO",
    name: "Industrial Fuel Oil",
    localName: "Fuel Oil",
    price: 0, // user enters station-specific price
    costPrice: 0,
    taxRate: PRESET_TAX_RATE,
    levyRate: 0,
    color: "orange",
    icon: "factory",
    pumpCount: 0,
    active: false,
    description: "Heavy fuel oil for industrial use",
  },
];

const FUEL_COLORS: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-200",
  green: "bg-green-100 text-green-700 border-green-200",
  cyan: "bg-cyan-100 text-cyan-700 border-cyan-200",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
  yellow: "bg-yellow-100 text-yellow-700 border-yellow-200",
  sky: "bg-sky-100 text-sky-700 border-sky-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
};

const COLOR_OPTIONS = Object.keys(FUEL_COLORS);
const ICON_OPTIONS = [
  { id: "flame", label: "Flame" },
  { id: "droplet", label: "Droplet" },
  { id: "zap", label: "Lightning" },
  { id: "wind", label: "Wind/Gas" },
  { id: "beaker", label: "Beaker" },
  { id: "leaf", label: "Eco/Leaf" },
  { id: "plane", label: "Aviation" },
  { id: "factory", label: "Industrial" },
];

function loadFuelTypes(): CustomFuelType[] {
  try {
    const saved = localStorage.getItem("fuelpro_custom_fuel_types");
    if (saved) return normalizeCustomFuelTypes(JSON.parse(saved));
  } catch {}
  return [];
}

function saveFuelTypes(types: CustomFuelType[]) {
  localStorage.setItem("fuelpro_custom_fuel_types", JSON.stringify(types));
}

export default function FuelTypesManager() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const { state, dispatch } = useFuel();
  const { hasPermission } = usePermissions();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  const stationId = currentStation?.id;
  const [fuelTypes, setFuelTypes] = useState<CustomFuelType[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "fuel_types_config",
      stationId,
    );
    if (Array.isArray(cloudCached))
      return normalizeCustomFuelTypes(cloudCached);
    return loadFuelTypes();
  });
  const [showAddForm, setShowAddForm] = useState(false);
  // Inline price editor on the expanded fuel card: which fuel is being
  // edited + its draft values (price/cost/VAT). Lets the station set prices
  // directly in Fuel Type Manager — the manual-pricing workflow — instead of
  // only through the Price Board.
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlinePrice, setInlinePrice] = useState<number | "">("");
  const [inlineCost, setInlineCost] = useState<number | "">("");
  const [inlineTax, setInlineTax] = useState<number | "">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingPumpsFor, setRenamingPumpsFor] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  // Inner sub-tab: hosts the formerly-standalone Price Board and Fuel
  // Quality Testing tabs alongside the fuel-type catalog. Pump Settings is
  // now merged INTO the Fuel Types sub-tab as a per-fuel-type "Number of
  // Pumps" action (see the expanded fuel-type card).
  const [activeView, setActiveView] = useState<
    "fueltypes" | "priceboard" | "scheduler" | "ratehistory" | "quality"
  >("fueltypes");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("fueltypes", setActiveView);

  // Form state
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formLocalName, setFormLocalName] = useState("");
  const [formPrice, setFormPrice] = useState<number | "">(0);
  const [formCostPrice, setFormCostPrice] = useState<number | "">(0);
  const [formTaxRate, setFormTaxRate] = useState<number | "">(PRESET_TAX_RATE);
  const [formColor, setFormColor] = useState("red");
  const [formIcon, setFormIcon] = useState("flame");
  const [formPumps, setFormPumps] = useState<number | "">(1);
  const [formDesc, setFormDesc] = useState("");

  // Race-condition guard: prevents the async cloud-load effect from
  // overwriting local state (persist) before the load completes, and
  // prevents the real-time echo from wiping uncommitted local edits.
  // Without this, switching to the tab shows cached fuel types for a
  // glimpse then the cloud load wipes them (the "flash then blank" bug).
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const fuelTypesRef = useRef(fuelTypes);
  fuelTypesRef.current = fuelTypes;

  // Fuel Quality ↔ Fuel Types data-sharing: latest quality test result per
  // fuel type, surfaced as a badge on each row so a failed test is visible
  // where the fuel is managed (not only inside the Quality sub-tab).
  const [qualityTests, setQualityTests] = useState<
    { fuelType: string; passed: boolean; date: string }[]
  >([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const tests = await cloudStorageService.get<
          { fuelType: string; passed: boolean; date: string }[]
        >("fuel_quality_tests", stationId);
        if (!cancelled && Array.isArray(tests)) setQualityTests(tests);
      } catch {
        /* best-effort badge */
      }
    })();
    const unsub = cloudStorageService.subscribe<
      { fuelType: string; passed: boolean; date: string }[]
    >("fuel_quality_tests", stationId, (val) => {
      if (Array.isArray(val)) setQualityTests(val);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user, stationId]);

  const qualityByCanonical = useMemo(() => {
    const map = new Map<string, { passed: boolean; date: string }>();
    const sorted = [...qualityTests].sort((a, b) =>
      (a.date || "").localeCompare(b.date || ""),
    );
    for (const t of sorted) {
      const canonical = normalizeFuelType(t.fuelType || "");
      if (canonical) map.set(canonical, { passed: t.passed, date: t.date });
    }
    return map;
  }, [qualityTests]);

  const persist = (types: CustomFuelType[]) => {
    localModifiedRef.current = true;
    // Record genuine price changes into the shared price-history trail
    // (Rate History sub-tab) so edits made HERE appear alongside changes
    // from Price Board / Price Scheduler / Dashboard. Deduped centrally.
    const prevById = new Map(fuelTypes.map((f) => [f.id, f]));
    for (const ft of types) {
      const prev = prevById.get(ft.id);
      if (prev && typeof prev.price === "number" && prev.price !== ft.price) {
        void recordPriceChange({
          fuelType: ft.name,
          oldPrice: prev.price,
          newPrice: ft.price,
          changedBy: "Fuel Type Manager",
          stationId,
        });
      }
    }
    setFuelTypes(types);
    saveFuelTypes(types);
    if (cloudLoadCompleteRef.current)
      cloudStorageService
        .set(FUEL_TYPES_CLOUD_KEY, types, stationId)
        .catch(() => {});
    // Broadcast each active fuel's price on the interlink bus so same-page
    // consumers (Dashboard, PriceBoard, POS, Invoice, Reports) update
    // instantly without waiting for the cloud real-time round-trip.
    for (const ft of types) {
      if (!ft.active) continue;
      emitFuelTypeChange({
        id: ft.id,
        fuelType: ft.name,
        canonical: normalizeFuelType(ft.name),
        source: "FuelTypesManager.persist",
      });
      emitFuelPriceChange({
        fuelType: ft.name,
        canonical: normalizeFuelType(ft.name),
        price: ft.price,
        source: "FuelTypesManager.persist",
      });
    }
  };

  // Load from cloud on mount + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      const cloudData = await cloudStorageService.get<CustomFuelType[]>(
        FUEL_TYPES_CLOUD_KEY,
        stationId,
      );
      if (!cancelled && cloudData && !localModifiedRef.current)
        setFuelTypes(normalizeCustomFuelTypes(cloudData));
      if (!cancelled) cloudLoadCompleteRef.current = true;
    })();
    // Real-time: when another device updates fuel types, update instantly
    const unsubs = [
      cloudStorageService.subscribe<CustomFuelType[]>(
        FUEL_TYPES_CLOUD_KEY,
        stationId,
        (val) => {
          if (!val || localModifiedRef.current) return;
          setFuelTypes(normalizeCustomFuelTypes(val));
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set(FUEL_TYPES_CLOUD_KEY, fuelTypesRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  // In-device interlink bus: a price/fuel-type edit in ANOTHER component on
  // the same page (Price Board, Dashboard price card, Price Scheduler, POS)
  // must update THIS list live — otherwise the Margin guard (price − cost)
  // and the price/cost displays stay stale until a full reload. The bus
  // fires optimistically before the cloud real-time echo (which is now OFF
  // by default in low-bandwidth mode), so without this the Fuel Type Manager
  // would never see price changes made elsewhere.
  useEffect(() => {
    const unsubPrice = onFuelPriceChange((p) => {
      const list = fuelTypesRef.current;
      if (!list.length) return;
      const canonical = p.canonical ?? normalizeFuelType(p.fuelType);
      if (!canonical) return;
      const idx = list.findIndex(
        (ft) => normalizeFuelType(ft.name) === canonical,
      );
      if (idx >= 0 && list[idx].price !== p.price) {
        const next = list.slice();
        next[idx] = { ...next[idx], price: p.price };
        setFuelTypes(next);
      }
    });
    const unsubType = onFuelTypeChange(() => {
      // A fuel-type add/edit/delete/activate elsewhere — re-read the latest
      // list from the cloud cache so this view reflects it immediately.
      const cached = cloudStorageService.getCached<unknown[]>(
        FUEL_TYPES_CLOUD_KEY,
        stationId,
      );
      if (Array.isArray(cached) && !localModifiedRef.current)
        setFuelTypes(normalizeCustomFuelTypes(cached));
    });
    return () => {
      unsubPrice();
      unsubType();
    };
  }, [stationId]);

  // Interlink receiver: when another tab calls navigateToTab("fueltypes",
  // <FuelPricePrefill>), open the add form pre-filled with the fuel type +
  // price so the user can review and save (which then propagates everywhere
  // via the bus + cloud real-time).
  useEffect(() => {
    return onTabPayload("fueltypes", (raw) => {
      const p = (raw || {}) as FuelPricePrefill;
      if (Object.keys(p).length === 0) return;
      const validViews = ["fueltypes", "priceboard", "quality"] as const;
      const target =
        p.view && (validViews as readonly string[]).includes(p.view)
          ? (p.view as (typeof validViews)[number])
          : "fueltypes";
      setActiveView(target);
      // Only open the add form when a fuel type / price is actually being
      // pre-filled — a pure "show price board" navigation has no fuelType.
      if (p.fuelType) {
        setFormName(p.fuelType);
        setFormLocalName(p.fuelType);
        const canonical = normalizeFuelType(p.fuelType);
        if (canonical) {
          // Use the canonical code as the form code (PMS/AGO/IK/...).
          const codeMap: Record<string, string> = {
            petrol: "PMS",
            diesel: "AGO",
            kerosene: "IK",
            vpower: "VPW",
            premium_diesel: "PDS",
            lpg: "LPG",
            cng: "CNG",
          };
          setFormCode(codeMap[canonical] || "");
        }
      }
      if (typeof p.price === "number" && p.price > 0) setFormPrice(p.price);
      setShowAddForm(true);
    });
  }, []);

  const resetForm = () => {
    setFormCode("");
    setFormName("");
    setFormLocalName("");
    setFormPrice(0);
    setFormCostPrice(0);
    setFormTaxRate(PRESET_TAX_RATE);
    setFormColor("red");
    setFormIcon("flame");
    setFormPumps(1);
    setFormDesc("");
  };

  const handleAdd = () => {
    if (!formCode.trim() || !formName.trim()) return;
    const newFuel: CustomFuelType = {
      id: `fuel_${Date.now()}`,
      code: formCode.toUpperCase(),
      name: formName,
      localName: formLocalName || formName,
      price: typeof formPrice === "number" ? formPrice : 0,
      costPrice: typeof formCostPrice === "number" ? formCostPrice : 0,
      taxRate: typeof formTaxRate === "number" ? formTaxRate : 0,
      levyRate: 0,
      color: formColor,
      icon: formIcon,
      pumpCount: typeof formPumps === "number" ? formPumps : 0,
      active: true,
      description: formDesc,
      source: "user",
    };
    persist([...fuelTypes, newFuel]);
    resetForm();
    setShowAddForm(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this fuel type?")) return;
    persist(fuelTypes.filter((f) => f.id !== id));
  };

  // ---- Per-fuel-type "Number of Pumps" action (merged Pump Settings) ----
  // Changing the pump count for a fuel type updates the fuel_types_config
  // catalog (pumpCount) AND the FuelContext pump store (pmsPumps /
  // agoPumps / fuelPumpsByType) so every tab (Dashboard, POS, SalesTracking,
  // PriceBoard, Reports) reflects the new pump count immediately.
  const handlePumpCountChange = (ft: CustomFuelType, nextCount: number) => {
    const count = Math.max(0, Math.min(99, nextCount));
    const canonical = normalizeFuelType(ft.name);
    // 1. Persist the pumpCount into the fuel_types_config catalog.
    persist(
      fuelTypes.map((f) => (f.id === ft.id ? { ...f, pumpCount: count } : f)),
    );
    // 2. Sync the FuelContext pump store so the whole site picks it up.
    const makePump = (id: string, name: string): Pump => ({
      id,
      name,
      openingKsh: 0,
      closingKsh: 0,
      openingL: 0,
      closingL: 0,
      salesL: 0,
      salesKsh: 0,
    });
    const code =
      ft.code ||
      (canonical ? canonical.toUpperCase().slice(0, 3) : ft.id.slice(0, 3));
    const label = getFuelLabel(ft.name);
    if (canonical === "petrol") {
      const newPmsPumps = Array.from(
        { length: count },
        (_, i) =>
          state.pmsPumps?.[i] || makePump(`pms-${i + 1}`, `PMS Pump ${i + 1}`),
      );
      dispatch({ type: "SET_PMS_PUMPS", payload: newPmsPumps });
    } else if (canonical === "diesel") {
      const newAgoPumps = Array.from(
        { length: count },
        (_, i) =>
          state.agoPumps?.[i] || makePump(`ago-${i + 1}`, `AGO Pump ${i + 1}`),
      );
      dispatch({ type: "SET_AGO_PUMPS", payload: newAgoPumps });
    } else if (canonical) {
      const existing = state.fuelPumpsByType?.[canonical] || [];
      const newPumps = Array.from(
        { length: count },
        (_, i) =>
          existing[i] || makePump(`${code}-${i + 1}`, `${label} Pump ${i + 1}`),
      );
      dispatch({
        type: "SET_FUEL_PUMPS_BY_TYPE",
        payload: { ...state.fuelPumpsByType, [canonical]: newPumps },
      });
    }
    // 3. Broadcast the fuel-type change so same-page consumers refresh.
    emitFuelTypeChange({
      id: ft.id,
      fuelType: ft.name,
      canonical,
      source: "FuelTypesManager.handlePumpCountChange",
    });
  };

  // Inline price editor handlers — open/save/cancel the draft values for a
  // single fuel card. Saving persists via `persist` (which broadcasts on the
  // interlink bus + writes to cloud), marking the entry `source: "user"`
  // so the regulator/EPRA auto-sync can never overwrite it.
  const startInlineEdit = (ft: CustomFuelType) => {
    setInlineEditId(ft.id);
    setInlinePrice(typeof ft.price === "number" ? ft.price : "");
    setInlineCost(typeof ft.costPrice === "number" ? ft.costPrice : "");
    setInlineTax(typeof ft.taxRate === "number" ? ft.taxRate : "");
  };

  const cancelInlineEdit = () => {
    setInlineEditId(null);
    setInlinePrice("");
    setInlineCost("");
    setInlineTax("");
  };

  const saveInlineEdit = (ft: CustomFuelType) => {
    const price =
      inlinePrice === "" || inlinePrice === null ? 0 : Number(inlinePrice);
    const cost =
      inlineCost === "" || inlineCost === null ? 0 : Number(inlineCost);
    const tax = inlineTax === "" || inlineTax === null ? 0 : Number(inlineTax);
    const unchanged =
      price === (ft.price || 0) &&
      cost === (ft.costPrice || 0) &&
      tax === (ft.taxRate || 0);
    if (unchanged || price < 0 || cost < 0 || tax < 0) {
      cancelInlineEdit();
      return;
    }
    persist(
      fuelTypes.map((f) =>
        f.id === ft.id
          ? {
              ...f,
              price,
              costPrice: cost,
              taxRate: tax,
              source: "user",
            }
          : f,
      ),
    );
    cancelInlineEdit();
    toastSuccess(`Price for ${ft.name || ft.localName} updated`);
  };

  // Rename a single pump's ID + display name for a fuel type. Updates the
  // FuelContext pump store (pmsPumps / agoPumps / fuelPumpsByType) so the
  // custom name appears in Sales Tracking, POS, Dashboard, Reports, etc.
  const handleRenamePump = (
    ft: CustomFuelType,
    pumpIndex: number,
    newName: string,
  ) => {
    const canonical = normalizeFuelType(ft.name);
    const trimmed = newName.trim();
    if (!trimmed) return; // don't allow empty names
    const code =
      ft.code ||
      (canonical ? canonical.toUpperCase().slice(0, 3) : ft.id.slice(0, 3));
    const updatePump = (pumps: Pump[], idx: number, name: string): Pump[] =>
      pumps.map((p, i) =>
        i === idx
          ? {
              ...p,
              name,
              id: `${code}-${idx + 1}-${name.replace(/\s+/g, "-").toLowerCase().slice(0, 8)}`,
            }
          : p,
      );
    if (canonical === "petrol" && state.pmsPumps) {
      dispatch({
        type: "SET_PMS_PUMPS",
        payload: updatePump(state.pmsPumps, pumpIndex, trimmed),
      });
    } else if (canonical === "diesel" && state.agoPumps) {
      dispatch({
        type: "SET_AGO_PUMPS",
        payload: updatePump(state.agoPumps, pumpIndex, trimmed),
      });
    } else if (canonical && state.fuelPumpsByType?.[canonical]) {
      const updated = updatePump(
        state.fuelPumpsByType[canonical],
        pumpIndex,
        trimmed,
      );
      dispatch({
        type: "SET_FUEL_PUMPS_BY_TYPE",
        payload: { ...state.fuelPumpsByType, [canonical]: updated },
      });
    }
  };

  const handleToggleActive = (id: string) => {
    persist(
      fuelTypes.map((f) => (f.id === id ? { ...f, active: !f.active } : f)),
    );
  };

  const handleAddPreset = (preset: CustomFuelType) => {
    const exists = fuelTypes.some((f) => f.code === preset.code);
    if (exists) {
      toastError(`${preset.name} already exists!`);
      return;
    }
    persist([...fuelTypes, { ...preset, id: `fuel_${Date.now()}` }]);
  };

  const marginPercent = (price: number, cost: number) =>
    cost > 0 ? (((price - cost) / cost) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
          <Fuel size={24} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            Fuel Type Manager
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
            Add, edit, and manage all fuel types at your station
          </p>
          <span
            className={`inline-flex items-center gap-1 mt-1 text-[10px] px-2 py-0.5 rounded-full border ${
              getPricingModeSync(stationId) === "manual"
                ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
            }`}
            title="How prices are populated. Manual = only you (or a scheduled change) set prices. Auto = the regulator source may fill unset prices."
          >
            Pricing: {pricingModeLabel(getPricingModeSync(stationId))}
          </span>
        </div>
      </div>

      {/* Sub-tab switcher: Fuel Types (incl. pump settings) / Price Board / Quality */}
      <SubTabBar
        tabs={[
          { id: "fueltypes", label: "Fuel Types", icon: Fuel },
          { id: "priceboard", label: "Price Board", icon: Monitor },
          { id: "scheduler", label: "Price Scheduler", icon: Monitor },
          { id: "ratehistory", label: "Rate History", icon: Monitor },
          { id: "quality", label: "Fuel Quality", icon: FlaskConical },
        ]}
        active={activeView}
        onChange={(id) =>
          setActiveView(
            id as
              | "fueltypes"
              | "priceboard"
              | "scheduler"
              | "ratehistory"
              | "quality",
          )
        }
      />

      {activeView === "priceboard" ? (
        <PriceBoard />
      ) : activeView === "quality" ? (
        <FuelQualityTesting />
      ) : activeView === "ratehistory" ? (
        <FuelRateHistory />
      ) : activeView === "scheduler" ? (
        <PriceScheduler />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {(fuelTypes || []).length}
              </p>
              <p className="text-[10px] text-gray-500">Fuel Types</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {(fuelTypes || []).filter((f) => f.active).length}
              </p>
              <p className="text-[10px] text-gray-500">Active</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {(fuelTypes || []).reduce((s, f) => s + (f.pumpCount || 0), 0)}
              </p>
              <p className="text-[10px] text-gray-500">Total Pumps</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {marginPercent(
                  fuelTypes.find((f) => f.id === "pms")?.price || 0,
                  fuelTypes.find((f) => f.id === "pms")?.costPrice || 0,
                )}
                %
              </p>
              <p className="text-[10px] text-gray-500">PMS Margin</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setShowPresets(false);
              }}
              className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg"
            >
              <Plus size={18} />{" "}
              {showAddForm ? "Cancel" : "Add Custom Fuel Type"}
            </button>
            <button
              onClick={() => {
                setShowPresets(!showPresets);
                setShowAddForm(false);
              }}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg"
            >
              <Fuel size={18} /> {showPresets ? "Hide" : "Add from Presets"}
            </button>
          </div>

          {/* Add Custom Form */}
          {showAddForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700 p-6 space-y-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
                <Settings size={18} className="text-amber-500" /> Add New Fuel
                Type
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Code *
                  </label>
                  <input
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="e.g. V-PWR"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Name *
                  </label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. V-Power"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Local Name
                  </label>
                  <input
                    value={formLocalName}
                    onChange={(e) => setFormLocalName(e.target.value)}
                    placeholder="e.g. V-Power Premium"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Selling Price ({currencySymbol}/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPrice === "" ? "" : formPrice}
                    onChange={(e) =>
                      setFormPrice(
                        e.target.value === ""
                          ? ""
                          : parseFloat(e.target.value) || 0,
                      )
                    }
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Cost Price ({currencySymbol}/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formCostPrice === "" ? "" : formCostPrice}
                    onChange={(e) =>
                      setFormCostPrice(
                        e.target.value === ""
                          ? ""
                          : parseFloat(e.target.value) || 0,
                      )
                    }
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    VAT Rate (%)
                  </label>
                  <input
                    type="number"
                    value={formTaxRate === "" ? "" : formTaxRate}
                    onChange={(e) =>
                      setFormTaxRate(
                        e.target.value === ""
                          ? ""
                          : parseFloat(e.target.value) || 0,
                      )
                    }
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Number of Pumps
                  </label>
                  <input
                    type="number"
                    value={formPumps === "" ? "" : formPumps}
                    onChange={(e) =>
                      setFormPumps(
                        e.target.value === ""
                          ? ""
                          : parseInt(e.target.value) || 0,
                      )
                    }
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Color
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setFormColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${c === formColor ? "border-gray-900 scale-110" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Description
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                />
              </div>
              <button
                onClick={handleAdd}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Save size={18} /> Save Fuel Type
              </button>
            </div>
          )}

          {/* Presets */}
          {showPresets && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
              <h3 className="text-sm font-bold text-blue-900 dark:text-blue-300 mb-3">
                Quick Add Preset Fuel Types
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRESET_FUELS.map((preset) => {
                  const exists = fuelTypes.some((f) => f.code === preset.code);
                  return (
                    <div
                      key={preset.id}
                      className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <Fuel size={14} className="text-blue-500" />
                        <div>
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                            {preset.name}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            {preset.code} | {currencySymbol}{" "}
                            {preset.price.toFixed(2)}/L
                          </p>
                        </div>
                      </div>
                      {exists ? (
                        <span className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full">
                          Added
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddPreset(preset)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white text-[11px] font-medium rounded-lg flex items-center gap-1"
                        >
                          <Plus size={12} /> Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fuel Types List */}
          <div className="space-y-3">
            {(fuelTypes || []).map((ft) => {
              const isExpanded = expandedId === ft.id;
              const colorClass = FUEL_COLORS[ft.color || ""] || FUEL_COLORS.red;
              return (
                <div
                  key={ft.id}
                  className={`bg-white dark:bg-gray-800 rounded-xl border overflow-hidden transition-all ${ft.active ? "border-gray-200 dark:border-gray-700" : "border-gray-100 dark:border-gray-800 opacity-60"}`}
                >
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    onClick={() => setExpandedId(isExpanded ? null : ft.id)}
                  >
                    <div className={`p-2 rounded-lg ${colorClass}`}>
                      <Fuel size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                          {ft.name || ""}
                        </h3>
                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 rounded-full">
                          {ft.code || ""}
                        </span>
                        {!ft.active && (
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 dark:text-gray-400 rounded-full">
                            Inactive
                          </span>
                        )}
                        {(() => {
                          const q = qualityByCanonical.get(
                            normalizeFuelType(ft.name) || "",
                          );
                          if (!q) return null;
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveView("quality");
                              }}
                              title={`Latest quality test: ${q.passed ? "PASSED" : "FAILED"} on ${new Date(q.date).toLocaleDateString()} — open Fuel Quality`}
                              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                q.passed
                                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                              }`}
                            >
                              {q.passed ? "Quality ✓" : "Quality ✗"}
                            </button>
                          );
                        })()}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                        {ft.localName || ""} | {currencySymbol}{" "}
                        {(ft.price || 0).toFixed(2)}/L | {ft.pumpCount || 0}{" "}
                        pump{(ft.pumpCount || 0) !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleActive(ft.id);
                        }}
                        className={`text-[10px] px-2 py-1 rounded-lg ${ft.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                      >
                        {ft.active ? "Active" : "Inactive"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(ft.id);
                        }}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                      {isExpanded ? (
                        <ChevronUp
                          size={16}
                          className="text-gray-500 dark:text-gray-400"
                        />
                      ) : (
                        <ChevronDown
                          size={16}
                          className="text-gray-500 dark:text-gray-400"
                        />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-700 p-4">
                      {inlineEditId === ft.id ? (
                        <div className="mb-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <label className="block">
                              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                Selling Price ({currencySymbol})
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={inlinePrice}
                                onChange={(e) =>
                                  setInlinePrice(
                                    e.target.value === ""
                                      ? ""
                                      : Number(e.target.value),
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                Cost Price ({currencySymbol})
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={inlineCost}
                                onChange={(e) =>
                                  setInlineCost(
                                    e.target.value === ""
                                      ? ""
                                      : Number(e.target.value),
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                VAT Rate (%)
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={inlineTax}
                                onChange={(e) =>
                                  setInlineTax(
                                    e.target.value === ""
                                      ? ""
                                      : Number(e.target.value),
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                              />
                            </label>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                saveInlineEdit(ft);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-colors"
                            >
                              <Save size={13} /> Save price
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelInlineEdit();
                              }}
                              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              Cancel
                            </button>
                            <span className="text-[10px] text-gray-400">
                              Marked as user-set — never auto-overwritten
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                          <InfoBox
                            label="Selling Price"
                            value={`${currencySymbol} ${(ft.price || 0).toFixed(2)}`}
                          />
                          <InfoBox
                            label="Cost Price"
                            value={`${currencySymbol} ${(ft.costPrice || 0).toFixed(2)}`}
                          />
                          <InfoBox
                            label="Margin"
                            value={`${marginPercent(ft.price || 0, ft.costPrice || 0)}%`}
                          />
                          <InfoBox
                            label="VAT Rate"
                            value={`${ft.taxRate || 0}%`}
                          />
                          <InfoBox
                            label="Levy Rate"
                            value={`${ft.levyRate || 0}%`}
                          />
                          <div className="flex items-end">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startInlineEdit(ft);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold transition-colors"
                              title="Edit this fuel's price/cost/VAT directly"
                            >
                              <Edit3 size={13} /> Edit prices
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Number of Pumps — inline Pump Settings action */}
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Gauge size={16} className="text-blue-500" />
                          <div>
                            <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                              Number of Pumps
                            </p>
                            <p className="text-[10px] text-blue-700 dark:text-blue-400">
                              Customize how many {ft.localName || ft.name} pumps
                              are at your station
                            </p>
                          </div>
                        </div>
                        {hasPermission("canChangePumpCount") ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePumpCountChange(
                                  ft,
                                  (ft.pumpCount || 0) - 1,
                                );
                              }}
                              className="p-2 bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
                              aria-label="Decrease pump count"
                            >
                              <Minus
                                size={14}
                                className="text-blue-600 dark:text-blue-300"
                              />
                            </button>
                            <span className="text-2xl font-bold text-blue-700 dark:text-blue-200 w-10 text-center">
                              {ft.pumpCount || 0}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePumpCountChange(
                                  ft,
                                  (ft.pumpCount || 0) + 1,
                                );
                              }}
                              className="p-2 bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
                              aria-label="Increase pump count"
                            >
                              <Plus
                                size={14}
                                className="text-blue-600 dark:text-blue-300"
                              />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full">
                            Restricted
                          </span>
                        )}
                      </div>

                      {/* Rename Pump IDs — lets the user assign a custom
                          name/label to each pump for this fuel type. The
                          custom name propagates to Sales Tracking, POS,
                          Dashboard, and Reports. */}
                      {(ft.pumpCount || 0) > 0 &&
                        hasPermission("canChangePumpCount") && (
                          <div className="mt-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingPumpsFor(
                                  renamingPumpsFor === ft.id ? null : ft.id,
                                );
                              }}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <Edit3 size={12} />
                              {renamingPumpsFor === ft.id
                                ? "Hide pump names"
                                : "Rename / assign pump IDs"}
                            </button>
                            {renamingPumpsFor === ft.id && (
                              <div className="mt-2 space-y-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg p-3">
                                {(() => {
                                  const canonical = normalizeFuelType(ft.name);
                                  let pumps: Pump[] = [];
                                  if (canonical === "petrol")
                                    pumps = state.pmsPumps || [];
                                  else if (canonical === "diesel")
                                    pumps = state.agoPumps || [];
                                  else if (canonical)
                                    pumps =
                                      state.fuelPumpsByType?.[canonical] || [];
                                  // If the pump store hasn't been seeded yet,
                                  // synthesize display rows from the count.
                                  if (pumps.length < (ft.pumpCount || 0)) {
                                    const code =
                                      ft.code ||
                                      (canonical
                                        ? canonical.toUpperCase().slice(0, 3)
                                        : "PMP");
                                    const label = getFuelLabel(ft.name);
                                    pumps = Array.from(
                                      { length: ft.pumpCount || 0 },
                                      (_, i) =>
                                        pumps[i] || {
                                          id: `${code}-${i + 1}`,
                                          name: `${label} Pump ${i + 1}`,
                                          openingKsh: 0,
                                          closingKsh: 0,
                                          openingL: 0,
                                          closingL: 0,
                                          salesL: 0,
                                          salesKsh: 0,
                                        },
                                    );
                                  }
                                  return pumps
                                    .slice(0, ft.pumpCount || 0)
                                    .map((pump, idx) => (
                                      <div
                                        key={pump.id || idx}
                                        className="flex items-center gap-2"
                                      >
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400 w-12">
                                          #{idx + 1}
                                        </span>
                                        <input
                                          type="text"
                                          value={pump.name || ""}
                                          placeholder={`Pump ${idx + 1}`}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            handleRenamePump(
                                              ft,
                                              idx,
                                              e.target.value,
                                            );
                                          }}
                                          className="flex-1 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md dark:text-gray-900 dark:text-white"
                                        />
                                        <span className="text-[9px] text-gray-500 dark:text-gray-400 font-mono">
                                          ID: {pump.id}
                                        </span>
                                      </div>
                                    ));
                                })()}
                              </div>
                            )}
                          </div>
                        )}

                      {ft.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 italic mt-3">
                          {ft.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
