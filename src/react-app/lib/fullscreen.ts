/**
 * Centralized FuelPro fullscreen controller.
 *
 * Fullscreen is treated as a native presentation mode, not a larger modal:
 * - request the target with navigation UI hidden;
 * - retry the plain API for older engines;
 * - retry the document root if a player wrapper is constrained;
 * - support WebKit and the native Android shell;
 * - use a fixed edge-to-edge fallback only when no native API exists.
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

function getFullscreenDocument(): FullscreenDocument {
  return document as FullscreenDocument;
}

function setFallbackFullscreen(active: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(
    "fuelpro-fullscreen-active",
    active,
  );
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

function dispatchFullscreenState(active: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fuelpro:fullscreenchange", { detail: { active } }),
  );
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = getFullscreenDocument();
  return Boolean(
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    document.documentElement.classList.contains("fuelpro-fullscreen-active"),
  );
}

export function canUseFullscreen(target?: Element | null): boolean {
  if (typeof document === "undefined" || !target) return false;
  const webkitTarget = target as WebkitFullscreenElement;
  return Boolean(
    (typeof (target as HTMLElement).requestFullscreen === "function" &&
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
    // Older engines can reject the options dictionary. Retry the plain API.
  }

  try {
    await request.call(target);
    return true;
  } catch {
    return false;
  }
}

export async function enterFullscreen(
  target: FullscreenTarget,
): Promise<boolean> {
  if (!target || typeof document === "undefined") return false;

  setFallbackFullscreen(true);
  notifyNativeFullscreen(true);

  if (isFullscreen() && document.fullscreenElement === target) {
    dispatchFullscreenState(true);
    return true;
  }

  // First choice: the actual player/panel becomes the browser fullscreen
  // element, which puts it in the top layer and removes browser chrome.
  if (await requestStandardFullscreen(target)) {
    dispatchFullscreenState(true);
    return true;
  }

  // Second choice: fullscreen the document root. The target remains the only
  // visible surface because the fullscreen-active CSS makes it fixed/inset.
  if (document.documentElement !== target) {
    if (await requestStandardFullscreen(document.documentElement)) {
      dispatchFullscreenState(true);
      return true;
    }
  }

  // Legacy WebKit element fullscreen.
  try {
    const webkitTarget = target as WebkitFullscreenElement;
    if (webkitTarget.webkitRequestFullscreen) {
      await webkitTarget.webkitRequestFullscreen();
      dispatchFullscreenState(true);
      return true;
    }
  } catch {
    // Continue to native/fixed fallback.
  }

  // Android/other native WebView shells can hide OS system bars here.
  if (notifyNativeFullscreen(true)) {
    setFallbackFullscreen(true);
    dispatchFullscreenState(true);
    return true;
  }

  // Last resort: edge-to-edge app surface. A normal browser cannot be forced
  // to hide OS chrome when it does not expose a fullscreen API.
  setFallbackFullscreen(true);
  dispatchFullscreenState(true);
  return true;
}

export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  let exited = false;

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      exited = true;
    }
  } catch {
    // Continue to WebKit/native cleanup.
  }

  try {
    const doc = getFullscreenDocument();
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      exited = true;
    }
  } catch {
    // Continue to fallback cleanup.
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

  const sync = () => {
    const active =
      isFullscreen() ||
      document.documentElement.classList.contains("fuelpro-fullscreen-active");
    document.documentElement.classList.toggle(
      "fuelpro-fullscreen-active",
      active,
    );
    document.body?.classList.toggle("fuelpro-fullscreen-active", active);
    dispatchFullscreenState(active);
  };

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync as EventListener);
  window.addEventListener("fuelpro:fullscreenchange", sync);
  sync();

  return () => {
    document.removeEventListener("fullscreenchange", sync);
    document.removeEventListener(
      "webkitfullscreenchange",
      sync as EventListener,
    );
    window.removeEventListener("fuelpro:fullscreenchange", sync);
  };
}
