/**
 * FuelThemePicker — interactive, functional palette switcher (design spec 99.txt).
 *
 * Unlike the preview-only component in the spec, this one ACTUALLY applies the
 * selected soft pastel theme to the whole site (via ThemeContext →
 * <html data-color-theme="...">) and persists the choice cross-device via
 * cloudStorageService (Supabase app_kv + Realtime). A change on one device
 * reflects on every other signed-in device instantly.
 *
 * Rule 9 (Avoid Using Pure Colors): the 6 low-saturation pastel palettes
 * prevent eye strain during long telemetry monitoring sessions.
 */
import { Check, Palette, Fuel, RotateCcw } from "lucide-react";
import {
  useTheme,
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  type ColorTheme,
} from "@/react-app/context/ThemeContext";
import { toastSuccess } from "@/react-app/lib/toast";

export default function FuelThemePicker() {
  const { colorTheme, colorThemeMeta, setColorTheme } = useTheme();

  const handleSelect = (id: ColorTheme) => {
    if (id === colorTheme) return;
    setColorTheme(id);
    const meta = COLOR_THEMES.find((t) => t.id === id);
    toastSuccess(`Theme changed to ${meta?.name ?? id}`);
  };

  const handleReset = () => {
    setColorTheme(DEFAULT_COLOR_THEME);
    toastSuccess("Theme reset to Eucalyptus Glow");
  };

  return (
    <div className="w-full bg-white dark:bg-gray-900/60 p-5 rounded-3xl border border-gray-200 dark:border-white/10 font-sans space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="p-2 rounded-xl fp-accent-ring"
            style={{
              backgroundColor: `rgba(${hexToRgb(colorThemeMeta.primaryHex)}, 0.18)`,
            }}
          >
            <Palette
              className="w-5 h-5"
              style={{ color: colorThemeMeta.primaryHex }}
            />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">
              App Color Theme
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Soft muted accents (Rule 9 UI) · syncs across devices
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          title="Reset to default theme"
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Palette Selection Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {COLOR_THEMES.map((theme) => {
          const isSelected = colorTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => handleSelect(theme.id)}
              className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                isSelected
                  ? "fp-accent-ring border-transparent"
                  : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20"
              }`}
              style={{
                background: isSelected
                  ? `linear-gradient(135deg, ${theme.tintHex} 0%, ${theme.primaryHex} 100%)`
                  : undefined,
              }}
              aria-pressed={isSelected}
              aria-label={`Select ${theme.name} theme`}
            >
              <div className="space-y-1.5">
                <span
                  className={`text-xs font-bold block ${
                    isSelected
                      ? "text-gray-900"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {theme.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-4 h-4 rounded-full border border-black/20"
                    style={{ backgroundColor: theme.primaryHex }}
                  />
                  <span
                    className="w-4 h-4 rounded-full border border-black/20"
                    style={{ backgroundColor: theme.tintHex }}
                  />
                </div>
              </div>
              {isSelected && <Check className="w-4 h-4 text-gray-900" />}
            </button>
          );
        })}
      </div>

      {/* Live Preview Card */}
      <div
        className="p-5 rounded-2xl border border-black/10 transition-all space-y-3"
        style={{
          background: `linear-gradient(135deg, ${colorThemeMeta.tintHex} 0%, ${colorThemeMeta.primaryHex} 100%)`,
          color: "#1F2937",
        }}
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider bg-black/10 px-2 py-0.5 rounded-full">
            Active Theme Preview
          </span>
          <Fuel className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-lg font-bold">{colorThemeMeta.name}</h3>
          <p className="text-xs opacity-80">
            Applied site-wide · {colorThemeMeta.primaryHex} /{" "}
            {colorThemeMeta.tintHex}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Convert a #RRGGBB hex string to an "r, g, b" string for rgba(). */
function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "167, 196, 160";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `${r}, ${g}, ${b}`;
}
