/**
 * Centralized FuelPro fullscreen controller.
 *
 * Uses the browser Fullscreen API whenever available and requests hidden
 * navigation UI. Native/WebView shells without the API receive an edge-to-edge
 * app-surface fallback; the host OS/browser still controls system chrome.
 */
export type FullscreenTarget = HTMLElement;

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

function getFullscreenDocument(): FullscreenDocument {
  return document as FullscreenDocument;
}

function setFallbackFullscreen(active: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("fuelpro-fullscreen-active", active);
  document.body.classList.toggle("fuelpro-fullscreen-active", active);
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = getFullscreenDocument();
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function canUseFullscreen(target?: Element | null): boolean {
  if (typeof document === "undefined" || !target) return false;
  const webkitTarget = target as WebkitFullscreenElement;
  return Boolean(
    (document.fullscreenEnabled &&
      typeof (target as HTMLElement).requestFullscreen === "function") ||
      typeof webkitTarget.webkitRequestFullscreen === "function",
  );
}

export async function enterFullscreen(target: FullscreenTarget): Promise<boolean> {
  if (!target || typeof document === "undefined") return false;

  try {
    if (document.fullscreenElement === target) return true;
    if (typeof target.requestFullscreen === "function") {
      await target.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions);
      return true;
    }
  } catch {
    // Fall through to the vendor-prefixed implementation.
  }

  try {
    const webkitTarget = target as WebkitFullscreenElement;
    if (webkitTarget.webkitRequestFullscreen) {
      await webkitTarget.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Fall through to the native/WebView edge-to-edge surface.
  }

  setFallbackFullscreen(true);
  window.dispatchEvent(
    new CustomEvent("fuelpro:fullscreenchange", { detail: { active: true } }),
  );
  return true;
}

export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
  } catch {
    // Fall through to vendor-prefixed/native fallback.
  }

  try {
    const doc = getFullscreenDocument();
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      return true;
    }
  } catch {
    // Fall through to fallback cleanup.
  }

  setFallbackFullscreen(false);
  window.dispatchEvent(
    new CustomEvent("fuelpro:fullscreenchange", { detail: { active: false } }),
  );
  return false;
}

export async function toggleFullscreen(target: FullscreenTarget): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }

  const fallbackActive =
    document.documentElement.classList.contains("fuelpro-fullscreen-active");
  if (fallbackActive) {
    await exitFullscreen();
    return false;
  }

  return enterFullscreen(target);
}

/**
 * Synchronize global fullscreen state with browser events.
 */
export function installFullscreenState(): () => void {
  if (typeof document === "undefined") return () => {};

  const sync = () => {
    const active =
      isFullscreen() ||
      document.documentElement.classList.contains("fuelpro-fullscreen-active");
    document.documentElement.classList.toggle("fuelpro-fullscreen-active", active);
    document.body.classList.toggle("fuelpro-fullscreen-active", active);
    window.dispatchEvent(
      new CustomEvent("fuelpro:fullscreenchange", { detail: { active } }),
    );
  };

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync as EventListener);
  sync();

  return () => {
    document.removeEventListener("fullscreenchange", sync);
    document.removeEventListener(
      "webkitfullscreenchange",
      sync as EventListener,
    );
  };
}
