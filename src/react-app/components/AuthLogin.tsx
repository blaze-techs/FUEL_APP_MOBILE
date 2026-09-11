import { useAuth } from "@/react-app/context/AuthContext";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import {
  ShieldCheck,
  Lock,
  Zap,
  Cloud,
  Server,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  LogIn,
  Fuel,
  User,
  Search,
  Building2,
} from "lucide-react";
import {
  loginWithAccessCode,
  lookupStation,
  type StationLookupResult,
} from "@/react-app/lib/station-access-code-service";

type LoginMode = "email" | "username" | "register" | "station";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Official Google "G" logo (multi-color) as inline SVG so we don't need an
// external asset and it renders crisply on the auth screens.
function GoogleLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// Persistent storage keys for form data
const PERSISTED_EMAIL_KEY = "fuelpro_login_email";
const PERSISTED_PASSWORD_KEY = "fuelpro_login_password";

// Load persisted form data
function loadPersistedFormData() {
  try {
    return {
      email: localStorage.getItem(PERSISTED_EMAIL_KEY) || "",
      password: localStorage.getItem(PERSISTED_PASSWORD_KEY) || "",
    };
  } catch {
    return { email: "", password: "" };
  }
}

// Save form data to localStorage (email only for security)
function savePersistedFormData(email: string, _password: string) {
  try {
    // Only persist email, never persist password for security
    localStorage.setItem(PERSISTED_EMAIL_KEY, email);
  } catch {
    // Ignore storage errors
  }
}

