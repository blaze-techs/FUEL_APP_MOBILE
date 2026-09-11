import { useState, useEffect } from "react";
import type { Station } from "@/react-app/context/StationContext";
import { getVATRate } from "@/react-app/config/pricing";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import {
  Building2,
  Link2,
  ArrowRight,
  Eye,
  EyeOff,
  Fuel,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Globe,
  Lock,
  ShieldCheck,
  X,
  User,
  ArrowLeft,
  LogIn,
  ExternalLink,
} from "lucide-react";
import {
  useAuth,
  type StationRoleBinding,
} from "@/react-app/context/AuthContext";
import { useNavigate } from "react-router";

interface FirstLoginChoiceProps {
  existingStations: Station[];
  showAccessMode: boolean;
  onCreateStation: () => void;
  onAccessShared: (stationId: string, password: string) => boolean;
  onSelectStation: (stationId: string) => boolean;
  loginAdmin: (username: string, password: string) => boolean;
}

function loadBindings(): StationRoleBinding[] {
  try {
    const stored = localStorage.getItem("fuelpro_role_bindings");
    if (stored) return JSON.parse(stored);
  } catch {
    /* ignore */
  }
  return [];
}

export default function FirstLoginChoice({
  existingStations,
  showAccessMode,
  onCreateStation,
  onAccessShared,
  onSelectStation,
  loginAdmin,
}: FirstLoginChoiceProps) {
  const { user, hasAnyBinding } = useAuth();
  const [mode, setMode] = useState<"choice" | "access" | "admin">("choice");
  const [bindings, setBindings] = useState<StationRoleBinding[]>(loadBindings);
  const [autoRedirecting, setAutoRedirecting] = useState(true);
  const [stationName, setStationName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Admin login state
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminSuccess, setAdminSuccess] = useState("");
  const navigate = useNavigate();

  // Create a station locally from binding data when the station doesn't exist
  const createStationFromBinding = (binding: StationRoleBinding) => {
    try {
      const STORAGE_KEY = "fuelpro_stations_v3";
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored
        ? JSON.parse(stored)
        : { stations: [], version: "3.0" };
      const stations = parsed.stations || [];

      // Only create if it doesn't already exist
      if (!stations.some((s: any) => s.id === binding.stationId)) {
        const newStation = {
          id: binding.stationId,
          name: binding.stationName,
          location: "Unknown Location",
          phone: "",
          email: "",
          kraPin: "",
          etrSerial: "",
          taxRate: getVATRate(getDetectedCountryCode()),
          theme: "default",
          logo: "",
          description: `Station accessed via ${binding.role} invite`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: {},
          access: [],
          sharedUsers: [],
        };
        stations.push(newStation);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ stations, version: "3.0" }),
        );
      }

      // Now select it
      onSelectStation(binding.stationId);
      import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
        broadcastReload(),
      );
    } catch {
      setError("Failed to create station. Please refresh and try again.");
    }
  };

  // Filter shared stations that match the typed name
  const matchingStations =
    stationName.length >= 2
      ? existingStations.filter(
          (s) =>
            s.name.toLowerCase().includes(stationName.toLowerCase()) ||
            s.id.toLowerCase().includes(stationName.toLowerCase()) ||
            s.location.toLowerCase().includes(stationName.toLowerCase()),
        )
      : existingStations;

  // Auto-redirect: if user has a binding for an existing station, auto-select it
  useEffect(() => {
    if (!autoRedirecting) return;
    const allBindings = loadBindings();
    if (!user || allBindings.length === 0) {
      setAutoRedirecting(false);
      return;
    }
    // Find first active binding where the station exists locally
    const activeBinding = allBindings.find((b) => {
      if (!b.active) return false;
      return existingStations.some((s) => s.id === b.stationId);
    });
    if (activeBinding) {
      // Auto-switch to the bound station
      onSelectStation(activeBinding.stationId);
      import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
        broadcastReload(),
      );
      return; // Don't unmount, just reload
    }
    setAutoRedirecting(false);
  }, [user, existingStations, onSelectStation, autoRedirecting]);

  const handleAccess = () => {
    setError("");
    setSuccess("");

    if (!stationName.trim()) {
      setError("Please enter a station name or ID");
      return;
    }
    if (!password.trim()) {
      setError("Please enter the station password");
      return;
    }

    // Try to find matching station
    const matched =
      matchingStations.length === 1
        ? matchingStations[0]
        : existingStations.find(
            (s) => s.name.toLowerCase() === stationName.toLowerCase(),
          );

    if (!matched) {
      setError(
        `Station "${stationName}" not found. Check the name and try again.`,
      );
      return;
    }

    const ok = onAccessShared(matched.id, password);
    if (ok) {
      setSuccess(`Connected to ${matched.name}! Redirecting...`);
      setTimeout(
        () =>
          import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
            broadcastReload(),
          ),
        800,
      );
    } else {
      setError("Incorrect password. Please check and try again.");
    }
  };

  // ===== ADMIN LOGIN =====
  const handleAdminLogin = () => {
    setAdminError("");
    setAdminSuccess("");

    if (!adminUsername.trim()) {
      setAdminError("Please enter admin username");
      return;
    }
    if (!adminPassword.trim()) {
      setAdminError("Please enter admin password");
      return;
    }

    const ok = loginAdmin(adminUsername, adminPassword);
    if (ok) {
      setAdminSuccess("Admin login successful!");
      setTimeout(() => {
        navigate("/founder");
      }, 600);
    } else {
      setAdminError("Invalid admin credentials. Please check and try again.");
    }
  };

  if (mode === "access") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Back button */}
          <button
            onClick={() => {
              setMode("choice");
              setError("");
              setSuccess("");
            }}
            className="mb-4 text-sm text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <ArrowRight size={14} className="rotate-180" /> Back to options
          </button>

          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg">
                <Link2 size={24} className="text-white" />
              </div>
              <h2 className="text-xl font-bold text-white">
                Access Shared Station
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Enter the station details shared with you
              </p>
            </div>

            {/* Station Name / ID - TYPE IN FIELD */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Station Name or ID *
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => {
                    setStationName(e.target.value);
                    setError("");
                  }}
                  placeholder="Type station name..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  autoFocus
                />
                {/* Matching stations dropdown */}
                {matchingStations.length > 0 && (
                  <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                    {matchingStations.slice(0, 5).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStationName(s.name)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-slate-700 flex items-center gap-2 transition-colors"
                      >
                        <Building2 size={14} className="text-amber-400" />
                        <span>{s.name}</span>
                        {s.location && (
                          <span className="text-gray-500 text-xs">
                            ({s.location})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Station Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAccess()}
                    placeholder="Enter password..."
                    className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Error / Success */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle
                    size={16}
                    className="text-red-400 flex-shrink-0"
                  />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <CheckCircle2
                    size={16}
                    className="text-green-400 flex-shrink-0"
                  />
                  <p className="text-xs text-green-400">{success}</p>
                </div>
              )}

              {/* Connect button */}
              <button
                onClick={handleAccess}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
              >
                <Link2 size={18} />
                Connect to Station
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show loading while auto-redirecting
  if (autoRedirecting && hasAnyBinding()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center animate-pulse">
            <span className="text-2xl font-bold text-white">F</span>
          </div>
          <h2 className="text-xl font-bold text-white font-serif">FuelPro</h2>
          <p className="text-gray-400 text-sm mt-2">
            Connecting to your station...
          </p>
          <div className="mt-4 w-48 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full animate-pulse"
              style={{ width: "60%" }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ===== MAIN CHOICE VIEW =====
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 rounded-3xl mb-5 shadow-xl shadow-amber-500/20">
            <Fuel size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white font-serif mb-2">
            Welcome to FuelPro
          </h1>
          <p className="text-blue-200 text-sm">
            Auto-detecting fuel prices for your location
          </p>
        </div>

        {/* Location indicator - hidden when not needed */}
        <div className="flex items-center justify-center gap-2 mb-6 h-6">
          <MapPin size={14} className="text-green-400 animate-pulse" />
          <span className="text-xs text-green-400 bg-green-500/10 px-3 py-1 rounded-full border border-green-500/20">
            Location ready
          </span>
        </div>

        {/* Existing Stations - shown when stations exist but none selected */}
        {showAccessMode && existingStations.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-400 mb-3 text-center">
              Your Stations
            </h3>
            <div className="space-y-2">
              {existingStations.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelectStation(s.id)}
                  className="w-full flex items-center gap-3 p-3 bg-white/10 border border-white/20 rounded-xl hover:bg-white/15 hover:border-green-400/50 transition-all text-left"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Fuel size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400">{s.location}</p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-green-400 flex-shrink-0"
                  />
                </button>
              ))}
            </div>
            <div className="my-4 flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-gray-500">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </div>
        )}

        {/* Bound Stations - stations the user has been invited to */}
        {bindings.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-400 mb-3 text-center">
              Your Team Access
            </h3>
            <div className="space-y-2">
              {bindings
                .filter((b) => b.active)
                .map((b) => {
                  const localStation = existingStations.find(
                    (s) => s.id === b.stationId,
                  );
                  return (
                    <button
                      key={b.stationId}
                      onClick={() => {
                        if (localStation) {
                          onSelectStation(b.stationId);
                          import("@/react-app/lib/app-reloader").then(
                            ({ broadcastReload }) => broadcastReload(),
                          );
                        } else {
                          // Auto-create station from binding data then access it
                          createStationFromBinding(b);
                        }
                      }}
                      className="w-full flex items-center gap-3 p-3 bg-white/10 border border-white/20 rounded-xl hover:bg-white/15 hover:border-purple-400/50 transition-all text-left"
                    >
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <LogIn size={18} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">
                            {b.stationName}
                          </p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 capitalize">
                            {b.role}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {localStation
                            ? "Click to access"
                            : "Click to create local station"}
                        </p>
                      </div>
                      <ArrowRight
                        size={16}
                        className="text-purple-400 flex-shrink-0"
                      />
                    </button>
                  );
                })}
            </div>
            {bindings.filter((b) => b.active).length > 0 && (
              <div className="my-4 flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-gray-500">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            )}
          </div>
        )}

        {/* Two Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Create Station */}
          <button
            onClick={onCreateStation}
            className="group bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 text-left hover:bg-white/15 hover:border-amber-400/50 transition-all hover:shadow-xl hover:shadow-amber-500/10 hover:-translate-y-1"
          >
            <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
              <Building2 size={28} className="text-white" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">
              Create New Station
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Set up a new fuel station with your own configuration, pricing,
              and data.
            </p>
            <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
              Get Started{" "}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </div>
          </button>

          {/* Access Shared Station */}
          <button
            onClick={() => setMode("access")}
            className="group bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 text-left hover:bg-white/15 hover:border-blue-400/50 transition-all hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1"
          >
            <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
              <Link2 size={28} className="text-white" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">
              Access Shared Station
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Connect to a station shared by another user using a name and
              password.
            </p>
            <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
              Connect{" "}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </div>
          </button>
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              icon: Globe,
              label: "Auto-Pricing",
              desc: "Location-based",
              action: null,
            },
            { icon: Lock, label: "Secure", desc: "Encrypted", action: null },
            {
              icon: Fuel,
              label: "Multi-Station",
              desc: "Unlimited",
              action: null,
            },
            {
              icon: ShieldCheck,
              label: "Founder Access",
              desc: "Password Protected",
              action: () => navigate("/founder"),
            },
          ].map((f) => (
            <button
              key={f.label}
              onClick={f.action || undefined}
              className={`text-center p-3 rounded-xl border border-white/10 transition-all ${
                f.action
                  ? "bg-purple-500/10 hover:bg-purple-500/20 cursor-pointer"
                  : "bg-white/5"
              }`}
            >
              <f.icon
                size={16}
                className={`mx-auto mb-1 ${f.label === "Founder" ? "text-purple-400" : "text-amber-400"}`}
              />
              <p className="text-[11px] text-white font-medium">{f.label}</p>
              <p className="text-[10px] text-gray-500">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
