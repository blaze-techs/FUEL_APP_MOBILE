import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useTheme } from "@/react-app/context/ThemeContext";
import { COLOR_THEMES } from "@/react-app/context/ThemeContext";
import { useLocation } from "@/react-app/context/LocationContext";
import { useTutorial } from "@/react-app/context/TutorialContext";
import LocationSelector from "@/react-app/components/LocationSelector";
import TabConfigModal from "@/react-app/components/TabConfigModal";
import SyncStatusIndicator from "@/react-app/components/SyncStatusIndicator";
import RoleSelector from "@/react-app/components/RoleSelector";
import QuickSearch from "@/react-app/components/QuickSearch";
import NotificationCenter from "@/react-app/components/NotificationCenter";
import { useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { uploadStationLogo } from "@/react-app/lib/logo-storage-service";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
import {
  Fuel,
  Sun,
  Moon,
  Settings,
  User,
  Download,
  QrCode,
  LogOut,
  Edit3,
  Image,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  X,
  Check,
  Menu,
  LayoutDashboard,
  Crown,
  Loader2,
  HelpCircle,
  Palette,
} from "lucide-react";

interface HeaderProps {
  onShowStations?: () => void;
  onShowCombined?: () => void;
}

export default function Header({
  onShowStations,
  onShowCombined,
}: HeaderProps) {
  const { state, dispatch } = useFuel();
  const { user, logout } = useAuth();
  const { currentStation, stations, switchStation } = useStations();
  const {
    resolvedTheme,
    toggleTheme,
    colorTheme,
    colorThemeMeta,
    setColorTheme,
  } = useTheme();
  const location = useLocation();
  const tutorial = useTutorial();
  const navigate = useNavigate();
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [showColorThemes, setShowColorThemes] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showStationMenu, setShowStationMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showTabConfig, setShowTabConfig] = useState(false);
  const [showCustomizeMenu, setShowCustomizeMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [editData, setEditData] = useState({ ...state.companyData });
  const [editDirty, setEditDirty] = useState(false);
  const [logoPreview, setLogoPreview] = useState(state.companyData.logo || "");
  const [logoUploading, setLogoUploading] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const customizeMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node)
      ) {
        setShowMobileMenu(false);
      }
      if (
        customizeMenuRef.current &&
        !customizeMenuRef.current.contains(e.target as Node)
      ) {
        setShowCustomizeMenu(false);
      }
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // CRITICAL: Sync the Company Profile form with the authoritative
  // state.companyData whenever it changes (e.g. after an async cloud load on a
  // fresh device/browser). Without this, editData is captured once at mount
  // from the default/empty state and never updates — so the user sees empty
  // fields and must re-type their company details every session, even though
  // the data is correctly persisted in cloud storage. We only re-sync when the
  // user has NOT started editing (editDirty flag) so in-progress edits are not
  // clobbered. Also tracks the logo so a cloud-loaded logo wins over a stale
  // local blob URL preview after refresh.
  useEffect(() => {
    if (!editDirty) {
      setEditData({ ...state.companyData });
    }
    if (state.companyData.logo) {
      setLogoPreview(state.companyData.logo);
    }
  }, [state.companyData, editDirty]);

  const handleToggleTheme = () => {
    toggleTheme();
  };

  const handleEditInfo = () => {
    dispatch({ type: "SET_COMPANY_DATA", payload: editData });
    setEditDirty(false);
    setShowEditInfo(false);
  };

  // Wrapper that marks the form as dirty so the cloud-sync effect above does
  // not clobber in-progress edits with freshly-loaded state.
  const updateEdit = (patch: Partial<typeof editData>) => {
    setEditDirty(true);
    setEditData((prev) => ({ ...prev, ...patch }));
  };

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show an instant local preview so the user gets feedback while uploading.
    const localPreview = URL.createObjectURL(file);
    setLogoPreview(localPreview);
    setLogoUploading(true);

    try {
      if (!user?.id) {
        throw new Error("You must be signed in to upload a logo.");
      }
      // Upload to Supabase Storage (cross-device) and store the public URL —
      // NOT a base64 blob — so the logo survives refresh and syncs to every
      // device signed into the same account.
      const { url } = await uploadStationLogo(file, user.id);
      setLogoPreview(url);
      setEditData((p) => ({ ...p, logo: url }));
      dispatch({
        type: "SET_COMPANY_DATA",
        payload: { ...state.companyData, logo: url },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Logo upload failed:", msg);
      toastError(`Could not upload logo: ${msg}`);
      // Revert preview to whatever was previously persisted.
      setLogoPreview(state.companyData.logo || "");
    } finally {
      setLogoUploading(false);
      // Reset the input so the same file can be re-selected.
      if (e.target) e.target.value = "";
    }
  };

  const generateQRCode = () => {
    const data = JSON.stringify({
      company: state.companyData.name,
      vat: state.companyData.vatRegNo,
      taxId: state.companyData.kraPin || state.companyData.vatRegNo || "",
      phone: state.companyData.contacts,
    });
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
    const link = document.createElement("a");
    link.download = `qrcode_${state.companyData.name}.png`;
    link.href = qrUrl;
    link.click();
  };

  return (
    <header className="bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 border-b border-gray-200 dark:border-white/10 text-gray-900 dark:text-white shadow-sm dark:shadow-lg relative z-40">
      {/* Desktop Header */}
      <div className="container mx-auto px-2 sm:px-4 py-1.5 sm:py-2 lg:py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Logo & Company */}
          <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
            {state.companyData.logo || logoPreview ? (
              <img
                src={state.companyData.logo || logoPreview}
                alt="Logo"
                className="w-9 h-9 rounded-lg object-cover border border-white/20"
              />
            ) : (
              <div className="w-9 h-9 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Fuel size={18} className="text-gray-900 dark:text-white" />
              </div>
            )}
            <div className="min-w-0 max-w-44 xl:max-w-60">
              <h1 className="text-base font-bold font-serif truncate leading-tight">
                {currentStation?.name || state.companyData.name || "FuelPro"}
              </h1>
              <p className="text-[9px] text-gray-500 dark:text-gray-400 truncate leading-tight">
                {currentStation?.location &&
                currentStation.location !== "Auto-detected"
                  ? currentStation.location
                  : "Fuel Station Management"}
              </p>
            </div>
          </div>

          {/* Center: Location + Station switcher (desktop) */}
          <div className="hidden lg:flex items-center gap-2">
            <LocationSelector compact />
            <div className="w-px h-5 bg-gray-200 dark:bg-white/10" />
            {/* Station switcher — switching, combined view, add/manage all
                live inside ONE dropdown to keep the bar uncluttered. */}
            {stations.length > 0 ? (
              <div className="relative inline-block">
                <button
                  onClick={() => setShowStationMenu(!showStationMenu)}
                  aria-haspopup="listbox"
                  aria-expanded={showStationMenu}
                  title="Switch station"
                  className="flex h-9 items-center gap-1.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium transition-all duration-150 border border-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                >
                  <Layers size={12} />
                  <span className="max-w-28 truncate">
                    {currentStation?.name}
                  </span>
                  <ChevronDown
                    size={10}
                    className={`transition-transform duration-150 ${showStationMenu ? "rotate-180" : ""}`}
                  />
                </button>
                {showStationMenu && (
                  <div
                    className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-white/10 overflow-hidden z-50 transition-all duration-150 origin-top"
                    role="listbox"
                  >
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Stations
                    </p>
                    {stations.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          switchStation(s.id);
                          setShowStationMenu(false);
                        }}
                        className={`w-full flex h-10 items-center gap-2.5 px-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors duration-150 ${currentStation?.id === s.id ? "bg-amber-500/10" : ""}`}
                      >
                        <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-amber-700 rounded-md flex items-center justify-center text-[10px] font-bold text-white">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs text-gray-800 dark:text-gray-200 truncate">
                          {s.name}
                        </span>
                        {currentStation?.id === s.id && (
                          <Check size={12} className="text-amber-400 ml-auto" />
                        )}
                      </button>
                    ))}
                    <div className="h-px bg-gray-200 dark:bg-white/10 my-1" />
                    {onShowCombined && (
                      <button
                        onClick={() => {
                          onShowCombined();
                          setShowStationMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <Layers size={13} className="text-gray-500" />
                        <span>Combined View</span>
                      </button>
                    )}
                    {onShowStations && (
                      <button
                        onClick={() => {
                          onShowStations();
                          setShowStationMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <Plus size={13} className="text-gray-500" />
                        <span>Add / Manage Stations</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              onShowStations && (
                <button
                  onClick={onShowStations}
                  className="flex h-9 items-center gap-1.5 px-3 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  <Plus size={12} /> Add Station
                </button>
              )
            )}
          </div>

          {/* Desktop Actions — organized into 3 zones: Workspace · Utilities · Account */}
          <div className="hidden md:flex items-center gap-1.5">
            {/* ── Zone 1: Workspace status ── */}
            <div className="flex items-center gap-1.5 pr-2 border-r border-gray-200 dark:border-white/10">
              <SyncStatusIndicator
                countryCode={location.currentCountry.id}
                compact
              />
            </div>

            {/* ── Zone 2: Global utilities (search, alerts, customize) ── */}
            <div className="flex items-center gap-1.5">
              <QuickSearch
                entries={[
                  ...(state.tabConfigurations || []).map((tab) => ({
                    id: tab.id,
                    label: tab.label,
                    description: tab.description || "",
                    category: "Navigation" as const,
                    tabId: tab.id,
                    keywords: `${tab.id} ${tab.label}`,
                  })),
                  {
                    id: "qa-pos",
                    label: "New Sale (POS)",
                    description: "Quick fuel sale",
                    category: "Quick Action" as const,
                    tabId: "pos",
                    keywords: "sell checkout pos cart",
                  },
                  {
                    id: "qa-invoice",
                    label: "New Invoice",
                    description: "Create a new invoice",
                    category: "Quick Action" as const,
                    tabId: "invoice",
                    keywords: "bill receipt customer",
                  },
                  {
                    id: "qa-expense",
                    label: "Record Expense",
                    description: "Log a new expense",
                    category: "Quick Action" as const,
                    tabId: "expenses",
                    keywords: "cost spend money",
                  },
                  {
                    id: "qa-credit",
                    label: "Credit Accounts",
                    description: "Manage customer credit",
                    category: "Quick Action" as const,
                    tabId: "credit",
                    keywords: "debt loan customer balance",
                  },
                  {
                    id: "qa-stkpush",
                    label: "M-PESA STK Push",
                    description: "Collect payment via M-PESA",
                    category: "Quick Action" as const,
                    tabId: "livetransaction",
                    keywords: "mpesa payment collect phone",
                  },
                ]}
              />
              <NotificationCenter />
              {/* Customize menu — groups every appearance/layout/branding
                  control (Theme, Tabs, Logo, QR, Tutorial, light/dark) into ONE
                  professional dropdown instead of a scattered button strip. */}
              <div className="relative" ref={customizeMenuRef}>
                <button
                  onClick={() => setShowCustomizeMenu((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showCustomizeMenu}
                  title="Customize & Tools"
                  className="h-9 px-3 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-1.5"
                >
                  <Settings size={12} />
                  <span className="hidden lg:inline">Customize</span>
                  <ChevronDown
                    size={10}
                    className={`transition-transform duration-150 ${showCustomizeMenu ? "rotate-180" : ""}`}
                  />
                </button>
                {/* Color-theme picker popover (opened from inside the
                    Customize dropdown, anchored to the same trigger). */}
                {showColorThemes && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 px-1">
                      App Color Theme
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {COLOR_THEMES.map((t) => {
                        const sel = colorTheme === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setColorTheme(t.id);
                              setShowColorThemes(false);
                              toastSuccess(`Theme: ${t.name}`);
                            }}
                            className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                              sel
                                ? "border-transparent fp-accent-ring"
                                : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20"
                            }`}
                          >
                            <span
                              className="w-5 h-5 rounded-full border border-black/10 shrink-0"
                              style={{
                                background: `linear-gradient(135deg, ${t.tintHex} 0%, ${t.primaryHex} 100%)`,
                              }}
                            />
                            <span className="text-[11px] font-medium text-gray-900 dark:text-white truncate">
                              {t.name}
                            </span>
                            {sel && (
                              <Check
                                size={12}
                                className="text-gray-900 ml-auto shrink-0"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1">
                      Syncs across your devices
                    </p>
                  </div>
                )}
                {showCustomizeMenu && (
                  <div
                    role="listbox"
                    className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-white/10 overflow-hidden z-50 transition-all duration-150 origin-top-right"
                  >
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Appearance
                    </p>
                    <button
                      onClick={() => {
                        setShowColorThemes((v) => !v);
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <Palette
                        size={13}
                        style={{ color: colorThemeMeta.primaryHex }}
                      />
                      <span>Color Theme</span>
                      <span className="ml-auto text-[10px] text-gray-400 truncate max-w-20">
                        {colorThemeMeta.name}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        handleToggleTheme();
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      {resolvedTheme === "dark" ? (
                        <Sun size={13} className="text-amber-400" />
                      ) : (
                        <Moon size={13} className="text-gray-500" />
                      )}
                      <span>
                        {resolvedTheme === "dark"
                          ? "Switch to Light Mode"
                          : "Switch to Dark Mode"}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setShowTabConfig(true);
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <LayoutDashboard size={13} className="text-gray-500" />
                      <span>Layout & Tabs</span>
                    </button>
                    <div className="h-px bg-gray-200 dark:bg-white/10 my-1" />
                    <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Branding & Tools
                    </p>
                    <label className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer">
                      {logoUploading ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Image size={13} className="text-gray-500" />
                      )}
                      <span>
                        {logoUploading ? "Uploading logo…" : "Upload Logo"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          handleLogoChange(e);
                          setShowCustomizeMenu(false);
                        }}
                        disabled={logoUploading}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={() => {
                        setShowQRCode(true);
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <QrCode size={13} className="text-gray-500" />
                      <span>Company QR Code</span>
                    </button>
                    <button
                      onClick={() => {
                        tutorial.startTutorial("basic");
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <HelpCircle size={13} className="text-amber-400" />
                      <span>Replay Tutorial</span>
                    </button>
                    <button
                      onClick={() => {
                        switchToTab("settings");
                        setShowCustomizeMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <Settings size={13} className="text-gray-500" />
                      <span>General Settings</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Zone 3: Account (role, company info, admin, sign out) ── */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-gray-200 dark:border-white/10">
              <RoleSelector />
              <div className="relative" ref={profileMenuRef}>
                <button
                  onClick={() => setShowProfileMenu((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showProfileMenu}
                  title="Account"
                  className="flex h-9 items-center gap-2 pl-1.5 pr-2.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                >
                  <div className="w-6 h-6 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
                    {user?.name?.charAt(0).toUpperCase() || <User size={11} />}
                  </div>
                  <span className="hidden xl:inline text-xs font-medium text-gray-800 dark:text-gray-200 max-w-24 truncate">
                    {user?.name || "Account"}
                  </span>
                  <ChevronDown
                    size={10}
                    className={`text-gray-500 transition-transform duration-150 ${showProfileMenu ? "rotate-180" : ""}`}
                  />
                </button>
                {showProfileMenu && (
                  <div
                    role="listbox"
                    className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-white/10 overflow-hidden z-50 transition-all duration-150 origin-top-right"
                  >
                    <div className="px-3 py-2.5 border-b border-gray-200 dark:border-white/10">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                        {user?.name || "Signed in"}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                        {user?.email}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setShowEditInfo(true);
                        setShowProfileMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <Edit3 size={13} className="text-gray-500" />
                      <span>Edit Company Info</span>
                    </button>
                    <button
                      onClick={() => {
                        navigate("/founder");
                        setShowProfileMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                    >
                      <Crown size={13} />
                      <span>Admin Console</span>
                      <ChevronRight size={11} className="ml-auto" />
                    </button>
                    <div className="h-px bg-gray-200 dark:bg-white/10 my-1" />
                    <button
                      onClick={() => {
                        logout();
                        setShowProfileMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 h-10 text-left text-xs text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut size={13} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile: Hamburger Menu */}
          <div
            className="flex md:hidden items-center gap-2"
            ref={mobileMenuRef}
          >
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="p-2.5 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 rounded-xl transition-colors text-gray-700 dark:text-gray-200"
            >
              {showMobileMenu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {showMobileMenu && (
        <div className="md:hidden bg-white dark:bg-slate-800/95 backdrop-blur-lg border-t border-gray-200 dark:border-white/10 shadow-2xl text-gray-900 dark:text-white">
          <div className="container mx-auto px-4 py-4 space-y-3">
            {/* Location & Station */}
            <div className="flex items-center justify-between">
              <LocationSelector compact />
              {stations.length > 1 && (
                <div className="relative inline-block">
                  <button
                    onClick={() => setShowStationMenu(!showStationMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium border border-amber-500/30"
                  >
                    <Layers size={12} />
                    <span className="max-w-28 truncate">
                      {currentStation?.name}
                    </span>
                    <ChevronDown size={10} />
                  </button>
                  {showStationMenu && (
                    <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-white/10 overflow-hidden z-50">
                      {stations.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            switchStation(s.id);
                            setShowStationMenu(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 ${currentStation?.id === s.id ? "bg-amber-500/10" : ""}`}
                        >
                          <div className="w-5 h-5 bg-amber-500 rounded flex items-center justify-center text-[9px] font-bold text-gray-900 dark:text-white">
                            {s.name.charAt(0)}
                          </div>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile menu — grouped sections mirroring the desktop zones */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1 mb-1.5">
                Workspace
              </p>
              <div className="grid grid-cols-2 gap-2">
                {onShowStations && (
                  <button
                    onClick={() => {
                      onShowStations();
                      setShowMobileMenu(false);
                    }}
                    className="flex items-center gap-2 p-2.5 bg-gray-100 dark:bg-white/5 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-left"
                  >
                    <Layers size={15} className="text-amber-400" />
                    <span className="text-xs text-gray-700 dark:text-gray-300">
                      Stations
                    </span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowEditInfo(!showEditInfo);
                    setShowMobileMenu(false);
                  }}
                  className="flex items-center gap-2 p-2.5 bg-gray-100 dark:bg-white/5 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-left"
                >
                  <Edit3 size={15} className="text-gray-500" />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    Company Info
                  </span>
                </button>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1 mb-1.5">
                Customize & Tools
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setShowColorThemes((v) => !v);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                  title={`Theme: ${colorThemeMeta.name}`}
                >
                  <Palette
                    size={16}
                    style={{ color: colorThemeMeta.primaryHex }}
                  />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Theme
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowTabConfig(true);
                    setShowMobileMenu(false);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                >
                  <LayoutDashboard
                    size={16}
                    className="text-gray-600 dark:text-gray-300"
                  />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Tabs
                  </span>
                </button>
                <label className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors cursor-pointer">
                  {logoUploading ? (
                    <Loader2
                      size={16}
                      className="text-gray-600 dark:text-gray-300 animate-spin"
                    />
                  ) : (
                    <Image
                      size={16}
                      className="text-gray-600 dark:text-gray-300"
                    />
                  )}
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {logoUploading ? "Uploading…" : "Logo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={logoUploading}
                    onChange={(e) => {
                      handleLogoChange(e);
                      setShowMobileMenu(false);
                    }}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => {
                    setShowQRCode(true);
                    setShowMobileMenu(false);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                >
                  <QrCode
                    size={16}
                    className="text-gray-600 dark:text-gray-300"
                  />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    QR Code
                  </span>
                </button>
                <button
                  onClick={() => {
                    tutorial.startTutorial("basic");
                    setShowMobileMenu(false);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                >
                  <HelpCircle size={16} className="text-amber-400" />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Tutorial
                  </span>
                </button>
                <button
                  onClick={() => {
                    switchToTab("settings");
                    setShowMobileMenu(false);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                  title="General Settings"
                >
                  <Settings
                    size={16}
                    className="text-gray-600 dark:text-gray-300"
                  />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Settings
                  </span>
                </button>
                <button
                  onClick={() => {
                    handleToggleTheme();
                    setShowMobileMenu(false);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 bg-gray-100 dark:bg-white/5 rounded-xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                >
                  {resolvedTheme === "dark" ? (
                    <Sun size={16} className="text-amber-400" />
                  ) : (
                    <Moon
                      size={16}
                      className="text-gray-600 dark:text-gray-300"
                    />
                  )}
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {resolvedTheme === "dark" ? "Light" : "Dark"}
                  </span>
                </button>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1 mb-1.5">
                Account
              </p>
              <button
                onClick={() => {
                  navigate("/founder");
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-2 p-2.5 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 transition-colors text-left"
              >
                <Crown size={15} className="text-amber-400" />
                <span className="text-xs text-amber-500 dark:text-amber-400">
                  Admin Console
                </span>
                <ChevronRight size={12} className="ml-auto text-amber-400" />
              </button>
            </div>

            {/* Inline color theme picker (mobile) — design spec 99.txt */}
            {showColorThemes && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl p-3 space-y-2">
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 px-1">
                  App Color Theme
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_THEMES.map((t) => {
                    const sel = colorTheme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setColorTheme(t.id);
                          setShowColorThemes(false);
                          toastSuccess(`Theme: ${t.name}`);
                        }}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                          sel
                            ? "border-transparent fp-accent-ring"
                            : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20"
                        }`}
                      >
                        <span
                          className="w-5 h-5 rounded-full border border-black/10 shrink-0"
                          style={{
                            background: `linear-gradient(135deg, ${t.tintHex} 0%, ${t.primaryHex} 100%)`,
                          }}
                        />
                        <span className="text-[11px] font-medium text-gray-900 dark:text-white truncate">
                          {t.name}
                        </span>
                        {sel && (
                          <Check
                            size={12}
                            className="text-gray-900 ml-auto shrink-0"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1">
                  Syncs across your devices
                </p>
              </div>
            )}

            {/* User & Logout */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-white/10">
              {/* Firebase User Profile */}
              {user ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-xs font-bold">
                    {user.name?.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-800 dark:text-gray-200">
                    {user.name}
                  </span>
                </div>
              ) : null}
              <button
                onClick={() => {
                  logout();
                  setShowMobileMenu(false);
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs flex items-center gap-2 transition-colors"
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Info Panel */}
      {showEditInfo && (
        <div className="bg-gray-50 dark:bg-white/5 border-t border-gray-200 dark:border-white/10 px-4 py-4">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Company Profile</h3>
              <button
                onClick={() => setShowEditInfo(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
              >
                <X size={16} />
              </button>
            </div>
            {/* Company Profile Form */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Row 1: Company Name, P.O. Box, Contacts */}
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  Company Name
                </label>
                <input
                  value={editData.name}
                  onChange={(e) => updateEdit({ name: e.target.value })}
                  placeholder="e.g. Acme Fuel Station Ltd"
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  P.O. Box
                </label>
                <input
                  value={editData.poBox}
                  onChange={(e) => updateEdit({ poBox: e.target.value })}
                  placeholder="e.g. 12345-00100"
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  Contacts (phone)
                </label>
                <input
                  value={editData.contacts}
                  onChange={(e) => updateEdit({ contacts: e.target.value })}
                  placeholder="+1 555 000 0000"
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              {/* Row 2: Email, Currency, VAT */}
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  Email Address
                </label>
                <input
                  value={editData.email}
                  onChange={(e) => updateEdit({ email: e.target.value })}
                  placeholder="info@company.com"
                  type="email"
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  Currency
                </label>
                <select
                  value={editData.currency}
                  onChange={(e) => updateEdit({ currency: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  {/* Detected station currency — shown first so the default
                      selection reflects the station's locale rather than
                      Kenya. */}
                  <option
                    value={getCurrencySymbol(getDetectedCurrency())}
                    className="bg-white dark:bg-gray-800"
                  >
                    {getDetectedCurrency()} — Detected
                  </option>
                  <option value="BRL" className="bg-white dark:bg-gray-800">
                    BRL — Brazilian Real
                  </option>
                  <option value="CNY" className="bg-white dark:bg-gray-800">
                    CNY — Chinese Yuan
                  </option>
                  <option value="EUR" className="bg-white dark:bg-gray-800">
                    EUR — Euro
                  </option>
                  <option value="GBP" className="bg-white dark:bg-gray-800">
                    GBP — British Pound
                  </option>
                  <option value="GHS" className="bg-white dark:bg-gray-800">
                    GHS — Ghana Cedi
                  </option>
                  <option value="INR" className="bg-white dark:bg-gray-800">
                    INR — Indian Rupee
                  </option>
                  <option value="JPY" className="bg-white dark:bg-gray-800">
                    JPY — Japanese Yen
                  </option>
                  <option value="KES" className="bg-white dark:bg-gray-800">
                    KES — Kenyan Shilling
                  </option>
                  <option value="NGN" className="bg-white dark:bg-gray-800">
                    NGN — Nigerian Naira
                  </option>
                  <option value="RWF" className="bg-white dark:bg-gray-800">
                    RWF — Rwanda Franc
                  </option>
                  <option value="TZS" className="bg-white dark:bg-gray-800">
                    TZS — Tanzania Shilling
                  </option>
                  <option value="UGX" className="bg-white dark:bg-gray-800">
                    UGX — Uganda Shilling
                  </option>
                  <option value="USD" className="bg-white dark:bg-gray-800">
                    USD — US Dollar
                  </option>
                  <option value="ZAR" className="bg-white dark:bg-gray-800">
                    ZAR — South African Rand
                  </option>
                  <option value="AUD" className="bg-white dark:bg-gray-800">
                    AUD — Australian Dollar
                  </option>
                  <option value="CAD" className="bg-white dark:bg-gray-800">
                    CAD — Canadian Dollar
                  </option>
                  <option value="CHF" className="bg-white dark:bg-gray-800">
                    CHF — Swiss Franc
                  </option>
                  <option value="CNY" className="bg-white dark:bg-gray-800">
                    CNY — Chinese Yuan
                  </option>
                  <option value="SGD" className="bg-white dark:bg-gray-800">
                    SGD — Singapore Dollar
                  </option>
                  <option value="HKD" className="bg-white dark:bg-gray-800">
                    HKD — Hong Kong Dollar
                  </option>
                  <option value="NZD" className="bg-white dark:bg-gray-800">
                    NZD — New Zealand Dollar
                  </option>
                  <option value="AED" className="bg-white dark:bg-gray-800">
                    AED — UAE Dirham
                  </option>
                  <option value="SAR" className="bg-white dark:bg-gray-800">
                    SAR — Saudi Riyal
                  </option>
                  <option value="BRL" className="bg-white dark:bg-gray-800">
                    BRL — Brazilian Real
                  </option>
                  <option value="MXN" className="bg-white dark:bg-gray-800">
                    MXN — Mexican Peso
                  </option>
                  <option value="RUB" className="bg-white dark:bg-gray-800">
                    RUB — Russian Ruble
                  </option>
                  <option value="TRY" className="bg-white dark:bg-gray-800">
                    TRY — Turkish Lira
                  </option>
                  <option value="KRW" className="bg-white dark:bg-gray-800">
                    KRW — South Korean Won
                  </option>
                  <option value="IDR" className="bg-white dark:bg-gray-800">
                    IDR — Indonesian Rupiah
                  </option>
                  <option value="MYR" className="bg-white dark:bg-gray-800">
                    MYR — Malaysian Ringgit
                  </option>
                  <option value="THB" className="bg-white dark:bg-gray-800">
                    THB — Thai Baht
                  </option>
                  <option value="PHP" className="bg-white dark:bg-gray-800">
                    PHP — Philippine Peso
                  </option>
                  <option value="VND" className="bg-white dark:bg-gray-800">
                    VND — Vietnamese Dong
                  </option>
                  <option value="EGP" className="bg-white dark:bg-gray-800">
                    EGP — Egyptian Pound
                  </option>
                  <option value="MAD" className="bg-white dark:bg-gray-800">
                    MAD — Moroccan Dirham
                  </option>
                  <option value="PKR" className="bg-white dark:bg-gray-800">
                    PKR — Pakistani Rupee
                  </option>
                  <option value="BDT" className="bg-white dark:bg-gray-800">
                    BDT — Bangladeshi Taka
                  </option>
                  <option value="ARS" className="bg-white dark:bg-gray-800">
                    ARS — Argentine Peso
                  </option>
                  <option value="CLP" className="bg-white dark:bg-gray-800">
                    CLP — Chilean Peso
                  </option>
                  <option value="COP" className="bg-white dark:bg-gray-800">
                    COP — Colombian Peso
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                  VAT Registration No
                </label>
                <input
                  value={editData.vatRegNo}
                  onChange={(e) => updateEdit({ vatRegNo: e.target.value })}
                  placeholder="VAT Reg No"
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              {/* Row 3: Bank Details */}
              <div className="sm:col-span-2 lg:col-span-3 border-t border-gray-200 dark:border-white/10 pt-2 mt-1">
                <p className="text-[10px] text-amber-400 font-medium mb-2">
                  Bank Details (For Invoices)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                      Bank Name
                    </label>
                    <input
                      value={editData.bankName}
                      onChange={(e) => updateEdit({ bankName: e.target.value })}
                      placeholder="e.g. Equity Bank"
                      className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                      Branch Name
                    </label>
                    <input
                      value={editData.branchName}
                      onChange={(e) =>
                        updateEdit({ branchName: e.target.value })
                      }
                      placeholder="e.g. Mombasa Road"
                      className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                      Account Holder Name
                    </label>
                    <input
                      value={editData.accountHolder}
                      onChange={(e) =>
                        updateEdit({
                          accountHolder: e.target.value,
                        })
                      }
                      placeholder="Account holder name"
                      className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                      Account Number
                    </label>
                    <input
                      value={editData.accountNumber}
                      onChange={(e) =>
                        updateEdit({
                          accountNumber: e.target.value,
                        })
                      }
                      placeholder="1234567890"
                      type="text"
                      inputMode="numeric"
                      className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                </div>
              </div>

              {/* Save button */}
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <button
                  onClick={handleEditInfo}
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  <Check size={14} /> Save Company Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQRCode && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setShowQRCode(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Company QR Code</h3>
              <button
                onClick={() => setShowQRCode(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="bg-white p-4 rounded-xl flex items-center justify-center mb-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(JSON.stringify({ company: state.companyData.name, vat: state.companyData.vatRegNo, phone: state.companyData.contacts, pin: state.companyData.kraPin }))}`}
                alt="QR Code"
                className="w-48 h-48"
              />
            </div>
            <button
              onClick={generateQRCode}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Download size={16} /> Download QR Code
            </button>
          </div>
        </div>
      )}

      {/* TABS Config Modal */}
      {showTabConfig && (
        <TabConfigModal onClose={() => setShowTabConfig(false)} />
      )}
    </header>
  );
}
