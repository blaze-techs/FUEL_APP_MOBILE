/**
 * FuelPro fullscreen controller.
 *
 * All app fullscreen entry points should use this helper. It requests the
 * browser's real Fullscreen API (not a CSS "preview"), asks the UA to hide
 * navigation UI, and maintains a CSS fallback state for embedded/native
 * shells that do not expose requestFullscreen().
 */
export type FullscreenTarget = HTMLElement;

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
  webkitEnterFullscreen?: () => void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

function getFullscreenDocument(): FullscreenDocument {
  return document as FullscreenDocument;
}

export function isFullscreen(): boolean {
  const doc = getFullscreenDocument();
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function canUseFullscreen(target?: Element | null): boolean {
  if (typeof document === "undefined") return false;
  const doc = getFullscreenDocument();
  return Boolean(
    target &&
      document.fullscreenEnabled &&
      typeof (target as HTMLElement).requestFullscreen === "function",
  ) || Boolean(
    target &&
      typeof (target as WebkitFullscreenElement).webkitRequestFullscreen ===
        "function",
  );
}

export async function enterFullscreen(target: FullscreenTarget): Promise<boolean> {
  if (!target || typeof document === "undefined") return false;

  try {
    if (document.fullscreenElement === target) return true;

    const request = target.requestFullscreen?.bind(target);
    if (request) {
      await request({ navigationUI: "hide" } as FullscreenOptions);
      return true;
    }
  } catch {
    // Try the vendor-prefixed implementation below.
  }

  try {
    const webkitTarget = target as WebkitFullscreenElement;
    if (webkitTarget.webkitRequestFullscreen) {
      await webkitTarget.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Some embedded shells expose neither standard nor prefixed fullscreen.
  }

  return false;
}

export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
  } catch {
    // Continue to vendor-prefixed fallback.
  }

  try {
    const doc = getFullscreenDocument();
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      return true;
    }
  } catch {
    // Ignore unsupported shells.
  }

  return false;
}

export async function toggleFullscreen(target: FullscreenTarget): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen(target);
}

/**
 * Keeps the app's fallback state synchronized with the browser's actual
 * fullscreen state. The fallback is useful for Android WebViews/native
 * shells where the browser Fullscreen API may be unavailable.
 */
export function installFullscreenState(): () => void {
  if (typeof document === "undefined") return () => {};

  const sync = () => {
    const active = isFullscreen();
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
