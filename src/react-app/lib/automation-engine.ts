/**
 * automation-engine.ts
 * Central automation "brain" for FuelPro Mobile.
 *
 * Watches a stream of domain events and reacts automatically: updating
 * dependent data, creating reorder suggestions, refreshing dashboards,
 * recording inventory transactions when stock is edited inline, etc.
 *
 * Everything is cloud-backed: automation preferences + logs sync across
 * devices via cloudStorageService so the "brain" behaves identically
 * everywhere.
 */

import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { supabase } from "@/supabase/client";

// ─── Event Bus ────────────────────────────────────────────────────────────

export type DomainEvent =
  | { type: "product:created"; productId: string; stationId: string; data: any }
  | {
      type: "product:updated";
      productId: string;
      stationId: string;
      data: any;
      prev?: any;
    }
  | { type: "product:deleted"; productId: string; stationId: string }
  | {
      type: "stock:adjusted";
      productId: string;
      stationId: string;
      newQty: number;
      reason: string;
    }
  | {
      type: "stock:transfer";
      productId: string;
      fromStationId: string;
      toStationId: string;
      qty: number;
    }
  | { type: "stock:wastage"; productId: string; stationId: string; qty: number }
  | { type: "sale:completed"; stationId: string; total: number; items: any[] }
  | {
      type: "expense:created";
      stationId: string;
      amount: number;
      category: string;
    }
  | {
      type: "price:changed";
      stationId: string;
      fuelType: string;
      newPrice: number;
    }
  | { type: "shift:opened"; stationId: string; shiftId: string }
  | { type: "shift:closed"; stationId: string; shiftId: string; totals: any }
  | { type: "station:switched"; stationId: string };

type EventHandler = (event: DomainEvent) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();
const wildcardHandlers = new Set<EventHandler>();

