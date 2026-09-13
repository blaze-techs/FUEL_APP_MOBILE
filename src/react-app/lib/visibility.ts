/**
 * Visibility helper — lets a long-running interval skip its WORK while the
 * tab is hidden/backgrounded and pick up again when the user returns.
 *
 * Browsers already throttle timers in background tabs, but every interval
 * that FIRES still performs its network call (cloudStorageService.get,
 * API fetch, etc.). Across a worldwide user base idling in background tabs
 * that is millions of wasted Supabase/API requests per day. Gating the
 * callback on `isWindowVisible()` keeps idle network traffic at zero and is
 * a no-op while the tab is actually visible.
 *
 * NOTE: `visibilitychange` listeners (already present in StationContext and
 * cloud-storage-service) run a sync immediately on return, so a backgrounded
 * interval never misses meaningful data — it just skips the redundant work.
 */
export function isWindowVisible(): boolean {
  try {
    return document.visibilityState === "visible";
  } catch {
    return true; // SSR/no-document fallback: behave as visible
  }
}
