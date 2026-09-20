/**
 * Centralized FuelPro fullscreen controller.
 *
 * Fullscreen is an immersive presentation mode:
 * - fullscreen the owning player container, never only a nested iframe/video;
 * - hide app/player chrome while preserving native media/game controls;
 * - hide Android system bars through the native bridge when available;
 * - fall back to a fixed edge-to-edge surface only when native fullscreen
 *   cannot be entered.
 */
export type FullscreenTarget = HTMLElement;

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
  webkitEnterFullscreen?: () => void | Promise<void>;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

type NativeFullscreenBridge = {
  enter?: () => boolean | void;
  exit?: () => boolean | void;
};

declare global {
  interface Window {
    FuelProNativeFullscreen?: NativeFullscreenBridge;
  }
}

let fallbackFullscreenActive = false;
let lastAnnouncedFullscreen: boolean | null = null;

function getFullscreenDocument(): FullscreenDocument {
  return document as FullscreenDocument;
}

function resolvePresentationTarget(target: FullscreenTarget): FullscreenTarget {
  return (
    (target.closest?.(
      "[data-fuelpro-fullscreen-target], .fuelpro-fullscreen-target",
    ) as HTMLElement | null) ?? target
  );
}

function setFallbackFullscreen(active: boolean): void {
  fallbackFullscreenActive = active;
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("fuelpro-fullscreen-active", active);
  document.body?.classList.toggle("fuelpro-fullscreen-active", active);
}

function notifyNativeFullscreen(active: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    const bridge = window.FuelProNativeFullscreen;
    if (!bridge) return false;
    const result = active ? bridge.enter?.() : bridge.exit?.();
    return result !== false;
  } catch {
    return false;
  }
}

export function dispatchFullscreenState(active: boolean): void {
  if (typeof window === "undefined") return;
  if (lastAnnouncedFullscreen === active) return;
  lastAnnouncedFullscreen = active;
  window.dispatchEvent(
    new CustomEvent("fuelpro:fullscreenchange", { detail: { active } }),
  );
}

export function resetFullscreenState(): void {
  lastAnnouncedFullscreen = null;
  fallbackFullscreenActive = false;
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = getFullscreenDocument();
  return Boolean(
    doc.fullscreenElement ??
      doc.webkitFullscreenElement ??
      fallbackFullscreenActive,
  );
}

export function canUseFullscreen(target?: Element | null): boolean {
  if (typeof document === "undefined" || !target) return false;
  const resolved = resolvePresentationTarget(target as HTMLElement);
  const webkitTarget = resolved as WebkitFullscreenElement;
  return Boolean(
    (typeof resolved.requestFullscreen === "function" &&
      document.fullscreenEnabled !== false) ||
      typeof webkitTarget.webkitRequestFullscreen === "function" ||
      typeof webkitTarget.webkitEnterFullscreen === "function" ||
      typeof window.FuelProNativeFullscreen?.enter === "function",
  );
}

async function requestStandardFullscreen(target: Element): Promise<boolean> {
  const request = (target as HTMLElement).requestFullscreen;
  if (typeof request !== "function") return false;

  try {
    await request.call(target, { navigationUI: "hide" } as FullscreenOptions);
    return true;
  } catch {
    // Older engines may reject the options dictionary.
  }

  try {
    await request.call(target);
    return true;
  } catch {
    return false;
  }
}

async function requestWebkitFullscreen(target: FullscreenTarget): Promise<boolean> {
  const webkitTarget = target as WebkitFullscreenElement;
  try {
    if (webkitTarget.webkitRequestFullscreen) {
      await webkitTarget.webkitRequestFullscreen();
      return true;
    }
    if (webkitTarget.webkitEnterFullscreen) {
      await webkitTarget.webkitEnterFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function enterFullscreen(
  target: FullscreenTarget,
): Promise<boolean> {
  if (!target || typeof document === "undefined") return false;

  const presentationTarget = resolvePresentationTarget(target);
  const doc = getFullscreenDocument();

  if (
    doc.fullscreenElement === presentationTarget ||
    doc.webkitFullscreenElement === presentationTarget
  ) {
    setFallbackFullscreen(false);
    notifyNativeFullscreen(true);
    dispatchFullscreenState(true);
    return true;
  }

  // Do not mark the app as fullscreen before a real browser request succeeds.
  // Doing so made failed requests look successful and left the app in a
  // preview-like pseudo fullscreen state.
  setFallbackFullscreen(false);

  if (await requestStandardFullscreen(presentationTarget)) {
    notifyNativeFullscreen(true);
    dispatchFullscreenState(true);
    return true;
  }

  if (await requestWebkitFullscreen(presentationTarget)) {
    notifyNativeFullscreen(true);
    dispatchFullscreenState(true);
    return true;
  }

  // In a native Android shell the bridge can still provide immersive system
  // bars even when the WebView Fullscreen API rejects the element request.
  const nativeEntered = notifyNativeFullscreen(true);
  setFallbackFullscreen(true);
  dispatchFullscreenState(true);
  return nativeEntered || true;
}

export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  let exited = false;
  const doc = getFullscreenDocument();

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      exited = true;
    }
  } catch {
    // Continue cleanup.
  }

  try {
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      exited = true;
    }
  } catch {
    // Continue cleanup.
  }

  if (notifyNativeFullscreen(false)) exited = true;
  setFallbackFullscreen(false);
  dispatchFullscreenState(false);
  return exited;
}

export async function toggleFullscreen(
  target: FullscreenTarget,
): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen(target);
}

export function installFullscreenState(): () => void {
  if (typeof document === "undefined") return () => {};

  const syncFromBrowser = () => {
    const doc = getFullscreenDocument();
    const active = Boolean(
      doc.fullscreenElement ??
        doc.webkitFullscreenElement ??
        fallbackFullscreenActive,
    );
    document.documentElement.classList.toggle(
      "fuelpro-fullscreen-active",
      active,
    );
    document.body?.classList.toggle("fuelpro-fullscreen-active", active);
    if (!active) notifyNativeFullscreen(false);
    dispatchFullscreenState(active);
  };

  document.addEventListener("fullscreenchange", syncFromBrowser);
  document.addEventListener(
    "webkitfullscreenchange",
    syncFromBrowser as EventListener,
  );
  syncFromBrowser();

  return () => {
    document.removeEventListener("fullscreenchange", syncFromBrowser);
    document.removeEventListener(
      "webkitfullscreenchange",
      syncFromBrowser as EventListener,
    );
  };
}
