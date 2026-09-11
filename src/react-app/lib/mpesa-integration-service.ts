/**
 * M-PESA Integration Service
 *
 * Shared data layer that interlinks the Live Transaction tab and the
 * M-PESA Analyzer tab. Both components read from and write to a unified
 * `mpesa_transactions` cloud store, so:
 *   - Real-time STK Push payments (LiveTransaction) appear in the Analyzer.
 *   - Statement-extracted inflows (MPESAAnalyzer) appear in the Live feed.
 *
 * Also provides typed access to the M-PESA Daraja and Kopo Kopo integration
 * configs, so the IntegrationsSettings UI, LiveTransaction, and
 * MPESAAnalyzer all share the same config source of truth.
 */

import cloudStorageService from "@/react-app/lib/cloud-storage-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionOrigin =
  "stk_push" | "statement" | "manual" | "kopokopo";
export type TransactionStatus =
  "completed" | "pending" | "failed" | "cancelled";

export interface UnifiedTransaction {
  id: string;
  transaction_ref: string;
  origin: TransactionOrigin;
  transaction_type: string;
  amount: number;
  currency: string;
  sender_info: string;
  description: string;
  status: TransactionStatus;
  payment_method: string;
  transaction_time: string;
  source_name?: string;
  source_type?: string;
  receipt?: string;
  balance?: number;
  is_online?: boolean;
  date?: string;
  time?: string;
  account_reference?: string;
}

export interface MpesaIntegrationConfig {
  name: string;
  type: "buy_goods" | "paybill";
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  initiatorName: string;
  initiatorPassword: string;
  shortcode: string;
  accountReference: string;
  environment: "sandbox" | "production";
  enabled: boolean;
}

export interface KopokopoIntegrationConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  tillNumber: string;
  apiKey: string;
  environment: "sandbox" | "production";
  searchWindowHours: number;
  enabled: boolean;
}

