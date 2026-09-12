import { useState, useEffect, useRef } from "react";
import { parseInputNumber } from "@/react-app/utils/inputUtils";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  CANONICAL_FUEL_TYPES,
  isSameFuelType,
} from "@/react-app/config/pricing";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  Monitor,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  History,
  RefreshCw,
  Fuel,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useAutoSync } from "@/react-app/hooks/useAutoSync";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  getCurrencySymbol,
  getDetectedCountryCode,
  isKenyaStation,
} from "@/react-app/lib/currency";
import { getCountryById } from "@/react-app/config/countries";
import { useFuel } from "@/react-app/context/FuelContext";
import {
  emitFuelPriceChange,
  onFuelPriceChange,
} from "@/react-app/lib/fuel-interlink-bus";
import { normalizeFuelType } from "@/react-app/config/pricing";
import { emit } from "@/react-app/lib/automation-engine";
import {
  getPricingModeSync,
  canAutoSyncPrice,
} from "@/react-app/lib/pricing-mode";

interface PriceEntry {
  id: string;
  fuelType: string;
  grade: string;
  price: number;
  previousPrice: number;
  currency: string;
  displayOrder: number;
  isActive: boolean;
  effectiveDate: string;
  updatedBy: string;
  updatedAt: string;
  /** "user" = explicitly set by the owner/manager (never auto-overwritten);
   *  "scheduled" = applied by the Price Scheduler (never auto-overwritten);
   *  "auto" = last set by the EPRA/regulator auto-sync (may be refreshed). */
  source?: "user" | "scheduled" | "auto";
}

interface PriceHistory {
  id: string;
  priceEntryId: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  reason: string;
  changedAt: string;
}

const STORAGE_KEY = "fuelpro_priceboard_v2";
const HISTORY_KEY = "fuelpro_price_history_v2";
const CLOUD_KEY = "priceboard_data";
const CLOUD_HISTORY_KEY = "price_history_data";

// Fuel-type labels are the CANONICAL labels from pricing.ts so that
// PriceBoard prices line up with Dashboard/POS/FuelTracker pricing.
const FUEL_GRADES: Record<string, string[]> = {
  [CANONICAL_FUEL_TYPES.petrol.label]: ["Regular", "Premium", "V-Power"],
  [CANONICAL_FUEL_TYPES.diesel.label]: ["Regular", "Premium", "Bio-Diesel"],
  [CANONICAL_FUEL_TYPES.kerosene.label]: ["Standard", "Premium"],
  [CANONICAL_FUEL_TYPES.lpg.label]: ["3kg", "6kg", "13kg", "25kg"],
};

/**
 * Resolve the grade list for a fuel type. Falls back to the canonical
 * petrol grades when the fuel type is unknown (e.g. a custom fuel like
 * "Shell V-Power" not in FUEL_GRADES) so the grade dropdown is never empty.
 */
function gradesFor(fuelType: string | undefined): string[] {
  if (fuelType && FUEL_GRADES[fuelType]) return FUEL_GRADES[fuelType];
  return FUEL_GRADES[CANONICAL_FUEL_TYPES.petrol.label];
}

/**
 * Normalize a price entry from cloud/localStorage so it always has every
 * field the UI expects. Cloud data may be partial (from older app versions,
 * API imports, or cross-device sync where the record was created with a
 * subset of fields). Without this, rendering crashes with
 * "Cannot read properties of undefined (reading 'toFixed')" etc.
 */
function normalizePriceEntry(
  p: Partial<PriceEntry> | null | undefined,
): PriceEntry {
  const id =
    p?.id || `pb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Accept any non-empty fuel type (incl. custom fuels not in FUEL_GRADES);
  // fall back to the canonical petrol label only when missing.
  const fuelType = p?.fuelType || CANONICAL_FUEL_TYPES.petrol.label;
  const grades = gradesFor(fuelType);
  const grade =
    p?.grade && grades.includes(p.grade) ? p.grade : grades[0] || "Regular";
  return {
    id,
    fuelType,
    grade,
    price: typeof p?.price === "number" ? p.price : 0,
    previousPrice: typeof p?.previousPrice === "number" ? p.previousPrice : 0,
    currency: p?.currency ?? "",
    displayOrder: typeof p?.displayOrder === "number" ? p.displayOrder : 0,
    isActive: typeof p?.isActive === "boolean" ? p.isActive : false,
    effectiveDate: p?.effectiveDate ?? "",
    updatedBy: p?.updatedBy ?? "",
    updatedAt: p?.updatedAt ?? "",
    source: p?.source === "user" || p?.source === "auto" ? p.source : "auto",
  };
}

function normalizePriceHistory(
  h: Partial<PriceHistory> | null | undefined,
): PriceHistory {
  const id =
    h?.id || `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    priceEntryId: h?.priceEntryId ?? "",
    oldPrice: typeof h?.oldPrice === "number" ? h.oldPrice : 0,
    newPrice: typeof h?.newPrice === "number" ? h.newPrice : 0,
    changedBy: h?.changedBy ?? "",
    reason: h?.reason ?? "",
    changedAt: h?.changedAt ?? "",
  };
}

