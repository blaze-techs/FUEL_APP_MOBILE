/**
 * PurchasesSuppliers.tsx
 * Purchase orders management and suppliers CRUD.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  Package,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  getCurrencySymbol,
  getDetectedCurrency,
  getLocaleForCountry,
} from "../lib/currency";
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  fetchPurchaseOrders,
  fetchSuppliers,
  fetchProducts,
} from "@/react-app/lib/pos-service";

const formatMoney = (amount: number) =>
  new Intl.NumberFormat(getLocaleForCountry(), {
    style: "currency",
    currency: getDetectedCurrency(),
    minimumFractionDigits: 0,
  }).format(amount);

export default function PurchasesSuppliers() {
  const { currentStation } = useStations();
  const [activeTab, setActiveTab] = useState<"orders" | "suppliers">("orders");
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);

  const loadData = useCallback(async () => {
    if (!currentStation?.id) return;
    setLoading(true);
    try {
      const [ordersData, suppliersData] = await Promise.all([
        fetchPurchaseOrders(currentStation.id),
        fetchSuppliers(currentStation.id),
      ]);
      setOrders(ordersData);
      setSuppliers(suppliersData);
    } catch (error) {
      console.error("Failed to load:", error);
    } finally {
      setLoading(false);
    }
  }, [currentStation?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveSupplier = async (data: any) => {
    if (!currentStation?.id) return;
    const { data: userData } = await supabase.auth.getUser();
    try {
      if (editingSupplier) {
        const { error } = await supabase
          .from("suppliers")
          .update(data)
          .eq("id", editingSupplier.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert({
          ...data,
          station_id: currentStation.id,
          owner_id: userData?.user?.id,
        });
        if (error) throw error;
      }
      loadData();
      setShowSupplierModal(false);
      setEditingSupplier(null);
    } catch (error: any) {
      console.error("Failed to save:", error);
      toastError("Failed to save supplier: " + (error?.message || error));
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) {
      toastError("Failed to delete supplier: " + error.message);
      return;
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Purchases & Suppliers
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("orders")}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${activeTab === "orders" ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-white/5 text-gray-500 dark:text-gray-400"}`}
          >
            Orders
          </button>
          <button
            onClick={() => setActiveTab("suppliers")}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${activeTab === "suppliers" ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-white/5 text-gray-500 dark:text-gray-400"}`}
          >
            Suppliers
          </button>
        </div>
      </div>

      {activeTab === "orders" ? (
        <div className="space-y-4">
          <button
            onClick={() => setShowOrderModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl"
          >
            <Plus size={20} /> New Order
          </button>
          <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                    Order #
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                    Supplier
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                    Date
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                    Status
                  </th>
                  <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-500 dark:text-gray-400">
                        No orders
                      </p>
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-white/5 hover:bg-white/5"
                    >
                      <td className="px-4 py-4 text-gray-900 dark:text-white font-medium">
                        {order.order_number}
                      </td>
                      <td className="px-4 py-4 text-gray-300">
                        {order.suppliers?.name || "N/A"}
                      </td>
                      <td className="px-4 py-4 text-gray-300 text-sm">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${order.status === "received" ? "bg-emerald-500/20 text-emerald-400" : order.status === "draft" ? "bg-gray-500/20 text-gray-500 dark:text-gray-400" : "bg-amber-500/20 text-amber-400"}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-amber-400 font-medium">
                        {formatMoney(order.total_amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => {
              setEditingSupplier(null);
              setShowSupplierModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl"
          >
            <Plus size={20} /> Add Supplier
          </button>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">No suppliers</p>
              </div>
            ) : (
              suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="text-gray-900 dark:text-white font-medium">
                        {supplier.name}
                      </h4>
                      <p className="text-gray-500 text-xs">{supplier.email}</p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEditingSupplier(supplier);
                          setShowSupplierModal(true);
                        }}
                        className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteSupplier(supplier.id)}
                        className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    {supplier.phone}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showSupplierModal && (
        <SupplierModal
          supplier={editingSupplier}
          onSave={handleSaveSupplier}
          onClose={() => {
            setShowSupplierModal(false);
            setEditingSupplier(null);
          }}
        />
      )}

      {showOrderModal && (
        <OrderModal
          suppliers={suppliers}
          onClose={() => setShowOrderModal(false)}
          onCreated={() => {
            setShowOrderModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

function SupplierModal({
  supplier,
  onSave,
  onClose,
}: {
  supplier: any;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(
    supplier || { name: "", email: "", phone: "", address: "" },
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md border border-gray-200 dark:border-white/10">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            {supplier ? "Edit Supplier" : "Add Supplier"}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(form);
          }}
          className="p-6 space-y-4"
        >
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Phone
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Address
            </label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} /> Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderModal({
  suppliers,
  onClose,
  onCreated,
}: {
  suppliers: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { currentStation } = useStations();
  const [form, setForm] = useState({ supplierId: "", expectedDate: "" });
  const [products, setProducts] = useState<any[]>([]);
  const [items, setItems] = useState<
    {
      productId: string;
      productName: string;
      quantity: number;
      unitCost: number;
      taxRate: number;
    }[]
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!currentStation?.id) return;
      const data = await fetchProducts(currentStation.id);
      setProducts(data);
    };
    load();
  }, [currentStation?.id]);

  const addItem = (product: any) => {
    if (items.some((i) => i.productId === product.id)) return;
    setItems([
      ...items,
      {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitCost: product.cost_price || 0,
        taxRate: 0,
      },
    ]);
  };

  const updateItem = (index: number, field: string, value: number) => {
    setItems(
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  };

  const removeItem = (index: number) =>
    setItems(items.filter((_, i) => i !== index));

  const total = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

  const handleSubmit = async () => {
    if (!currentStation?.id || !form.supplierId || items.length === 0) return;
    setLoading(true);
    try {
      const result = await createPurchaseOrder(
        currentStation.id,
        form.supplierId,
        items,
        form.expectedDate || null,
      );
      if (!result.success) {
        toastError(
          "Failed to create purchase order: " +
            (result.error || "Unknown error"),
        );
        return;
      }
      onCreated();
    } catch (error: any) {
      console.error("Failed:", error);
      toastError(
        "Failed to create purchase order: " + (error?.message || error),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg border border-gray-200 dark:border-white/10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            New Purchase Order
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Supplier *
            </label>
            <select
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Expected Date
            </label>
            <input
              type="date"
              value={form.expectedDate}
              onChange={(e) =>
                setForm({ ...form, expectedDate: e.target.value })
              }
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-gray-500 dark:text-gray-400 text-xs mb-2 block">
              Add Products
            </label>
            <select
              onChange={(e) => {
                const p = products.find((pr) => pr.id === e.target.value);
                if (p) addItem(p);
              }}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white"
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {formatMoney(p.cost_price)}
                </option>
              ))}
            </select>
          </div>
          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.productId}
                  className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-white/5 rounded-lg"
                >
                  <span className="flex-1 text-gray-900 dark:text-white text-sm">
                    {item.productName}
                  </span>
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(
                        index,
                        "quantity",
                        parseFloat(e.target.value) || 1,
                      )
                    }
                    className="w-20 px-2 py-1 bg-white/10 border border-gray-200 dark:border-white/10 rounded text-gray-900 dark:text-white text-sm"
                    min="1"
                  />
                  <input
                    type="number"
                    value={item.unitCost}
                    onChange={(e) =>
                      updateItem(
                        index,
                        "unitCost",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="w-24 px-2 py-1 bg-white/10 border border-gray-200 dark:border-white/10 rounded text-gray-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={() => removeItem(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-white/10">
                <span className="text-gray-500 dark:text-gray-400">Total</span>
                <span className="text-amber-400 font-bold">
                  {formatMoney(total)}
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !form.supplierId || items.length === 0}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CheckCircle size={18} />
              )}{" "}
              Create Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