export interface PayheroIntegrationConfig {
  name: string;
  apiUsername: string;
  apiPassword: string;
  channelId: string;
  accountReference: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Cloud storage keys (station-scoped)
// ---------------------------------------------------------------------------

const TXN_KEY = "mpesa_transactions";
const MPESA_CONFIG_KEY = "mpesa_config";
const KOPOKOPO_CONFIG_KEY = "kopokopo_config";
const PAYHERO_CONFIG_KEY = "payhero_config";

// ---------------------------------------------------------------------------
// Default configs
// ---------------------------------------------------------------------------

export const DEFAULT_MPESA_CONFIG: MpesaIntegrationConfig = {
  name: "M-PESA",
  type: "buy_goods",
  consumerKey: "",
  consumerSecret: "",
  passkey: "",
  initiatorName: "",
  initiatorPassword: "",
  shortcode: "",
  // accountReference is intentionally empty — it is populated per-station
  // (e.g. the station code/name) at save time. A hardcoded "FuelPro" default
  // would leak across all stations and break account reconciliation.
  accountReference: "",
  // Default to sandbox so a freshly-configured integration cannot accidentally
  // hit the production Daraja endpoint before the user has verified it works.
  environment: "sandbox",
  enabled: false,
};

export const DEFAULT_KOPOKOPO_CONFIG: KopokopoIntegrationConfig = {
  name: "Kopo Kopo",
  clientId: "",
  clientSecret: "",
  tillNumber: "",
  apiKey: "",
  environment: "sandbox",
  searchWindowHours: 24,
  enabled: false,
};

export const DEFAULT_PAYHERO_CONFIG: PayheroIntegrationConfig = {
  name: "PayHero",
  apiUsername: "",
  apiPassword: "",
  channelId: "",
  accountReference: "",
  enabled: false,
};

// ---------------------------------------------------------------------------
// Transaction store (shared between LiveTransaction & MPESAAnalyzer)
// ---------------------------------------------------------------------------

export async function getTransactions(
  stationId?: string,
): Promise<UnifiedTransaction[]> {
  const data =
    (await cloudStorageService.get<UnifiedTransaction[]>(TXN_KEY, stationId)) ||
    [];
  return Array.isArray(data) ? data : [];
}

export async function saveTransactions(
  txns: UnifiedTransaction[],
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(TXN_KEY, txns, stationId);
}

export async function addTransaction(
  txn: Omit<UnifiedTransaction, "id"> & { id?: string },
  stationId?: string,
): Promise<UnifiedTransaction> {
  const existing = await getTransactions(stationId);
  const record: UnifiedTransaction = {
    ...txn,
    id: txn.id || `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  // De-dup by transaction_ref (avoid double-importing the same receipt)
  if (
    record.transaction_ref &&
    existing.some((t) => t.transaction_ref === record.transaction_ref)
  ) {
    return record; // already exists, skip
  }
  const updated = [record, ...existing];
  await saveTransactions(updated, stationId);
  return record;
}

export async function addBatchTransactions(
  txns: Array<Omit<UnifiedTransaction, "id"> & { id?: string }>,
  stationId?: string,
): Promise<{ added: number; skipped: number }> {
  const existing = await getTransactions(stationId);
  const existingRefs = new Set(
    existing.map((t) => t.transaction_ref).filter(Boolean),
  );
  const toAdd: UnifiedTransaction[] = [];
  let skipped = 0;
  for (const txn of txns) {
    if (txn.transaction_ref && existingRefs.has(txn.transaction_ref)) {
      skipped++;
      continue;
    }
    if (txn.transaction_ref) existingRefs.add(txn.transaction_ref);
    toAdd.push({
      ...txn,
      id:
        txn.id || `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  }
  if (toAdd.length > 0) {
    await saveTransactions([...toAdd, ...existing], stationId);
  }
  return { added: toAdd.length, skipped };
}

export async function deleteTransaction(
  id: string,
  stationId?: string,
): Promise<void> {
  const existing = await getTransactions(stationId);
  const updated = existing.filter((t) => t.id !== id);
  await saveTransactions(updated, stationId);
}

export async function clearTransactions(stationId?: string): Promise<void> {
  await saveTransactions([], stationId);
}

/**
 * Subscribe to real-time changes on the shared transaction store. When any
 * device writes (LiveTransaction STK Push or MPESAAnalyzer statement import),
 * the callback fires instantly.
 */
export function subscribeToTransactions(
  stationId: string | undefined,
  callback: (txns: UnifiedTransaction[] | null) => void,
): () => void {
  return cloudStorageService.subscribe<UnifiedTransaction[]>(
    TXN_KEY,
    stationId,
    callback,
  );
}

// ---------------------------------------------------------------------------
// Config access
// ---------------------------------------------------------------------------

export async function getMpesaConfig(
  stationId?: string,
): Promise<MpesaIntegrationConfig> {
  const cloud = await cloudStorageService.get<Partial<MpesaIntegrationConfig>>(
    MPESA_CONFIG_KEY,
    stationId,
  );
  return { ...DEFAULT_MPESA_CONFIG, ...(cloud || {}) };
}

export async function saveMpesaConfig(
  config: MpesaIntegrationConfig,
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(MPESA_CONFIG_KEY, config, stationId);
}

export async function getKopokopoConfig(
  stationId?: string,
): Promise<KopokopoIntegrationConfig> {
  const cloud = await cloudStorageService.get<
    Partial<KopokopoIntegrationConfig>
  >(KOPOKOPO_CONFIG_KEY, stationId);
  return { ...DEFAULT_KOPOKOPO_CONFIG, ...(cloud || {}) };
}

export async function saveKopokopoConfig(
  config: KopokopoIntegrationConfig,
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(KOPOKOPO_CONFIG_KEY, config, stationId);
}

export async function getPayheroConfig(
  stationId?: string,
): Promise<PayheroIntegrationConfig> {
  const cloud = await cloudStorageService.get<
    Partial<PayheroIntegrationConfig>
  >(PAYHERO_CONFIG_KEY, stationId);
  return { ...DEFAULT_PAYHERO_CONFIG, ...(cloud || {}) };
}

export async function savePayheroConfig(
  config: PayheroIntegrationConfig,
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(PAYHERO_CONFIG_KEY, config, stationId);
}

// ---------------------------------------------------------------------------
// Analytics (shared summary stats consumed by both tabs)
// ---------------------------------------------------------------------------

export interface TransactionSummary {
  total: number;
  totalCount: number;
  completed: number;
  pending: number;
  failed: number;
  byOrigin: Record<TransactionOrigin, { count: number; amount: number }>;
  topSender: { name: string; amount: number; count: number };
  uniqueSenders: number;
  onlinePayments: number;
}

export function calculateSummary(
  txns: UnifiedTransaction[],
): TransactionSummary {
  const completed = txns.filter((t) => t.status === "completed");
  const total = completed.reduce((s, t) => s + t.amount, 0);
  const byOrigin = {} as Record<
    TransactionOrigin,
    { count: number; amount: number }
  >;
  for (const origin of [
    "stk_push",
    "statement",
    "manual",
    "kopokopo",
  ] as TransactionOrigin[]) {
    byOrigin[origin] = { count: 0, amount: 0 };
  }
  const senderMap = new Map<string, { amount: number; count: number }>();
  for (const t of completed) {
    const origin = t.origin || "manual";
    if (byOrigin[origin]) {
      byOrigin[origin].count++;
      byOrigin[origin].amount += t.amount;
    }
    const sender = t.sender_info || "Unknown";
    const ex = senderMap.get(sender) || { amount: 0, count: 0 };
    ex.amount += t.amount;
    ex.count++;
    senderMap.set(sender, ex);
  }
  let topSender = { name: "", amount: 0, count: 0 };
  for (const [name, d] of senderMap) {
    if (d.amount > topSender.amount) topSender = { name, ...d };
  }
  return {
    total,
    totalCount: txns.length,
    completed: completed.length,
    pending: txns.filter((t) => t.status === "pending").length,
    failed: txns.filter((t) => t.status === "failed").length,
    byOrigin,
    topSender,
    uniqueSenders: senderMap.size,
    onlinePayments: txns.filter((t) => t.is_online).length,
  };
}

// ---------------------------------------------------------------------------
// Cross-tab navigation helper
// ---------------------------------------------------------------------------

export function switchToTab(tabId: string): void {
  window.dispatchEvent(new CustomEvent("changeTab", { detail: tabId }));
}

/**
 * Pending-payload store: when navigateToTab is called with a payload, the
 * payload is stored here keyed by tabId. When the target component mounts and
 * calls onTabPayload, it immediately checks this store for a pending payload
 * and applies it — this eliminates the lazy-load race where the 50ms
 * tabPayload event fires before the component has mounted. The pending
 * payload is consumed (deleted) on first read so it's only applied once.
 *
 * CRITICAL: This Map is stored on `window` (not module scope) because Vite
 * code-splits mpesa-integration-service.ts into MULTIPLE chunks (index +
 * reports). A module-level `const pendingPayloads = new Map()` would create
 * a SEPARATE Map instance per chunk — navigateToTab (in the index chunk)
 * would set the payload in one Map, while onTabPayload (in the reports chunk)
 * would check a different Map and find nothing. Using `window` guarantees a
 * single shared instance across all chunks.
 */
const PENDING_PAYLOADS_KEY = "__fuelpro_pendingPayloads";
function getPendingPayloads(): Map<string, unknown> {
  if (typeof window === "undefined") return new Map();
  if (!(window as any)[PENDING_PAYLOADS_KEY]) {
    (window as any)[PENDING_PAYLOADS_KEY] = new Map();
  }
  return (window as any)[PENDING_PAYLOADS_KEY];
}

/**
 * Consume (read + delete) a pending payload for the given tabId. Returns
 * the payload if one exists, otherwise undefined. This is called by
 * onTabPayload on registration AND can be called directly by target
 * components on mount as a belt-and-suspenders approach.
 */
export function consumePendingPayload(tabId: string): unknown | undefined {
  const val = getPendingPayloads().get(tabId);
  if (val !== undefined) getPendingPayloads().delete(tabId);
  return val;
}

/**
 * Cross-tab navigation with an optional prefill payload. Switches the active
 * top-level tab AND dispatches a `tabPayload` event carrying data the target
 * component can use to pre-fill its form (e.g. opening the STK Push modal
 * pre-filled with a credit account's phone + outstanding balance).
 *
 * Target components listen via `onTabPayload` (below) and apply the payload
 * once on activation. This is the backbone of the inter-tab linking layer
 * connecting Credit ↔ Live Transaction ↔ Invoice ↔ Dashboard quick actions.
 *
 * The payload is stored in a pending-payload store AND dispatched multiple
 * times via events to handle the lazy-load race: the target tab's component
 * may not be mounted yet when early dispatches fire (React.lazy + Suspense).
 * On mount, onTabPayload checks the pending store first (instant), then
 * listens for subsequent events. The receiver's onTabPayload callback is
 * idempotent (it uses functional setState, so duplicate applications are safe).
 */
export function navigateToTab(tabId: string, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent("changeTab", { detail: tabId }));
  if (payload !== undefined) {
    // Store the pending payload so the target component can consume it on
    // mount (eliminates the lazy-load race condition).
    getPendingPayloads().set(tabId, payload);
    const dispatch = () => {
      window.dispatchEvent(
        new CustomEvent("tabPayload", { detail: { tab: tabId, payload } }),
      );
    };
    setTimeout(dispatch, 50);
    setTimeout(dispatch, 200);
    setTimeout(dispatch, 500);
    setTimeout(dispatch, 1000);
    // Clean up the pending payload after 3 seconds (it should have been
    // consumed by then; if not, it's stale and shouldn't persist).
    setTimeout(() => getPendingPayloads().delete(tabId), 3000);
  }
}