export function on(pattern: string, handler: EventHandler): () => void {
  if (pattern === "*") {
    wildcardHandlers.add(handler);
    return () => wildcardHandlers.delete(handler);
  }
  let set = handlers.get(pattern);
  if (!set) {
    set = new Set();
    handlers.set(pattern, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function emit(event: DomainEvent): void {
  const prefix = event.type.split(":")[0];
  const exact = handlers.get(event.type);
  const prefixSet = handlers.get(`${prefix}:*`);
  // Fire-and-forget async handlers, but log errors
  const fire = async (h: EventHandler) => {
    try {
      await h(event);
    } catch (err) {
      console.error(`[automation] handler error for ${event.type}:`, err);
    }
  };
  exact?.forEach(fire);
  prefixSet?.forEach(fire);
  wildcardHandlers.forEach(fire);
  // persist log (fire-and-forget)
  logEvent(event).catch(() => {});
  // REAL webhook delivery: fire matching Integration Hub webhooks for this
  // event (fire-and-forget; the dynamic import avoids a load-time cycle).
  const stationId = (event as { stationId?: string }).stationId;
  import("@/react-app/lib/webhook-dispatcher")
    .then((m) => m.dispatchAutomationWebhooks(event, stationId))
    .catch(() => {});
}

// ─── Automation Preferences (cloud-backed) ───────────────────────────────

export interface AutomationPreferences {
  autoReorderEnabled: boolean;
  autoReorderThresholdMultiplier: number; // e.g. 1.0 = reorder at reorder_level
  autoRecordStockOnProductEdit: boolean; // create inventory_transactions row on inline stock edits
  autoRefreshDashboard: boolean;
  autoCreateExpenseOnReorder: boolean;
  autoSyncPricesAcrossTabs: boolean;
  autoLogShiftTotals: boolean;
  notifications: {
    lowStock: boolean;
    reorderCreated: boolean;
    priceChanges: boolean;
    shiftClosed: boolean;
  };
  customRules: AutomationRule[];
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string; // event type pattern
  condition?: string; // simple expression
  action: string; // "notify" | "create_expense" | "adjust_stock" | "create_reorder"
  params: Record<string, any>;
  enabled: boolean;
}

const DEFAULT_PREFS: AutomationPreferences = {
  autoReorderEnabled: true,
  autoReorderThresholdMultiplier: 1.0,
  autoRecordStockOnProductEdit: true,
  autoRefreshDashboard: true,
  autoCreateExpenseOnReorder: false,
  autoSyncPricesAcrossTabs: true,
  autoLogShiftTotals: true,
  notifications: {
    lowStock: true,
    reorderCreated: true,
    priceChanges: true,
    shiftClosed: true,
  },
  customRules: [],
};

const PREFS_KEY = "automation_prefs";

let cachedPrefs: AutomationPreferences | null = null;

export async function getAutomationPrefs(): Promise<AutomationPreferences> {
  if (cachedPrefs) return cachedPrefs;
  const data = await cloudStorageService.get<AutomationPreferences>(PREFS_KEY);
  const prefs = data
    ? {
        ...DEFAULT_PREFS,
        ...data,
        notifications: {
          ...DEFAULT_PREFS.notifications,
          ...(data.notifications || {}),
        },
      }
    : DEFAULT_PREFS;
  cachedPrefs = prefs;
  return prefs;
}

export async function saveAutomationPrefs(
  prefs: AutomationPreferences,
): Promise<void> {
  cachedPrefs = prefs;
  await cloudStorageService.set(PREFS_KEY, prefs);
  emit({ type: "station:switched", stationId: "" }); // nudge listeners to re-evaluate
}

// ─── Event Log (cloud-backed) ─────────────────────────────────────────────

const LOG_KEY = "automation_log";
const MAX_LOG_ENTRIES = 200;

export interface AutomationLogEntry {
  id: string;
  timestamp: number;
  eventType: string;
  summary: string;
  stationId?: string;
  actionTaken?: string;
}

/**
 * Convert a domain event into a short, human-readable summary shown in the
 * Activity Log. Never falls back to raw JSON.
 */
function summarizeEvent(event: DomainEvent): string {
  switch (event.type) {
    case "product:created":
      return `Product created (ID ${event.productId.slice(0, 8)})`;
    case "product:updated":
      return `Product updated (ID ${event.productId.slice(0, 8)})`;
    case "product:deleted":
      return `Product deleted (ID ${event.productId.slice(0, 8)})`;
    case "stock:adjusted":
      return `Stock adjusted: ${event.newQty} units — ${event.reason || "adjustment"}`;
    case "stock:transfer":
      return `Stock transfer of ${event.qty} units`;
    case "stock:wastage":
      return `Wastage of ${event.qty} units recorded`;
    case "sale:completed":
      return `Sale completed — ${event.total} total (${event.items?.length ?? 0} items)`;
    case "expense:created":
      return `Expense recorded — ${event.amount} (${event.category || "uncategorized"})`;
    case "price:changed":
      return `Price for ${event.fuelType} changed to ${event.newPrice}`;
    case "shift:opened":
      return `Shift opened`;
    case "shift:closed":
      return `Shift closed`;
    case "station:switched":
      return `Station switched`;
    default:
      return (event as DomainEvent).type.replace(":", " ");
  }
}

async function logEvent(event: DomainEvent): Promise<void> {
  const entry: AutomationLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    eventType: event.type,
    summary: summarizeEvent(event),
    stationId: "stationId" in event ? event.stationId : undefined,
  };
  const log =
    (await cloudStorageService.get<AutomationLogEntry[]>(LOG_KEY)) || [];
  log.unshift(entry);
  if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
  await cloudStorageService.set(LOG_KEY, log);
}

export async function getAutomationLog(): Promise<AutomationLogEntry[]> {
  return (await cloudStorageService.get<AutomationLogEntry[]>(LOG_KEY)) || [];
}

export async function clearAutomationLog(): Promise<void> {
  await cloudStorageService.set(LOG_KEY, []);
}

// ─── Built-in Automation Reactions ────────────────────────────────────────

/**
 * Register the default automation reactions. Called once at app boot.
 * Each reaction checks the user's preferences before acting.
 */
export async function initAutomationEngine(
  stationId: string | null,
): Promise<void> {
  const prefs = await getAutomationPrefs();

  // ── Reaction 1: When a product is created/updated with stock, auto-record
  //    an inventory_transaction if the user enabled it.
  if (prefs.autoRecordStockOnProductEdit) {
    on("product:created", async (event) => {
      const e = event as Extract<DomainEvent, { type: "product:created" }>;
      if (e.data.stock_quantity > 0) {
        await recordInventoryTxn(
          e.stationId,
          e.productId,
          0,
          e.data.stock_quantity,
          "Initial stock (auto)",
        );
      }
    });

    on("product:updated", async (event) => {
      const e = event as Extract<DomainEvent, { type: "product:updated" }>;
      const prevQty = e.prev?.stock_quantity ?? 0;
      const newQty = e.data.stock_quantity ?? 0;
      if (newQty !== prevQty) {
        await recordInventoryTxn(
          e.stationId,
          e.productId,
          prevQty,
          newQty,
          "Product edit (auto)",
        );
      }
    });
  }

  // ── Reaction 2: Auto-reorder when stock drops below threshold
  on("stock:adjusted", async (event) => {
    if (!prefs.autoReorderEnabled) return;
    const e = event as Extract<DomainEvent, { type: "stock:adjusted" }>;
    await checkAndCreateReorder(e.stationId, e.productId, e.newQty, prefs);
  });

  on("product:updated", async (event) => {
    if (!prefs.autoReorderEnabled) return;
    const e = event as Extract<DomainEvent, { type: "product:updated" }>;
    await checkAndCreateReorder(
      e.stationId,
      e.productId,
      e.data.stock_quantity ?? 0,
      prefs,
    );
  });

  // ── Reaction 3: When a sale completes, emit a stock adjustment for each item
  //    so inventory + reorder logic fires automatically.
  on("sale:completed", async (event) => {
    const e = event as Extract<DomainEvent, { type: "sale:completed" }>;
    for (const item of e.items || []) {
      if (item.productId) {
        emit({
          type: "stock:adjusted",
          productId: item.productId,
          stationId: e.stationId,
          newQty: -(item.quantity || 0),
          reason: `Sale (auto)`,
        });
      }
    }
  });

  // ── Reaction 4: Auto-refresh dashboard — broadcast a lightweight event
  //    the dashboard listens to via the event bus (no page reload).
  on("price:changed", async () => {
    if (prefs.autoSyncPricesAcrossTabs) {
      window.dispatchEvent(new CustomEvent("automation:refresh-prices"));
    }
  });
  on("sale:completed", async () => {
    if (prefs.autoRefreshDashboard) {
      window.dispatchEvent(new CustomEvent("automation:refresh-dashboard"));
    }
  });

  // ── Reaction 5: Auto-create expense when a reorder is placed (optional)
  if (prefs.autoCreateExpenseOnReorder) {
    on("stock:*", async (event) => {
      // handled inside checkAndCreateReorder which emits its own events
    });
  }

  console.info("[automation] engine initialized for station", stationId);
}

// ─── Automation Actions ───────────────────────────────────────────────────

async function recordInventoryTxn(
  stationId: string,
  productId: string,
  prevQty: number,
  newQty: number,
  reason: string,
): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const ownerId = userData.user?.id;
    const delta = newQty - prevQty;
    const { error: txnErr } = await supabase
      .from("inventory_transactions")
      .insert({
        station_id: stationId,
        product_id: productId,
        owner_id: ownerId,
        previous_quantity: prevQty,
        new_quantity: newQty,
        quantity_change: delta,
        reason,
        transaction_type: delta >= 0 ? "adjustment_in" : "adjustment_out",
        created_at: new Date().toISOString(),
      });
    if (txnErr) {
      // supabase-js does NOT throw on RLS/constraint failures — it returns
      // { error }. Without this check the audit-trail row is silently lost.
      console.warn(
        "[automation] inventory_transactions insert failed (audited adjustment lost):",
        txnErr.message,
      );
    }
  } catch (err) {
    // Non-fatal — the primary mutation already succeeded
    console.warn("[automation] failed to record inventory transaction:", err);
  }
}

