/* feature-events.ts — typed cross-feature event channel.
 *
 * Pairs with `fuel-interlink-bus.ts` (fuel prices) and
 * `mpesa-integration-service.ts` navigation payloads (deep links).
 * Use this for state notifications that are NOT navigations:
 *   emitFeatureEvent({ type: "discount.approved", payload: { ... } })
 *   unsubscribe = onFeatureEvent("discount.approved", cb)
 *
 * Boundaries (from docs/ARCHITECTURE.md):
 * - Event names are `<feature>.<action>`; payload shapes are fixed types.
 * - An emitter must be the same feature that OWNS the cloud KV key the
 *   event describes (single-writer principle — no "other features will
 *   ping on my behalf").
 */

export type FPFeatureEvent =
  | {
      type: "discount.approved" | "discount.rejected";
      payload: { discountId: string; amount: number; cash: string };
    }
  | {
      type: "handover.added" | "handover.acknowledged";
      payload: {
        handoverId: string;
        fromShift: string;
        toShift: string;
        note: string;
      };
    }
  | {
      type: "voucher.issued" | "voucher.redeemed";
      payload: { code: string; amount: number; buyer?: string };
    }
  | {
      type: "meter-proving.fail" | "meter-proving.pass";
      payload: { nozzle: string; driftPct: number };
    }
  | {
      type: "tank-water.alert";
      payload: { fuelType: string; waterMm: number };
    }
  | {
      type: "complaint.opened" | "complaint.resolved";
      payload: { complaintId: string; customer: string; severity: string };
    }
  | {
      type: "permit.issued" | "permit.closed";
      payload: { permitId: string; work: string; contractor: string };
    }
  | {
      type: "power.outage";
      payload: { date: string; durationMin: number; generatorRan: boolean };
    };

export type FPFeatureEventType = FPFeatureEvent["type"];
export type FPFeatureEventPayload<T extends FPFeatureEventType> = Extract<
  FPFeatureEvent,
  { type: T }
>["payload"];

type Listener<T extends FPFeatureEventType> = (
  payload: FPFeatureEventPayload<T>,
) => void;

const listeners = new Map<
  FPFeatureEventType,
  Set<Listener<FPFeatureEventType>>
>();

/** Emit a feature event; listeners receive it synchronously. */
export function emitFeatureEvent(event: FPFeatureEvent): void {
  const set = listeners.get(event.type);
  if (!set) return;
  for (const listener of set) {
    try {
      (listener as unknown as (payload: FPFeatureEvent["payload"]) => void)(
        event.payload,
      );
    } catch (error) {
      console.warn(`[feature-events] listener for ${event.type} threw`, error);
    }
  }
}

/**
 * Subscribe to one event type. Returns an unsubscribe function — always call
 * it in the `useEffect` cleanup (same contract as `onFuelPriceChange`).
 */
export function onFeatureEvent<T extends FPFeatureEventType>(
  type: T,
  listener: Listener<T>,
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  const anyListener = listener as unknown as Listener<FPFeatureEventType>;
  set.add(anyListener);
  return () => {
    set.delete(anyListener);
    if (set.size === 0) listeners.delete(type);
  };
}

/** Test-only helper: wipe all listeners between test cases. */
export function _resetFeatureEventListeners(): void {
  listeners.clear();
}
