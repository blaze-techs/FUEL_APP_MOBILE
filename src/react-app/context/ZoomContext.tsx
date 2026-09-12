import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useMemo,
} from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

/**
 * View Zoom + Frame Aspect — the APK-friendly "zoom to suit the
 * (user/station)" accessibility feature.
 *
 * - zoom: 75%–200% (5% steps) applied as root font-size on <html> so the
 *   WHOLE app frame scales proportionally (exactly like browser/WebView
 *   zoom on the standalone app, but isolated to our own UI and fully
 *   controllable from inside the app).
 * - frame: the centered app surface width profile:
 *     device  -> narrow phone frame (default, the 9:20 APK canvas)
 *     wide    -> wider desktop-ish frame
 *     full    -> break out of the max-width gutter entirely (edge-to-edge)
 *
 * Both persist to localStorage (read-through cache, instant boot) AND to
 * the Supabase app_kv cloud key (cross-device, per user) — mirrors the
 * ThemeContext color-theme pattern exactly.
 */

export type ViewZoom = number; // percent 75..200
export type FrameMode = "device" | "wide" | "full";

export const ZOOM_MIN = 75;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 5;
export const DEFAULT_ZOOM: ViewZoom = 100;
export const DEFAULT_FRAME: FrameMode = "device";

const ZOOM_CLOUD_KEY = "app_view_zoom";
const FRAME_CLOUD_KEY = "app_frame_mode";
const ZOOM_LS_KEY = "fuelpro_view_zoom";
const FRAME_LS_KEY = "fuelpro_frame_mode";

export const FRAME_MODES: { id: FrameMode; name: string; hint: string }[] = [
  { id: "device", name: "Device (9:20)", hint: "Narrow phone frame — default" },
  { id: "wide", name: "Wide", hint: "Wider frame for tablets / large type" },
  { id: "full", name: "Full Width", hint: "Break out of the center gutter" },
];

export const zoomLabel = (z: ViewZoom): string => `${Math.round(z)}%`;

export function clampZoom(z: unknown): ViewZoom {
  if (z === null || z === undefined || z === "") return DEFAULT_ZOOM;
  const n = Number(z);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM;
  return Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round(n / ZOOM_STEP) * ZOOM_STEP),
  );
}

export function isFrameMode(v: unknown): v is FrameMode {
  return v === "device" || v === "wide" || v === "full";
}

export interface ZoomContextValue {
  zoom: ViewZoom;
  frame: FrameMode;
  setZoom: (z: ViewZoom) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setFrame: (f: FrameMode) => void;
}

const ZoomContext = createContext<ZoomContextValue | null>(null);

/** Apply zoom + frame attributes to <html>. */
function applyZoomAndFrame(zoom: ViewZoom, frame: FrameMode) {
  try {
    const root = document.documentElement;
    root.setAttribute("data-zoom", String(Math.round(zoom)));
    root.style.fontSize = `${zoom}%`;
    root.setAttribute("data-frame", frame);
  } catch {
    /* ignore */
  }
}

export function ZoomProvider({ children }: { children: React.ReactNode }) {
  // View zoom — seeded from the synchronous cache first (instant boot),
  // then cloud/localStorage fallbacks.
  const [zoom, setZoomState] = useState<ViewZoom>(() => {
    try {
      const cached = cloudStorageService.getCached<ViewZoom>(ZOOM_CLOUD_KEY);
      if (cached !== null) return clampZoom(cached);
    } catch {
      /* ignore */
    }
    try {
      const stored = localStorage.getItem(ZOOM_LS_KEY);
      if (stored !== null) return clampZoom(stored);
    } catch {
      /* ignore */
    }
    return DEFAULT_ZOOM;
  });

  // Frame aspect (width profile).
  const [frame, setFrameState] = useState<FrameMode>(() => {
    try {
      const cached = cloudStorageService.getCached<FrameMode>(FRAME_CLOUD_KEY);
      if (isFrameMode(cached)) return cached;
    } catch {
      /* ignore */
    }
    try {
      const stored = localStorage.getItem(FRAME_LS_KEY);
      if (isFrameMode(stored)) return stored;
    } catch {
      /* ignore */
    }
    return DEFAULT_FRAME;
  });

  // Apply on first render + whenever it changes (no flash of wrong size).
  useEffect(() => {
    applyZoomAndFrame(zoom, frame);
  }, [zoom, frame]);

  // Persist zoom — localStorage cache + cloud write (cross-device).
  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_LS_KEY, String(zoom));
    } catch {
      /* ignore */
    }
    cloudStorageService.set(ZOOM_CLOUD_KEY, zoom).catch(() => {});
  }, [zoom]);

  // Persist frame — localStorage cache + cloud write (cross-device).
  useEffect(() => {
    try {
      localStorage.setItem(FRAME_LS_KEY, frame);
    } catch {
      /* ignore */
    }
    cloudStorageService.set(FRAME_CLOUD_KEY, frame).catch(() => {});
  }, [frame]);

  // Pull remote zoom once on mount (fresh device) + live subscription.
  useEffect(() => {
    const unsub = cloudStorageService.subscribe<ViewZoom>(
      ZOOM_CLOUD_KEY,
      undefined,
      (val) => {
        if (val !== null && clampZoom(val) !== zoom) {
          setZoomState(clampZoom(val));
        }
      },
    );
    cloudStorageService
      .get<ViewZoom>(ZOOM_CLOUD_KEY)
      .then((remote) => {
        if (remote !== null && clampZoom(remote) !== zoom) {
          setZoomState(clampZoom(remote));
        }
      })
      .catch(() => {});
    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull remote frame once on mount + live subscription (same pattern).
  useEffect(() => {
    const unsub = cloudStorageService.subscribe<FrameMode>(
      FRAME_CLOUD_KEY,
      undefined,
      (val) => {
        if (isFrameMode(val) && val !== frame) {
          setFrameState(val);
        }
      },
    );
    cloudStorageService
      .get<FrameMode>(FRAME_CLOUD_KEY)
      .then((remote) => {
        if (isFrameMode(remote) && remote !== frame) {
          setFrameState(remote);
        }
      })
      .catch(() => {});
    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setZoom = useCallback((z: ViewZoom) => {
    setZoomState(clampZoom(z));
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState(clampZoom(zoom + ZOOM_STEP));
  }, [zoom]);

  const zoomOut = useCallback(() => {
    setZoomState(clampZoom(zoom - ZOOM_STEP));
  }, [zoom]);

  const resetZoom = useCallback(() => {
    setZoomState(DEFAULT_ZOOM);
  }, []);

  const setFrame = useCallback((f: FrameMode) => {
    if (isFrameMode(f)) setFrameState(f);
  }, []);

  const value = useMemo<ZoomContextValue>(
    () => ({ zoom, frame, setZoom, zoomIn, zoomOut, resetZoom, setFrame }),
    [zoom, frame, setZoom, zoomIn, zoomOut, resetZoom, setFrame],
  );

  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
}

export function useZoom(): ZoomContextValue {
  const ctx = useContext(ZoomContext);
  if (!ctx) {
    // Defaults when no provider is mounted (e.g. standalone pages).
    return {
      zoom: DEFAULT_ZOOM,
      frame: DEFAULT_FRAME,
      setZoom: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      resetZoom: () => {},
      setFrame: () => {},
    };
  }
  return ctx;
}
