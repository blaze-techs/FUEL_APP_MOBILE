/**
 * Local-calendar date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC date, which is the
 * previous day between local midnight and the UTC offset (00:00-03:00 in
 * Kenya). For anything a user thinks of as "today" (sales, shifts, deliveries,
 * reports, expiry dates) use these helpers instead.
 */

/** Format a Date as YYYY-MM-DD using the device's local calendar. */
export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date as YYYY-MM-DD in the device's local calendar. */
export function todayLocalISO(): string {
  return localDateISO();
}
