/**
 * Enhanced Inventory Management System
 * AI-powered demand forecasting, automated reordering, and real-time tracking
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Package,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap,
  Brain,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import { formatCurrency } from "@/react-app/lib/currency";
import { dataCache } from "@/react-app/lib/enhanced/performance";
import { toast } from "sonner";

interface InventoryItem {
  id: string;
  product_name: string;
  sku: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  unit_price: number;
  category: string;
  supplier_id?: string;
  last_restocked?: string;
  location?: string;
}

interface DemandForecast {
  productId: string;
  predictedDemand: number;
  confidence: number;
  recommendedOrderQty: number;
  daysUntilStockout: number;
  /** True when no real stock movement backs this forecast. */
  needsData?: boolean;
}

interface AutomatedOrder {
  id: string;
  product_name: string;
  quantity: number;
  supplier_name: string;
  estimated_cost: number;
  status: "pending" | "approved" | "ordered" | "received";
  created_at: string;
}

const EnhancedInventoryManagement: React.FC = () => {
  const { currentStation } = useStations();
  const stationId = currentStation?.id || "";
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [forecasts, setForecasts] = useState<DemandForecast[]>([]);
  const [automatedOrders, setAutomatedOrders] = useState<AutomatedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [orderQuantity, setOrderQuantity] = useState(0);
  const [autoReorderEnabled, setAutoReorderEnabled] = useState(true);

  // Fetch inventory data
  const fetchInventory = useCallback(async () => {
    const cacheKey = `inventory_${stationId}`;
    const cached = dataCache.get(cacheKey);

    if (cached) {
      setInventory(cached.inventory);
      setForecasts(cached.forecasts);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("inventory")
        .select(
          `
          *,
          suppliers (name)
        `,
        )
        .eq("station_id", stationId)
        .order("product_name");

      if (error) throw error;

      const processedData = data || [];

      // Real movement history backs the forecast (see generateDemandForecasts).
      const { data: movements, error: movementError } = await supabase
        .from("inventory_transactions")
        .select("product_id, quantity_change, transaction_type, created_at")
        .eq("station_id", stationId)
        .gte(
          "created_at",
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        );
      if (movementError) {
        console.warn(
          "EnhancedInventory: movement history unavailable, forecasts will report no data:",
          movementError.message,
        );
      }

      const generatedForecasts = generateDemandForecasts(
        processedData,
        movements ?? [],
      );

      setInventory(processedData);
      setForecasts(generatedForecasts);

      dataCache.set(
        cacheKey,
        {
          inventory: processedData,
          forecasts: generatedForecasts,
        },
        300000,
      );

      // Auto-generate orders if enabled
      if (autoReorderEnabled) {
        generateAutomatedOrders(processedData, generatedForecasts);
      }
    } catch (error) {
      console.error("Error fetching inventory:", error);
      toast.error("Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [stationId, autoReorderEnabled]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  /**
   * Demand forecast derived from REAL stock movement.
   *
   * This previously used `Math.random()` for the average daily usage and the
   * confidence score, so every refresh showed different, invented numbers.
   * It now averages the actual `inventory_transactions` draw-down recorded for
   * each product over the last 30 days and reports a confidence derived from
   * how many movements actually back that average. A product with no recorded
   * movement gets `needsData: true` instead of a fabricated forecast.
   */
  const generateDemandForecasts = useCallback(
    (
      items: InventoryItem[],
      movements: Array<{
        product_id: string;
        quantity_change: number;
        transaction_type?: string;
        created_at: string;
      }>,
    ): DemandForecast[] => {
      const WINDOW_DAYS = 30;
      const now = Date.now();
      const windowStart = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;

      // Aggregate recorded OUTBOUND movement per product.
      const usage = new Map<string, { total: number; samples: number }>();
      for (const m of movements) {
        if (!m?.product_id) continue;
        if (new Date(m.created_at).getTime() < windowStart) continue;
        const outbound =
          m.quantity_change < 0 ||
          m.transaction_type === "sale" ||
          m.transaction_type === "wastage";
        if (!outbound) continue;
        const entry = usage.get(m.product_id) ?? { total: 0, samples: 0 };
        entry.total += Math.abs(Number(m.quantity_change) || 0);
        entry.samples += 1;
        usage.set(m.product_id, entry);
      }

      return items.map((item) => {
        const agg = usage.get(item.id);
        const observed = agg?.total ?? 0;
        const avgDailySales = observed / WINDOW_DAYS;

        if (!agg || observed <= 0) {
          // No real movement on record — say so rather than invent a number.
          return {
            productId: item.id,
            predictedDemand: 0,
            confidence: 0,
            recommendedOrderQty: Math.max(
              0,
              item.min_stock - item.current_stock,
            ),
            daysUntilStockout: item.current_stock > 0 ? Infinity : 0,
            needsData: true,
          };
        }

        const predictedDemand = Math.round(observed);
        const daysUntilStockout = Math.round(item.current_stock / avgDailySales);
        const recommendedOrderQty = Math.max(
          0,
          predictedDemand - item.current_stock + item.min_stock,
        );
        // More recorded movements → more trustworthy average. Capped at 95.
        const confidence = Math.min(95, Math.round(40 + agg.samples * 3));

        return {
          productId: item.id,
          predictedDemand,
          confidence,
          recommendedOrderQty,
          daysUntilStockout,
          needsData: false,
        };
      });
    },
    [],
  );

  // Generate automated purchase orders
  const generateAutomatedOrders = useCallback(
    (items: InventoryItem[], forecasts: DemandForecast[]) => {
      const newOrders: AutomatedOrder[] = [];

      items.forEach((item, index) => {
        const forecast = forecasts[index];
        if (!forecast || forecast.needsData) return;

        // Auto-order if stock is below minimum or will stock out within 7 days
        if (
          item.current_stock < item.min_stock ||
          forecast.daysUntilStockout < 7
        ) {
          newOrders.push({
            id: crypto.randomUUID(),
            product_name: item.product_name,
            quantity: forecast.recommendedOrderQty,
            supplier_name: "Auto-selected Supplier",
            estimated_cost: forecast.recommendedOrderQty * item.unit_price,
            status: "pending",
            created_at: new Date().toISOString(),
          });
        }
      });

      setAutomatedOrders(newOrders);
    },
    [],
  );

  // Filter inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch =
        item.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [inventory, searchQuery, selectedCategory]);

  // Get categories
  const categories = useMemo(() => {
    const cats = new Set(inventory.map((i) => i.category));
    return ["all", ...Array.from(cats)];
  }, [inventory]);

  // Calculate inventory metrics
  const inventoryMetrics = useMemo(() => {
    const totalItems = inventory.length;
    const lowStockItems = inventory.filter(
      (i) => i.current_stock < i.min_stock,
    ).length;
    const outOfStockItems = inventory.filter(
      (i) => i.current_stock === 0,
    ).length;
    const overStockItems = inventory.filter(
      (i) => i.current_stock > i.max_stock,
    ).length;
    const totalValue = inventory.reduce(
      (sum, i) => sum + i.current_stock * i.unit_price,
      0,
    );

    return {
      totalItems,
      lowStockItems,
      outOfStockItems,
      overStockItems,
      totalValue,
      healthScore:
        Math.round(
          ((totalItems - lowStockItems - outOfStockItems) / totalItems) * 100,
        ) || 0,
    };
  }, [inventory]);

  // Handle order placement
  const handlePlaceOrder = useCallback(async () => {
    if (!selectedItem || orderQuantity <= 0) {
      toast.error("Invalid order quantity");
      return;
    }

    try {
      const orderData = {
        station_id: stationId,
        product_id: selectedItem.id,
        quantity: orderQuantity,
        unit_price: selectedItem.unit_price,
        total_cost: orderQuantity * selectedItem.unit_price,
        status: "ordered",
        ordered_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("purchase_orders")
        .insert(orderData);

      if (error) throw error;

      toast.success("Purchase order created successfully!");
      setIsOrderDialogOpen(false);
      setOrderQuantity(0);
      setSelectedItem(null);
      fetchInventory();
    } catch (error) {
      console.error("Error creating order:", error);
      toast.error("Failed to create order");
    }
  }, [selectedItem, orderQuantity, stationId, fetchInventory]);

  const openOrderDialog = (item: InventoryItem, suggestedQty?: number) => {
    setSelectedItem(item);
    setOrderQuantity(suggestedQty || item.min_stock * 2);
    setIsOrderDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading inventory...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Enhanced Inventory Management</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={autoReorderEnabled ? "default" : "outline"}
            onClick={() => setAutoReorderEnabled(!autoReorderEnabled)}
          >
            <Zap className="w-4 h-4 mr-2" />
            Auto-Reorder: {autoReorderEnabled ? "ON" : "OFF"}
          </Button>
          <Button onClick={fetchInventory}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="w-4 h-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {inventoryMetrics.totalItems}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {inventoryMetrics.lowStockItems}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {inventoryMetrics.outOfStockItems}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Over Stock</CardTitle>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {inventoryMetrics.overStockItems}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Health Score</CardTitle>
            <CheckCircle className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {inventoryMetrics.healthScore}%
            </div>
            <Progress value={inventoryMetrics.healthScore} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Demand forecast — derived from REAL recorded stock movement. Shown
          only for products that actually have movement history, because a
          forecast without data would be an invented number. */}
      {forecasts.some((f) => !f.needsData) ? (
        <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-indigo-600" />
              Demand Forecasting
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                (from recorded stock movement, last 30 days)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {forecasts
                .filter((f) => !f.needsData)
                .slice(0, 3)
                .map((forecast, idx) => {
                const item = inventory.find((i) => i.id === forecast.productId);
                return (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-800 p-4 rounded-lg"
                  >
                    <div className="font-medium mb-2">{item?.product_name}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                      <p>
                        Predicted Demand:{" "}
                        <span className="font-semibold">
                          {forecast.predictedDemand} units/month
                        </span>
                      </p>
                      <p>
                        Confidence:{" "}
                        <span className="font-semibold">
                          {forecast.confidence}%
                        </span>
                      </p>
                      <p>
                        Days to Stockout:{" "}
                        <span
                          className={`font-semibold ${forecast.daysUntilStockout < 7 ? "text-red-600" : "text-green-600"}`}
                        >
                          {forecast.daysUntilStockout} days
                        </span>
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="w-full mt-3"
                      onClick={() =>
                        openOrderDialog(item!, forecast.recommendedOrderQty)
                      }
                    >
                      Order {forecast.recommendedOrderQty} Units
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Filters */}
      <div className="flex gap-2">
        <Input
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat} className="capitalize">
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Min/Max</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.map((item) => {
                const stockStatus =
                  item.current_stock === 0
                    ? "out_of_stock"
                    : item.current_stock < item.min_stock
                      ? "low_stock"
                      : item.current_stock > item.max_stock
                        ? "over_stock"
                        : "in_stock";

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.product_name}
                    </TableCell>
                    <TableCell>{item.sku}</TableCell>
                    <TableCell className="capitalize">
                      {item.category}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{item.current_stock}</span>
                        {stockStatus === "low_stock" && (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        )}
                        {stockStatus === "out_of_stock" && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.min_stock} / {item.max_stock}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          stockStatus === "out_of_stock"
                            ? "destructive"
                            : stockStatus === "low_stock"
                              ? "warning"
                              : stockStatus === "over_stock"
                                ? "secondary"
                                : "default"
                        }
                      >
                        {stockStatus.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openOrderDialog(item)}
                      >
                        Reorder
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Order Dialog */}
      <Dialog open={isOrderDialogOpen} onOpenChange={setIsOrderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place Purchase Order</DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4 py-4">
              <div>
                <Label>Product</Label>
                <div className="font-medium mt-1">
                  {selectedItem.product_name}
                </div>
              </div>

              <div>
                <Label>Current Stock</Label>
                <div className="font-medium mt-1">
                  {selectedItem.current_stock} units
                </div>
              </div>

              <div>
                <Label htmlFor="quantity">Order Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  value={orderQuantity}
                  onChange={(e) =>
                    setOrderQuantity(parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Estimated Cost</Label>
                <div className="font-medium text-green-600 mt-1">
                  {formatCurrency(orderQuantity * selectedItem.unit_price)}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOrderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handlePlaceOrder}>Place Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EnhancedInventoryManagement;
