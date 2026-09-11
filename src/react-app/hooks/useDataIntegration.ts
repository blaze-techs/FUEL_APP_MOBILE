import { useCallback, useEffect } from "react";

// ============================================================
// useDataIntegration - Cross-tab data synchronization
// Links all components so data flows seamlessly across tabs
// ============================================================

interface SaleEvent {
  fuelType: string; // any canonical fuel code (PMS, AGO, IK, LPG, VPW, etc.)
  quantity: number; // liters
  amount: number;
  customerName?: string;
  customerPhone?: string;
  timestamp: string;
}

interface DeliveryEvent {
  fuelType: string; // any canonical fuel code
  quantity: number; // liters
  supplier: string;
  timestamp: string;
}

interface TankUpdateEvent {
  pmsTankClosing: number;
  agoTankClosing: number;
  timestamp: string;
}

type TankMap = Record<string, number>;

export function useDataIntegration(stationId: string) {
  const STORAGE_PREFIX = `fuelpro_${stationId}`;

  // Record a fuel sale - triggers inventory update, customer loyalty, tank levels
  const recordSale = useCallback(
    (sale: SaleEvent) => {
      // 1. Update tank levels (dynamic — supports any fuel type code)
      let currentTanks: TankMap = {};
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}_tanks`);
        if (stored) currentTanks = JSON.parse(stored);
      } catch {
        /* Use defaults */
      }
      const ft = sale.fuelType || "PMS";
      currentTanks[ft] = Math.max(0, (currentTanks[ft] || 0) - sale.quantity);
      localStorage.setItem(
        `${STORAGE_PREFIX}_tanks`,
        JSON.stringify(currentTanks),
      );

      // 2. Award loyalty points if customer identified
      if (sale.customerName && sale.customerPhone) {
        const points = Math.floor(sale.amount / 100); // 1 point per 100 spent
        awardLoyaltyPoints(sale.customerPhone, points, sale.amount);
      }

      // 3. Update daily sales summary (dynamic per-fuel-type)
      const today = new Date().toISOString().split("T")[0];
      const dailyKey = `${STORAGE_PREFIX}_daily_${today}`;
      let daily: Record<string, number> = { transactions: 0 };
      try {
        const stored = localStorage.getItem(dailyKey);
        if (stored) daily = JSON.parse(stored);
      } catch {
        /* Use defaults */
      }
      const qtyKey = `${ft}Qty`;
      const revKey = `${ft}Revenue`;
      daily[qtyKey] = (daily[qtyKey] || 0) + sale.quantity;
      daily[revKey] = (daily[revKey] || 0) + sale.amount;
      daily.transactions = (daily.transactions || 0) + 1;
      localStorage.setItem(dailyKey, JSON.stringify(daily));

      // 4. Log to audit trail
      logAudit(
        "sale",
        `Sold ${sale.quantity}L of ${ft} for ${sale.amount}`,
        sale,
      );

      // 5. Dispatch event for real-time updates
      window.dispatchEvent(new CustomEvent("fuelpro-sale", { detail: sale }));
    },
    [STORAGE_PREFIX],
  );

  // Record fuel delivery - updates tank levels
  const recordDelivery = useCallback(
    (delivery: DeliveryEvent) => {
      let currentTanks: TankMap = {};
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}_tanks`);
        if (stored) currentTanks = JSON.parse(stored);
      } catch {
        /* Use defaults */
      }
      const ft = delivery.fuelType || "PMS";
      currentTanks[ft] = (currentTanks[ft] || 0) + delivery.quantity;
      localStorage.setItem(
        `${STORAGE_PREFIX}_tanks`,
        JSON.stringify(currentTanks),
      );

      logAudit(
        "inventory",
        `Received ${delivery.quantity}L of ${ft} from ${delivery.supplier}`,
        delivery,
      );
      window.dispatchEvent(
        new CustomEvent("fuelpro-delivery", { detail: delivery }),
      );
    },
    [STORAGE_PREFIX],
  );

  // Award loyalty points
  const awardLoyaltyPoints = useCallback(
    (phone: string, points: number, amount: number) => {
      let customers: any[] = [];
      try {
        const stored = localStorage.getItem("fuelpro_customers");
        if (stored) customers = JSON.parse(stored);
        const idx = customers.findIndex((c: any) => c.phone === phone);
        if (idx >= 0) {
          customers[idx].loyaltyPoints =
            (customers[idx].loyaltyPoints || 0) + points;
          customers[idx].totalSpent = (customers[idx].totalSpent || 0) + amount;
          customers[idx].visits = (customers[idx].visits || 0) + 1;
          customers[idx].lastVisit = new Date().toISOString().split("T")[0];
          // Update tier
          const totalPts = customers[idx].loyaltyPoints;
          customers[idx].tier =
            totalPts >= 10000
              ? "Platinum"
              : totalPts >= 5000
                ? "Gold"
                : totalPts >= 1000
                  ? "Silver"
                  : "Bronze";
          localStorage.setItem("fuelpro_customers", JSON.stringify(customers));
          window.dispatchEvent(
            new CustomEvent("fuelpro-loyalty-update", {
              detail: { phone, points },
            }),
          );
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Update tank levels from dip measurement
  const updateTankLevels = useCallback(
    (update: TankUpdateEvent) => {
      // Merge into the dynamic tank map (preserve other fuel types)
      let currentTanks: TankMap = {};
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}_tanks`);
        if (stored) currentTanks = JSON.parse(stored);
      } catch {
        /* Use defaults */
      }
      currentTanks.PMS = update.pmsTankClosing;
      currentTanks.AGO = update.agoTankClosing;
      currentTanks.timestamp = update.timestamp as unknown as number;
      localStorage.setItem(
        `${STORAGE_PREFIX}_tanks`,
        JSON.stringify(currentTanks),
      );
      const fuelSummary = Object.entries(currentTanks)
        .filter(([k]) => k !== "timestamp")
        .map(([k, v]) => `${k}=${v}L`)
        .join(", ");
      logAudit("inventory", `Tank levels updated: ${fuelSummary}`, update);
      window.dispatchEvent(
        new CustomEvent("fuelpro-tank-update", { detail: update }),
      );
    },
    [STORAGE_PREFIX],
  );

  // Record credit sale
  const recordCreditSale = useCallback(
    (accountId: string, amount: number, description: string) => {
      try {
        let accounts: any[] = [];
        try {
          const stored = localStorage.getItem("fuelpro_credit_accounts");
          if (stored) accounts = JSON.parse(stored);
        } catch {
          /* Use empty array */
        }
        const idx = accounts.findIndex((a: any) => a.id === accountId);
        if (idx >= 0) {
          accounts[idx].balanceUsed = (accounts[idx].balanceUsed || 0) + amount;
          accounts[idx].totalPurchases =
            (accounts[idx].totalPurchases || 0) + amount;
          localStorage.setItem(
            "fuelpro_credit_accounts",
            JSON.stringify(accounts),
          );

          // Also record transaction
          let txs: any[] = [];
          try {
            const storedTx = localStorage.getItem("fuelpro_credit_tx");
            if (storedTx) txs = JSON.parse(storedTx);
          } catch {
            /* Use empty array */
          }
          txs.unshift({
            id: `ctx_${Date.now()}`,
            accountId,
            type: "purchase",
            amount,
            description,
            date: new Date().toISOString(),
            recordedBy: "System",
          });
          localStorage.setItem(
            "fuelpro_credit_tx",
            JSON.stringify(txs.slice(0, 200)),
          );

          logAudit(
            "payment",
            `Credit sale: ${amount} to ${accounts[idx].customerName}`,
            { accountId, amount },
          );
          window.dispatchEvent(
            new CustomEvent("fuelpro-credit-update", {
              detail: { accountId, amount },
            }),
          );
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Record shift activity
  const recordShiftActivity = useCallback(
    (
      employeeId: string,
      action: "checkin" | "checkout",
      pumpAssignment?: string,
    ) => {
      try {
        let shifts: any[] = [];
        try {
          const stored = localStorage.getItem("fuelpro_shifts");
          if (stored) shifts = JSON.parse(stored);
        } catch {
          /* Use empty array */
        }
        const today = new Date().toISOString().split("T")[0];

        if (action === "checkin") {
          let employees: any[] = [];
          try {
            const storedEmp = localStorage.getItem("fuelpro_employees");
            if (storedEmp) employees = JSON.parse(storedEmp);
          } catch {
            /* Use empty array */
          }
          const emp = employees.find((e: any) => e.id === employeeId);
          shifts.unshift({
            id: `shift_${Date.now()}`,
            employeeName: emp?.name || "Unknown",
            role: emp?.role || "Staff",
            date: today,
            startTime: new Date().toTimeString().slice(0, 5),
            endTime: "",
            shiftType: "morning",
            pumpAssigned: pumpAssignment || "Any",
            status: "active",
            notes: "",
            checkIn: new Date().toISOString(),
            employeeId,
          } as any);
        } else {
          const activeShift = shifts.find(
            (s: any) => s.employeeId === employeeId && s.status === "active",
          );
          if (activeShift) {
            activeShift.status = "completed";
            activeShift.checkOut = new Date().toISOString();
          }
        }
        localStorage.setItem("fuelpro_shifts", JSON.stringify(shifts));
        window.dispatchEvent(
          new CustomEvent("fuelpro-shift-update", {
            detail: { employeeId, action },
          }),
        );
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Record inventory adjustment
  const recordInventoryAdjustment = useCallback(
    (itemId: string, quantity: number, type: "in" | "out", reason: string) => {
      try {
        let items: any[] = [];
        try {
          const stored = localStorage.getItem("fuelpro_inventory");
          if (stored) items = JSON.parse(stored);
        } catch {
          /* Use empty array */
        }
        const idx = items.findIndex((i: any) => i.id === itemId);
        if (idx >= 0) {
          if (type === "in") items[idx].quantity += quantity;
          else
            items[idx].quantity = Math.max(0, items[idx].quantity - quantity);
          items[idx].lastRestocked = new Date().toISOString().split("T")[0];
          localStorage.setItem("fuelpro_inventory", JSON.stringify(items));

          // Log movement
          let movements: any[] = [];
          try {
            const storedMov = localStorage.getItem(
              "fuelpro_inventory_movements",
            );
            if (storedMov) movements = JSON.parse(storedMov);
          } catch {
            /* Use empty array */
          }
          movements.unshift({
            id: `mov_${Date.now()}`,
            itemId,
            type,
            quantity,
            reason,
            timestamp: new Date().toISOString(),
            user: "Current User",
          });
          localStorage.setItem(
            "fuelpro_inventory_movements",
            JSON.stringify(movements.slice(0, 200)),
          );

          logAudit(
            "inventory",
            `${type === "in" ? "Stock in" : "Stock out"}: ${quantity} x ${items[idx].name} (${reason})`,
            { itemId, quantity, type },
          );
          window.dispatchEvent(
            new CustomEvent("fuelpro-inventory-update", {
              detail: { itemId, quantity, type },
            }),
          );
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Get daily summary
  const getDailySummary = useCallback(
    (date?: string) => {
      const d = date || new Date().toISOString().split("T")[0];
      let daily = null;
      try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}_daily_${d}`);
        if (stored) daily = JSON.parse(stored);
      } catch {
        /* Return defaults */
      }
      if (!daily) return { transactions: 0 };
      return daily;
    },
    [STORAGE_PREFIX],
  );

  // Get current tank levels
  const getTankLevels = useCallback(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}_tanks`);
      if (stored) return JSON.parse(stored);
    } catch {
      /* Use defaults */
    }
    return {};
  }, [STORAGE_PREFIX]);

  return {
    recordSale,
    recordDelivery,
    recordCreditSale,
    recordShiftActivity,
    recordInventoryAdjustment,
    updateTankLevels,
    getDailySummary,
    getTankLevels,
  };
}

// Helper: log to audit trail
function logAudit(category: string, details: string, data?: any) {
  try {
    const entry = {
      stationId: "default",
      action: category,
      category,
      details,
      user: "System",
      ...(data && { newValue: data }),
    };
    window.dispatchEvent(
      new CustomEvent("fuelpro-audit-log", { detail: entry }),
    );
  } catch {
    /* ignore */
  }
}
