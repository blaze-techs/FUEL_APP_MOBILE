/**
 * Enhanced POS System with Advanced Features
 * Real-time inventory sync, multi-payment support, offline mode, and AI recommendations
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  DollarSign,
  Smartphone,
  QrCode,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import { formatCurrency } from "@/react-app/lib/currency";
import { dataCache } from "@/react-app/lib/enhanced/performance";
import { enhancedSyncService } from "@/react-app/services/enhanced/SyncService";
import { toast } from "sonner";

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  barcode?: string;
  image_url?: string;
}

interface CartItem extends Product {
  quantity: number;
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: React.ReactNode;
  enabled: boolean;
}

const EnhancedPOS: React.FC = () => {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id || "";
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState(0);

  // Payment methods configuration
  const paymentMethods: PaymentMethod[] = useMemo(
    () => [
      {
        id: "cash",
        name: "Cash",
        icon: <DollarSign className="w-5 h-5" />,
        enabled: true,
      },
      {
        id: "card",
        name: "Credit/Debit Card",
        icon: <CreditCard className="w-5 h-5" />,
        enabled: true,
      },
      {
        id: "mpesa",
        name: "M-PESA",
        icon: <Smartphone className="w-5 h-5" />,
        enabled: true,
      },
      {
        id: "qr",
        name: "QR Code",
        icon: <QrCode className="w-5 h-5" />,
        enabled: true,
      },
    ],
    [],
  );

  // Fetch products with caching
  const fetchProducts = useCallback(async () => {
    const cacheKey = `pos_products_${stationId}`;
    const cached = dataCache.get(cacheKey);

    if (cached) {
      setProducts(cached);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("station_id", stationId)
        .order("name");

      if (error) throw error;

      setProducts(data || []);
      dataCache.set(cacheKey, data || [], 300000); // 5 min cache
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error("Failed to load products");
    }
  }, [stationId]);

  useEffect(() => {
    fetchProducts();

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchProducts]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.barcode?.includes(searchQuery);
      const matchesCategory =
        selectedCategory === "all" || product.category === selectedCategory;
      return matchesSearch && matchesCategory && product.stock > 0;
    });
  }, [products, searchQuery, selectedCategory]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category));
    return ["all", ...Array.from(cats)];
  }, [products]);

  // Cart calculations
  const cartTotal = useMemo(() => {
    const subtotal = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const discountAmount = subtotal * (discount / 100);
    return subtotal - discountAmount;
  }, [cart, discount]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Add to cart
  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  // Update quantity
  const updateQuantity = useCallback((productId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.id === productId) {
            const newQty = Math.max(0, item.quantity + delta);
            return { ...item, quantity: newQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0);
    });
  }, []);

  // Remove from cart
  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  }, []);

  // Clear cart
  const clearCart = useCallback(() => {
    setCart([]);
    setDiscount(0);
    setCustomerPhone("");
  }, []);

  // Process sale
  const processSale = useCallback(async () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    setIsProcessing(true);

    try {
      const saleData = {
        station_id: stationId,
        user_id: user?.id,
        total_amount: cartTotal,
        discount_percentage: discount,
        payment_method: paymentMethod,
        customer_phone: customerPhone || null,
        items: cart.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
        })),
        created_at: new Date().toISOString(),
      };

      if (isOnline) {
        // Online mode - save directly to database
        const { error } = await supabase.from("sales").insert(saleData);

        if (error) throw error;

        // Update inventory
        for (const item of cart) {
          await supabase.rpc("update_product_stock", {
            p_product_id: item.id,
            p_quantity_change: -item.quantity,
          });
        }

        toast.success("Sale completed successfully!");
      } else {
        // Offline mode - queue for sync
        await enhancedSyncService.pushChange("sales", "INSERT", saleData);
        toast.success(
          "Sale saved offline. Will sync when connection restored.",
        );
      }

      // Emit analytics event
      enhancedSyncService.emit("sale_completed", {
        amount: cartTotal,
        items: cart.length,
        paymentMethod,
        timestamp: new Date().toISOString(),
      });

      clearCart();
      setIsPaymentDialogOpen(false);
      fetchProducts(); // Refresh product stock
    } catch (error) {
      console.error("Error processing sale:", error);
      toast.error("Failed to process sale. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [
    cart,
    cartTotal,
    discount,
    paymentMethod,
    customerPhone,
    isOnline,
    stationId,
    user,
    clearCart,
    fetchProducts,
  ]);

  // Handle barcode scanner input
  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      const product = products.find((p) => p.barcode === barcode);
      if (product) {
        addToCart(product);
        setSearchQuery("");
        toast.success(`Added ${product.name} to cart`);
      } else {
        toast.error("Product not found");
      }
    },
    [products, addToCart],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // F2 - New sale
      if (e.key === "F2" && !isPaymentDialogOpen) {
        e.preventDefault();
        clearCart();
      }
      // F12 - Complete sale
      if (e.key === "F12" && cart.length > 0 && !isPaymentDialogOpen) {
        e.preventDefault();
        setIsPaymentDialogOpen(true);
      }
      // Escape - Cancel
      if (e.key === "Escape") {
        setIsPaymentDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [cart.length, isPaymentDialogOpen, clearCart]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-140px)]">
      {/* Products Section */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle>Products</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={isOnline ? "default" : "destructive"}>
                {isOnline ? (
                  <Wifi className="w-3 h-3 mr-1" />
                ) : (
                  <WifiOff className="w-3 h-3 mr-1" />
                )}
                {isOnline ? "Online" : "Offline"}
              </Badge>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Input
              placeholder="Search products or scan barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleBarcodeScan(searchQuery)
              }
              className="flex-1"
            />
            <Button onClick={() => setSearchQuery("")} variant="outline">
              Clear
            </Button>
          </div>

          <div className="flex gap-2 mt-2 overflow-x-auto">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className="capitalize whitespace-nowrap"
              >
                {cat}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map((product) => (
              <Card
                key={product.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => addToCart(product)}
              >
                <CardContent className="p-3">
                  <div className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg mb-2 flex items-center justify-center">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <ShoppingCart className="w-8 h-8 text-slate-400" />
                    )}
                  </div>
                  <h3 className="font-medium text-sm truncate">
                    {product.name}
                  </h3>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-green-600 font-bold">
                      {formatCurrency(product.price)}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      Stock: {product.stock}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cart Section */}
      <Card className="w-full lg:w-96 flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="flex justify-between items-center">
            <span>Current Sale</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCart}
              disabled={cart.length === 0}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto space-y-2">
          {cart.length === 0 ? (
            <div className="text-center text-slate-500 py-8">
              <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Cart is empty</p>
              <p className="text-sm">Click products to add them</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatCurrency(item.price)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateQuantity(item.id, -1)}
                  >
                    <Minus className="w-3 h-3" />
                  </Button>
                  <span className="w-6 text-center text-sm">
                    {item.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateQuantity(item.id, 1)}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFromCart(item.id)}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ))
          )}
        </CardContent>

        {/* Cart Summary */}
        <div className="border-t p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Items:</span>
            <span>{cartItemCount}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Discount ({discount}%):</span>
              <span>
                -{formatCurrency(cartTotal * (discount / (100 - discount)))}
              </span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Total:</span>
            <span>{formatCurrency(cartTotal)}</span>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDiscount(discount === 0 ? 10 : 0)}
            >
              {discount === 0 ? "Apply 10% Off" : "Remove Discount"}
            </Button>
            <Button
              className="flex-1"
              onClick={() => setIsPaymentDialogOpen(true)}
              disabled={cart.length === 0}
            >
              Checkout
            </Button>
          </div>

          <p className="text-xs text-center text-slate-500 mt-2">
            Press F12 to checkout quickly
          </p>
        </div>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Sale</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-2xl font-bold text-center">
              {formatCurrency(cartTotal)}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.map((method) => (
                  <Button
                    key={method.id}
                    variant={
                      paymentMethod === method.id ? "default" : "outline"
                    }
                    className="flex items-center gap-2"
                    onClick={() => setPaymentMethod(method.id)}
                    disabled={!method.enabled}
                  >
                    {method.icon}
                    {method.name}
                  </Button>
                ))}
              </div>
            </div>

            {paymentMethod === "mpesa" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Customer Phone (Optional)
                </label>
                <Input
                  placeholder="+254 XXX XXX XXX"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  type="tel"
                />
              </div>
            )}

            {!isOnline && (
              <Alert variant="warning">
                <AlertDescription>
                  You're offline. This sale will be synced when connection is
                  restored.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPaymentDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={processSale} disabled={isProcessing}>
              {isProcessing ? "Processing..." : "Complete Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EnhancedPOS;