export default function AuthLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    loginWithEmail,
    registerWithEmail,
    loginWithUsername,
    loginWithGoogleToken,
    updateProfile,
    user,
    isPending,
    error,
    clearError,
  } = useAuth();

  // Load persisted form data to prevent state loss on remount
  const persistedData = useRef(loadPersistedFormData());

  // Default to register mode when the user lands on /sign-up (new users);
  // otherwise default to email sign-in (returning users).
  const [mode, setMode] = useState<LoginMode>(
    location.pathname === "/sign-up" ? "register" : "email",
  );
  const [email, setEmail] = useState(persistedData.current.email);
  const [password, setPassword] = useState(persistedData.current.password);
  const [username, setUsername] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("fuel_retail");
  const [companyRegNo, setCompanyRegNo] = useState("");
  const [taxId, setTaxId] = useState("");
  const [showCompanyFields, setShowCompanyFields] = useState(false);
  const [localError, setLocalError] = useState("");
  const [success, setSuccess] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  // --- Station Member login (access code) state ---
  const [stationQuery, setStationQuery] = useState("");
  const [stationResults, setStationResults] = useState<StationLookupResult[]>(
    [],
  );
  const [selectedStation, setSelectedStation] =
    useState<StationLookupResult | null>(null);
  const [stationSearching, setStationSearching] = useState(false);
  const [stationUsername, setStationUsername] = useState("");
  const [stationPassword, setStationPassword] = useState("");
  const [stationLoginLoading, setStationLoginLoading] = useState(false);
  // Fallback manual entry (when the lookup_station RPC isn't available).
  const [manualOwnerId, setManualOwnerId] = useState("");
  const [manualStationId, setManualStationId] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const stationSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the Google spinner once auth completes (token-flow success path —
  // the failure path clears it in handleGoogleLogin). Also add a safety
  // timeout so a stuck GIS prompt never leaves the button spinning forever.
  useEffect(() => {
    if (user && googleLoading) setGoogleLoading(false);
  }, [user, googleLoading]);
  useEffect(() => {
    if (!googleLoading) return;
    const t = setTimeout(() => setGoogleLoading(false), 30_000);
    return () => clearTimeout(t);
  }, [googleLoading]);

  // Stable callback for email change with persistence
  const handleEmailChange = useCallback(
    (value: string) => {
      setEmail(value);
      savePersistedFormData(value, password);
    },
    [password],
  );

  // Stable callback for password change with persistence
  const handlePasswordChange = useCallback(
    (value: string) => {
      setPassword(value);
      savePersistedFormData(email, value);
    },
    [email],
  );

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  // Clear errors when switching modes
  useEffect(() => {
    setLocalError("");
    setSuccess("");
    clearError();
  }, [mode, clearError]);

  // Sync auth context error to local
  useEffect(() => {
    if (error) setLocalError(error);
  }, [error]);

  // Clear password from persistence on successful login
  useEffect(() => {
    if (user) {
      try {
        localStorage.removeItem(PERSISTED_PASSWORD_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }, [user]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!email.trim()) {
      setLocalError("Please enter your email");
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setLocalError("Please enter a valid email address");
      return;
    }
    if (!password) {
      setLocalError("Please enter your password");
      return;
    }
    const result = await loginWithEmail(email.trim(), password);
    if (!result.success)
      setLocalError(result.error || "Invalid email or password");
  };

  const handleUsernameLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!username.trim()) {
      setLocalError("Please enter your username");
      return;
    }
    if (!password) {
      setLocalError("Please enter your password");
      return;
    }
    const ok = await loginWithUsername(username.trim(), password);
    if (!ok) setLocalError(error || "Invalid username or password");
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    setSuccess("");
    if (!regName.trim()) {
      setLocalError("Please enter your name");
      return;
    }
    if (!regEmail.trim()) {
      setLocalError("Please enter your email");
      return;
    }
    if (!EMAIL_REGEX.test(regEmail.trim())) {
      setLocalError("Please enter a valid email address");
      return;
    }
    if (!regPassword || regPassword.length < 6) {
      setLocalError("Password must be at least 6 characters");
      return;
    }
    if (regPassword !== regConfirm) {
      setLocalError("Passwords do not match");
      return;
    }
    const ok = await registerWithEmail(
      regEmail.trim(),
      regPassword,
      regName.trim(),
    );
    if (ok) {
      // Save company profile to cloud (cross-device) + localStorage cache
      if (companyName || companyRegNo || taxId) {
        const companyProfile = {
          name: companyName || regName.trim(),
          phone: companyPhone,
          address: companyAddress,
          industry: companyIndustry,
          regNo: companyRegNo,
          taxId,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem(
          "fuelpro_company_profile",
          JSON.stringify(companyProfile),
        );
        // Also save to cloud KV store for cross-device access
        try {
          const { cloudStorageService } =
            await import("@/react-app/lib/cloud-storage-service");
          await cloudStorageService.set("company_profile", companyProfile);
        } catch (err) {
          console.warn("[AuthLogin] company_profile cloud save failed:", err);
        }
      }
      // Update profile with username + phone if provided (saves to profiles table + auth metadata)
      if (regUsername.trim() || regPhone.trim()) {
        try {
          await updateProfile({
            username: regUsername.trim() || undefined,
            phone: regPhone.trim() || undefined,
          });
        } catch (err) {
          console.warn(
            "[AuthLogin] profile update (username/phone) failed:",
            err,
          );
        }
      }
      setSuccess("Account created! Logging you in...");
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  // Production mode - no demo credentials

  const handleGoogleLogin = async () => {
    setLocalError("");
    setGoogleLoading(true);
    // Primary: Google Identity Services client-side token flow (uses
    // Authorized JavaScript origins). Falls back to the OAuth redirect flow
    // (which uses Authorized redirect URIs) if GIS cannot display.
    const result = await loginWithGoogleToken();
    if (!result.success) {
      setGoogleLoading(false);
      const err = result.error || "Google sign-in failed. Please try again.";
      // Surface a clear, actionable message when the Google OAuth client
      // hasn't been configured yet (the most common cause of failure).
      const actionable =
        /redirect_uri_mismatch|redirect.*uri|doesn't comply|OAuth 2\.0 policy|origin|not enabled|provider not/i.test(
          err,
        )
          ? "Google sign-in isn't fully configured yet. The app owner needs to add this site to the Google OAuth client's Authorized JavaScript origins and Authorized redirect URIs in the Google Cloud Console (a free, one-time setup). Email and Username sign-in still work."
          : err;
      setLocalError(actionable);
    }
    // On success via redirect fallback the browser navigates to Google; the
    // spinner stays until that happens. On success via token flow the
    // onAuthStateChange listener handles the transition.
  };

  // --- Station Member login handlers ---

  // Debounced station search: looks up stations by code or name via the
  // lookup_station RPC. If the RPC isn't available (migration 026 not
  // applied), returns [] and the UI shows a "enter manually" fallback.
  const handleStationSearch = useCallback((value: string) => {
    setStationQuery(value);
    setSelectedStation(null);
    if (stationSearchRef.current) clearTimeout(stationSearchRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setStationResults([]);
      return;
    }
    setStationSearching(true);
    stationSearchRef.current = setTimeout(async () => {
      const results = await lookupStation(q);
      setStationResults(results);
      setStationSearching(false);
      // If no results and the RPC returned nothing, hint at manual entry.
      if (results.length === 0) {
        setShowManualEntry(true);
      } else {
        setShowManualEntry(false);
      }
    }, 400);
  }, []);

  const handleStationLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!stationUsername.trim() || !stationPassword) {
      setLocalError("Please enter your username and password.");
      return;
    }
    // Resolve the station: either from the search selection or the manual
    // ownerId + stationId fallback entry.
    const ownerId = selectedStation?.ownerId || manualOwnerId.trim();
    const stationId = selectedStation?.stationId || manualStationId.trim();
    if (!ownerId || !stationId) {
      setLocalError(
        "Please search for and select your station, or enter the Station Owner ID and Station ID manually.",
      );
      return;
    }
    setStationLoginLoading(true);
    try {
      const session = await loginWithAccessCode(
        stationUsername.trim(),
        stationPassword,
        ownerId,
        stationId,
      );
      // Success — redirect to the Station Access viewer which reads the
      // session from localStorage and renders the read-only dashboard.
      navigate("/station-access", { replace: true });
      void session;
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Station login failed.",
      );
    } finally {
      setStationLoginLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex overflow-hidden">
      {/* Animated background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Left Side - Branding (hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-center px-12 w-1/2 relative z-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center text-2xl shadow-xl">
            ⛽
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">FuelPro</h1>
            <p className="text-indigo-300 text-sm">
              Professional Fuel Management
            </p>
          </div>
        </div>
        <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
          Manage your fuel stations
          <br />
          <span className="text-indigo-400">from anywhere</span>
        </h2>
        <div className="space-y-4 mt-8">
          {[
            {
              icon: Cloud,
              title: "Cloud Sync",
              desc: "Real-time sync across all devices",
              color: "text-blue-400",
            },
            {
              icon: Lock,
              title: "Secure Auth",
              desc: "Encrypted storage & session management",
              color: "text-green-400",
            },
            {
              icon: Zap,
              title: "Real-Time Updates",
              desc: "Live sales, delivery & payment tracking",
              color: "text-amber-400",
            },
            {
              icon: Server,
              title: "Multi-Station",
              desc: "Manage unlimited stations independently",
              color: "text-purple-400",
            },
            {
              icon: ShieldCheck,
              title: "Admin Control",
              desc: "Full system management panel",
              color: "text-emerald-400",
            },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <f.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${f.color}`} />
              <div>
                <p className="text-white text-sm font-semibold">{f.title}</p>
                <p className="text-gray-400 text-xs">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6 lg:hidden">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-xl">
              ⛽
            </div>
            <div>
              <h1 className="text-xl font-black text-white">FuelPro</h1>
              <p className="text-indigo-300 text-xs">
                Professional Fuel Management
              </p>
            </div>
          </div>

          <h3 className="text-2xl font-bold text-white mb-1">
            {mode === "register" ? "Create Account" : "Sign In"}
          </h3>
          <p className="text-gray-400 text-sm mb-6">
            {mode === "register"
              ? "Join FuelPro and manage your stations"
              : "Enter your credentials to continue"}
          </p>

          {/* Error / Success Messages */}
          {localError && (
            <div className="mb-4 flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{localError}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 flex items-center gap-2 text-green-400 bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-3 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Sign in with Google (Google Identity Services / OAuth 2.0) */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isPending || googleLoading}
            className="w-full py-3 mb-4 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed text-gray-700 font-semibold rounded-xl transition-all shadow-lg flex items-center justify-center gap-3"
          >
            {googleLoading ? (
              <>
                <span className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
                Connecting to Google...
              </>
            ) : (
              <>
                <GoogleLogo className="w-5 h-5" />
                {mode === "register"
                  ? "Sign up with Google"
                  : "Sign in with Google"}
              </>
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[11px] text-gray-500 uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Mode Tabs */}
          {mode !== "register" && (
            <div className="flex bg-white/5 rounded-xl p-1 mb-5 gap-1">
              <button
                type="button"
                onClick={() => setMode("email")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${mode === "email" ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-300"}`}
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </button>
              <button
                type="button"
                onClick={() => setMode("username")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${mode === "username" ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-300"}`}
              >
                <User className="w-3.5 h-3.5" /> Username
              </button>
              <button
                type="button"
                onClick={() => setMode("station")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${mode === "station" ? "bg-green-600 text-white shadow-md" : "text-gray-400 hover:text-gray-300"}`}
                title="Log in with a station-assigned username + password (no signup needed)"
              >
                <Building2 className="w-3.5 h-3.5" /> Station
              </button>
            </div>
          )}

          {/* EMAIL LOGIN FORM */}
          {mode === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-4" noValidate>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      handleEmailChange(e.target.value);
                      setLocalError("");
                    }}
                    placeholder="you@company.com"
                    className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                    autoComplete="email"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-300">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate("/reset-password")}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      handlePasswordChange(e.target.value);
                      setLocalError("");
                    }}
                    placeholder="Enter your password"
                    className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 fp-icon-only"
                title="Sign in"
                aria-label="Sign in"
              >
                {isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" /> Sign In
                  </>
                )}
              </button>
            </form>
          )}

          {/* USERNAME LOGIN FORM */}
          {mode === "username" && (
            <form
              onSubmit={handleUsernameLogin}
              className="space-y-4"
              noValidate
            >
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setLocalError("");
                    }}
                    placeholder="Enter your username"
                    className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                    autoComplete="username"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      handlePasswordChange(e.target.value);
                      setLocalError("");
                    }}
                    placeholder="Enter your password"
                    className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 fp-icon-only"
                title="Sign in"
                aria-label="Sign in"
              >
                {isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Sign In
                  </>
                )}
              </button>
            </form>
          )}

          {/* STATION MEMBER LOGIN FORM (access code) */}
          {mode === "station" && (
            <form
              onSubmit={handleStationLogin}
              className="space-y-4"
              noValidate
            >
              {/* Station search */}
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                  Find Your Station
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={stationQuery}
                    onChange={(e) => {
                      handleStationSearch(e.target.value);
                      setLocalError("");
                    }}
                    placeholder="Station name or code (e.g. Founder Admin Station)"
                    className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                  />
                  {stationSearching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                  )}
                </div>
                {/* Search results */}
                {stationResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {stationResults.map((s) => (
                      <button
                        key={s.stationId}
                        type="button"
                        onClick={() => {
                          setSelectedStation(s);
                          setStationQuery(s.stationName);
                          setStationResults([]);
                          setLocalError("");
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2 ${selectedStation?.stationId === s.stationId ? "bg-green-600/20 border border-green-500/50 text-white" : "bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"}`}
                      >
                        <Building2 className="w-3.5 h-3.5 flex-shrink-0 text-green-400" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            {s.stationName}
                          </p>
                          {s.code && (
                            <p className="text-[10px] text-gray-500 truncate">
                              Code: {s.code}
                            </p>
                          )}
                        </div>
                        {selectedStation?.stationId === s.stationId && (
                          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {/* Selected station confirmation */}
                {selectedStation && stationResults.length === 0 && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-green-600/10 border border-green-500/30 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <span className="text-xs text-green-300 truncate">
                      {selectedStation.stationName}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStation(null);
                        setStationQuery("");
                      }}
                      className="ml-auto text-[10px] text-gray-400 hover:text-gray-200"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {/* Manual entry fallback (shown when lookup RPC unavailable) */}
              {showManualEntry &&
                !selectedStation &&
                stationQuery.length >= 2 &&
                !stationSearching && (
                  <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                    <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      No stations found by search. Enter the IDs from your
                      access link manually.
                    </p>
                    <input
                      type="text"
                      value={manualOwnerId}
                      onChange={(e) => setManualOwnerId(e.target.value)}
                      placeholder="Station Owner ID"
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-xs placeholder-gray-500 focus:ring-1 focus:ring-amber-500 outline-none"
                    />
                    <input
                      type="text"
                      value={manualStationId}
                      onChange={(e) => setManualStationId(e.target.value)}
                      placeholder="Station ID"
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-xs placeholder-gray-500 focus:ring-1 focus:ring-amber-500 outline-none"
                    />
                  </div>
                )}

              {/* Username + password */}
              <div className="border-t border-white/10 pt-3 space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={stationUsername}
                      onChange={(e) => {
                        setStationUsername(e.target.value);
                        setLocalError("");
                      }}
                      placeholder="Your assigned username"
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                      autoComplete="username"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={stationPassword}
                      onChange={(e) => {
                        setStationPassword(e.target.value);
                        setLocalError("");
                      }}
                      placeholder="Your assigned password"
                      className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={stationLoginLoading}
                className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {stationLoginLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <Building2 className="w-4 h-4" />
                    Access Station
                  </>
                )}
              </button>
              <p className="text-[11px] text-gray-500 text-center">
                Log in with the username + password your station owner assigned
                you. No signup needed — read-only access to approved sections.
              </p>
            </form>
          )}

          {/* REGISTER FORM */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-3" noValidate>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    autoComplete="new-password"
                    className="w-full pl-4 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Confirm Password *
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-300 mb-1 block">
                    Username
                  </label>
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="unique ID"
                    autoComplete="username"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-300 mb-1 block">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                    autoComplete="tel"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Optional company fields */}
              <button
                type="button"
                onClick={() => setShowCompanyFields(!showCompanyFields)}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
              >
                <Fuel className="w-3 h-3" />{" "}
                {showCompanyFields ? "Hide" : "Add"} company details (optional)
              </button>
              {showCompanyFields && (
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company name"
                    className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-xl text-white text-xs placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <input
                    type="text"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="Phone number"
                    className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-xl text-white text-xs placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <input
                    type="text"
                    value={companyRegNo}
                    onChange={(e) => setCompanyRegNo(e.target.value)}
                    placeholder="Registration number"
                    className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-xl text-white text-xs placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder="Tax ID"
                    className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-xl text-white text-xs placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isPending}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating account...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Create Account
                  </>
                )}
              </button>
            </form>
          )}

          {/* Toggle between login / register */}
          <div className="mt-5 text-center text-xs text-gray-400">
            {mode === "register" ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("email");
                    navigate("/sign-in", { replace: true });
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                >
                  Sign In
                </button>
              </>
            ) : (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    navigate("/sign-up", { replace: true });
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                >
                  Create one
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