async function checkAndCreateReorder(
  stationId: string,
  productId: string,
  currentQty: number,
  prefs: AutomationPreferences,
): Promise<void> {
  try {
    // Fetch the product to get its reorder_level
    const { data: product } = await supabase
      .from("products")
      .select("name, reorder_level, stock_quantity")
      .eq("id", productId)
      .single();
    if (!product) return;

    const threshold =
      (product.reorder_level || 10) * prefs.autoReorderThresholdMultiplier;
    const effectiveQty =
      currentQty < 0 ? (product.stock_quantity || 0) + currentQty : currentQty;

    if (effectiveQty <= threshold) {
      // Check if there's already a pending reorder for this product
      const existing =
        (await cloudStorageService.get<any[]>("auto_reorders")) || [];
      const hasPending = existing.some(
        (r: any) =>
          r.productId === productId &&
          r.stationId === stationId &&
          r.status === "pending",
      );
      if (hasPending) return;

      const reorder = {
        id: `REO-${Date.now()}`,
        productId,
        stationId,
        productName: product.name,
        currentStock: effectiveQty,
        reorderLevel: product.reorder_level || 10,
        suggestedQty: Math.max(
          (product.reorder_level || 10) * 2 - effectiveQty,
          1,
        ),
        status: "pending",
        createdAt: Date.now(),
      };
      existing.unshift(reorder);
      if (existing.length > 100) existing.length = 100;
      await cloudStorageService.set("auto_reorders", existing);

      if (prefs.notifications.reorderCreated) {
        window.dispatchEvent(
          new CustomEvent("automation:notify", {
            detail: {
              title: "Auto-Reorder Created",
              message: `${product.name} is below reorder level (${effectiveQty} ≤ ${threshold}). Suggested reorder: ${reorder.suggestedQty} units.`,
              type: "reorder",
            },
          }),
        );
      }

      // Optionally auto-create an expense
      if (prefs.autoCreateExpenseOnReorder) {
        emit({
          type: "expense:created",
          stationId,
          amount: reorder.suggestedQty * 10,
          category: "Inventory Reorder (auto)",
        });
      }
    }
  } catch (err) {
    console.warn("[automation] reorder check failed:", err);
  }
}

