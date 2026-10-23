import { useEffect, useMemo, useState } from "react";

/**
 * Render a large list in bounded windows instead of all at once.
 *
 * A single imported bank/M-PESA statement can hold thousands of rows. Mounting
 * one `<tr>` per record on every render is the dominant cost — the browser
 * lays out and paints each one — which is why "load all previous and current
 * records at once" made these tabs lag.
 *
 * The window resets whenever `resetKey` changes (a new search or filter means
 * a new list), so a narrowed result is always fully visible, while data merely
 * GROWING does not collapse a view the user has already expanded.
 */
export function useWindowedList<T>(
  items: readonly T[],
  resetKey: string,
  pageSize = 200,
) {
  const [count, setCount] = useState(pageSize);

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  // Clamp so a shrinking list (e.g. "Clear All") cannot leave the window past
  // the end of the data.
  const safeCount = Math.min(count, items.length);

  const visible = useMemo(() => items.slice(0, safeCount), [items, safeCount]);

  return {
    visible,
    /** Rows currently mounted. */
    shown: safeCount,
    total: items.length,
    /** True when more rows exist beyond the current window. */
    hasMore: safeCount < items.length,
    loadMore: () => setCount((c) => c + pageSize),
  };
}
