/**
 * Webhook dispatcher (frontend)
 *
 * Makes the Integration Hub webhooks REAL: when a domain event fires in the
 * automation engine (sale:completed, expense:created, price:changed, ...),
 * every enabled webhook whose `events` list matches is ACTUALLY POSTed to
 * the station's endpoint via the integrations dispatcher (HMAC-SHA256 signed
 * with the webhook secret, X-FuelPro-Event header).
 *
 * Previously webhooks were stored in the cloud but NEVER fired — a pure
 * config UI with no delivery. This module is the delivery path.
 */

import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { fireWebhook } from "@/react-app/lib/integrations-client";
import type { DomainEvent } from "@/react-app/lib/automation-engine";

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  lastTriggered?: string;
}

const CLOUD_WEBHOOKS_KEY = "integration_webhooks";

// Short-TTL in-memory cache so a burst of events doesn't re-read the cloud
// (or the read-through cache) for every single event.
let webhooksCache: {
  stationId?: string;
  data: WebhookEndpoint[];
  ts: number;
} | null = null;
const CACHE_TTL_MS = 60_000;

async function loadWebhooks(stationId?: string): Promise<WebhookEndpoint[]> {
  if (
    webhooksCache &&
    webhooksCache.stationId === stationId &&
    Date.now() - webhooksCache.ts < CACHE_TTL_MS
  ) {
    return webhooksCache.data;
  }
  // Sync cache first (instant), then async cloud.
  const cached = cloudStorageService.getCached<WebhookEndpoint[]>(
    CLOUD_WEBHOOKS_KEY,
    stationId,
  );
  if (Array.isArray(cached)) {
    webhooksCache = { stationId, data: cached, ts: Date.now() };
    return cached;
  }
  const cloud = await cloudStorageService
    .get<WebhookEndpoint[]>(CLOUD_WEBHOOKS_KEY, stationId)
    .catch(() => null);
  const data = Array.isArray(cloud) ? cloud : [];
  webhooksCache = { stationId, data, ts: Date.now() };
  return data;
}

function eventMatches(wh: WebhookEndpoint, eventType: string): boolean {
  if (!Array.isArray(wh.events) || wh.events.length === 0) return false;
  const prefix = eventType.split(":")[0];
  return wh.events.some(
    (e) => e === eventType || e === `${prefix}:*` || e === "*" || e === prefix,
  );
}

/**
 * Fire all matching enabled webhooks for a domain event. Fire-and-forget —
 * delivery results are logged to the integration log cloud key (best-effort)
 * and never block the event flow.
 */
export async function dispatchAutomationWebhooks(
  event: DomainEvent,
  stationId?: string,
): Promise<void> {
  try {
    const hooks = await loadWebhooks(stationId);
    const matching = hooks.filter(
      (wh) => wh.active && wh.url && eventMatches(wh, event.type),
    );
    if (matching.length === 0) return;

    const payload = event as unknown as Record<string, unknown>;
    const results = await Promise.allSettled(
      matching.map((wh) => fireWebhook(wh.url, event.type, payload, wh.secret)),
    );

    // Update lastTriggered for successfully delivered webhooks (best-effort).
    const now = new Date().toISOString();
    let changed = false;
    const updated = hooks.map((wh) => {
      const idx = matching.findIndex((m) => m.id === wh.id);
      if (
        idx >= 0 &&
        results[idx].status === "fulfilled" &&
        (results[idx] as PromiseFulfilledResult<{ success: boolean }>).value
          .success
      ) {
        changed = true;
        return { ...wh, lastTriggered: now };
      }
      return wh;
    });
    if (changed) {
      webhooksCache = { stationId, data: updated, ts: Date.now() };
      cloudStorageService
        .set(CLOUD_WEBHOOKS_KEY, updated, stationId)
        .catch(() => {});
    }
  } catch (err) {
    console.warn("[webhooks] dispatch error:", err);
  }
}

/** Invalidate the in-memory webhook cache (call after webhook CRUD). */
export function invalidateWebhookCache(): void {
  webhooksCache = null;
}