function normalizePriceEntries(arr: unknown): PriceEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => normalizePriceEntry(p as Partial<PriceEntry>));
}

function normalizePriceHistoryList(arr: unknown): PriceHistory[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((h) => normalizePriceHistory(h as Partial<PriceHistory>));
}

function loadPrices(): PriceEntry[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizePriceEntries(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

function loadHistory(): PriceHistory[] {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) return normalizePriceHistoryList(JSON.parse(saved));
  } catch {
    /* ignore */
  }
  return [];
}

export default function PriceBoard() {
  const location = useLocation();
  const { fuelPrice, isSyncing, syncNow, refreshPrices, arePricesStale } =
    useAutoSync(location.currentCountry.id);
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { syncPriceToFuelTypes } = useFuel();
  // Derive the fuel-type options from the station's configured Fuel Types
  // (fuel_types_config) so the Price Board is no longer limited to the
  // hardcoded petrol/diesel/kerosene/LPG set. Any fuel the user added in
  // Fuel Type Manager (V-Power, CNG, custom) appears here.
  const fuelTypeApi = useStationFuelTypes(stationId);
  const fuelTypeOptions = (() => {
    const configured = fuelTypeApi.activeFuelTypes.map((ft) => ft.name);
    if (configured.length > 0) return configured;
    // Fallback to the canonical FUEL_GRADES keys when no fuel types are
    // configured yet (legacy station / first run) so the dropdown is never
    // empty.
    return Object.keys(FUEL_GRADES);
  })();
  const [prices, setPrices] = useState<PriceEntry[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "priceboard_data",
      stationId,
    );
    if (Array.isArray(cloudCached)) return normalizePriceEntries(cloudCached);
    return loadPrices();
  });
  const [history, setHistory] = useState<PriceHistory[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      "price_history_data",
      stationId,
    );
    if (Array.isArray(cloudCached))
      return normalizePriceHistoryList(cloudCached);
    return loadHistory();
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [formData, setFormData] = useState<Partial<PriceEntry>>({
    fuelType: CANONICAL_FUEL_TYPES.petrol.label,
    grade: "Regular",
    price: 0,
    currency: getCurrencySymbol(),
    displayOrder: 0,
    isActive: true,
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  const [changeReason, setChangeReason] = useState("");

  // Prevents save effects from overwriting cloud data with default state
  // before the initial cloud load completes (cross-device overwrite race).
  const cloudLoadCompleteRef = useRef(false);
  // Echo guard: prevents the async cloud-load effect from overwriting
  // uncommitted local edits (price changes the user just made).
  const localModifiedRef = useRef(false);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const [showAutoUpdateNotice, setShowAutoUpdateNotice] = useState(false);
  // True once the initial cloud load has completed (drives the seed-from-fuel-
  // types effect so it never races the cloud load and gets overwritten).
  const [cloudLoaded, setCloudLoaded] = useState(false);

  const isKenya = isKenyaStation();
  const countryProfile = getCountryById(getDetectedCountryCode());
  const regulatorName =
    countryProfile?.fuelRegulations?.priceSettingBody ||
    (isKenya ? "EPRA" : "fuel regulator");

  // Update prices when fuelPrice syncs (daily EPRA prices)
  useEffect(() => {
    if (!fuelPrice) return;

    // Check if we should auto-update from synced prices
    const autoUpdateEnabled =
      localStorage.getItem("fuelpro_price_auto_update") !== "disabled";
    if (!autoUpdateEnabled) return;

    // PRICING-MODE GATE: when the station/user chose "manual", the regulator
    // auto-sync NEVER writes — it can't clobber scheduler-applied or
    // user-entered prices. Only in "auto" mode may the regulator fill in
    // entries that are still "auto"-sourced (see canAutoSyncPrice below).
    const pricingMode = getPricingModeSync(stationId);
    if (pricingMode !== "auto") return;

    // Get current local prices
    const currentPrices = loadPrices();
    const today = new Date().toISOString().slice(0, 10);

    // Only auto-update if fuel price effective date is today or more recent
    if (fuelPrice.effectiveDate >= today) {
      // Check if prices need updating
      let needsUpdate = false;
      const newPrices = [...currentPrices];

      // Map EPRA prices to our entries (alias-aware so legacy "Petrol" and
      // canonical "Super Petrol" labels both match)
      if (fuelPrice.petrolPrice > 0) {
        const petrolEntry = newPrices.find(
          (p) =>
            p.isActive &&
            isSameFuelType(p.fuelType, CANONICAL_FUEL_TYPES.petrol.label),
        );
        // Don't auto-overwrite a price the owner/manager set explicitly.
        if (
          petrolEntry &&
          canAutoSyncPrice(petrolEntry.source, pricingMode) &&
          petrolEntry.price !== fuelPrice.petrolPrice
        ) {
          // Log history before updating
          const historyEntry: PriceHistory = {
            id: `ph_${Date.now()}_auto`,
            priceEntryId: petrolEntry.id,
            oldPrice: petrolEntry.price,
            newPrice: fuelPrice.petrolPrice,
            changedBy: `System (${regulatorName} Auto-Sync)`,
            reason: `Auto-updated from ${regulatorName} - ${fuelPrice.sourceName}`,
            changedAt: new Date().toISOString(),
          };
          setHistory((prev) => [...prev, historyEntry]);

          petrolEntry.previousPrice = petrolEntry.price;
          petrolEntry.price = fuelPrice.petrolPrice;
          petrolEntry.effectiveDate = fuelPrice.effectiveDate;
          petrolEntry.updatedAt = new Date().toISOString();
          petrolEntry.updatedBy = "System";
          petrolEntry.source = "auto";
          needsUpdate = true;
        }
      }

      if (fuelPrice.dieselPrice > 0) {
        const dieselEntry = newPrices.find(
          (p) =>
            p.isActive &&
            isSameFuelType(p.fuelType, CANONICAL_FUEL_TYPES.diesel.label),
        );
        // Don't auto-overwrite a price the owner/manager set explicitly.
        if (
          dieselEntry &&
          canAutoSyncPrice(dieselEntry.source, pricingMode) &&
          dieselEntry.price !== fuelPrice.dieselPrice
        ) {
          // Log history
          const historyEntry: PriceHistory = {
            id: `ph_${Date.now()}_auto_d`,
            priceEntryId: dieselEntry.id,
            oldPrice: dieselEntry.price,
            newPrice: fuelPrice.dieselPrice,
            changedBy: `System (${regulatorName} Auto-Sync)`,
            reason: `Auto-updated from ${regulatorName} - ${fuelPrice.sourceName}`,
            changedAt: new Date().toISOString(),
          };
          setHistory((prev) => [...prev, historyEntry]);

          dieselEntry.previousPrice = dieselEntry.price;
          dieselEntry.price = fuelPrice.dieselPrice;
          dieselEntry.effectiveDate = fuelPrice.effectiveDate;
          dieselEntry.updatedAt = new Date().toISOString();
          dieselEntry.updatedBy = "System";
          dieselEntry.source = "auto";
          needsUpdate = true;
        }
      }

      if (fuelPrice.kerosenePrice && fuelPrice.kerosenePrice > 0) {
        const keroseneEntry = newPrices.find(
          (p) =>
            p.isActive &&
            isSameFuelType(p.fuelType, CANONICAL_FUEL_TYPES.kerosene.label),
        );
        // Don't auto-overwrite a price the owner/manager set explicitly.
        if (
          keroseneEntry &&
          canAutoSyncPrice(keroseneEntry.source, pricingMode) &&
          keroseneEntry.price !== fuelPrice.kerosenePrice
        ) {
          // Log history
          const historyEntry: PriceHistory = {
            id: `ph_${Date.now()}_auto_k`,
            priceEntryId: keroseneEntry.id,
            oldPrice: keroseneEntry.price,
            newPrice: fuelPrice.kerosenePrice!,
            changedBy: `System (${regulatorName} Auto-Sync)`,
            reason: `Auto-updated from ${regulatorName} - ${fuelPrice.sourceName}`,
            changedAt: new Date().toISOString(),
          };
          setHistory((prev) => [...prev, historyEntry]);

          keroseneEntry.previousPrice = keroseneEntry.price;
          keroseneEntry.price = fuelPrice.kerosenePrice!;
          keroseneEntry.effectiveDate = fuelPrice.effectiveDate;
          keroseneEntry.updatedAt = new Date().toISOString();
          keroseneEntry.updatedBy = "System";
          keroseneEntry.source = "auto";
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        setPrices(newPrices);
        setShowAutoUpdateNotice(true);
        setTimeout(() => setShowAutoUpdateNotice(false), 5000);
      }
    }
  }, [fuelPrice]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService.set(CLOUD_KEY, prices, stationId).catch(() => {});
    // Broadcast each active price on the interlink bus so FuelTypesManager,
    // Dashboard, POS, Invoice, Reports see PriceBoard edits instantly.
    for (const p of prices) {
      if (!p.isActive) continue;
      emitFuelPriceChange({
        fuelType: p.fuelType,
        canonical: normalizeFuelType(p.fuelType),
        price: p.price,
        source: "PriceBoard.persist",
      });
    }
  }, [prices, stationId]);
  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    cloudStorageService
      .set(CLOUD_HISTORY_KEY, history, stationId)
      .catch(() => {});
  }, [history, stationId]);

  // Interlink receiver: when a price changes elsewhere (FuelTypesManager,
  // Dashboard, "Set as my price", FuelContext sync), mirror it into the
  // matching PriceBoard entry so the board stays in sync.
  useEffect(() => {
    return onFuelPriceChange((p) => {
      if (p.source === "PriceBoard.persist") return; // skip our own echo
      const canonical = p.canonical ?? normalizeFuelType(p.fuelType);
      if (!canonical) return;
      setPrices((prev) => {
        const idx = prev.findIndex(
          (entry) => normalizeFuelType(entry.fuelType) === canonical,
        );
        if (idx < 0 || prev[idx].price === p.price) return prev;
        const next = prev.slice();
        // A price propagated from the Price Scheduler is marked "scheduled";
        // everything else (FuelTypesManager / "Set as my price") is an
        // explicit user choice — either way the EPRA auto-sync must NOT
        // overwrite it (canAutoSyncPrice only allows "auto"/unset).
        const isScheduler =
          typeof p.source === "string" && p.source.includes("Scheduler");
        next[idx] = {
          ...next[idx],
          price: p.price,
          updatedAt: new Date().toISOString(),
          source: isScheduler ? "scheduled" : "user",
        };
        return next;
      });
    });
  }, []);

  // Load from cloud on mount (cross-device sync)
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const cloudPrices = await cloudStorageService.get<PriceEntry[]>(
          CLOUD_KEY,
          stationId,
        );
        if (!cancelled && cloudPrices && !localModifiedRef.current)
          setPrices(normalizePriceEntries(cloudPrices));
        const cloudHistory = await cloudStorageService.get<PriceHistory[]>(
          CLOUD_HISTORY_KEY,
          stationId,
        );
        if (!cancelled && cloudHistory && !localModifiedRef.current)
          setHistory(normalizePriceHistoryList(cloudHistory));
      } finally {
        if (!cancelled) {
          cloudLoadCompleteRef.current = true;
          setCloudLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set(CLOUD_KEY, pricesRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  // SEED FROM FUEL TYPES: the Price Board must ALWAYS show the station's
  // already-set prices. The authoritative prices live in `fuel_types_config`
  // (edited by Fuel Type Manager + applied by the Price Scheduler), while the
  // board's own `priceboard_data` store can be empty or stale (e.g. a station
  // that set prices in Fuel Types but never opened the board). Whenever the
  // configured fuel types load, merge any fuel that is MISSING from the board
  // into it (preserving the configured price + source), so the board is never
  // blank and never contradicts the source of truth.
  useEffect(() => {
    if (!cloudLoaded) return;
    if (!fuelTypeApi.fuelTypes.length) return;
    setPrices((prev) => {
      const byCanonical = new Map(
        prev.map((p) => [normalizeFuelType(p.fuelType), p]),
      );
      const additions: PriceEntry[] = [];
      for (const ft of fuelTypeApi.fuelTypes) {
        const canonical = normalizeFuelType(ft.name);
        if (!canonical || byCanonical.has(canonical)) continue;
        additions.push({
          id: `pb_${ft.id || canonical}`,
          fuelType: ft.name,
          grade: ft.code || "Regular",
          price: ft.price || 0,
          previousPrice: ft.price || 0,
          currency: "",
          displayOrder: prev.length + additions.length + 1,
          isActive: !!ft.active,
          effectiveDate: new Date().toISOString().slice(0, 10),
          updatedBy: "Fuel Type Manager",
          updatedAt: new Date().toISOString(),
          // Preserve the authoritative source so the regulator auto-sync can
          // still refresh a genuinely "auto"-sourced price. User/scheduled
          // entries (the common case — a station that set prices) stay
          // protected; unmarked legacy with a real price is treated as user.
          source:
            ft.source === "scheduled"
              ? "scheduled"
              : ft.source === "auto"
                ? "auto"
                : "user",
        });
      }
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
  }, [fuelTypeApi.fuelTypes, cloudLoaded]);

  const showNotification = (
    message: string,
    type: "success" | "warning" = "success",
  ) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSave = () => {
    if (!formData.fuelType || !formData.grade || !formData.price) {
      showNotification("Fuel type, grade, and price are required", "warning");
      return;
    }
    localModifiedRef.current = true;
    if (editingId) {
      const old = prices.find((p) => p.id === editingId);
      setPrices((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                ...(formData as PriceEntry),
                previousPrice: old?.price || p.price,
                updatedAt: new Date().toISOString(),
                updatedBy: "Manager",
                // Mark as user-set so the EPRA/regulator auto-sync never
                // overwrites a price the owner/manager explicitly chose.
                source: "user",
              }
            : p,
        ),
      );
      // Log history
      if (old && old.price !== formData.price) {
        const newHistory: PriceHistory = {
          id: `ph_${Date.now()}`,
          priceEntryId: editingId,
          oldPrice: old.price,
          newPrice: formData.price!,
          changedBy: "Manager",
          reason: changeReason || "Price update",
          changedAt: new Date().toISOString(),
        };
        setHistory((prev) => [newHistory, ...prev]);

        // Notify the automation engine that a fuel price was updated. Emitted
        // after the new price is applied so downstream reactions (price sync
        // across tabs, dashboard refresh) use the saved value.
        emit({
          type: "price:changed",
          stationId: currentStation?.id || "",
          fuelType: formData.fuelType,
          newPrice: formData.price!,
        });

        // AUTOMATICALLY sync the price to Fuel Type Manager (fuel_types_config)
        // so the two tabs stay fully consistent. Previously this was a manual
        // "Set as station price" button — the user wants changes in Price Board
        // to reflect in Fuel Types (and vice versa) automatically.
        if (formData.price && formData.price > 0) {
          syncPriceToFuelTypes(formData.fuelType, formData.price);
        }
      }
      showNotification("Price updated");
    } else {
      const newEntry: PriceEntry = {
        ...(formData as PriceEntry),
        id: `pb_${Date.now()}`,
        previousPrice: formData.price!,
        updatedBy: "Manager",
        updatedAt: new Date().toISOString(),
        source: "user",
      };
      setPrices((prev) => [...prev, newEntry]);

      // Notify the automation engine of the newly added fuel price.
      emit({
        type: "price:changed",
        stationId: currentStation?.id || "",
        fuelType: formData.fuelType,
        newPrice: formData.price!,
      });

      // Auto-sync to Fuel Type Manager for consistency.
      if (formData.price && formData.price > 0) {
        syncPriceToFuelTypes(formData.fuelType, formData.price);
      }
      showNotification("Price entry added");
    }
    setShowForm(false);
    setEditingId(null);
    setChangeReason("");
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this price entry?")) {
      localModifiedRef.current = true;
      setPrices((prev) => prev.filter((p) => p.id !== id));
      showNotification("Price entry deleted");
    }
  };

  const toggleActive = (id: string) => {
    localModifiedRef.current = true;
    setPrices((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)),
    );
  };

  const sortedPrices = [...prices].sort(
    (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0),
  );

  const priceChange = (current: number, previous: number) => {
    const cur = typeof current === "number" ? current : 0;
    const prev = typeof previous === "number" ? previous : 0;
    const diff = cur - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    return { diff, pct, up: diff >= 0 };
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 ${notification.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}
        >
          {notification.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span className="text-sm">{notification.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Monitor size={22} className="text-amber-500" /> Price Board
            {isSyncing && (
              <RefreshCw size={16} className="text-blue-500 animate-spin" />
            )}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {fuelPrice ? (
              <>
                {regulatorName} prices as of {fuelPrice.effectiveDate} •
                Auto-updates daily
              </>
            ) : (
              <>Manage fuel prices displayed to customers</>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Auto-update status indicator */}
          <div className="flex items-center gap-1.5 mr-2">
            <div
              className={`w-2 h-2 rounded-full ${arePricesStale ? "bg-amber-500" : "bg-green-500"}`}
            ></div>
            <span className="text-xs text-gray-500">
              {arePricesStale ? "Prices need update" : "Prices current"}
            </span>
          </div>
          <button
            onClick={() => refreshPrices()}
            disabled={isSyncing}
            className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />{" "}
            Refresh Prices
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all"
          >
            <History size={14} /> History
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all"
          >
            {showPreview ? (
              <>
                <EyeOff size={14} /> Hide Preview
              </>
            ) : (
              <>
                <Eye size={14} /> Preview
              </>
            )}
          </button>
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setFormData({
                fuelType: CANONICAL_FUEL_TYPES.petrol.label,
                grade: "Regular",
                price: 0,
                currency: getCurrencySymbol(),
                displayOrder: prices.length + 1,
                isActive: true,
                effectiveDate: new Date().toISOString().slice(0, 10),
              });
            }}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
          >
            <Plus size={16} /> Add Price
          </button>
        </div>
      </div>

      {/* Auto-update notification */}
      {showAutoUpdateNotice && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-500" />
          <div>
            <p className="text-sm font-medium text-green-400">
              Prices Auto-Updated from {regulatorName}
            </p>
            <p className="text-xs text-green-400/70">
              Fuel prices have been synced with the latest government rates
            </p>
          </div>
        </div>
      )}

      {/* Digital Price Board Preview */}
      {showPreview && (
        <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 border border-gray-700 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <Fuel size={16} className="text-white" />
              </div>
              <span className="text-white font-bold text-lg">FuelPro</span>
            </div>
            <span className="text-gray-400 text-xs">
              {new Date().toLocaleDateString()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {sortedPrices
              .filter((p) => p.isActive)
              .map((price) => {
                const change = priceChange(price.price, price.previousPrice);
                return (
                  <div
                    key={price.id}
                    className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 text-center"
                  >
                    <p className="text-xs text-gray-400 uppercase tracking-wider">
                      {price.fuelType} {price.grade}
                    </p>
                    <p className="text-2xl font-bold text-white mt-1">
                      {price.currency || ""} {(price.price || 0).toFixed(2)}
                    </p>
                    <div
                      className={`flex items-center justify-center gap-1 mt-1 text-xs ${change.up ? "text-red-400" : "text-emerald-400"}`}
                    >
                      {change.up ? (
                        <ArrowUpRight size={12} />
                      ) : (
                        <ArrowDownRight size={12} />
                      )}
                      <span>
                        {change.pct.toFixed(1)}% ({change.diff >= 0 ? "+" : ""}
                        {change.diff.toFixed(2)})
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="text-center text-[10px] text-gray-500 mt-3">
            Prices per liter | Subject to change without notice
          </p>
        </div>
      )}

      {/* Price Management Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Order
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Fuel Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Grade
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Price
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Previous
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  Change
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPrices.map((price) => {
                const change = priceChange(price.price, price.previousPrice);
                return (
                  <tr
                    key={price.id}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20"
                  >
                    <td className="px-4 py-3 text-gray-500">
                      {price.displayOrder}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {price.fuelType}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {price.grade}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                      {price.currency || ""} {(price.price || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {price.currency || ""}{" "}
                      {(price.previousPrice || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`flex items-center justify-center gap-1 text-xs ${change.up ? "text-red-500" : "text-emerald-500"}`}
                      >
                        {change.up ? (
                          <TrendingUp size={12} />
                        ) : (
                          <TrendingDown size={12} />
                        )}
                        {change.pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(price.id)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${price.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-gray-500/10 text-gray-500"}`}
                      >
                        {price.isActive ? "Active" : "Hidden"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditingId(price.id);
                            setFormData(price);
                            setChangeReason("");
                            setShowForm(true);
                          }}
                          className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 rounded-lg transition-colors"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={() =>
                            syncPriceToFuelTypes(price.fuelType, price.price)
                          }
                          className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-600 rounded-lg transition-colors"
                          title="Set as station price (syncs to FuelContext + Fuel Type Manager)"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(price.id)}
                          className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-lg transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {prices.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No price entries
          </div>
        )}
      </div>

      {/* Price Change Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingId ? "Update" : "Add"} Price
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Fuel Type
                    </label>
                    <select
                      value={formData.fuelType}
                      onChange={(e) => {
                        const chosen = e.target.value;
                        // Pre-fill the price from the station's configured
                        // fuel type when the user hasn't entered one yet,
                        // so Price Board stays in sync with Fuel Types.
                        const configuredPrice = fuelTypeApi.getPriceFor(chosen);
                        setFormData((prev) => ({
                          ...prev,
                          fuelType: chosen,
                          grade: gradesFor(chosen)[0] || "Regular",
                          price:
                            !prev.price && configuredPrice
                              ? configuredPrice
                              : prev.price,
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    >
                      {fuelTypeOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Grade
                    </label>
                    <select
                      value={formData.grade}
                      onChange={(e) =>
                        setFormData({ ...formData, grade: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    >
                      {gradesFor(formData.fuelType).map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Price *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.price || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          price: parseInputNumber(e.target.value) ?? 0,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Currency
                    </label>
                    <select
                      value={formData.currency}
                      onChange={(e) =>
                        setFormData({ ...formData, currency: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    >
                      {[
                        "USD",
                        "EUR",
                        "GBP",
                        "JPY",
                        "CNY",
                        "INR",
                        "AUD",
                        "CAD",
                        "CHF",
                        "SGD",
                        "HKD",
                        "NZD",
                        "AED",
                        "SAR",
                        "ZAR",
                        "BRL",
                        "MXN",
                        "RUB",
                        "TRY",
                        "KRW",
                        "IDR",
                        "MYR",
                        "THB",
                        "PHP",
                        "VND",
                        "EGP",
                        "NGN",
                        "KES",
                        "UGX",
                        "TZS",
                        "GHS",
                        "RWF",
                        "ETB",
                        "MAD",
                        "DZD",
                        "TND",
                        "PKR",
                        "BDT",
                        "LKR",
                        "NPR",
                        "ARS",
                        "CLP",
                        "COP",
                        "PEN",
                        "UYU",
                      ].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {editingId && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Reason for Change
                    </label>
                    <input
                      value={changeReason}
                      onChange={(e) => setChangeReason(e.target.value)}
                      placeholder="e.g. Monthly price review"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={formData.effectiveDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        effectiveDate: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Display Order
                  </label>
                  <input
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        displayOrder: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <button
                  onClick={handleSave}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <History size={18} /> Price Change History
                </h3>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-2">
                {history.map((h) => {
                  const entry = prices.find((p) => p.id === h.priceEntryId);
                  const oldPrice = h.oldPrice || 0;
                  const newPrice = h.newPrice || 0;
                  const diff = newPrice - oldPrice;
                  return (
                    <div
                      key={h.id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {entry?.fuelType} {entry?.grade}
                        </p>
                        <p className="text-xs text-gray-500">
                          {h.reason} &middot; {h.changedBy}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 line-through">
                            {oldPrice.toFixed(2)}
                          </span>
                          <ArrowUpRight size={12} className="text-gray-400" />
                          <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {newPrice.toFixed(2)}
                          </span>
                        </div>
                        <span
                          className={`text-xs ${diff >= 0 ? "text-red-500" : "text-emerald-500"}`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff.toFixed(2)}
                        </span>
                        <p className="text-[10px] text-gray-400">
                          {new Date(
                            h.changedAt || Date.now(),
                          ).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {history.length === 0 && (
                  <p className="text-center text-gray-500 py-4">
                    No price changes recorded
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
