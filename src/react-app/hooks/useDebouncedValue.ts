import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value.
 *
 * The search box must stay instant, but filtering a large record set on every
 * keystroke is what makes a table feel laggy. Callers keep the raw value bound
 * to the input and filter on the debounced copy.
 *
 * The first value is returned immediately so an initial render is never
 * delayed behind the timer.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // Skip the timer entirely when nothing is pending — avoids a redundant
    // re-render (and a pointless timeout) on unrelated renders.
    if (value === debounced) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
    // `debounced` is intentionally excluded: including it would re-arm the
    // timer on the very update this effect is waiting to apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs]);

  return debounced;
}
