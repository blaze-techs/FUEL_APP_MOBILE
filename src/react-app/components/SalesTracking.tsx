import { useState, useRef, useCallback, useMemo } from "react";
import { parseInputNumber } from "@/react-app/utils/inputUtils";
import {
  KENYA_BASE_PRICES,
  normalizeFuelType,
  getFuelLabel,
  getFuelCode,
  type CanonicalFuelType,
} from "@/react-app/config/pricing";
import {
  Plus,
  Save,
  Trash2,
  BarChart3,
  Camera,
  Upload,
  Loader2,
  Check,
  Image,
  Pencil,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Calendar,
  Fuel,
  Tag,
  Cloud,
  RefreshCw,
  TrendingUp,
  Receipt,
  Edit3,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import {
  exportSalesPDF,
  exportSalesExcel,
  exportSalesTXT,
} from "@/react-app/utils/exportUtils";
import { formatNumber } from "@/react-app/utils/formatUtils";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
} from "@/react-app/lib/currency";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import ImageCropper from "@/react-app/components/ImageCropper";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface ExtractedPump {
  name: string;
  fuelType: string;
  openingReading: number;
  closingReading: number;
  salesAmount: number;
}

interface ExtractedExpense {
  name: string;
  amount: number;
}

interface ScanResultData {
  date?: string;
  shift?: string;
  pumps?: ExtractedPump[];
  pmsPumps?: any[];
  agoPumps?: any[];
  expenses?: ExtractedExpense[];
  totalSales?: number;
  tillAmount?: number;
  tillPayment?: number;
  cashAmount?: number;
  confidence?: string;
  additionalNotes?: string;
}

type ScanStep = "idle" | "uploading" | "analyzing" | "review" | "error";