/**
 * Get all pending auto-generated reorder suggestions.
 */
export async function getAutoReorders(): Promise<any[]> {
  return (await cloudStorageService.get<any[]>("auto_reorders")) || [];
}

/**
 * Mark a reorder as fulfilled (and optionally apply the received quantity).
 */
export async function fulfillReorder(
  reorderId: string,
  receivedQty: number,
): Promise<{ success: boolean; error?: string }> {
  const reorders =
    (await cloudStorageService.get<any[]>("auto_reorders")) || [];
  const idx = reorders.findIndex((r: any) => r.id === reorderId);
  if (idx < 0) return { success: false, error: "Reorder not found" };
  const reorder = reorders[idx];

  // 1) Restock the product so the reorder actually changes inventory.
  // Previously this only flipped the reorder status to "fulfilled" — no
  // stock movement, no inventory_transaction, so the product stayed below
  // the reorder level and the reorder re-appeared immediately.
  try {
    const { data: product, error: pErr } = await supabase
      .from("products")
      .select("stock_quantity, cost_price")
      .eq("id", reorder.productId)
      .eq("station_id", reorder.stationId)
      .single();
    if (pErr || !product) {
      return {
        success: false,
        error: pErr?.message || "Product not found for reorder",
      };
    }
    const newQty = (product.stock_quantity || 0) + receivedQty;
    const { error: upErr } = await supabase
      .from("products")
      .update({ stock_quantity: newQty })
      .eq("id", reorder.productId);
    if (upErr) {
      return { success: false, error: upErr.message };
    }
    // 2) Record an inventory_transaction (restock) for the audit trail.
    // NOTE: inventory_transactions.reference_id is a UUID column, but the
    // auto-reorder id is a string like "REO-1723...". Passing the string id
    // triggers a Postgres 22P02 "invalid input syntax for type uuid" error,
    // which would abort the insert and leave no audit trail. Use the
    // product UUID as reference_id (it IS a valid product row id) and keep
    // the reorder id in the human-readable notes.
    const { data: userData } = await supabase.auth.getUser();
    const ownerId = userData.user?.id;
    const { error: restockErr } = await supabase
      .from("inventory_transactions")
      .insert({
        station_id: reorder.stationId,
        product_id: reorder.productId,
        transaction_type: "restock",
        quantity_change: receivedQty,
        previous_quantity: product.stock_quantity || 0,
        new_quantity: newQty,
        unit_cost: product.cost_price || 0,
        reference_type: "reorder",
        reference_id: reorder.productId, // valid UUID (the product id)
        notes: `Auto-reorder fulfilled (${reorderId})`,
        owner_id: ownerId,
      });
    if (restockErr) {
      // supabase-js does NOT throw on RLS/constraint failures — without this
      // check the restock audit-trail row is silently lost while the stock
      // update above already succeeded.
      console.warn(
        "[automation] restock inventory_transactions insert failed (audit trail lost):",
        restockErr.message,
      );
    }
    // 3) Emit a stock event so listeners (dashboard, reorder check) refresh.
    emit({
      type: "stock:adjusted",
      productId: reorder.productId,
      stationId: reorder.stationId,
      newQty,
      reason: `Reorder fulfilled (${receivedQty} units)`,
    } as any);
  } catch (err: any) {
    console.warn("[automation] fulfillReorder restock failed:", err);
    return {
      success: false,
      error: err?.message || "Failed to restock product",
    };
  }

  // 4) Mark fulfilled.
  reorders[idx].status = "fulfilled";
  reorders[idx].receivedQty = receivedQty;
  reorders[idx].fulfilledAt = Date.now();
  await cloudStorageService.set("auto_reorders", reorders);
  return { success: true };
}

// ─── Helper: emit a domain event from any component ──────────────────────

export const automation = {
  emit,
  on,
  getPrefs: getAutomationPrefs,
  savePrefs: saveAutomationPrefs,
  getLog: getAutomationLog,
  clearLog: clearAutomationLog,
  getReorders: getAutoReorders,
  fulfillReorder,
  init: initAutomationEngine,
};
