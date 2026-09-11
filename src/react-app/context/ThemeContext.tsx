import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

type Theme = "light" | "dark" | "system";

/** The color themes from design spec (99.txt) + the Framer dark aesthetic. */
export type ColorTheme =
  | "royal"
  | "eucalyptus"
  | "mauve"
  | "ocean"
  | "peach"
  | "periwinkle"
  | "mint"
  | "framer";

export interface ColorThemeMeta {
  id: ColorTheme;
  name: string;
  primaryHex: string;
  tintHex: string;
}

export const COLOR_THEMES: ColorThemeMeta[] = [
  {
    id: "royal",
    name: "Royal Professional",
    primaryHex: "#c5a059",
    tintHex: "#111625",
  },
  {
    id: "eucalyptus",
    name: "Eucalyptus Glow",
    primaryHex: "#A7C4A0",
    tintHex: "#F4EFE6",
  },
  {
    id: "mauve",
    name: "Pearl Mauve",
    primaryHex: "#D8BFD8",
    tintHex: "#FDFCFB",
  },
  {
    id: "ocean",
    name: "Ocean Breeze",
    primaryHex: "#7FCDFF",
    tintHex: "#DFF7FF",
  },
  {
    id: "peach",
    name: "Peach Champagne",
    primaryHex: "#FFD3B6",
    tintHex: "#FFF9F5",
  },
  {
    id: "periwinkle",
    name: "Dreamy Periwinkle",
    primaryHex: "#B8C0FF",
    tintHex: "#E7D8FF",
  },
  {
    id: "mint",
    name: "Mint Lagoon",
    primaryHex: "#6DD5C4",
    tintHex: "#DFF6F0",
  },
  {
    id: "framer",
    name: "Framer Dark",
    primaryHex: "#035bfe",
    tintHex: "#0a0a0a",
  },
];

export const DEFAULT_COLOR_THEME: ColorTheme = "royal";
const COLOR_THEME_CLOUD_KEY = "app_color_theme";
const COLOR_THEME_LS_KEY = "fuelpro_color_theme";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Active pastel color theme (99.txt palettes). */
  colorTheme: ColorTheme;
  colorThemeMeta: ColorThemeMeta;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Robust prefers-color-scheme detection for all browsers
function getPrefersDarkMode(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia !== "function") {
      // Fallback for browsers without matchMedia
      return false;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    return mediaQuery.matches;
  } catch {
    return false;
  }
}

// Robust media query listener for all browsers
function addMediaQueryListener(
  mediaQuery: MediaQueryList,
  callback: () => void,
): () => void {
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  } else if (mediaQuery.addListener) {
    // Legacy support for older browsers
    mediaQuery.addListener(callback);
    return () => mediaQuery.removeListener(callback);
  }
  return () => {};
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem("fuelpro_theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    } catch {
      // localStorage not available
    }
    return "system";
  });

  const getResolvedTheme = useCallback((t: Theme): "light" | "dark" => {
    if (t === "system") {
      return getPrefersDarkMode() ? "dark" : "light";
    }
    return t;
  }, []);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    getResolvedTheme(theme),
  );

  // Apply theme to document
  const applyTheme = useCallback((resolved: "light" | "dark") => {
    try {
      const root = document.documentElement;
      if (resolved === "dark") {
        root.classList.add("dark");
        root.classList.remove("light");
        // Also set data attribute for Tailwind dark mode
        root.setAttribute("data-theme", "dark");
        // Set CSS custom property for extra compatibility
        document.body.style.colorScheme = "dark";
      } else {
        root.classList.remove("dark");
        root.classList.add("light");
        root.setAttribute("data-theme", "light");
        document.body.style.colorScheme = "light";
      }
    } catch {
      // DOM not ready
    }
  }, []);

  useEffect(() => {
    const resolved = getResolvedTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    try {
      localStorage.setItem("fuelpro_theme", theme);
    } catch {
      // localStorage not available
    }
  }, [theme, getResolvedTheme, applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;

    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        const resolved = getPrefersDarkMode() ? "dark" : "light";
        setResolvedTheme(resolved);
        applyTheme(resolved);
      };

      return addMediaQueryListener(mediaQuery, handleChange);
    } catch {
      // matchMedia not supported
    }
  }, [theme, applyTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === "light") return "dark";
      if (prev === "dark") return "system";
      return "light";
    });
  }, []);

  // ── Soft pastel color theme (design spec 99.txt) ──────────────────────
  // Source of truth: cloud (app_kv) so the chosen theme follows the user
  // across devices. localStorage is a read-through cache for instant load.
  const isColorTheme = (v: unknown): v is ColorTheme =>
    typeof v === "string" && COLOR_THEMES.some((t) => t.id === v);

  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    try {
      const cached = cloudStorageService.getCached<ColorTheme>(
        COLOR_THEME_CLOUD_KEY,
      );
      if (isColorTheme(cached)) return cached;
    } catch {
      /* noop */
    }
    try {
      const stored = localStorage.getItem(COLOR_THEME_LS_KEY);
      if (isColorTheme(stored)) return stored;
    } catch {
      /* noop */
    }
    return DEFAULT_COLOR_THEME;
  });

  const colorThemeMeta =
    COLOR_THEMES.find((t) => t.id === colorTheme) ?? COLOR_THEMES[0];

  // Apply the color theme to <html data-color-theme="..."> so CSS variable
  // overrides take effect site-wide.
  const applyColorTheme = useCallback((ct: ColorTheme) => {
    try {
      document.documentElement.setAttribute("data-color-theme", ct);
    } catch {
      /* DOM not ready */
    }
  }, []);

  useEffect(() => {
    applyColorTheme(colorTheme);
  }, [colorTheme, applyColorTheme]);

  // Real-time cross-device sync of the color theme. A change made on one
  // device reflects on every other signed-in device instantly.
  const skipRemoteColorRef = useRef(false);
  useEffect(() => {
    applyColorTheme(colorTheme);
    // persist to localStorage (instant cache)
    try {
      localStorage.setItem(COLOR_THEME_LS_KEY, colorTheme);
    } catch {
      /* noop */
    }
    // persist to cloud (cross-device source of truth)
    if (!skipRemoteColorRef.current) {
      cloudStorageService
        .set(COLOR_THEME_CLOUD_KEY, colorTheme)
        .catch(() => {});
    }
    skipRemoteColorRef.current = false;
  }, [colorTheme, applyColorTheme]);

  // Load from cloud on mount + subscribe to remote changes.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const remote = await cloudStorageService.get<ColorTheme>(
          COLOR_THEME_CLOUD_KEY,
        );
        if (cancelled) return;
        if (isColorTheme(remote) && remote !== colorTheme) {
          skipRemoteColorRef.current = true;
          setColorThemeState(remote);
        }
      } catch {
        /* noop */
      }
      // Subscribe so another device's change reflects here instantly.
      try {
        unsub = cloudStorageService.subscribe<ColorTheme>(
          COLOR_THEME_CLOUD_KEY,
          undefined,
          (val) => {
            if (isColorTheme(val) && val !== colorTheme) {
              skipRemoteColorRef.current = true;
              setColorThemeState(val);
            }
          },
        );
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setColorTheme = useCallback((ct: ColorTheme) => {
    setColorThemeState(ct);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        toggleTheme,
        colorTheme,
        colorThemeMeta,
        setColorTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