export default function SalesTracking() {
  const { state, dispatch, syncPriceToFuelTypes } = useFuel();
  const { currentStation } = useStations();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  // Dynamic fuel-type support: read the station's configured fuel types so
  // the pump tables, pricing inputs, and per-fuel summaries are NOT hardcoded
  // to PMS/AGO. A station with Kerosene/LPG/V-Power etc. gets its own pump
  // table per fuel type.
  // NOTE: prefer the real StationContext station id (currentStation?.id) —
  // that is the id FuelTypesManager writes fuel_types_config under. The
  // FuelContext `state.currentStationId` is a legacy "default_station" value
  // that resolves to a DIFFERENT (empty) cloud row.
  const stationId = currentStation?.id ?? state.currentStationId ?? undefined;
  const fuelTypeApi = useStationFuelTypes(stationId);

  /**
   * The fuel types this station tracks pumps for. Built from the configured
   * fuel_types_config (canonical-normalized). A station with 3 fuel types
   * (e.g. Kerosene, V-Power, LPG) gets exactly 3 pump tables — no hardcoded
   * PMS/AGO. Petrol + diesel are included ONLY as a first-run fallback when
   * the station has not yet configured ANY fuel types (legacy compatibility).
   */
  const trackedFuelTypes: CanonicalFuelType[] = useMemo(() => {
    const active = fuelTypeApi.activeFuelTypes;
    const set = new Set<CanonicalFuelType>();
    for (const ft of active) {
      const c = fuelTypeApi.canonicalOf(ft.name);
      if (c) set.add(c);
    }
    // First-run fallback: if the station has NOT configured any fuel types
    // yet, show the legacy petrol + diesel tables so the screen is never
    // empty. Once fuel types ARE configured, ONLY those appear (the user's
    // actual fuel mix — e.g. Kerosene/V-Power/LPG with no petrol/diesel).
    if (set.size === 0) {
      set.add("petrol");
      set.add("diesel");
    }
    return Array.from(set);
  }, [fuelTypeApi]);

  const [scanStep, setScanStep] = useState<ScanStep>("idle");
  const [scanResult, setScanResult] = useState<ScanResultData | null>(null);
  const [editableResult, setEditableResult] = useState<ScanResultData | null>(
    null,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuggestion, setScanSuggestion] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showScanPanel, setShowScanPanel] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "synced">(
    "idle",
  );
  const [loadedRecordKey, setLoadedRecordKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/") || file.type === "application/pdf") {
        if (file.type.startsWith("image/")) {
          setPendingFile(file);
          setShowCropper(true);
        } else {
          handleScanDocument(file);
        }
      }
    }
  }, []);

  // Local AI extraction simulation - works without server
  const simulateAIExtraction = (fileName: string): ScanResultData => {
    // Generate placeholder data - user needs to enter actual values
    const today = new Date().toISOString().split("T")[0];
    const currentReading =
      Math.round((state.pmsTankClosing || 0) / 1000) * 1000;

    return {
      date: today,
      shift: new Date().getHours() < 14 ? "Day" : "Night",
      pumps: [
        {
          name: "PMS-1",
          fuelType: "Petrol",
          openingReading: 0,
          closingReading: 0,
          salesAmount: 0,
        },
        {
          name: "PMS-2",
          fuelType: "Petrol",
          openingReading: 0,
          closingReading: 0,
          salesAmount: 0,
        },
        {
          name: "AGO-1",
          fuelType: "Diesel",
          openingReading: 0,
          closingReading: 0,
          salesAmount: 0,
        },
        {
          name: "AGO-2",
          fuelType: "Diesel",
          openingReading: 0,
          closingReading: 0,
          salesAmount: 0,
        },
      ],
      expenses: [],
      tillAmount: 0,
      cashAmount: 0,
      confidence: "low",
      additionalNotes: `Please enter pump readings manually. Document: ${fileName}`,
    };
  };

  // Handle document scan/upload for AI extraction (local mode)
  const handleScanDocument = async (file: File) => {
    setScanStep("uploading");
    setScanError(null);
    setScanSuggestion(null);
    setScanResult(null);
    setEditableResult(null);
    setShowScanPanel(true);

    try {
      // Upload is local (no server) — skip straight to analysis
      setScanStep("analyzing");

      // Local extraction is synchronous — no artificial delay needed
      const extractedData = simulateAIExtraction(file.name);

      setScanResult(extractedData);
      setEditableResult(JSON.parse(JSON.stringify(extractedData))); // Deep copy for editing
      setScanStep("review");
    } catch (error: any) {
      setScanError(error.message || "Failed to scan document");
      setScanSuggestion(
        "Try taking a clearer photo with good lighting, or enter data manually below.",
      );
      setScanStep("error");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setShowScanPanel(true);
      // For images, show cropper first
      if (file.type.startsWith("image/")) {
        setPendingFile(file);
        setShowCropper(true);
      } else {
        // For PDFs and docs, scan directly
        handleScanDocument(file);
      }
    }
    e.target.value = "";
  };

  const handleCropComplete = (croppedFile: File) => {
    setShowCropper(false);
    setPendingFile(null);
    handleScanDocument(croppedFile);
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    setPendingFile(null);
    setScanStep("idle");
  };

  // Update editable result field
  const updateEditableField = (field: string, value: any) => {
    if (!editableResult) return;
    setEditableResult({ ...editableResult, [field]: value });
  };

  // Update editable pump
  const updateEditablePump = (index: number, field: string, value: any) => {
    if (!editableResult?.pumps) return;
    const pumps = [...editableResult.pumps];
    pumps[index] = { ...pumps[index], [field]: value };
    setEditableResult({ ...editableResult, pumps });
  };

  // Update editable expense
  const updateEditableExpense = (index: number, field: string, value: any) => {
    if (!editableResult?.expenses) return;
    const expenses = [...editableResult.expenses];
    expenses[index] = { ...expenses[index], [field]: value };
    setEditableResult({ ...editableResult, expenses });
  };

  // Reset scan state
  const resetScan = () => {
    setScanStep("idle");
    setScanResult(null);
    setEditableResult(null);
    setScanError(null);
    setScanSuggestion(null);
    setShowScanPanel(false);
  };

  const applyScannedData = () => {
    const data = editableResult || scanResult;
    if (!data) return;

    // Apply extracted data to the form
    if (data.date) {
      dispatch({ type: "SET_SALES_DATE", payload: data.date });
    }
    if (data.shift) {
      dispatch({ type: "SET_SHIFT", payload: data.shift });
    }

    // Handle new pump format (pumps array with fuelType). Use canonical
    // normalization so Kerosene/LPG/V-Power etc. are NOT dropped (the old
    // code only matched literal "petrol"/"diesel").
    if (data.pumps && data.pumps.length > 0) {
      const byType: Record<string, typeof state.pmsPumps> = {};
      for (const p of data.pumps as any[]) {
        const raw = p.fuelType || p.name || "";
        const canonical =
          normalizeFuelType(raw) ||
          (String(raw).toLowerCase().includes("diesel") ? "diesel" : "petrol");
        const arr = byType[canonical] ?? [];
        arr.push({
          id: p.name || `${getFuelCode(canonical)}-${arr.length + 1}`,
          openingKsh: p.openingReading || 0,
          closingKsh: p.closingReading || 0,
          openingL: 0,
          closingL: 0,
          salesL: 0,
          salesKsh:
            p.salesAmount ||
            Math.max(0, (p.closingReading || 0) - (p.openingReading || 0)),
        });
        byType[canonical] = arr;
      }
      if (byType.petrol?.length > 0)
        dispatch({ type: "SET_PMS_PUMPS", payload: byType.petrol });
      if (byType.diesel?.length > 0)
        dispatch({ type: "SET_AGO_PUMPS", payload: byType.diesel });
      const extraTypes = { ...byType };
      delete extraTypes.petrol;
      delete extraTypes.diesel;
      if (Object.keys(extraTypes).length > 0) {
        dispatch({
          type: "SET_FUEL_PUMPS_BY_TYPE",
          payload: { ...state.fuelPumpsByType, ...extraTypes },
        });
      }
    }
    // Fallback for old format
    if (data.pmsPumps && data.pmsPumps.length > 0) {
      const pumps = data.pmsPumps.map((p: any, i: number) => ({
        id: p.id || `PMS-${i + 1}`,
        openingKsh: p.openingKsh || 0,
        closingKsh: p.closingKsh || 0,
        openingL: p.openingL || 0,
        closingL: p.closingL || 0,
        salesL: Math.max(0, (p.closingL || 0) - (p.openingL || 0)),
        salesKsh: Math.max(0, (p.closingKsh || 0) - (p.openingKsh || 0)),
      }));
      dispatch({ type: "SET_PMS_PUMPS", payload: pumps });
    }
    if (data.agoPumps && data.agoPumps.length > 0) {
      const pumps = data.agoPumps.map((p: any, i: number) => ({
        id: p.id || `AGO-${i + 1}`,
        openingKsh: p.openingKsh || 0,
        closingKsh: p.closingKsh || 0,
        openingL: p.openingL || 0,
        closingL: p.closingL || 0,
        salesL: Math.max(0, (p.closingL || 0) - (p.openingL || 0)),
        salesKsh: Math.max(0, (p.closingKsh || 0) - (p.openingKsh || 0)),
      }));
      dispatch({ type: "SET_AGO_PUMPS", payload: pumps });
    }

    // Handle expenses (support both name and desc fields)
    if (data.expenses && data.expenses.length > 0) {
      const expenses = data.expenses.map((e: any) => ({
        desc: e.name || e.desc || "Expense",
        amount: e.amount || 0,
      }));
      dispatch({ type: "SET_EXPENSES", payload: expenses });
    }

    // Handle till payment (support both tillAmount and tillPayment)
    const tillValue = data.tillAmount ?? data.tillPayment;
    if (tillValue !== null && tillValue !== undefined) {
      dispatch({ type: "SET_TILL_PAYMENT", payload: tillValue });
    }

    // Handle cash amount if available
    if (data.cashAmount !== null && data.cashAmount !== undefined) {
      // Cash can be calculated or displayed separately
      console.log("Cash amount extracted:", data.cashAmount);
    }

    resetScan();
    toastSuccess("Data applied successfully! Review and adjust as needed.");
  };

  const pumpsForType = (type: CanonicalFuelType): typeof state.pmsPumps => {
    if (type === "petrol") return state.pmsPumps;
    if (type === "diesel") return state.agoPumps;
    return state.fuelPumpsByType?.[type] ?? [];
  };

  const setPumpsForType = (
    type: CanonicalFuelType,
    pumps: typeof state.pmsPumps,
  ) => {
    if (type === "petrol") {
      dispatch({ type: "SET_PMS_PUMPS", payload: pumps });
    } else if (type === "diesel") {
      dispatch({ type: "SET_AGO_PUMPS", payload: pumps });
    } else {
      dispatch({
        type: "SET_FUEL_PUMPS_BY_TYPE",
        payload: { ...state.fuelPumpsByType, [type]: pumps },
      });
    }
  };

  const addPump = (type: CanonicalFuelType) => {
    const pumps = [...pumpsForType(type)];
    const code = getFuelCode(type) || type.toUpperCase();
    const pumpId = `${code}-${pumps.length + 1}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const pump = {
      id: pumpId,
      openingKsh: 0,
      closingKsh: 0,
      openingL: 0,
      closingL: 0,
      salesL: 0,
      salesKsh: 0,
    };
    setPumpsForType(type, [...pumps, pump]);
  };

  const calculateSales = (
    index: number,
    type: CanonicalFuelType,
    field: string,
    value: number,
  ) => {
    const pumps = pumpsForType(type).map((p, i) =>
      i === index ? { ...p, [field]: value } : p,
    );
    const pump = pumps[index];
    // Calculate sales
    pump.salesL = Math.max(0, pump.closingL - pump.openingL);
    pump.salesKsh = Math.max(0, pump.closingKsh - pump.openingKsh);
    setPumpsForType(type, pumps);
  };

  const removePump = (index: number, type: CanonicalFuelType) => {
    if (confirm("Delete this pump?")) {
      const pumps = [...pumpsForType(type)];
      pumps.splice(index, 1);
      setPumpsForType(type, pumps);
    }
  };

  const priceForType = (type: CanonicalFuelType): number => {
    const dynamic = fuelTypeApi.getPriceFor(type);
    if (dynamic && dynamic > 0) return dynamic;
    if (type === "petrol") return state.pmsPrice ?? 0;
    if (type === "diesel") return state.agoPrice ?? 0;
    return state.fuelPricesByType?.[type] ?? 0;
  };

  const setPriceForType = (type: CanonicalFuelType, value: number) => {
    if (type === "petrol") {
      dispatch({ type: "SET_PRICES", payload: { pmsPrice: value } });
    } else if (type === "diesel") {
      dispatch({ type: "SET_PRICES", payload: { agoPrice: value } });
    } else {
      dispatch({
        type: "SET_FUEL_PRICES_BY_TYPE",
        payload: { [type]: value },
      });
    }
    // Propagate to the canonical fuel-types config so the price shows up on
    // the Dashboard / POS / Price Board instantly.
    if (syncPriceToFuelTypes) syncPriceToFuelTypes(type, value);
  };

  const addExpense = () => {
    const expense = { desc: "", amount: 0 };
    dispatch({ type: "SET_EXPENSES", payload: [...state.expenses, expense] });
  };

  const updateExpense = (index: number, field: string, value: any) => {
    const expenses = [...state.expenses];
    expenses[index] = {
      ...expenses[index],
      [field]: field === "amount" ? parseFloat(value) || 0 : value,
    };
    dispatch({ type: "SET_EXPENSES", payload: expenses });
  };

  const removeExpense = (index: number) => {
    if (confirm("Delete this expense?")) {
      const expenses = [...state.expenses];
      expenses.splice(index, 1);
      dispatch({ type: "SET_EXPENSES", payload: expenses });
    }
  };

  const calculateSummary = () => {
    // Sum pump sales across ALL tracked fuel types (not just PMS/AGO).
    const salesByType: Record<string, number> = {};
    let totalRevenue = 0;
    for (const ft of trackedFuelTypes) {
      const pumps = pumpsForType(ft) ?? [];
      const sales = pumps.reduce((sum, pump) => sum + (pump.salesKsh || 0), 0);
      salesByType[ft] = sales;
      totalRevenue += sales;
    }
    const totalExpenses = state.expenses.reduce(
      (sum, expense) => sum + (expense.amount || 0),
      0,
    );
    const cashInHand = totalRevenue - totalExpenses - (state.tillPayment || 0);
    const netIncome = (state.tillPayment || 0) + cashInHand;

    return {
      ...salesByType,
      totalPmsSalesKsh: salesByType.petrol ?? 0,
      totalAgoSalesKsh: salesByType.diesel ?? 0,
      salesByType,
      totalRevenue,
      totalExpenses,
      cashInHand,
      netIncome,
    };
  };

  const summary = calculateSummary();

  const clearSalesData = () => {
    if (confirm("Clear all sales data?")) {
      dispatch({ type: "SET_PMS_PUMPS", payload: [] });
      dispatch({ type: "SET_AGO_PUMPS", payload: [] });
      // Clear dynamic fuel-type pumps too.
      const cleared: Record<string, typeof state.pmsPumps> = {};
      for (const ft of trackedFuelTypes) {
        if (ft !== "petrol" && ft !== "diesel") cleared[ft] = [];
      }
      if (Object.keys(cleared).length > 0) {
        dispatch({
          type: "SET_FUEL_PUMPS_BY_TYPE",
          payload: { ...state.fuelPumpsByType, ...cleared },
        });
      }
      dispatch({ type: "SET_EXPENSES", payload: [] });
      dispatch({ type: "SET_TILL_PAYMENT", payload: 0 });
      // Keep the station's configured prices — do NOT reset to hardcoded
      // Kenya base prices (that would silently overwrite a user's custom
      // per-litre price on every "Clear" click and confuse cross-device
      // sync).
      dispatch({
        type: "SET_SALES_DATE",
        payload: new Date().toISOString().split("T")[0],
      });
      dispatch({ type: "SET_SHIFT", payload: "Day" });
      dispatch({
        type: "SET_TANK_VALUES",
        payload: {
          pmsTankOpening: 0,
          pmsTankClosing: 0,
          agoTankOpening: 0,
          agoTankClosing: 0,
        },
      });
      setLoadedRecordKey(null);
    }
  };

  const saveSalesData = () => {
    const key = `${state.salesDate}_${state.shift}`;

    // Preserve posSales from the existing entry — POS sales (PointOfSale tab)
    // are stored in the same salesHistory[key].posSales sub-object. Without
    // this spread, saving Sales Tracking data would silently DESTROY all POS
    // sales for this day/shift (data-loss bug).
    const existing = state.salesHistory[key] || {};

    const salesData = {
      date: state.salesDate,
      shift: state.shift,
      pmsPumps: [...state.pmsPumps],
      agoPumps: [...state.agoPumps],
      fuelPumpsByType: { ...(state.fuelPumpsByType || {}) },
      fuelPricesByType: { ...(state.fuelPricesByType || {}) },
      // Per-fuel-type tank readings (Kerosene/LPG/V-Power/...) so cross-device
      // sync + reload preserves them (was missing → tank inventory lost on
      // reload for any non-petrol/diesel fuel).
      fuelTankValuesByType: { ...(state.fuelTankValuesByType || {}) },
      expenses: [...state.expenses],
      tillPayment: state.tillPayment,
      pmsPrice: state.pmsPrice,
      agoPrice: state.agoPrice,
      pmsTankOpening: state.pmsTankOpening,
      pmsTankClosing: state.pmsTankClosing,
      agoTankOpening: state.agoTankOpening,
      agoTankClosing: state.agoTankClosing,
      // Preserve POS sales so they survive a Sales Tracking save
      posSales: existing.posSales,
      savedAt: new Date().toISOString(),
    };

    dispatch({
      type: "SET_SALES_HISTORY",
      payload: { ...state.salesHistory, [key]: salesData },
    });

    // Non-blocking save feedback — the FuelContext auto-save (500ms debounce)
    // persists to Supabase app_kv + Realtime, so the data syncs cross-device
    // without a page reload.
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("synced");
      setLoadedRecordKey(key);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }, 600);
  };

  const loadSalesData = (key: string) => {
    const data = state.salesHistory[key];
    if (!data) return;

    dispatch({ type: "SET_SALES_DATE", payload: data.date });
    dispatch({ type: "SET_SHIFT", payload: data.shift });
    dispatch({ type: "SET_PMS_PUMPS", payload: data.pmsPumps || [] });
    dispatch({ type: "SET_AGO_PUMPS", payload: data.agoPumps || [] });
    if (data.fuelPumpsByType)
      dispatch({
        type: "SET_FUEL_PUMPS_BY_TYPE",
        payload: data.fuelPumpsByType,
      });
    if (data.fuelPricesByType)
      dispatch({
        type: "SET_FUEL_PRICES_BY_TYPE",
        payload: data.fuelPricesByType,
      });
    // Restore per-fuel-type tank readings (Kerosene/LPG/V-Power/...).
    if (data.fuelTankValuesByType)
      dispatch({
        type: "SET_TANK_VALUES",
        payload: { fuelTankValuesByType: data.fuelTankValuesByType },
      });
    dispatch({ type: "SET_EXPENSES", payload: data.expenses || [] });
    dispatch({ type: "SET_TILL_PAYMENT", payload: data.tillPayment || 0 });
    dispatch({
      type: "SET_PRICES",
      payload: {
        pmsPrice: data.pmsPrice || state.pmsPrice,
        agoPrice: data.agoPrice || state.agoPrice,
      },
    });
    dispatch({
      type: "SET_TANK_VALUES",
      payload: {
        pmsTankOpening: data.pmsTankOpening || 0,
        pmsTankClosing: data.pmsTankClosing || 0,
        agoTankOpening: data.agoTankOpening || 0,
        agoTankClosing: data.agoTankClosing || 0,
      },
    });
    setLoadedRecordKey(key);
  };

  const deleteSalesData = (key: string) => {
    if (confirm(`Delete sales data for ${key}?`)) {
      const updatedHistory = { ...state.salesHistory };
      delete updatedHistory[key];
      dispatch({ type: "SET_SALES_HISTORY", payload: updatedHistory });
      if (loadedRecordKey === key) setLoadedRecordKey(null);
    }
  };

  const exportHandlers = {
    pdf: async () => {
      await exportSalesPDF({ ...state, summary });
    },
    excel: () => exportSalesExcel({ ...state, summary }),
    txt: () => exportSalesTXT({ ...state, summary }),
    whatsapp: () => {
      const data = getSalesData();
      const msg = `*${state.companyData.name}*\n\n*Fuel Sales Report*\n\n${data}\n\n*P.O. Box:* ${state.companyData.poBox || "N/A"}\n*CONTACTS:* ${state.companyData.contacts || "N/A"}\n*EMAIL:* ${state.companyData.email || "N/A"}`;
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      const data = getSalesData();
      const subject = "Fuel Sales Report";
      const body = `${state.companyData.name}\n\nFuel Sales Report\n\n${data}\n\nP.O. Box: ${state.companyData.poBox || "N/A"}\nCONTACTS: ${state.companyData.contacts || "N/A"}\nEMAIL: ${state.companyData.email || "N/A"}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  const getSalesData = () => {
    const fuelLines: string[] = [];
    const summaryLines: string[] = [];
    for (const ft of trackedFuelTypes) {
      const label = getFuelLabel(ft);
      const code = getFuelCode(ft);
      const pumps = pumpsForType(ft) ?? [];
      const price = priceForType(ft);
      fuelLines.push(
        `${label} (${code}) Price: ${currencySymbol} ${formatNumber(price)}/L`,
      );
      fuelLines.push(
        `${label} (${code}) Pumps:\n${
          pumps
            .map(
              (p) =>
                `${p.id}: Sales: ${formatNumber(p.salesL)} L, ${formatNumber(
                  p.salesKsh,
                )} ${currencySymbol}`,
            )
            .join("\n") || "  (no pumps)"
        }`,
      );
      const sales = (summary.salesByType as Record<string, number>)?.[ft] ?? 0;
      summaryLines.push(
        `Total ${label} Sales: ${currencySymbol} ${formatNumber(sales, 2)}`,
      );
    }
    // Dynamic tank inventory per fuel type (not hardcoded PMS/AGO).
    const tankLines = trackedFuelTypes.map((ft) => {
      const label = getFuelLabel(ft);
      const code = getFuelCode(ft);
      const tv =
        ft === "petrol"
          ? { opening: state.pmsTankOpening, closing: state.pmsTankClosing }
          : ft === "diesel"
            ? { opening: state.agoTankOpening, closing: state.agoTankClosing }
            : (state.fuelTankValuesByType?.[ft] ?? { opening: 0, closing: 0 });
      return `${label} (${code}) Tank: Opening: ${formatNumber(tv.opening)} L, Closing: ${formatNumber(tv.closing)} L`;
    });
    return `Date: ${state.salesDate}\nShift: ${state.shift}\n\nFuel Tank Inventory:\n${tankLines.join("\n")}\n\nFuel Pricing & Pumps:\n${fuelLines.join("\n")}\n\nDaily Expenses:\n${state.expenses.map((e) => `${e.desc}: ${formatNumber(e.amount)} ${currencySymbol}`).join("\n")}\n\nTill/Mobile Payment: ${formatNumber(state.tillPayment)} ${currencySymbol}\n\nDaily Summary:\n${summaryLines.join("\n")}\nTotal Revenue: ${currencySymbol} ${formatNumber(summary.totalRevenue, 2)}\nTill/Mobile Payment: ${currencySymbol} ${formatNumber(state.tillPayment, 2)}\nCash In Hand: ${currencySymbol} ${formatNumber(summary.cashInHand, 2)}\nTotal Expenses: ${currencySymbol} ${formatNumber(summary.totalExpenses, 2)}\nNet Income: ${currencySymbol} ${formatNumber(summary.netIncome, 2)}`;
  };

  // Compute a compact revenue summary for a saved history record so the
  // saved-records list can show per-record totals (not just date+shift).
  const getRecordSummary = (data: any) => {
    // DYNAMIC: sum revenue across ALL fuel types — legacy pmsPumps/agoPumps
    // PLUS fuelPumpsByType (Kerosene, V-Power, LPG, …). Was hardcoded to
    // PMS/AGO only, silently dropping revenue from other fuel types.
    const pms = (data.pmsPumps || []).reduce(
      (s: number, p: any) => s + (p.salesKsh || 0),
      0,
    );
    const ago = (data.agoPumps || []).reduce(
      (s: number, p: any) => s + (p.salesKsh || 0),
      0,
    );
    let otherFuelRevenue = 0;
    if (data.fuelPumpsByType && typeof data.fuelPumpsByType === "object") {
      for (const [type, pumps] of Object.entries(data.fuelPumpsByType)) {
        if (type === "petrol" || type === "diesel") continue; // already counted
        otherFuelRevenue += (pumps as any[]).reduce(
          (s: number, p: any) => s + (p.salesKsh || 0),
          0,
        );
      }
    }
    const exp = (data.expenses || []).reduce(
      (s: number, e: any) => s + (e.amount || 0),
      0,
    );
    return {
      revenue: pms + ago + otherFuelRevenue,
      pms,
      ago,
      expenses: exp,
    };
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* Image Cropper Modal */}
      {showCropper && pendingFile && (
        <ImageCropper
          file={pendingFile}
          onCrop={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* Scan & Upload Panel - Collapsible */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowScanPanel(!showScanPanel)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-white dark:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-gray-900 dark:text-white">
              <Sparkles size={24} />
            </div>
            <div className="text-left">
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-900 dark:text-white">
                AI-Powered Scan & Upload
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
                Snap a photo of handwritten records — AI reads it for you
              </p>
            </div>
          </div>
          <div
            className={`transform transition-transform ${showScanPanel ? "rotate-180" : ""}`}
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </button>

        {showScanPanel && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            {/* Step indicator */}
            {scanStep !== "idle" && (
              <div className="flex items-center justify-center gap-2 mb-4">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                    scanStep === "uploading"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                      : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                  }`}
                >
                  {scanStep === "uploading" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={12} />
                  )}
                  Upload
                </div>
                <div className="w-4 h-px bg-gray-300 dark:bg-gray-600" />
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                    scanStep === "analyzing"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                      : scanStep === "review"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {scanStep === "analyzing" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : scanStep === "review" ? (
                    <CheckCircle2 size={12} />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  AI Reading
                </div>
                <div className="w-4 h-px bg-gray-300 dark:bg-gray-600" />
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                    scanStep === "review"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <Pencil size={12} />
                  Review
                </div>
              </div>
            )}

            {/* Idle state - Upload zone */}
            {scanStep === "idle" && (
              <div
                ref={dropZoneRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
                  isDragging
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                    : "border-gray-300 dark:border-gray-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10"
                }`}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="p-4 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30">
                    <Image
                      size={32}
                      className="text-amber-600 dark:text-amber-400"
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-1">
                      Drop your sales record here
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      or use the buttons below
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3 mt-2">
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-gray-900 dark:text-white font-medium rounded-xl shadow-lg shadow-amber-500/25 transition-all"
                    >
                      <Camera size={18} />
                      Take Photo
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:border-amber-400 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-all"
                    >
                      <Upload size={18} />
                      Choose File
                    </button>
                  </div>

                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    Supports: Photos (JPG, PNG), PDFs, Documents
                  </p>
                </div>
              </div>
            )}

            {/* Uploading state */}
            {scanStep === "uploading" && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-amber-200 dark:border-amber-800" />
                  <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
                </div>
                <p className="mt-4 font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  Uploading document...
                </p>
              </div>
            )}

            {/* Analyzing state */}
            {scanStep === "analyzing" && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center">
                    <Sparkles
                      size={32}
                      className="text-amber-600 dark:text-amber-400 animate-pulse"
                    />
                  </div>
                </div>
                <p className="mt-4 font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  AI is reading your document...
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-1">
                  Extracting pump readings, expenses, and totals
                </p>
              </div>
            )}

            {/* Error state */}
            {scanStep === "error" && (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-6 text-center">
                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle
                    size={24}
                    className="text-amber-600 dark:text-amber-400"
                  />
                </div>
                <p className="font-medium text-amber-900 dark:text-amber-200 mb-1">
                  {scanError}
                </p>
                {scanSuggestion && (
                  <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                    {scanSuggestion}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 mb-4">
                  AI service may be temporarily busy. You can try again or enter
                  data manually below.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={resetScan}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-lg font-medium transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => {
                      resetScan();
                      setShowScanPanel(false);
                      // Scroll to manual entry section
                      setTimeout(() => {
                        const dateSection = document.querySelector(
                          '[data-section="date-shift"]',
                        );
                        if (dateSection)
                          dateSection.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg font-medium transition-colors"
                  >
                    Enter Manually Instead
                  </button>
                </div>
              </div>
            )}

            {/* Review state - Editable preview */}
            {scanStep === "review" && editableResult && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={20} className="text-green-600" />
                    <span className="font-medium text-green-700 dark:text-green-300">
                      Data extracted successfully
                    </span>
                    {editableResult.confidence && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          editableResult.confidence === "high"
                            ? "bg-green-100 text-green-700"
                            : editableResult.confidence === "medium"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {editableResult.confidence} confidence
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                  Review and edit the extracted data below, then click "Apply to
                  Form" to use it.
                </p>

                {/* Editable fields */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="form-group">
                    <label className="text-xs">Date</label>
                    <input
                      type="date"
                      value={editableResult.date || ""}
                      onChange={(e) =>
                        updateEditableField("date", e.target.value)
                      }
                      className="text-sm"
                    />
                  </div>
                  <div className="form-group">
                    <label className="text-xs">Shift</label>
                    <select
                      value={editableResult.shift || ""}
                      onChange={(e) =>
                        updateEditableField("shift", e.target.value)
                      }
                      className="text-sm"
                    >
                      <option value="">Not specified</option>
                      <option value="Day">Day</option>
                      <option value="Night">Night</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="text-xs">Till/M-Pesa</label>
                    <input
                      type="number"
                      value={editableResult.tillAmount ?? ""}
                      onChange={(e) =>
                        updateEditableField(
                          "tillAmount",
                          parseInputNumber(e.target.value) ?? 0,
                        )
                      }
                      className="text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div className="form-group">
                    <label className="text-xs">Cash</label>
                    <input
                      type="number"
                      value={editableResult.cashAmount ?? ""}
                      onChange={(e) =>
                        updateEditableField(
                          "cashAmount",
                          parseInputNumber(e.target.value) ?? 0,
                        )
                      }
                      className="text-sm"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Pumps */}
                {editableResult.pumps && editableResult.pumps.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">
                      Pumps ({editableResult.pumps.length})
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {editableResult.pumps.map((pump, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                        >
                          <input
                            type="text"
                            value={pump.name}
                            onChange={(e) =>
                              updateEditablePump(i, "name", e.target.value)
                            }
                            className="flex-1 min-w-0 px-2 py-1 rounded border text-xs"
                            placeholder="Name"
                          />
                          <select
                            value={pump.fuelType}
                            onChange={(e) =>
                              updateEditablePump(i, "fuelType", e.target.value)
                            }
                            className="px-2 py-1 rounded border text-xs"
                          >
                            <option value="Petrol">Petrol</option>
                            <option value="Diesel">Diesel</option>
                          </select>
                          <input
                            type="number"
                            value={pump.salesAmount ?? ""}
                            onChange={(e) =>
                              updateEditablePump(
                                i,
                                "salesAmount",
                                parseInputNumber(e.target.value) ?? 0,
                              )
                            }
                            className="w-24 px-2 py-1 rounded border text-xs"
                            placeholder="Sales"
                          />
                          <span className="text-xs text-gray-500">
                            {currencySymbol}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses */}
                {editableResult.expenses &&
                  editableResult.expenses.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">
                        Expenses ({editableResult.expenses.length})
                      </h4>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {editableResult.expenses.map((expense, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                          >
                            <input
                              type="text"
                              value={expense.name}
                              onChange={(e) =>
                                updateEditableExpense(i, "name", e.target.value)
                              }
                              className="flex-1 min-w-0 px-2 py-1 rounded border text-xs"
                              placeholder="Description"
                            />
                            <input
                              type="number"
                              value={expense.amount ?? ""}
                              onChange={(e) =>
                                updateEditableExpense(
                                  i,
                                  "amount",
                                  parseInputNumber(e.target.value) ?? 0,
                                )
                              }
                              className="w-24 px-2 py-1 rounded border text-xs"
                              placeholder="Amount"
                            />
                            <span className="text-xs text-gray-500">
                              {currencySymbol}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={applyScannedData}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-gray-900 dark:text-white font-medium rounded-xl shadow-lg shadow-green-500/25 transition-all"
                  >
                    <Check size={18} />
                    Apply to Form
                  </button>
                  <button
                    onClick={resetScan}
                    className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
      />

      {/* Header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-xl md:text-2xl font-bold text-blue-900 dark:text-blue-200">
              Fuel Sales Tracking
            </h2>
            {/* Cloud sync indicator — shows the user their data is synced */}
            {saveStatus === "saving" && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <RefreshCw size={12} className="animate-spin" />
                Saving to cloud...
              </span>
            )}
            {saveStatus === "synced" && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                <Cloud size={12} />
                Synced ✓
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => switchToTab("pos")}
              className="btn btn-outline"
              title="Record a sale in Point of Sale"
              aria-label="Record a sale in Point of Sale"
            >
              <Tag size={16} />
              <span>POS</span>
            </button>
            <button
              onClick={() => switchToTab("fuelsalesreport")}
              className="btn btn-outline"
              title="View consolidated fuel sales report"
              aria-label="View consolidated fuel sales report"
            >
              <BarChart3 size={16} />
              <span>Reports</span>
            </button>
            <button
              onClick={saveSalesData}
              className="btn btn-primary"
              aria-label="Save sales data"
            >
              <Save size={16} />
              <span>Save</span>
            </button>
            <button
              onClick={clearSalesData}
              className="btn btn-outline"
              aria-label="Clear sales data"
            >
              <Trash2 size={16} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Date & Shift */}
        <div className="mb-6" data-section="date-shift">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Calendar size={20} className="text-indigo-500" />
            Date & Shift
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={state.salesDate}
                onChange={(e) =>
                  dispatch({ type: "SET_SALES_DATE", payload: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Shift</label>
              <select
                value={state.shift}
                onChange={(e) =>
                  dispatch({ type: "SET_SHIFT", payload: e.target.value })
                }
              >
                <option value="Day">Day</option>
                <option value="Night">Night</option>
              </select>
            </div>
          </div>
        </div>

        {/* Fuel Tank Inventory — dynamic per fuel type. A station with N fuel
            types gets N tank sections (was hardcoded to only Petrol (PMS) Tank
            + Diesel (AGO) Tank). */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Fuel size={20} className="text-indigo-500" />
            Fuel Tank Inventory
          </h3>

          {trackedFuelTypes.map((ft) => {
            const label = getFuelLabel(ft);
            const code = getFuelCode(ft);
            // petrol/diesel map to the legacy pmsTank/agoTank fields for
            // backward compatibility; all other fuel types use the dynamic
            // fuelTankValuesByType store.
            const isPetrol = ft === "petrol";
            const isDiesel = ft === "diesel";
            const tankVal = isPetrol
              ? {
                  opening: state.pmsTankOpening,
                  closing: state.pmsTankClosing,
                }
              : isDiesel
                ? {
                    opening: state.agoTankOpening,
                    closing: state.agoTankClosing,
                  }
                : (state.fuelTankValuesByType?.[ft] ?? {
                    opening: 0,
                    closing: 0,
                  });
            const setTank = (opening: number, closing: number) => {
              if (isPetrol) {
                dispatch({
                  type: "SET_TANK_VALUES",
                  payload: { pmsTankOpening: opening, pmsTankClosing: closing },
                });
              } else if (isDiesel) {
                dispatch({
                  type: "SET_TANK_VALUES",
                  payload: { agoTankOpening: opening, agoTankClosing: closing },
                });
              } else {
                dispatch({
                  type: "SET_TANK_VALUES",
                  payload: {
                    fuelTankValuesByType: { [ft]: { opening, closing } },
                  },
                });
              }
            };
            return (
              <div className="mb-4" key={ft}>
                <h4 className="font-medium mb-2 text-gray-700 dark:text-gray-300">
                  {label} ({code}) Tank
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="form-group">
                    <label>Opening Meter (L)</label>
                    <input
                      type="number"
                      value={tankVal.opening ?? ""}
                      onChange={(e) =>
                        setTank(
                          parseInputNumber(e.target.value) ?? 0,
                          tankVal.closing,
                        )
                      }
                      step="0.1"
                      placeholder="0"
                    />
                  </div>
                  <div className="form-group">
                    <label>Closing Meter (L)</label>
                    <input
                      type="number"
                      value={tankVal.closing ?? ""}
                      onChange={(e) =>
                        setTank(
                          tankVal.opening,
                          parseInputNumber(e.target.value) ?? 0,
                        )
                      }
                      step="0.1"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fuel Pricing — dynamic per fuel type */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Tag size={20} className="text-indigo-500" />
            Fuel Pricing
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {trackedFuelTypes.map((ft) => {
              const label = getFuelLabel(ft);
              const code = getFuelCode(ft);
              return (
                <div className="form-group" key={ft}>
                  <label>
                    {label} ({code}) Price ({currencySymbol}/L)
                  </label>
                  <input
                    type="number"
                    value={priceForType(ft)}
                    onChange={(e) =>
                      setPriceForType(ft, parseInputNumber(e.target.value) ?? 0)
                    }
                    step="0.1"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Pumps — dynamic per fuel type. A station with N fuel types gets N
            pump tables (was hardcoded to only Petrol (PMS) Pumps + Diesel
            (AGO) Pumps). */}
        {trackedFuelTypes.map((ft) => {
          const label = getFuelLabel(ft);
          const code = getFuelCode(ft);
          const pumps = pumpsForType(ft);
          return (
            <div className="mb-6" key={ft}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">
                  {label} ({code}) Pumps
                </h3>
                <button onClick={() => addPump(ft)} className="btn btn-primary">
                  <Plus size={16} />
                  Add {label} Pump
                </button>
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Pump ID</th>
                      <th>Opening Meter ({currencySymbol})</th>
                      <th>Closing Meter ({currencySymbol})</th>
                      <th>Opening Meter (L)</th>
                      <th>Closing Meter (L)</th>
                      <th>Sales (L)</th>
                      <th>Sales ({currencySymbol})</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pumps.map((pump, index) => (
                      <tr key={pump.id || index}>
                        <td>{pump.id}</td>
                        <td>
                          <input
                            type="number"
                            value={pump.openingKsh}
                            onChange={(e) =>
                              calculateSales(
                                index,
                                ft,
                                "openingKsh",
                                parseInputNumber(e.target.value) ?? 0,
                              )
                            }
                            step="0.1"
                            className="w-full bg-transparent border-none outline-none"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pump.closingKsh}
                            onChange={(e) =>
                              calculateSales(
                                index,
                                ft,
                                "closingKsh",
                                parseInputNumber(e.target.value) ?? 0,
                              )
                            }
                            step="0.1"
                            className="w-full bg-transparent border-none outline-none"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pump.openingL}
                            onChange={(e) =>
                              calculateSales(
                                index,
                                ft,
                                "openingL",
                                parseInputNumber(e.target.value) ?? 0,
                              )
                            }
                            step="0.1"
                            className="w-full bg-transparent border-none outline-none"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pump.closingL}
                            onChange={(e) =>
                              calculateSales(
                                index,
                                ft,
                                "closingL",
                                parseInputNumber(e.target.value) ?? 0,
                              )
                            }
                            step="0.1"
                            className="w-full bg-transparent border-none outline-none"
                          />
                        </td>
                        <td>{formatNumber(pump.salesL)}</td>
                        <td>{formatNumber(pump.salesKsh)}</td>
                        <td>
                          <button
                            onClick={() => removePump(index, ft)}
                            className="btn btn-outline p-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Daily Expenses */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold">Daily Expenses</h3>
            <button onClick={addExpense} className="btn btn-secondary">
              <Plus size={16} />
              Add Expense
            </button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount ({currencySymbol})</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.expenses.map((expense, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        type="text"
                        value={expense.desc}
                        onChange={(e) =>
                          updateExpense(index, "desc", e.target.value)
                        }
                        className="w-full bg-transparent border-none outline-none"
                        placeholder="Expense description"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={expense.amount}
                        onChange={(e) =>
                          updateExpense(index, "amount", e.target.value)
                        }
                        step="0.1"
                        className="w-full bg-transparent border-none outline-none"
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => removeExpense(index)}
                        className="btn btn-outline p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Till/Mobile Payment */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Till/Mobile Payment</h3>
          <div className="form-group max-w-md">
            <label>Total Till/Mobile Payment ({currencySymbol})</label>
            <input
              type="number"
              value={state.tillPayment}
              onChange={(e) =>
                dispatch({
                  type: "SET_TILL_PAYMENT",
                  payload: parseInputNumber(e.target.value) ?? 0,
                })
              }
              step="0.1"
            />
          </div>
        </div>

        {/* Daily Summary — per-fuel-type sales + totals */}
        <div className="sales-summary">
          {trackedFuelTypes.map((ft) => {
            const label = getFuelLabel(ft);
            const sales =
              (summary.salesByType as Record<string, number>)?.[ft] ?? 0;
            return (
              <div className="summary-item" key={ft}>
                <div className="summary-label">Total {label} Sales</div>
                <div className="summary-value">
                  {currencySymbol} {formatNumber(sales, 2)}
                </div>
              </div>
            );
          })}
          <div className="summary-item">
            <div className="summary-label">Total Revenue</div>
            <div className="summary-value">
              {currencySymbol} {formatNumber(summary.totalRevenue, 2)}
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Till/Mobile Payment</div>
            <div className="summary-value">
              {currencySymbol} {formatNumber(state.tillPayment, 2)}
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Cash In Hand</div>
            <div className="summary-value">
              {currencySymbol} {formatNumber(summary.cashInHand, 2)}
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Total Expenses</div>
            <div className="summary-value">
              {currencySymbol} {formatNumber(summary.totalExpenses, 2)}
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Net Income</div>
            <div className="summary-value">
              {currencySymbol} {formatNumber(summary.netIncome, 2)}
            </div>
          </div>
        </div>

        {/* Export Actions */}
        <div className="mt-6">
          <ExportDropdown onExport={exportHandlers} title="Print Report" />
        </div>
      </div>

      {/* Saved Sales Tracking */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 size={20} className="text-blue-500" />
            Saved Sales Tracking
            {Object.keys(state.salesHistory).length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                ({Object.keys(state.salesHistory).length} record
                {Object.keys(state.salesHistory).length !== 1 ? "s" : ""})
              </span>
            )}
          </h3>
        </div>
        <div className="history-panel">
          {Object.keys(state.salesHistory).length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-500 dark:text-gray-400">
              <BarChart3 size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                No saved records yet. Fill in the form above and click "Save" to
                create your first sales record — it syncs to the cloud
                automatically.
              </p>
            </div>
          ) : (
            Object.keys(state.salesHistory)
              .sort()
              .reverse()
              .map((key) => {
                const data = state.salesHistory[key];
                const rec = getRecordSummary(data);
                const isActive = loadedRecordKey === key;
                return (
                  <div
                    key={key}
                    className={`history-item ${
                      isActive
                        ? "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20"
                        : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">
                        {data.date} - {data.shift} Shift
                      </span>
                      {isActive && (
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          (editing)
                        </span>
                      )}
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp size={11} />
                          {currencySymbol} {formatNumber(rec.revenue, 0)}
                        </span>
                        {rec.pms > 0 && (
                          <span>
                            PMS: {currencySymbol} {formatNumber(rec.pms, 0)}
                          </span>
                        )}
                        {rec.ago > 0 && (
                          <span>
                            AGO: {currencySymbol} {formatNumber(rec.ago, 0)}
                          </span>
                        )}
                        {rec.expenses > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Receipt size={11} />
                            {currencySymbol} {formatNumber(rec.expenses, 0)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => loadSalesData(key)}
                        className="btn btn-outline text-xs flex items-center gap-1"
                        title="Load this record into the form"
                      >
                        <Edit3 size={12} />
                        Load
                      </button>
                      <button
                        onClick={() => deleteSalesData(key)}
                        className="btn btn-outline text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete this record"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}
