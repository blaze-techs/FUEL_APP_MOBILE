/**
 * App Reloader — non-destructive state refresh utility.
 * Replaces all window.location.reload() calls with a smooth
 * state-based refresh that preserves user context.
 */

let reloadCallback: (() => void) | null = null;

/** Register a callback that triggers a soft app refresh */
export function onSoftReload(cb: () => void): void {
  reloadCallback = cb;
}

/** Unregister the reload callback */
export function offSoftReload(): void {
  reloadCallback = null;
}

/** Trigger a soft reload if registered, else fall back to hard reload */
export function triggerSoftReload(delayMs = 0): void {
  if (delayMs > 0) {
    setTimeout(() => {
      if (reloadCallback) reloadCallback();
      else window.location.reload();
    }, delayMs);
  } else {
    if (reloadCallback) reloadCallback();
    else window.location.reload();
  }
}

/** Event-based reload — broadcasts to all app components */
export function broadcastReload(): void {
  try {
    window.dispatchEvent(new CustomEvent("fuelpro:app-reload"));
  } catch {
    /* */
  }
}

/** Listen for reload broadcasts */
export function listenForReload(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener("fuelpro:app-reload", handler);
  return () => window.removeEventListener("fuelpro:app-reload", handler);
}
