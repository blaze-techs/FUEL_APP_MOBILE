import { useState } from "react";
import {
  Palette,
  Upload,
  Image,
  Type,
  Save,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

interface BrandConfig {
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  faviconUrl: string;
  loginBg: string;
  customCss: string;
  stationName: string;
  tagline: string;
}

const BRAND_KEY = "fuelpro_branding";
const DEFAULT_BRAND: BrandConfig = {
  primaryColor: "#d97706",
  accentColor: "#f59e0b",
  logoUrl: "",
  faviconUrl: "",
  loginBg: "",
  customCss: "",
  stationName: "",
  tagline: "",
};

function load(): BrandConfig {
  try {
    const s = localStorage.getItem(BRAND_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return { ...DEFAULT_BRAND };
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function BrandingSection({ logAudit }: Props) {
  const [brand, setBrand] = useState<BrandConfig>(load);
  const [saved, setSaved] = useState(false);

  const update = (k: keyof BrandConfig, v: string) => {
    setBrand((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    logAudit("Branding Updated", "Brand configuration saved", "success");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      update("logoUrl", reader.result as string);
    };
    reader.readAsDataURL(f);
  };

  const colors = [
    { name: "Amber", hex: "#d97706" },
    { name: "Blue", hex: "#2563eb" },
    { name: "Green", hex: "#059669" },
    { name: "Red", hex: "#dc2626" },
    { name: "Purple", hex: "#7c3aed" },
    { name: "Teal", hex: "#0d9488" },
    { name: "Rose", hex: "#e11d48" },
    { name: "Indigo", hex: "#4f46e5" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Palette size={18} className="text-pink-400" /> Branding
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Customize appearance and branding
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Colors */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Palette size={14} className="text-amber-400" /> Colors
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Primary Color
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {colors.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => update("primaryColor", c.hex)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${brand.primaryColor === c.hex ? "border-white scale-110" : "border-transparent hover:border-white/30"}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
            <input
              value={brand.primaryColor}
              onChange={(e) => update("primaryColor", e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Accent Color
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {colors.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => update("accentColor", c.hex)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${brand.accentColor === c.hex ? "border-white scale-110" : "border-transparent hover:border-white/30"}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
            <input
              value={brand.accentColor}
              onChange={(e) => update("accentColor", e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white font-mono"
            />
          </div>
        </div>

        {/* Logo */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Image size={14} className="text-blue-400" /> Logo
          </h3>
          <div className="w-full h-24 bg-white/5 rounded-lg flex items-center justify-center border border-dashed border-white/10">
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                className="max-h-20 max-w-full object-contain"
                alt="Logo"
              />
            ) : (
              <span className="text-xs text-gray-600">No logo uploaded</span>
            )}
          </div>
          <label className="w-full py-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors flex items-center justify-center gap-2 cursor-pointer">
            <Upload size={12} /> Upload Logo
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Station Identity */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Type size={14} className="text-green-400" /> Identity
          </h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Station Name
            </label>
            <input
              value={brand.stationName}
              onChange={(e) => update("stationName", e.target.value)}
              placeholder="Your Station Name"
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Tagline</label>
            <input
              value={brand.tagline}
              onChange={(e) => update("tagline", e.target.value)}
              placeholder="Your tagline..."
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
        </div>

        {/* Preview */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">Preview</h3>
          <div className="space-y-3">
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: brand.primaryColor + "20",
                border: `1px solid ${brand.primaryColor}40`,
              }}
            >
              <p className="text-xs text-gray-400">Primary Button</p>
              <button
                className="mt-1 px-3 py-1 rounded text-xs text-white"
                style={{ backgroundColor: brand.primaryColor }}
              >
                {brand.stationName || "FuelPro"}
              </button>
            </div>
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: brand.accentColor + "20",
                border: `1px solid ${brand.accentColor}40`,
              }}
            >
              <p className="text-xs text-gray-400">Accent Element</p>
              <div
                className="mt-1 w-8 h-1 rounded"
                style={{ backgroundColor: brand.accentColor }}
              />
            </div>
            {brand.tagline && (
              <p className="text-xs text-gray-500 italic">
                &ldquo;{brand.tagline}&rdquo;
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
