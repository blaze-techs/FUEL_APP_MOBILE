// packages/store/src/useFuelStore.ts
// Cross-Feature Zustand Store with persistence and cross-tab sync

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { getEventBus, Events } from "@/react-app/lib/event-bus";

// ─── Types ───
interface CartItem {
  fuelType: string;
  liters: number;
  pricePerLiter: number;
  stationId: string;
}

interface PriceAlert {
  fuelType: string;
  threshold: number;
  active: boolean;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "danger";
  read: boolean;
  timestamp: string;
}

interface FuelState {
  // Cross-component state
  cart: CartItem[];
  selectedStation: string;
  activeShift: string | null;
  isOnline: boolean;
  notifications: Notification[];
  priceAlerts: PriceAlert[];
  pendingMaintenance: string[];
  recentActions: { action: string; detail: string; timestamp: string }[];

  // Actions
  addToCart: (item: CartItem) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  setSelectedStation: (id: string) => void;
  setActiveShift: (id: string | null) => void;
  setIsOnline: (online: boolean) => void;
  addNotification: (n: {
    title: string;
    message: string;
    severity: Notification["severity"];
  }) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  setPriceAlert: (alert: PriceAlert) => void;
  removePriceAlert: (fuelType: string) => void;
  addPendingMaintenance: (id: string) => void;
  removePendingMaintenance: (id: string) => void;
  logAction: (action: string, detail: string) => void;
}

// ─── Zustand Store ───
export const useFuelStore = create<FuelState>()(
  persist(
    (set, get) => ({
      cart: [],
      selectedStation: "default",
      activeShift: null,
      isOnline: true,
      notifications: [],
      priceAlerts: [],
      pendingMaintenance: [],
      recentActions: [],

      addToCart: (item) => {
        set((state) => ({ cart: [...state.cart, item] }));
        getEventBus().emit(Events.SALE_RECORDED, {
          item,
          cartSize: get().cart.length + 1,
        });
      },

      removeFromCart: (index) =>
        set((state) => ({ cart: state.cart.filter((_, i) => i !== index) })),

      clearCart: () => set({ cart: [] }),

      setSelectedStation: (id) => {
        set({ selectedStation: id });
        getEventBus().emit(Events.STATION_CHANGED, { stationId: id });
      },

      setActiveShift: (id) => set({ activeShift: id }),

      setIsOnline: (online) => set({ isOnline: online }),

      addNotification: (n) => {
        const notif: Notification = {
          ...n,
          read: false,
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          notifications: [notif, ...state.notifications].slice(0, 100),
        }));
      },

      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      clearNotifications: () => set({ notifications: [] }),

      setPriceAlert: (alert) =>
        set((state) => ({
          priceAlerts: [
            ...state.priceAlerts.filter((a) => a.fuelType !== alert.fuelType),
            alert,
          ],
        })),

      removePriceAlert: (fuelType) =>
        set((state) => ({
          priceAlerts: state.priceAlerts.filter((a) => a.fuelType !== fuelType),
        })),

      addPendingMaintenance: (id) =>
        set((state) => ({
          pendingMaintenance: [...state.pendingMaintenance, id],
        })),

      removePendingMaintenance: (id) =>
        set((state) => ({
          pendingMaintenance: state.pendingMaintenance.filter((m) => m !== id),
        })),

      logAction: (action, detail) => {
        const entry = { action, detail, timestamp: new Date().toISOString() };
        set((state) => ({
          recentActions: [entry, ...state.recentActions].slice(0, 50),
        }));
      },
    }),
    {
      name: "fuelpro_store_v2",
      partialize: (state) => ({
        selectedStation: state.selectedStation,
        priceAlerts: state.priceAlerts,
        notifications: state.notifications.filter((n) => !n.read).slice(0, 20),
      }),
      skipHydration: true, // Prevent SSR/hydration mismatches in StrictMode
    },
  ),
);

// ─── Hook to sync BroadcastChannel events into the store ───
export function useFuelStoreSync() {
  const addNotification = useFuelStore((s) => s.addNotification);
  const setIsOnline = useFuelStore((s) => s.setIsOnline);
  const logAction = useFuelStore((s) => s.logAction);

  useEffect(() => {
    const bus = getEventBus();

    const unsubs = [
      bus.on(Events.SALE_RECORDED, (data) => {
        addNotification({
          title: "Sale Recorded",
          message: `${data.item?.fuelType || "Fuel"} sale recorded`,
          severity: "success" as const,
        });
      }),
      bus.on(Events.STATION_CHANGED, (data) => {
        logAction("station_changed", `Switched to station ${data.stationId}`);
      }),
      bus.on(Events.LOCATION_UPDATED, (data) => {
        addNotification({
          title: "Location Updated",
          message: `Now operating in ${data.countryName} (${data.currency})`,
          severity: "info" as const,
        });
      }),
      bus.on(Events.INVENTORY_CHANGED, (data) => {
        if (data?.belowThreshold) {
          addNotification({
            title: "Low Inventory Alert",
            message: `${data.fuelType} stock below threshold (${data.currentStock}L)`,
            severity: "warning" as const,
          });
        }
      }),
      bus.on(Events.MAINTENANCE_DUE, (data) => {
        addNotification({
          title: "Maintenance Due",
          message: `${data.equipmentName} maintenance scheduled`,
          severity: "warning" as const,
        });
      }),
    ];

    // Online/offline detection
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [addNotification, setIsOnline, logAction]);
}
