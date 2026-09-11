/**
 * NotificationCenter.tsx
 * Aggregates real-time alerts from across the app:
 * - Low stock products (below reorder level)
 * - Overdue credit accounts
 * - Pending/uncompleted shifts
 * - Low tank levels
 * - Unpaid invoices
 * - Expired/expiring access codes
 *
 * Displays in a bell-icon dropdown in the Header.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Bell,
  AlertTriangle,
  TrendingDown,
  Clock,
  FileText,
  Users,
  X,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { normalizeFuelType } from "@/react-app/config/pricing";

interface NotificationItem {
  id: string;
  type: "warning" | "danger" | "info";
  category: "stock" | "credit" | "shift" | "tank" | "invoice" | "access";
  title: string;
  message: string;
  tabId?: string;
  timestamp: number;
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  useEffect(() => {
    async function loadNotifications() {
      setLoading(true);
      try {
        const items: NotificationItem[] = [];
        const now = Date.now();
        const ownerId = cloudStorageService.currentUserIdSync();
        if (!ownerId) {
          setLoading(false);
          return;
        }

        // 1. Low tank levels (from FuelContext state)
        const tankValues = state.fuelTankValuesByType || {};
        const fuelTypes = state.fuelTypes || [];
        for (const ft of fuelTypes) {
          if (!ft.active) continue;
          const canonical =
            normalizeFuelType(ft.localName || ft.name) || ft.code || "";
          const tank = tankValues[canonical];
          if (
            tank &&
            tank.closing !== undefined &&
            tank.opening !== undefined
          ) {
            const capacity = tank.opening || 10000;
            const current = tank.closing || 0;
            const pct = capacity > 0 ? (current / capacity) * 100 : 0;
            if (pct < 25) {
              items.push({
                id: `tank-${canonical}`,
                type: pct < 10 ? "danger" : "warning",
                category: "tank",
                title: `Low Tank: ${ft.localName || canonical}`,
                message: `${current.toLocaleString()}L remaining (${pct.toFixed(0)}% full)`,
                tabId: "sales",
                timestamp: now,
              });
            }
          }
        }

        // 2. Unpaid invoices (from FuelContext state)
        const invoicesRaw = state.invoices || {};
        const invoices: any[] = Array.isArray(invoicesRaw)
          ? invoicesRaw
          : Object.values(invoicesRaw);
        for (const inv of invoices) {
          if (inv.status === "unpaid" || (!inv.status && inv.totalAmount)) {
            const invDate = inv.date ? new Date(inv.date).getTime() : now;
            const daysOverdue = Math.floor(
              (now - invDate) / (1000 * 60 * 60 * 24),
            );
            if (daysOverdue > 7) {
              items.push({
                id: `invoice-${inv.id || inv.invoiceNumber}`,
                type: daysOverdue > 30 ? "danger" : "warning",
                category: "invoice",
                title: `Overdue Invoice: ${inv.invoiceNumber || inv.id}`,
                message: `${inv.customerName || "Unknown"} — ${daysOverdue} days overdue`,
                tabId: "invoice",
                timestamp: invDate,
              });
            }
          }
        }

        // 3. Overdue credit accounts (from cloud)
        try {
          const creditAccounts = await cloudStorageService.get<any[]>(
            "credit_accounts",
            stationId,
          );
          if (Array.isArray(creditAccounts)) {
            for (const acc of creditAccounts) {
              const balance = Number(acc.balance) || 0;
              if (balance > 0) {
                const dueDate = acc.dueDate
                  ? new Date(acc.dueDate).getTime()
                  : 0;
                if (dueDate && dueDate < now) {
                  items.push({
                    id: `credit-${acc.id}`,
                    type: "danger",
                    category: "credit",
                    title: `Overdue Credit: ${acc.name || acc.customerName}`,
                    message: `Balance: ${balance.toLocaleString()} — was due ${new Date(dueDate).toLocaleDateString()}`,
                    tabId: "credit",
                    timestamp: dueDate,
                  });
                }
              }
            }
          }
        } catch {
          // credit accounts may not exist yet
        }

        // 4. Low stock products (from Supabase products table)
        try {
          const { getSupabaseClient } = await import("@/supabase/client");
          const client = getSupabaseClient();
          const { data: products } = await client
            .from("products")
            .select("id, name, stock_quantity, reorder_level, is_active")
            .eq("is_active", true)
            .limit(50);
          if (Array.isArray(products)) {
            for (const p of products) {
              const stock = Number(p.stock_quantity) || 0;
              const reorder = Number(p.reorder_level) || 0;
              if (reorder > 0 && stock <= reorder) {
                items.push({
                  id: `stock-${p.id}`,
                  type: stock === 0 ? "danger" : "warning",
                  category: "stock",
                  title: `Low Stock: ${p.name}`,
                  message: `${stock} units left (reorder at ${reorder})`,
                  tabId: "inventory",
                  timestamp: now,
                });
              }
            }
          }
        } catch {
          // products table may not be accessible
        }

        // 5. Pending shifts (from cloud)
        try {
          const shifts = await cloudStorageService.get<any[]>(
            "shift_data",
            stationId,
          );
          if (Array.isArray(shifts)) {
            for (const shift of shifts) {
              if (shift.status === "scheduled" || shift.status === "active") {
                const shiftDate = shift.startTime
                  ? new Date(shift.startTime).getTime()
                  : 0;
                if (
                  shiftDate &&
                  shiftDate < now &&
                  shift.status === "scheduled"
                ) {
                  items.push({
                    id: `shift-${shift.id}`,
                    type: "info",
                    category: "shift",
                    title: `Overdue Shift: ${shift.employeeName || "Unknown"}`,
                    message: `Was scheduled to start ${new Date(shiftDate).toLocaleDateString()}`,
                    tabId: "team",
                    timestamp: shiftDate,
                  });
                }
              }
            }
          }
        } catch {
          // shift data may not exist
        }

        // Sort by timestamp descending
        items.sort((a, b) => b.timestamp - a.timestamp);
        setNotifications(items);
      } catch {
        // silently fail — notifications are non-critical
      } finally {
        setLoading(false);
      }
    }

    loadNotifications();
    // Refresh every 60 seconds
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [state.fuelTankValuesByType, state.invoices, state.fuelTypes, stationId]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const unreadCount = notifications.length;
  const dangerCount = useMemo(
    () => notifications.filter((n) => n.type === "danger").length,
    [notifications],
  );

  const typeIcon = (category: NotificationItem["category"]) => {
    switch (category) {
      case "stock":
        return <TrendingDown size={16} className="text-orange-500" />;
      case "credit":
        return <AlertTriangle size={16} className="text-red-500" />;
      case "shift":
        return <Clock size={16} className="text-blue-500" />;
      case "tank":
        return <AlertTriangle size={16} className="text-amber-500" />;
      case "invoice":
        return <FileText size={16} className="text-red-500" />;
      case "access":
        return <Users size={16} className="text-indigo-500" />;
    }
  };

  const handleDismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="relative h-9 w-9 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
        aria-label={`Notifications (${unreadCount} unread)`}
        title="Notifications"
      >
        <Bell size={16} className="text-gray-600 dark:text-gray-300" />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${
              dangerCount > 0 ? "bg-red-500" : "bg-amber-500"
            }`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 max-h-[480px] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
              Notifications
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {unreadCount > 0 ? `${unreadCount} active` : "All clear"}
            </span>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell
                  size={32}
                  className="mx-auto mb-2 text-gray-300 dark:text-gray-600"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No active notifications
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  You're all caught up!
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.tabId) switchToTab(n.tabId);
                    setOpen(false);
                  }}
                  className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-gray-700/50 text-left transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {typeIcon(n.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {n.message}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDismiss(n.id, e)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200 dark:hover:bg-white/10"
                    aria-label="Dismiss"
                  >
                    <X size={14} className="text-gray-400" />
                  </button>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <button
                onClick={() => setNotifications([])}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
