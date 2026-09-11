/**
 * Scheduled Debt Reminder Service
 *
 * Cloud-backed (app_kv) scheduled reminder engine for the Credit Management
 * "Debt Payment Reminders" sub-tab. Each station can schedule reminders at a
 * specific minute/hour/day-of-month/month/year, choose the communication
 * method (WhatsApp / Email / SMS), and define the message format. A
 * background interval checks every 30s for due reminders and fires them.
 *
 * Because the app runs entirely client-side (no server cron), the scheduler
 * runs while the Credit Management tab is open. Reminders are also
 * re-evaluated on mount so a reminder that came due while the tab was closed
 * fires the next time the user opens it (within the same minute window).
 */

import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

const SCHEDULED_REMINDERS_KEY = "scheduled_debt_reminders";

export type ReminderMethod = "whatsapp" | "email" | "sms";

export interface ScheduledReminder {
  id: string;
  customerName: string;
  customerId?: string;
  amount: number;
  currency: string;
  contact: string; // phone (whatsapp/sms) or email
  method: ReminderMethod;
  messageFormat: string; // template with {{name}}, {{amount}}, {{currency}}
  // Schedule fields — all 0-based except day-of-month (1-31) and month (1-12).
  // A field set to null means "every" (e.g. minute=null = every minute).
  minute: number | null; // 0-59
  hour: number | null; // 0-23
  dayOfMonth: number | null; // 1-31
  month: number | null; // 1-12 (null = every month)
  // One-time vs recurring: if recurring=false, the reminder fires once and is
  // marked as fired (deleted on next check).
  recurring: boolean;
  enabled: boolean;
  createdAt: number;
  lastFiredAt: number | null;
  nextFireAt: number | null;
}

function isDue(reminder: ScheduledReminder, now: Date): boolean {
  if (!reminder.enabled) return false;
  if (reminder.minute !== null && reminder.minute !== now.getMinutes())
    return false;
  if (reminder.hour !== null && reminder.hour !== now.getHours()) return false;
  if (reminder.dayOfMonth !== null && reminder.dayOfMonth !== now.getDate())
    return false;
  if (reminder.month !== null && reminder.month !== now.getMonth() + 1)
    return false;
  // Prevent re-firing within the same minute for recurring reminders.
  if (reminder.lastFiredAt) {
    const elapsed = Date.now() - reminder.lastFiredAt;
    if (elapsed < 60_000) return false;
  }
  return true;
}

export function computeNextFireTime(r: ScheduledReminder): number | null {
  const now = new Date();
  // Brute-force search forward in 1-minute steps up to ~1 year.
  for (let i = 0; i < 525600; i++) {
    const candidate = new Date(now.getTime() + i * 60_000);
    if (r.minute !== null && r.minute !== candidate.getMinutes()) continue;
    if (r.hour !== null && r.hour !== candidate.getHours()) continue;
    if (r.dayOfMonth !== null && r.dayOfMonth !== candidate.getDate()) continue;
    if (r.month !== null && r.month !== candidate.getMonth() + 1) continue;
    return candidate.getTime();
  }
  return null;
}

export function formatReminderMessage(
  template: string,
  ctx: { name: string; amount: number; currency: string },
): string {
  return template
    .replace(/\{\{name\}\}/g, ctx.name)
    .replace(/\{\{amount\}\}/g, ctx.amount.toFixed(2))
    .replace(/\{\{currency\}\}/g, ctx.currency);
}

export async function getScheduledReminders(
  stationId?: string,
): Promise<ScheduledReminder[]> {
  const data = await cloudStorageService.get<ScheduledReminder[]>(
    SCHEDULED_REMINDERS_KEY,
    stationId,
  );
  return Array.isArray(data) ? data : [];
}

export async function saveScheduledReminders(
  reminders: ScheduledReminder[],
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(SCHEDULED_REMINDERS_KEY, reminders, stationId);
}

export async function addScheduledReminder(
  reminder: Omit<
    ScheduledReminder,
    "id" | "createdAt" | "lastFiredAt" | "nextFireAt"
  >,
  stationId?: string,
): Promise<ScheduledReminder> {
  const existing = await getScheduledReminders(stationId);
  const full: ScheduledReminder = {
    ...reminder,
    id: `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    lastFiredAt: null,
    nextFireAt: computeNextFireTime({
      ...reminder,
      id: "",
      createdAt: 0,
      lastFiredAt: null,
      nextFireAt: null,
    }),
  };
  await saveScheduledReminders([...existing, full], stationId);
  return full;
}

export async function deleteScheduledReminder(
  id: string,
  stationId?: string,
): Promise<void> {
  const existing = await getScheduledReminders(stationId);
  await saveScheduledReminders(
    existing.filter((r) => r.id !== id),
    stationId,
  );
}

export async function toggleScheduledReminder(
  id: string,
  stationId?: string,
): Promise<void> {
  const existing = await getScheduledReminders(stationId);
  await saveScheduledReminders(
    existing.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    stationId,
  );
}

/**
 * Check all scheduled reminders for the station and fire any that are due.
 * Returns the list of reminders that were fired (for UI feedback). The actual
 * "sending" (opening WhatsApp, mailto, etc.) is done by the caller via the
 * `onFire` callback, because only the UI layer can open links/windows.
 */
export async function checkAndFireDueReminders(
  stationId: string | undefined,
  onFire: (reminder: ScheduledReminder, message: string) => void,
): Promise<ScheduledReminder[]> {
  const reminders = await getScheduledReminders(stationId);
  const now = new Date();
  const fired: ScheduledReminder[] = [];
  let changed = false;
  for (const r of reminders) {
    if (!isDue(r, now)) continue;
    const message = formatReminderMessage(r.messageFormat, {
      name: r.customerName,
      amount: r.amount,
      currency: r.currency,
    });
    onFire(r, message);
    fired.push(r);
    r.lastFiredAt = Date.now();
    changed = true;
    // For one-time reminders, disable after firing.
    if (!r.recurring) {
      r.enabled = false;
    }
  }
  if (changed) {
    await saveScheduledReminders(reminders, stationId);
  }
  return fired;
}