/**
 * Subscribe to cross-tab prefill payloads for a given tab id. Returns an
 * unsubscribe function. The callback receives the payload once per dispatch.
 *
 * On registration, immediately checks the pending-payload store for a
 * pending payload (set by navigateToTab) and applies it — this eliminates
 * the lazy-load race where the component mounts after the tabPayload events
 * have already fired.
 */
export function onTabPayload(
  tabId: string,
  callback: (payload: unknown) => void,
): () => void {
  // Check for a pending payload that was set by navigateToTab before this
  // component mounted. Consume it immediately so it's only applied once.
  const pending = getPendingPayloads().get(tabId);
  if (pending !== undefined) {
    getPendingPayloads().delete(tabId);
    // Defer the callback to the next microtask so the component is fully
    // mounted (refs + state are initialized) before the callback runs.
    setTimeout(() => callback(pending), 0);
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      { tab: string; payload: unknown } | undefined;
    if (detail && detail.tab === tabId) callback(detail.payload);
  };
  window.addEventListener("tabPayload", handler);
  return () => window.removeEventListener("tabPayload", handler);
}

/** Shared prefill shapes for the interlinked payment / billing flows. */
export interface StkPushPrefill {
  phone?: string;
  amount?: number;
  account_reference?: string;
  transaction_desc?: string;
  openStkPush?: boolean;
}

export interface InvoicePrefill {
  customerName?: string;
  amount?: number;
  description?: string;
}

export interface CreditPrefill {
  customerName?: string;
  phone?: string;
  amount?: number;
}

export interface ExpensePrefill {
  category?: string;
  amount?: number;
  description?: string;
  reference?: string;
  paymentMethod?: string;
}

// Re-export the fuel prefill shape so all cross-tab prefill types live in one
// importable module for receivers that already import from here.
export type { FuelPricePrefill } from "@/react-app/lib/fuel-interlink-bus";
