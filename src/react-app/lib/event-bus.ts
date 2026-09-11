// packages/utils/src/event-bus.ts
// Cross-Tab, Cross-Feature Event Bus using BroadcastChannel

type EventHandler = (payload: any) => void;
type EventMap = Record<string, EventHandler[]>;

const BROADCAST_CHANNEL = "fuelpro_events";

class EventBus {
  private handlers: EventMap = {};
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL);
        this.channel.onmessage = (event: MessageEvent) => {
          const { type, payload } = event.data;
          this.emitInternal(type, payload);
        };
      } catch {
        /* BroadcastChannel not supported */
      }
    }
  }

  private emitInternal(type: string, payload: any) {
    const handlers = this.handlers[type];
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(payload);
        } catch (e) {
          console.error(`Event handler error for ${type}:`, e);
        }
      });
    }
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
    return () => {
      this.handlers[type] = this.handlers[type].filter((h) => h !== handler);
    };
  }

  emit(type: string, payload?: any) {
    this.emitInternal(type, payload);
    // Broadcast to other tabs
    if (this.channel) {
      try {
        this.channel.postMessage({ type, payload });
      } catch {
        /* */
      }
    }
    // Also dispatch DOM event for within-tab listeners
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(`fuelpro:${type}`, { detail: payload }),
      );
    }
  }

  once(type: string, handler: EventHandler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
  }

  off(type: string, handler: EventHandler) {
    if (this.handlers[type]) {
      this.handlers[type] = this.handlers[type].filter((h) => h !== handler);
    }
  }
}

// Singleton
const bus = new EventBus();

export function getEventBus() {
  return bus;
}

export function onEvent(type: string, handler: EventHandler) {
  return bus.on(type, handler);
}
export function emitEvent(type: string, payload?: any) {
  bus.emit(type, payload);
}

// ─── Common event types ───
export const Events = {
  SALE_RECORDED: "sale:recorded",
  INVENTORY_CHANGED: "inventory:changed",
  STATION_CHANGED: "station:changed",
  USER_LOGGED_IN: "auth:login",
  USER_LOGGED_OUT: "auth:logout",
  LOCATION_UPDATED: "geo:updated",
  PRICE_CHANGED: "price:changed",
  MAINTENANCE_DUE: "maintenance:due",
  SUPPLIER_ORDER: "supplier:order",
  EXPENSE_ADDED: "expense:added",
  FEATURE_FLAG_CHANGED: "featureflag:changed",
  BACKUP_COMPLETED: "backup:completed",
  BACKUP_SCHEDULED: "backup:scheduled",
  CONFIG_CHANGED: "config:changed",
} as const;
