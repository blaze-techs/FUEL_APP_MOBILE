/**
 * InventoryManagement.tsx — Stock Management
 *
 * Unified stock + product management. Formerly a separate "Products" tab,
 * product catalog CRUD is now a sub-tab here ("Products") so all
 * stock-related operations live in one place.
 *
 * Wired to the automation engine: every product create/update/delete and
 * stock adjustment emits a domain event, so reorder suggestions, inventory
 * transaction audit trails, and dashboard refreshes fire automatically.
 *
 * All subcomponents are module-scoped (UPDATE-4 rule).
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Plus,
  X,
  Loader2,
  CheckCircle,
  ArrowUpDown,
  Package,
  ArrowRight,
  Scale,
  Trash2,
  Edit2,
  AlertCircle,
  Filter,
  ChevronDown,
  Bell,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import {
  adjustStock,
  createStockTransfer,
  completeStockTransfer,
  processStockCount,
  recordWastage,
  fetchAllProducts,
  fetchInventoryTransactions,
} from "@/react-app/lib/pos-service";
import {
  getCurrencySymbol,
  getDetectedCurrency,
  getDetectedCountryCode,
  getLocaleForCountry,
} from "@/react-app/lib/currency";
import {
  automation,
  emit,
  on,
  getAutoReorders,
  fulfillReorder,
} from "@/react-app/lib/automation-engine";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import TankMonitor from "@/react-app/components/TankMonitor";
import TheftAnomalyDetector from "@/react-app/components/TheftAnomalyDetector";
import AutoReplenishment from "@/react-app/components/AutoReplenishment";
import EvaporationDriftDetector from "@/react-app/components/EvaporationDriftDetector";
import ThresholdAlertRules from "@/react-app/components/ThresholdAlertRules";
import TamperAlarmLog from "@/react-app/components/TamperAlarmLog";
import ItemMovementLedger from "@/react-app/components/ItemMovementLedger";
import StockValuationReport from "@/react-app/components/StockValuationReport";
import DipToLitresCalculator from "@/react-app/components/DipToLitresCalculator";
import TankWaterTrace from "@/react-app/components/TankWaterTrace";
import AbcInventoryAnalysis from "@/react-app/components/AbcInventoryAnalysis";
import MeterProvingLog from "@/react-app/components/MeterProvingLog";
import TankTelemetry from "@/react-app/components/TankTelemetry";
import TankCalibration from "@/react-app/components/TankCalibration";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { getVATRate } from "@/react-app/config/pricing";
import { lazy, Suspense } from "react";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const EnhancedInventoryManagement = lazy(() =>
  import("@/react-app/features/inventory-pro/EnhancedInventory").then((m) => ({
    default: m.default,
  })),
);

// Format currency — country-aware (uses the detected/station currency symbol).
// Previously hardcoded en-US with no symbol; getCurrencySymbol/getDetectedCurrency
// were imported but never used (dead imports).
const formatMoney = (amount: number) => {
  const symbol = getCurrencySymbol(getDetectedCurrency());
  return `${symbol} ${new Intl.NumberFormat(getLocaleForCountry(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)}`;
};

// Default categories (adjustable via user preferences, but kept here as fallback)
const DEFAULT_CATEGORIES = [
  "Fuel",
  "Lubricants",
  "Accessories",
  "Services",
  "Other",
];

// Product form initial state. tax_rate is country-aware (was hardcoded 16% —
// a Kenya VAT rate — which made every new product taxable at 16% even for
// stations in countries with no VAT or a different rate, silently inflating
// POS sale totals for non-Kenyan stations).
const INITIAL_PRODUCT = {
  sku: "",
  name: "",
  description: "",
  category: "Fuel",
  unit: "pcs",
  barcode: "",
  cost_price: 0,
  selling_price: 0,
  reorder_level: 10,
  stock_quantity: 0,
  tax_rate: getVATRate(getDetectedCountryCode()),
  is_active: true,
  is_taxable: true,
};

// Tab types — "products" is the merged catalog sub-tab
type InventoryTab =
  | "products"
  | "tankmonitor"
  | "telemetry"
  | "calibration"
  | "adjustments"
  | "transfers"
  | "counts"
  | "wastage"
  | "history"
  | "reorders"
  | "enhanced"
  | "movement"
  | "valuation"
  | "dipcalc"
  | "abc"
  | "meterproving";

const TABS = [
  { id: "products", label: "Products" },
  { id: "tankmonitor", label: "Tank Monitor" },
  { id: "telemetry", label: "Telemetry Ingest" },
  { id: "calibration", label: "Calibration" },
  { id: "adjustments", label: "Adjustments" },
  { id: "transfers", label: "Transfers" },
  { id: "counts", label: "Counts" },
  { id: "wastage", label: "Wastage" },
  { id: "reorders", label: "Auto-Reorders" },
  { id: "history", label: "History" },
  { id: "movement", label: "Item Ledger" },
  { id: "valuation", label: "Valuation" },
  { id: "dipcalc", label: "Dip to Litres" },
  { id: "abc", label: "ABC Analysis" },
  { id: "meterproving", label: "Meter Proving" },
  { id: "enhanced", label: "Pro Inventory" },
] as const;

// Module-scoped subcomponents (UPDATE-4 rule)
const AdjustmentForm = ({
  products,
  onSubmit,
  isLoading,
}: {
  products: any[];
  onSubmit: (
    data: { productId: string; newQuantity: number; reason: string }[],
  ) => void;
  isLoading: boolean;
}) => {
  const [adjustments, setAdjustments] = useState<
    { productId: string; newQuantity: number; reason: string }[]
  >([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()),
  );

  const addAdjustment = () => {
    if (!selectedProduct) return;
    if (adjustments.some((a) => a.productId === selectedProduct.id)) return;
    setAdjustments([
      ...adjustments,
      {
        productId: selectedProduct.id,
        newQuantity: selectedProduct.stock_quantity || 0,
        reason: "",
      },
    ]);
    setSelectedProduct(null);
    setSearch("");
  };

  const updateAdjustment = (index: number, field: string, value: any) => {
    setAdjustments(
      adjustments.map((a, i) => (i === index ? { ...a, [field]: value } : a)),
    );
  };

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
        <h4 className="text-gray-900 dark:text-white font-medium mb-4">
          Add Adjustment
        </h4>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
            {search && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                {filteredProducts.slice(0, 10).map((product) => (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProduct(product)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:bg-white/5 border-b border-white/5 last:border-0"
                  >
                    <p className="text-gray-900 dark:text-white text-sm">
                      {product.name}
                    </p>
                    <p className="text-gray-500 text-xs">
                      Current: {product.stock_quantity || 0}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={addAdjustment}
            disabled={!selectedProduct}
            className="px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 dark:text-white rounded-xl fp-icon-only"
            title="Add"
            aria-label="Add"
          >
            <Plus size={20} />
          </button>
        </div>
        {selectedProduct && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-gray-900 dark:text-white text-sm">
              Selected:{" "}
              <span className="font-medium">{selectedProduct.name}</span>
            </p>
            <p className="text-gray-500 dark:text-gray-400 text-xs">
              Current: {selectedProduct.stock_quantity || 0}
            </p>
          </div>
        )}
      </div>

      {adjustments.length > 0 ? (
        <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-white/10">
            <h4 className="text-gray-900 dark:text-white font-medium">
              Adjustments ({adjustments.length})
            </h4>
          </div>
          {adjustments.map((adj, index) => {
            const product = products.find((p) => p.id === adj.productId);
            return (
              <div key={adj.productId} className="p-4 border-b border-white/5">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {product?.name}
                    </p>
                    <p className="text-gray-500 text-xs mb-3">
                      Current: {product?.stock_quantity || 0}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-gray-500 dark:text-gray-400 text-xs mb-1 block">
                          New Quantity
                        </label>
                        <input
                          type="number"
                          value={adj.newQuantity}
                          onChange={(e) =>
                            updateAdjustment(
                              index,
                              "newQuantity",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 dark:text-gray-400 text-xs mb-1 block">
                          Reason
                        </label>
                        <input
                          type="text"
                          value={adj.reason}
                          onChange={(e) =>
                            updateAdjustment(index, "reason", e.target.value)
                          }
                          placeholder="e.g., Damaged"
                          className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeAdjustment(index)}
                    className="p-2 text-red-400 hover:text-red-300"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="p-4 border-t border-gray-200 dark:border-white/10">
            <button
              onClick={() => onSubmit(adjustments)}
              disabled={isLoading || adjustments.some((a) => !a.reason)}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CheckCircle size={18} />
              )}
              Apply All Adjustments
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <ArrowUpDown className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No adjustments</p>
          <p className="text-gray-500 text-sm">
            Search products to adjust stock
          </p>
        </div>
      )}
    </div>
  );
};

const TransferForm = ({
  products,
  stations,
  onSubmit,
  isLoading,
  onTransferChanged,
}: {
  products: any[];
  stations: any[];
  onSubmit: (data: {
    productId: string;
    toStationId: string;
    quantity: number;
    notes: string;
  }) => void;
  isLoading: boolean;
  onTransferChanged?: () => void;
}) => {
  const [formData, setFormData] = useState({
    productId: "",
    toStationId: "",
    quantity: 1,
    notes: "",
  });
  const [search, setSearch] = useState("");
  const { currentStation } = useStations();
  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedProduct = products.find((p) => p.id === formData.productId);
  const otherStations = stations.filter((s) => s.id !== currentStation?.id);

  return (
    <div className="space-y-6">
      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
        <h4 className="text-gray-900 dark:text-white font-medium mb-4">
          New Transfer
        </h4>
        <div className="space-y-4">
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Product
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search product..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              />
              {search && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                  {filteredProducts.slice(0, 10).map((product) => (
                    <button
                      key={product.id}
                      onClick={() => {
                        setFormData({ ...formData, productId: product.id });
                        setSearch(product.name);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:bg-white/5 border-b border-white/5 last:border-0"
                    >
                      <p className="text-gray-900 dark:text-white text-sm">
                        {product.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        Available: {product.stock_quantity || 0}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedProduct && (
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-2">
                Available: {selectedProduct.stock_quantity || 0}
              </p>
            )}
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Transfer To
            </label>
            <select
              value={formData.toStationId}
              onChange={(e) =>
                setFormData({ ...formData, toStationId: e.target.value })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            >
              <option value="">Select station</option>
              {otherStations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Quantity
            </label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  quantity: parseFloat(e.target.value) || 1,
                })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              min="1"
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white resize-none"
              rows={2}
            />
          </div>
          <button
            onClick={() => onSubmit(formData)}
            disabled={isLoading || !formData.productId || !formData.toStationId}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ArrowRight size={18} />
            )}
            Create Transfer
          </button>
        </div>
      </div>
      <TransfersList onComplete={onTransferChanged} />
    </div>
  );
};

const TransfersList = ({ onComplete }: { onComplete?: () => void }) => {
  const { currentStation } = useStations();
  const [transfers, setTransfers] = useState<any[]>([]);
  useEffect(() => {
    const loadTransfers = async () => {
      if (!currentStation?.id) return;
      const { data } = await supabase
        .from("stock_transfers")
        .select("*")
        .eq("from_station_id", currentStation.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setTransfers(data || []);
    };
    loadTransfers();
  }, [currentStation?.id]);

  const handleComplete = async (id: string) => {
    const result = await completeStockTransfer(id);
    if (!result.success) {
      toastError(
        "Failed to complete transfer: " + (result.error || "Unknown error"),
      );
      return;
    }
    setTransfers(transfers.filter((t) => t.id !== id));
    // Refresh the parent Products list so stock reflects the completed
    // transfer (completeStockTransfer moves stock on both stations). Without
    // this, the Products tab showed stale stock after completing a transfer.
    onComplete?.();
  };

  if (transfers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500 dark:text-gray-400">No pending transfers</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-white/10">
        <h4 className="text-gray-900 dark:text-white font-medium">Pending</h4>
      </div>
      {transfers.map((t) => (
        <div
          key={t.id}
          className="p-4 border-b border-white/5 flex items-center justify-between"
        >
          <div>
            <p className="text-gray-900 dark:text-white text-sm">
              {t.transfer_number}
            </p>
            <p className="text-gray-500 text-xs">{t.quantity} units</p>
          </div>
          <button
            onClick={() => handleComplete(t.id)}
            className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm"
          >
            Complete
          </button>
        </div>
      ))}
    </div>
  );
};

const CountForm = ({
  products,
  onSubmit,
  isLoading,
}: {
  products: any[];
  onSubmit: (
    data: { productId: string; countedQuantity: number; variance: number }[],
  ) => void;
  isLoading: boolean;
}) => {
  const [counts, setCounts] = useState<
    { productId: string; countedQuantity: number }[]
  >([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()),
  );

  const addCount = () => {
    if (!selectedProduct) return;
    if (counts.some((c) => c.productId === selectedProduct.id)) return;
    setCounts([
      ...counts,
      {
        productId: selectedProduct.id,
        countedQuantity: selectedProduct.stock_quantity || 0,
      },
    ]);
    setSelectedProduct(null);
    setSearch("");
  };

  const updateCount = (index: number, qty: number) =>
    setCounts(
      counts.map((c, i) => (i === index ? { ...c, countedQuantity: qty } : c)),
    );
  const removeCount = (index: number) =>
    setCounts(counts.filter((_, i) => i !== index));
  const getVariance = (productId: string, counted: number) =>
    counted - (products.find((p) => p.id === productId)?.stock_quantity || 0);

  return (
    <div className="space-y-6">
      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
        <h4 className="text-gray-900 dark:text-white font-medium mb-4">
          Add Count
        </h4>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
            {search && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                {filteredProducts.slice(0, 10).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:bg-white/5 border-b border-white/5 last:border-0"
                  >
                    <p className="text-gray-900 dark:text-white text-sm">
                      {p.name}
                    </p>
                    <p className="text-gray-500 text-xs">
                      System: {p.stock_quantity || 0}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={addCount}
            disabled={!selectedProduct}
            className="px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 dark:text-white rounded-xl fp-icon-only"
            title="Add"
            aria-label="Add"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {counts.length > 0 ? (
        <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-white/10">
            <h4 className="text-gray-900 dark:text-white font-medium">
              Count ({counts.length})
            </h4>
          </div>
          {counts.map((count, index) => {
            const product = products.find((p) => p.id === count.productId);
            const variance = getVariance(
              count.productId,
              count.countedQuantity,
            );
            return (
              <div
                key={count.productId}
                className="p-4 border-b border-white/5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {product?.name}
                    </p>
                    <p className="text-gray-500 text-xs mb-3">
                      System: {product?.stock_quantity || 0}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-gray-500 dark:text-gray-400 text-xs mb-1 block">
                          Actual
                        </label>
                        <input
                          type="number"
                          value={count.countedQuantity}
                          onChange={(e) =>
                            updateCount(index, parseFloat(e.target.value) || 0)
                          }
                          className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 dark:text-gray-400 text-xs mb-1 block">
                          Variance
                        </label>
                        <div
                          className={`px-3 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-center font-medium ${variance > 0 ? "text-emerald-400" : variance < 0 ? "text-red-400" : "text-gray-500 dark:text-gray-400"}`}
                        >
                          {variance > 0 ? "+" : ""}
                          {variance}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeCount(index)}
                    className="p-2 text-red-400 hover:text-red-300"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="p-4 border-t border-gray-200 dark:border-white/10">
            <button
              onClick={() =>
                onSubmit(
                  counts.map((c) => ({
                    productId: c.productId,
                    countedQuantity: c.countedQuantity,
                    variance: getVariance(c.productId, c.countedQuantity),
                  })),
                )
              }
              disabled={isLoading}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CheckCircle size={18} />
              )}
              Submit Count
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <Scale className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No items</p>
        </div>
      )}
    </div>
  );
};

const WastageForm = ({
  products,
  onSubmit,
  isLoading,
}: {
  products: any[];
  onSubmit: (data: {
    productId: string;
    quantity: number;
    notes: string;
  }) => void;
  isLoading: boolean;
}) => {
  const [formData, setFormData] = useState({
    productId: "",
    quantity: 1,
    notes: "",
  });
  const [search, setSearch] = useState("");
  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedProduct = products.find((p) => p.id === formData.productId);

  return (
    <div className="space-y-6">
      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
        <h4 className="text-gray-900 dark:text-white font-medium mb-4">
          Record Wastage
        </h4>
        <div className="space-y-4">
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Product
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              />
              {search && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                  {filteredProducts.slice(0, 10).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setFormData({ ...formData, productId: p.id });
                        setSearch(p.name);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:bg-white/5 border-b border-white/5 last:border-0"
                    >
                      <p className="text-gray-900 dark:text-white text-sm">
                        {p.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        Avail: {p.stock_quantity || 0}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Quantity
            </label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  quantity: parseFloat(e.target.value) || 1,
                })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              min="1"
              max={selectedProduct?.stock_quantity || 1}
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Reason
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              placeholder="e.g., Expired, Spillage..."
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white resize-none"
              rows={3}
            />
          </div>
          <button
            onClick={() => onSubmit(formData)}
            disabled={isLoading || !formData.productId || !formData.notes}
            className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Trash2 size={18} />
            )}
            Record Wastage
          </button>
        </div>
      </div>
    </div>
  );
};

const HistoryTable = () => {
  const { currentStation } = useStations();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTransactions = async () => {
      if (!currentStation?.id) return;
      setLoading(true);
      const data = await fetchInventoryTransactions(
        currentStation.id,
        undefined,
        100,
      );
      setTransactions(data);
      setLoading(false);
    };
    loadTransactions();
  }, [currentStation?.id]);

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  if (transactions.length === 0)
    return (
      <div className="text-center py-12">
        <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No transactions</p>
      </div>
    );

  return (
    <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-white/10">
            {[
              "Date",
              "Product",
              "Type",
              "Change",
              "Before",
              "After",
              "Notes",
            ].map((h) => (
              <th
                key={h}
                className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr
              key={tx.id}
              className="border-b border-white/5 hover:bg-gray-50 dark:bg-white/5"
            >
              <td className="px-4 py-3 text-sm text-gray-300">
                {new Date(tx.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-gray-900 dark:text-white">
                  {tx.products?.name || "Unknown"}
                </div>
                <div className="text-xs text-gray-500">{tx.products?.sku}</div>
              </td>
              <td className="px-4 py-3">
                <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 capitalize">
                  {(tx.transaction_type || "unknown").replace("_", " ")}
                </span>
              </td>
              <td
                className={`px-4 py-3 text-sm font-bold ${tx.quantity_change >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {tx.quantity_change >= 0 ? "+" : ""}
                {tx.quantity_change}
              </td>
              <td className="px-4 py-3 text-sm text-gray-300">
                {tx.previous_quantity}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                {tx.new_quantity}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                {tx.notes || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Products sub-tab subcomponents (merged from ProductsManagement) ─────

const ProductTableHeader = () => (
  <thead>
    <tr className="border-b border-gray-200 dark:border-white/10">
      {[
        "Product",
        "Category",
        "Stock",
        "Cost",
        "Price",
        "Status",
        "Actions",
      ].map((label) => (
        <th
          key={label}
          className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3"
        >
          {label}
        </th>
      ))}
    </tr>
  </thead>
);

const ProductRow = ({
  product,
  onEdit,
  onDelete,
}: {
  product: any;
  onEdit: (product: any) => void;
  onDelete: (product: any) => void;
}) => (
  <tr className="border-b border-white/5 hover:bg-gray-50 dark:bg-white/5">
    <td className="px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
          <Package size={18} className="text-amber-400" />
        </div>
        <div>
          <p className="text-gray-900 dark:text-white font-medium">
            {product.name}
          </p>
          <p className="text-gray-500 text-xs">{product.sku}</p>
        </div>
      </div>
    </td>
    <td className="px-4 py-4">
      <span className="text-gray-300 text-sm">{product.category || "-"}</span>
    </td>
    <td className="px-4 py-4">
      <span
        className={`text-sm font-medium ${
          (product.stock_quantity || 0) <= (product.reorder_level || 10)
            ? "text-red-400"
            : "text-emerald-400"
        }`}
      >
        {product.stock_quantity ?? 0}
      </span>
    </td>
    <td className="px-4 py-4">
      <span className="text-gray-900 dark:text-white">
        {formatMoney(product.cost_price || 0)}
      </span>
    </td>
    <td className="px-4 py-4">
      <span className="text-amber-400 font-medium">
        {formatMoney(product.selling_price || 0)}
      </span>
    </td>
    <td className="px-4 py-4">
      <span
        className={`text-xs px-2 py-1 rounded-full ${
          product.is_active
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-gray-500/20 text-gray-500 dark:text-gray-400"
        }`}
      >
        {product.is_active ? "Active" : "Inactive"}
      </span>
    </td>
    <td className="px-4 py-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onEdit(product)}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white hover:bg-gray-100 dark:bg-white/10 rounded-lg transition-colors"
        >
          <Edit2 size={16} />
        </button>
        <button
          onClick={() => onDelete(product)}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </td>
  </tr>
);

const ProductModal = ({
  product,
  categories,
  onSave,
  onClose,
  isLoading,
}: {
  product: any | null;
  categories: string[];
  onSave: (data: any) => void;
  onClose: () => void;
  isLoading: boolean;
}) => {
  const [formData, setFormData] = useState(product || INITIAL_PRODUCT);
  const [newCategory, setNewCategory] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const allCategories = useMemo(() => {
    const cats = new Set([...DEFAULT_CATEGORIES, ...categories]);
    return Array.from(cats);
  }, [categories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const addCategory = () => {
    if (newCategory.trim()) {
      setFormData({ ...formData, category: newCategory.trim() });
      setNewCategory("");
      setShowCategoryDropdown(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl border border-gray-200 dark:border-white/10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            {product ? "Edit Product" : "Add Product"}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                SKU *
              </label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) =>
                  setFormData({ ...formData, sku: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Barcode
              </label>
              <input
                type="text"
                value={formData.barcode || ""}
                onChange={(e) =>
                  setFormData({ ...formData, barcode: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Product Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Description
            </label>
            <textarea
              value={formData.description || ""}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white resize-none"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Category *
              </label>
              <button
                type="button"
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-left"
              >
                <span className="text-gray-900 dark:text-white">
                  {formData.category || "Select Category"}
                </span>
                <ChevronDown
                  size={16}
                  className="text-gray-500 dark:text-gray-400"
                />
              </button>
              {showCategoryDropdown && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-10 overflow-hidden">
                  <div className="p-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="New category"
                        className="flex-1 px-3 py-2 bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm"
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          (e.preventDefault(), addCategory())
                        }
                      />
                      <button
                        type="button"
                        onClick={addCategory}
                        className="px-3 py-2 bg-amber-500 text-gray-900 dark:text-white rounded-lg text-sm"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {allCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, category: cat });
                          setShowCategoryDropdown(false);
                        }}
                        className="w-full px-4 py-2 text-left text-gray-300 hover:bg-gray-50 dark:bg-white/5"
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Unit
              </label>
              <select
                value={formData.unit}
                onChange={(e) =>
                  setFormData({ ...formData, unit: e.target.value })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              >
                <option value="pcs">Pieces</option>
                <option value="liters">Liters</option>
                <option value="kg">Kilograms</option>
                <option value="boxes">Boxes</option>
                <option value="drums">Drums</option>
                <option value="cartons">Cartons</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Cost Price *
              </label>
              <input
                type="number"
                value={formData.cost_price}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    cost_price: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                min="0"
                step="0.01"
                required
              />
            </div>
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Selling Price *
              </label>
              <input
                type="number"
                value={formData.selling_price}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    selling_price: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                min="0"
                step="0.01"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Initial Stock
              </label>
              <input
                type="number"
                value={formData.stock_quantity}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    stock_quantity: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Reorder Level
              </label>
              <input
                type="number"
                value={formData.reorder_level}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    reorder_level: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                min="0"
                step="0.01"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Tax Rate (%)
              </label>
              <input
                type="number"
                value={formData.tax_rate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    tax_rate: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
                min="0"
                max="100"
                step="0.01"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                Options
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_taxable}
                  onChange={(e) =>
                    setFormData({ ...formData, is_taxable: e.target.checked })
                  }
                  className="w-5 h-5 bg-gray-100 dark:bg-white/10 border border-white/20 rounded"
                />
                <span className="text-gray-300 text-sm">Taxable</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
                  className="w-5 h-5 bg-gray-100 dark:bg-white/10 border border-white/20 rounded"
                />
                <span className="text-gray-300 text-sm">Active</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 dark:bg-white/10 hover:bg-white/20 text-gray-900 dark:text-white rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  {product ? "Update Product" : "Add Product"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DeleteConfirmModal = ({
  product,
  onConfirm,
  onCancel,
  isLoading,
}: {
  product: any;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-200 dark:border-white/10">
      <div className="text-center">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Delete Product
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Are you sure you want to delete{" "}
          <span className="text-gray-900 dark:text-white font-medium">
            {product.name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-gray-100 dark:bg-white/10 hover:bg-white/20 text-gray-900 dark:text-white rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 text-gray-900 dark:text-white rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                <Trash2 size={18} />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  </div>
);

// Products panel — the merged catalog CRUD
const ProductsPanel = ({
  products,
  categories,
  onEdit,
  onDelete,
  onAdd,
  saving,
}: {
  products: any[];
  categories: string[];
  onEdit: (product: any) => void;
  onDelete: (product: any) => void;
  onAdd: () => void;
  saving: boolean;
}) => {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showLowStock, setShowLowStock] = useState(false);

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        !search ||
        product.name?.toLowerCase().includes(search.toLowerCase()) ||
        product.sku?.toLowerCase().includes(search.toLowerCase()) ||
        product.barcode?.includes(search);
      const matchesCategory =
        !categoryFilter || product.category === categoryFilter;
      const matchesLowStock =
        !showLowStock ||
        (product.stock_quantity || 0) <= (product.reorder_level || 10);
      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [products, search, categoryFilter, showLowStock]);

  const allCategories = useMemo(() => {
    const cats = new Set([...DEFAULT_CATEGORIES, ...categories]);
    return Array.from(cats);
  }, [categories]);

  return (
    <div>
      {(() => {
        const lowStockCount = products.filter(
          (p) => (p.stock_quantity || 0) <= (p.reorder_level || 10),
        ).length;
        const outOfStockCount = products.filter(
          (p) => (p.stock_quantity || 0) <= 0,
        ).length;
        if (lowStockCount === 0) return null;
        return (
          <div
            className={`mb-4 p-3 rounded-xl border ${
              outOfStockCount > 0
                ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
            }`}
          >
            <p
              className={`text-sm font-medium ${
                outOfStockCount > 0
                  ? "text-red-700 dark:text-red-300"
                  : "text-yellow-700 dark:text-yellow-300"
              }`}
            >
              {outOfStockCount > 0
                ? `⚠ ${outOfStockCount} product(s) out of stock`
                : `⚠ ${lowStockCount} product(s) below reorder level`}
              {" — "}
              <button
                onClick={() => setShowLowStock(true)}
                className="underline font-semibold"
              >
                View low stock items
              </button>
            </p>
          </div>
        );
      })()}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {filtered.length} product{filtered.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => switchToTab("pos")}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 text-gray-300 hover:text-gray-900 dark:text-white rounded-xl transition-colors text-sm border border-gray-200 dark:border-white/10"
            title="Open Point of Sale to sell these products"
          >
            <Package size={18} />
            Sell in POS
          </button>
          <button
            onClick={onAdd}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl transition-colors"
          >
            <Plus size={20} />
            Add Product
          </button>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            size={18}
          />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
        >
          <option value="">All Categories</option>
          {allCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={showLowStock}
            onChange={(e) => setShowLowStock(e.target.checked)}
            className="w-5 h-5 bg-gray-100 dark:bg-white/10 border border-white/20 rounded"
          />
          <span className="text-gray-300 text-sm">Low Stock</span>
        </label>
      </div>
      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
        <table className="w-full">
          <ProductTableHeader />
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No products found
                  </p>
                  <p className="text-gray-500 text-sm mt-1">
                    {search || categoryFilter || showLowStock
                      ? "Try adjusting your filters"
                      : "Add your first product to get started"}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Auto-Reorders panel — shows automation-generated reorder suggestions
const ReordersPanel = ({
  refreshKey,
  onFulfilled,
}: {
  refreshKey: number;
  onFulfilled?: () => void;
}) => {
  const [reorders, setReorders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await getAutoReorders();
      if (!cancelled) {
        setReorders(r.filter((x: any) => x.status === "pending"));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleFulfill = async (id: string, qty: number) => {
    setBusy(true);
    try {
      // fulfillReorder now restocks the product + records a transaction +
      // returns {success, error}. Previously it returned void and gave the
      // user no feedback (and never moved stock).
      const result = await fulfillReorder(id, qty);
      if (!result.success) {
        toastError(
          "Failed to fulfill reorder: " + (result.error || "Unknown error"),
        );
        return;
      }
      const r = await getAutoReorders();
      setReorders(r.filter((x: any) => x.status === "pending"));
      // Refresh the parent Products list so the new stock shows up.
      onFulfilled?.();
    } catch (error: any) {
      toastError("Failed to fulfill reorder: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Loading reorder suggestions...
      </div>
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-amber-400 text-sm">
        <Bell size={16} />
        <span>
          Auto-generated reorder suggestions (updates in real-time as stock
          changes)
        </span>
        <button
          onClick={() => switchToTab("suppliers")}
          className="ml-2 flex items-center gap-1 px-3 py-1 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 text-gray-300 hover:text-gray-900 dark:text-white rounded-lg border border-gray-200 dark:border-white/10 text-xs"
          title="Open Supplier Management to create a purchase order"
        >
          <ArrowRight size={12} />
          Create PO
        </button>
      </div>
      {reorders.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            No pending reorders
          </p>
          <p className="text-gray-500 text-sm mt-1">
            Suggestions appear automatically when stock drops below the reorder
            level
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reorders.map((r: any) => (
            <div
              key={r.id}
              className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-gray-900 dark:text-white font-medium">
                  {r.productName}
                </p>
                <p className="text-gray-500 dark:text-gray-400 text-xs">
                  Current: {r.currentStock} · Reorder level: {r.reorderLevel} ·
                  Suggested: {r.suggestedQty} units
                </p>
              </div>
              <button
                onClick={() => handleFulfill(r.id, r.suggestedQty)}
                disabled={busy}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-gray-900 dark:text-white rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle size={16} />
                )}
                Mark Fulfilled
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main Component
export default function InventoryManagement() {
  const { currentStation } = useStations();
  const [activeTab, setActiveTab] = useState<InventoryTab>("products");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("inventory", setActiveTab);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<any | null>(null);
  const [reorderRefresh, setReorderRefresh] = useState(0);

  const loadData = useCallback(async () => {
    if (!currentStation?.id) return;
    setLoading(true);
    try {
      const [productsData, stationsData] = await Promise.all([
        // fetchAllProducts returns ALL products (incl. inactive) so they can
        // be viewed/re-activated/edited/deleted. fetchProducts (is_active=true)
        // made inactive products permanently unmanageable ghost rows.
        fetchAllProducts(currentStation.id),
        supabase
          .from("stations")
          .select("id, name")
          .neq("id", currentStation.id),
      ]);
      setProducts(productsData);
      const { error: stErr } = stationsData;
      if (stErr) console.error("Stations query error:", stErr.message);
      setStations(stationsData.data || []);
      const cats = new Set(
        productsData.map((p: any) => p.category).filter(Boolean),
      );
      setCategories(Array.from(cats) as string[]);
    } catch (error) {
      console.error("Failed to load:", error);
    } finally {
      setLoading(false);
    }
  }, [currentStation?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Realtime: refresh products when another device inserts/updates/deletes
  // a product in this station. Without this, cross-device product changes
  // were invisible until a manual tab switch / refresh. Respects the global
  // Realtime kill-switch (egress saver).
  useEffect(() => {
    if (!currentStation?.id) return;
    if (!cloudStorageService.isRealtimeEnabled()) return;
    const channel = supabase
      .channel(`inventory-products-${currentStation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `station_id=eq.${currentStation.id}`,
        },
        () => loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_transactions",
          filter: `station_id=eq.${currentStation.id}`,
        },
        () => setReorderRefresh((k) => k + 1),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stock_transfers",
          filter: `from_station_id=eq.${currentStation.id}`,
        },
        () => loadData(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentStation?.id, loadData]);

  // ── Automation wiring: listen for events that should refresh our data ──
  useEffect(() => {
    // When a sale completes (from POS), product stock may have changed — reload
    const unsub1 = on("sale:completed", () => {
      if (currentStation?.id) loadData();
    });
    // When automation creates a reorder, refresh the reorders panel
    const unsub2 = on("stock:adjusted", () => {
      setReorderRefresh((k) => k + 1);
    });
    // Refresh when prices change (automation auto-sync)
    const onPriceRefresh = () => loadData();
    window.addEventListener("automation:refresh-prices", onPriceRefresh);
    return () => {
      unsub1();
      unsub2();
      window.removeEventListener("automation:refresh-prices", onPriceRefresh);
    };
  }, [currentStation?.id, loadData]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  // ── Product CRUD (merged from ProductsManagement) ──────────────────────
  const handleSaveProduct = async (formData: any) => {
    if (!currentStation?.id) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const ownerId = userData.user?.id;

      if (editingProduct) {
        const prev = products.find((p) => p.id === editingProduct.id);
        const { error } = await supabase
          .from("products")
          .update(formData)
          .eq("id", editingProduct.id);
        if (error) throw error;
        // Emit automation event — engine auto-records inventory txn + checks reorder
        emit({
          type: "product:updated",
          productId: editingProduct.id,
          stationId: currentStation.id,
          data: formData,
          prev,
        });
        showNotice("Product updated successfully");
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert({
            ...formData,
            station_id: currentStation.id,
            owner_id: ownerId,
          })
          .select()
          .single();
        if (error) throw error;
        // Emit automation event — engine auto-records initial stock txn
        emit({
          type: "product:created",
          productId: data.id,
          stationId: currentStation.id,
          data: formData,
        });
        showNotice("Product added successfully");
      }
      setShowModal(false);
      setEditingProduct(null);
      loadData();
    } catch (error: any) {
      console.error("Failed to save product:", error);
      toastError("Failed to save product: " + (error?.message || error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteProduct) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", deleteProduct.id);
      if (error) throw error;
      emit({
        type: "product:deleted",
        productId: deleteProduct.id,
        stationId: currentStation?.id || "",
      });
      setDeleteProduct(null);
      loadData();
      showNotice("Product deleted successfully");
    } catch (error: any) {
      console.error("Failed to delete product:", error);
      toastError("Failed to delete product: " + (error?.message || error));
    } finally {
      setSaving(false);
    }
  };

  // ── Stock operations (emit automation events) ─────────────────────────
  const handleAdjustment = async (
    adjustments: { productId: string; newQuantity: number; reason: string }[],
  ) => {
    if (!currentStation?.id) return;
    setProcessing(true);
    try {
      const result = await adjustStock(
        currentStation.id,
        adjustments.map((a) => ({
          productId: a.productId,
          previousQuantity:
            products.find((p) => p.id === a.productId)?.stock_quantity || 0,
          newQuantity: a.newQuantity,
          reason: a.reason,
        })),
      );
      if (!result.success) {
        toastError(
          "Failed to adjust stock: " + (result.error || "Unknown error"),
        );
        return;
      }
      // Emit automation events — reorder check + dashboard refresh fire automatically
      adjustments.forEach((a) =>
        emit({
          type: "stock:adjusted",
          productId: a.productId,
          stationId: currentStation.id,
          newQty: a.newQuantity,
          reason: a.reason,
        }),
      );
      showNotice("Adjustments applied");
      loadData();
    } catch (error: any) {
      toastError("Failed: " + (error?.message || error));
    } finally {
      setProcessing(false);
    }
  };

  const handleTransfer = async (data: {
    productId: string;
    toStationId: string;
    quantity: number;
    notes: string;
  }) => {
    if (!currentStation?.id) return;
    setProcessing(true);
    try {
      const result = await createStockTransfer({
        productId: data.productId,
        fromStationId: currentStation.id,
        toStationId: data.toStationId,
        quantity: data.quantity,
        notes: data.notes,
      });
      // createStockTransfer returns {success, error} — checking it prevents a
      // false "Transfer created" notice when the insert actually failed (RLS,
      // constraint, etc.). Previously the result was ignored.
      if (!result.success) {
        toastError(
          "Failed to create transfer: " + (result.error || "Unknown error"),
        );
        return;
      }
      emit({
        type: "stock:transfer",
        productId: data.productId,
        fromStationId: currentStation.id,
        toStationId: data.toStationId,
        qty: data.quantity,
      });
      showNotice("Transfer created");
      loadData();
    } catch (error: any) {
      toastError("Failed: " + (error?.message || error));
    } finally {
      setProcessing(false);
    }
  };

  const handleCount = async (
    counts: { productId: string; countedQuantity: number; variance: number }[],
  ) => {
    if (!currentStation?.id) return;
    setProcessing(true);
    try {
      const result = await processStockCount(
        currentStation.id,
        counts.filter((c) => c.variance !== 0),
      );
      if (!result.success) {
        toastError(
          "Failed to submit count: " + (result.error || "Unknown error"),
        );
        return;
      }
      counts
        .filter((c) => c.variance !== 0)
        .forEach((c) =>
          emit({
            type: "stock:adjusted",
            productId: c.productId,
            stationId: currentStation.id,
            newQty: c.countedQuantity,
            reason: "Stock count adjustment",
          }),
        );
      showNotice("Count submitted");
      loadData();
    } catch (error: any) {
      toastError("Failed: " + (error?.message || error));
    } finally {
      setProcessing(false);
    }
  };

  const handleWastage = async (data: {
    productId: string;
    quantity: number;
    notes: string;
  }) => {
    if (!currentStation?.id) return;
    setProcessing(true);
    try {
      const result = await recordWastage(
        currentStation.id,
        data.productId,
        data.quantity,
        data.notes,
      );
      if (!result.success) {
        toastError(
          "Failed to record wastage: " + (result.error || "Unknown error"),
        );
        return;
      }
      emit({
        type: "stock:wastage",
        productId: data.productId,
        stationId: currentStation.id,
        qty: data.quantity,
      });
      showNotice("Wastage recorded");
      loadData();
    } catch (error: any) {
      toastError("Failed: " + (error?.message || error));
    } finally {
      setProcessing(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Stock Management
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Products, adjustments, transfers, counts, wastage & auto-reorders
        </p>
      </div>
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${activeTab === tab.id ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className={
          activeTab === "products" ||
          activeTab === "tankmonitor" ||
          activeTab === "calibration"
            ? ""
            : "max-w-2xl"
        }
      >
        {activeTab === "tankmonitor" && (
          <div className="space-y-4">
            <TankMonitor />
            <TheftAnomalyDetector />
            <AutoReplenishment />
            <EvaporationDriftDetector />
            <ThresholdAlertRules />
            <TamperAlarmLog />
            <TankWaterTrace />
          </div>
        )}
        {activeTab === "telemetry" && <TankTelemetry />}
        {activeTab === "calibration" && <TankCalibration />}
        {activeTab === "dipcalc" && <DipToLitresCalculator />}
        {activeTab === "abc" && <AbcInventoryAnalysis />}
        {activeTab === "meterproving" && <MeterProvingLog />}
        {activeTab === "movement" && <ItemMovementLedger />}
        {activeTab === "valuation" && (
          <StockValuationReport products={products} />
        )}
        {activeTab === "products" && (
          <ProductsPanel
            products={products}
            categories={categories}
            onEdit={(p) => {
              setEditingProduct(p);
              setShowModal(true);
            }}
            onDelete={(p) => setDeleteProduct(p)}
            onAdd={() => {
              setEditingProduct(null);
              setShowModal(true);
            }}
            saving={saving}
          />
        )}
        {activeTab === "adjustments" && (
          <AdjustmentForm
            products={products}
            onSubmit={handleAdjustment}
            isLoading={processing}
          />
        )}
        {activeTab === "transfers" && (
          <TransferForm
            products={products}
            stations={stations}
            onSubmit={handleTransfer}
            isLoading={processing}
            onTransferChanged={loadData}
          />
        )}
        {activeTab === "counts" && (
          <CountForm
            products={products}
            onSubmit={handleCount}
            isLoading={processing}
          />
        )}
        {activeTab === "wastage" && (
          <WastageForm
            products={products}
            onSubmit={handleWastage}
            isLoading={processing}
          />
        )}
        {activeTab === "reorders" && (
          <ReordersPanel refreshKey={reorderRefresh} onFulfilled={loadData} />
        )}
        {activeTab === "history" && <HistoryTable />}
        {activeTab === "enhanced" && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                <span className="ml-2 text-gray-500">
                  Loading Pro Inventory...
                </span>
              </div>
            }
          >
            <EnhancedInventoryManagement />
          </Suspense>
        )}
      </div>

      {/* Product Modal */}
      {showModal && (
        <ProductModal
          product={editingProduct}
          categories={categories}
          onSave={handleSaveProduct}
          onClose={() => {
            setShowModal(false);
            setEditingProduct(null);
          }}
          isLoading={saving}
        />
      )}
      {/* Delete Confirmation */}
      {deleteProduct && (
        <DeleteConfirmModal
          product={deleteProduct}
          onConfirm={handleDeleteProduct}
          onCancel={() => setDeleteProduct(null)}
          isLoading={saving}
        />
      )}
      {notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/90 text-gray-900 dark:text-white text-sm font-medium px-4 py-2 rounded-xl">
          {notice}
        </div>
      )}
    </div>
  );
}
