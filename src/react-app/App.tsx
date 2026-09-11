import { HashRouter as Router, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "@/react-app/context/AuthContext";
import { StationProvider } from "@/react-app/context/StationContext";
import { TenantProvider } from "@/react-app/context/TenantContext";
import { ThemeProvider } from "@/react-app/context/ThemeContext";
import { LocalizationProvider } from "@/react-app/context/LocalizationContext";
import { PermissionProvider } from "@/react-app/context/PermissionContext";
import { FuelProvider } from "@/react-app/context/FuelContext";
import { PlatformDataProvider } from "@/react-app/context/PlatformDataContext";
import { TutorialProvider } from "@/react-app/context/TutorialContext";
import HomePage from "@/react-app/pages/Home";
import AuthLogin from "@/react-app/components/AuthLogin";
import PasswordReset from "@/react-app/pages/PasswordReset";
import {
  Suspense,
  useMemo,
  useState,
  useEffect,
  Component,
  ReactNode,
} from "react";
import InviteAccept from "@/react-app/pages/InviteAccept";
import StationAccess from "@/react-app/pages/StationAccess";
import FounderAccess from "@/react-app/pages/FounderAccess";
import NotFound from "@/react-app/pages/NotFound";
import SeoManager from "@/react-app/components/SeoManager";
import OfflineIndicator from "@/react-app/components/OfflineIndicator";
import { SkipToContent } from "@/react-app/lib/accessibility";
import UpdateAvailableBanner from "@/react-app/components/UpdateAvailableBanner";
import { TRPCProvider } from "@/providers/trpc";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { resolveCountryCode } from "@/react-app/lib/geo-utils";

// Supabase Configuration - Primary Auth & Database
const supabaseConfigured =
  !!import.meta.env.VITE_SUPABASE_URL &&
  !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// Simple fallback for lazy-loaded routes
function RouteFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
      <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/20 text-center">
        <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-amber-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-white font-serif">FuelPro</h2>
        <p className="text-gray-300 mt-2 text-sm">Loading...</p>
      </div>
    </div>
  );
}

// Error Boundary - catches React errors and shows fallback UI
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    // Persist full diagnostic so it can be inspected after the crash screen loads
    try {
      localStorage.setItem(
        "fuelpro_last_error",
        JSON.stringify({
          message: error?.message ?? String(error),
          stack: error?.stack ?? null,
          componentStack: errorInfo?.componentStack ?? null,
          at: new Date().toISOString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }

  handleReload = () => {
    try {
      localStorage.removeItem("fuelpro_last_error");
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, error: null });
    // Use the loop-guarded reload so an error that keeps happening doesn't
    // cause an infinite reload loop.
    if (
      typeof window !== "undefined" &&
      typeof window.__fuelproSafeReload === "function"
    ) {
      window.__fuelproSafeReload("error-boundary-retry");
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900/20 to-slate-900 flex items-center justify-center p-4">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-red-500/30 text-center max-w-lg w-full">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-400 text-sm mb-2">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            {this.state.error?.stack && (
              <details className="text-left text-xs text-gray-500 bg-black/30 rounded-lg p-3 mb-4 overflow-auto max-h-40">
                <summary className="cursor-pointer select-none">
                  Technical details
                </summary>
                <pre className="whitespace-pre-wrap mt-2">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-xl transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Detect country — world-wide (250+ timezone mappings), never Kenya-biased. */
function useDetectedCountry(): string {
  return useMemo(() => resolveCountryCode("US"), []);
}

/** Loading screen shown only for main app, not for founder/public routes */
function MainAppLoader() {
  const { user, isPending: isLoading } = useAuth();
  const detectedCountry = useDetectedCountry();
  // Supabase is configured - primary auth and database
  const isSupabaseConfigured = supabaseConfigured;

  // ── Automation engine: initialize once the user is logged in ──────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { initAutomationEngine } =
          await import("@/react-app/lib/automation-engine");
        if (!cancelled) await initAutomationEngine(null);
      } catch (err) {
        console.warn("[automation] failed to init:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Add loading timeout - show error after 15 seconds
  const [loadTimeout, setLoadTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        setLoadTimeout(true);
      }
    }, 15000); // 15 second timeout
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Loading timeout exceeded
  if (loadTimeout && isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900/20 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-red-500/30 text-center max-w-md">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Connection Timeout
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            The server is taking too long to respond. Please check your
            connection and try again.
          </p>
          <button
            onClick={() => {
              setLoadTimeout(false);
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/20 text-center">
          <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-amber-400 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-white font-serif">
            FuelPro
          </h2>
          <p className="text-gray-300 mt-2 text-sm">
            Initializing Supabase authentication...
          </p>
          <div className="mt-4 flex items-center gap-2 justify-center">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-xs text-gray-400">
              Region: {detectedCountry}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Supabase auth - show dashboard if user is logged in, otherwise show login
  return user ? (
    <TenantProvider detectedCountry={detectedCountry}>
      <StationProvider>
        <FuelProvider>
          <TutorialProvider>
            <HomePage />
          </TutorialProvider>
        </FuelProvider>
      </StationProvider>
    </TenantProvider>
  ) : (
    <AuthLogin />
  );
}

export default function App() {
  // Supabase - Primary Auth and Database
  return (
    <ErrorBoundary>
      <SkipToContent />
      <UpdateAvailableBanner />
      <div id="main-content" className="min-h-screen">
        <AuthProvider>
          <ThemeProvider>
            <LocalizationProvider>
              <PermissionProvider>
                <PlatformDataProvider>
                  <TRPCProvider>
                    <Router>
                      <SeoManager />
                      <Routes>
                        {/* Firebase Authentication - handled by AuthLogin component */}
                        <Route path="/sign-in" element={<AuthLogin />} />
                        <Route path="/sign-up" element={<AuthLogin />} />
                        <Route path="/dashboard" element={<MainAppLoader />} />

                        {/* Founder Access - public, no auth required */}
                        <Route path="/founder" element={<FounderAccess />} />
                        <Route
                          path="/founder-v1"
                          element={<Navigate to="/founder" replace />}
                        />
                        <Route
                          path="/admin"
                          element={<Navigate to="/founder" replace />}
                        />

                        {/* Password Reset - public */}
                        <Route
                          path="/reset-password"
                          element={<PasswordReset />}
                        />

                        {/* Invite acceptance - public */}
                        <Route
                          path="/join/:inviteId"
                          element={<InviteAccept />}
                        />

                        {/* Station access (team member login w/o signup) - public */}
                        <Route
                          path="/station-access"
                          element={<StationAccess />}
                        />

                        {/* Main app - requires auth, shows loader while checking */}
                        <Route path="/" element={<MainAppLoader />} />

                        {/* Catch all — branded 404 */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                      {/* Offline indicator for sync status */}
                      <OfflineIndicator />
                    </Router>
                  </TRPCProvider>
                </PlatformDataProvider>
              </PermissionProvider>
            </LocalizationProvider>
          </ThemeProvider>
        </AuthProvider>
      </div>
    </ErrorBoundary>
  );
}
