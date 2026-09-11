import React, { useCallback, useRef, Suspense } from "react";
import { useState, useEffect } from "react";
import {
  Crown,
  Users,
  Building2,
  Shield,
  Activity,
  Server,
  Clock,
  Search,
  Eye,
  EyeOff,
  Lock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Key,
  Settings,
  ToggleRight,
  RefreshCw,
  Radio,
  Zap,
  ArrowLeft,
  Layers,
  X,
  Menu,
  Sparkles,
  Upload,
  Wand2,
  Terminal,
  Cpu,
  FileCode,
  ShieldCheck,
  DatabaseBackup,
  Bell,
  Palette,
  Code,
  Mail,
  ShieldAlert,
  FolderCog,
  Wrench,
  DollarSign,
  Tag,
  CreditCard,
  Cloud,
  CloudOff,
  Command,
  Webhook,
  KeyRound,
  FlaskConical,
  HeartPulse,
  Megaphone,
  ShieldBan,
  Globe,
  Languages,
  Database,
  Monitor,
  ListChecks,
  Rocket,
  Send,
  HardDrive,
  Gauge,
  ArrowRight,
  Download,
} from "lucide-react";
import { loginFounder } from "@/react-app/lib/founder-auth";
import { requestPasswordReset } from "@/react-app/lib/founder-auth";
import { loadFounder2FA } from "@/react-app/lib/founder-auth";
import {
  SecuritySection,
  BackupSection,
  ConfigSection,
  NotificationsSection,
  BrandingSection,
  ApiSection,
  AnalyticsSection,
  MaintenanceSection,
  EmailTemplatesSection,
  RateLimitSection,
  DataManagementSection,
  PricingManagerSection,
  SubscriptionDashboardSection,
  CouponSection,
  PayoutSection,
  TrialAnalyticsSection,
  PerformanceSection,
  PaywallControlSection,
  PaymentMethodsSection,
  SecretsManagerSection,
  FeatureFlagsManagerSection,
  AuditLogManagerSection,
  ConsoleSettingsSection,
  SystemHealthManagerSection,
  WebhooksManagerSection,
  ApiKeysManagerSection,
  AnnouncementsSection,
  MaintenanceWindowsSection,
  BlocklistSection,
  CorsConfigSection,
  EnvVarsSection,
  ScheduledJobsSection,
  ExperimentsSection,
  HealthChecksSection,
  LocalizationSection,
  CacheManagementSection,
  CommandPaletteSection,
  DatabaseQuerySection,
  ErrorTrackerSection,
  SessionInspectorSection,
  TaskQueueSection,
  LogStreamsSection,
  RoleMatrixSection,
  ReleaseCoordinatorSection,
  MigrationsSection,
  WebhookDeliveriesSection,
  StorageExplorerSection,
  ApiRateLimitsSection,
  DeveloperControlCenterSection,
} from "./founder-sections/lazy";
import { useFounderBackend } from "@/react-app/hooks/useFounderBackend";
import { useFounderConsoleStore } from "@/react-app/hooks/useFounderConsoleStore";
import { useFounderAdvancedStore } from "@/react-app/hooks/useFounderAdvancedStore";
import { checkApiStatus } from "@/react-app/lib/restApiSync";
import { getBackendUrl } from "@/utils/apiConfig";
import { toastSuccess } from "@/react-app/lib/toast";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";

/* ─── Types ─── */
interface AppUser {
  authId: string;
  authMethod: string;
  name: string;
  email: string;
  role: string;
  lastActive: string;
  stations: number;
  createdAt: string;
}

interface StationRecord {
  id: string;
  name: string;
  location: string;
  ownerId: string;
  ownerName: string;
  members: number;
  createdAt: string;
  lastActive: string;
  revenue: number;
  currency?: string;
  country?: string;
  code?: string;
}

/* ─── Founder Password Storage ─── */

interface StationData {
  id: string;
  name?: string;
  location?: string;
  createdBy?: string;
  ownerName?: string;
  sharedUsers?: any[];
  createdAt?: string;
  updatedAt?: string;
}

const FOUNDER_SESSION_KEY = "fuelpro_founder_session";
const FOUNDER_2FA_KEY = "fuelpro_founder_2fa";

type SectionId =
  | "overview"
  | "users"
  | "stations"
  | "secrets"
  | "audit"
  | "flags"
  | "system"
  | "editor"
  | "security"
  | "backup"
  | "config"
  | "notifications"
  | "branding"
  | "api"
  | "analytics"
  | "maintenance"
  | "email"
  | "ratelimit"
  | "datamgmt"
  | "pricing"
  | "subdash"
  | "coupons"
  | "payouts"
  | "trialanalytics"
  | "performance"
  | "paywall"
  | "paymentmethods"
  | "consolesettings"
  | "webhooks"
  | "apikeys"
  | "announcements"
  | "maintwindows"
  | "blocklist"
  | "cors"
  | "envvars"
  | "jobs"
  | "experiments"
  | "healthchecks"
  | "localization"
  | "cachemgmt"
  | "commandpalette"
  | "dbquery"
  | "errortracker"
  | "sessions"
  | "taskqueue"
  | "logstreams"
  | "rolematrix"
  | "releasecoord"
  | "migrations"
  | "deliveries"
  | "storage"
  | "ratelimits"
  | "devcontrol";

// NavItem must be defined at MODULE scope (outside the component) so it is a
// STABLE component type across re-renders. When it was defined inside the
// FounderAccess body, every re-render created a new NavItem function → React
// unmounted/remounted ALL nav buttons on every state change from the store
// hooks (useFounderConsoleStore, useFounderAdvancedStore, useFounderBackend)
// → click handlers were lost during the unmount/remount cycle → section
// switching silently never worked.
function NavItem({
  id,
  label,
  icon: Icon,
  count,
  active,
  onSelect,
}: {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  count?: number;
  active: boolean;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <button
      data-section-id={id}
      onClick={() => onSelect(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-all ${
        active
          ? "bg-amber-500/15 text-amber-300 border-l-2 border-amber-400"
          : "text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]"
      }`}
    >
      <Icon size={17} />
      <span className="text-[13px]">{label}</span>
      {count !== undefined && (
        <span
          className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${active ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-gray-500"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function FounderAccess() {
  /* ─── Cloud Sync State ─── */
  const [cloudStatus, setCloudStatus] = useState<{
    isOnline: boolean;
    isSyncing: boolean;
    lastSync: number;
    pendingChanges: number;
    status?: string;
  }>({ isOnline: false, isSyncing: false, lastSync: 0, pendingChanges: 0 });

  /* ─── Backend Integration ─── */
  const {
    logAudit,
    auditLog: backendAuditLog,
    stationCount: backendStationCount,
    salesAnalytics,
    allBackendUsers,
    usersLoading,
    allBackendStations,
    allStationsLoading,
    statsTotalRevenue,
  } = useFounderBackend();

  /* ─── Founder Console Store (cloud-backed, real-time synced) ───
   * Secrets, Feature Flags, Audit Log, and Console Settings are persisted to
   * Supabase app_kv and synced in real time to every founder device via
   * Supabase Realtime. This replaces the old localStorage-only arrays so a
   * change made on one device reflects instantly on all others. */
  const consoleStore = useFounderConsoleStore();
  const advancedStore = useFounderAdvancedStore();

  /* ─── Auth State ─── */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [login2FACode, setLogin2FACode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<{
    sent: boolean;
    error?: string;
  }>({ sent: false });
  const [forgotSending, setForgotSending] = useState(false);
  const [founderUniqueId, setFounderUniqueId] = useState<string | null>(null);
  const [founderUserId, setFounderUserId] = useState<string | null>(null);

  /* ─── Admin State ─── */
  // activeSection is tracked via the URL hash query param (`#/founder?s=users`)
  // instead of React state. React state/refs were unreliable here because the
  // component has a massive render tree (useFounderConsoleStore +
  // useFounderAdvancedStore + useFounderBackend) that causes concurrent-mode
  // render cancellation — the state update from setActiveSection was being
  // torn before it committed, falling back to "overview". The URL is outside
  // React's reconciliation, so updating it always takes effect immediately.
  // The `hashTick` state forces a re-render when the hash changes (since the
  // hash is read inline during render, not via a router hook).
  const [, setHashTick] = useState(0);
  useEffect(() => {
    const onHash = () => setHashTick((n) => n + 1);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const activeSection: SectionId = (() => {
    try {
      const hash = window.location.hash;
      const qIdx = hash.indexOf("?");
      if (qIdx >= 0) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        const s = params.get("s");
        if (s) return s as SectionId;
      }
    } catch {
      /* */
    }
    return "overview";
  })();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [stations, setStations] = useState<StationRecord[]>([]);

  // Navigate to a section by updating the URL hash query param. This is the
  // ONLY mechanism for section switching — no React state involved, so it
  // cannot be cancelled/teared by concurrent-mode re-renders. The hashchange
  // event listener above triggers the re-render.
  const handleSetActiveSection = useCallback((id: SectionId) => {
    try {
      const hash = window.location.hash;
      const base = hash.split("?")[0];
      const newHash = `${base}?s=${id}`;
      if (hash !== newHash) {
        window.location.hash = newHash;
      } else {
        // Same hash — manually trigger a re-render
        setHashTick((n) => n + 1);
      }
    } catch {
      /* */
    }
  }, []);

  // Secrets, Feature Flags and the Audit Log are now sourced from the
  // cloud-backed, real-time Founder Console store (useFounderConsoleStore).
  // The legacy localStorage state is kept only as a fallback display shape
  // for the (now-replaced) inline sections; the new section components read
  // directly from consoleStore.
  const secrets = consoleStore.secrets;
  const featureFlags = consoleStore.flags;
  // Audit log: prefer the backend (MySQL) audit log when it has entries,
  // otherwise use the cloud-synced console store audit log.
  const auditLog =
    backendAuditLog.length > 1 ? backendAuditLog : consoleStore.audit;
  const consoleSettings = consoleStore.settings;
  const [searchQuery, setSearchQuery] = useState("");

  // AI Website Editor state
  const [editorInstruction, setEditorInstruction] = useState("");
  const [editorOutput, setEditorOutput] = useState("");
  const [editorExecuting, setEditorExecuting] = useState(false);
  const [editorHistory, setEditorHistory] = useState<
    { instruction: string; output: string; timestamp: string }[]
  >([]);
  const [editorTab, setEditorTab] = useState<"chat" | "files" | "preview">(
    "chat",
  );
  const [uploadedFiles, setUploadedFiles] = useState<
    { name: string; type: string; content: string; size: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  /* ─── Cloud Status Check ─── */
  const checkCloudStatus = useCallback(async () => {
    const status = await checkApiStatus();
    setCloudStatus((prev) => ({
      ...prev,
      isOnline: status.connected,
    }));
    return status.connected;
  }, []);

  // Check cloud status periodically
  useEffect(() => {
    checkCloudStatus();
    const interval = setInterval(checkCloudStatus, 30000);
    return () => clearInterval(interval);
  }, [checkCloudStatus]);

  /* ─── Password check on mount ─── */
  // Runs ONCE on mount. `logAudit` is intentionally omitted from the deps
  // because it is a useCallback whose identity changes whenever the tRPC
  // mutation result object changes (idle→pending→success). Including it
  // causes this effect to re-fire on every mutation, which re-logs
  // "Session Resumed", which triggers another mutation → infinite render
  // loop that breaks section navigation. The ref keeps the latest fn
  // without re-subscribing.
  const logAuditRef = useRef(logAudit);
  logAuditRef.current = logAudit;
  useEffect(() => {
    try {
      const sessionStr = localStorage.getItem(FOUNDER_SESSION_KEY);
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        // Check the JSON object structure and enforce an 8-hour expiry
        if (session?.active && session.loginTime) {
          if (Date.now() - session.loginTime < 8 * 60 * 60 * 1000) {
            setIsAuthenticated(true);
            logAuditRef.current(
              "Session Resumed",
              "Founder session restored",
              "info",
            );
          } else {
            localStorage.removeItem(FOUNDER_SESSION_KEY);
          }
        }
      }
    } catch (error) {
      // Handle corrupted localStorage data gracefully
      localStorage.removeItem(FOUNDER_SESSION_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Load real users and stations from backend when authenticated ─── */
  useEffect(() => {
    if (!isAuthenticated) return;

    // If we have backend data, use it
    if (allBackendUsers && allBackendUsers.length > 0) {
      // Build a station count map: userId -> number of stations owned
      const stationCountByUser = new Map<string, number>();
      if (allBackendStations) {
        for (const s of allBackendStations) {
          const oid = String(s.ownerId || s.owner_id || "");
          if (oid) {
            stationCountByUser.set(oid, (stationCountByUser.get(oid) || 0) + 1);
          }
        }
      }
      const backendUsersMapped: AppUser[] = allBackendUsers.map((u: any) => ({
        authId: String(u.id),
        authMethod: u.email?.includes("@") ? "email" : "unknown",
        name: u.name || "Unknown",
        email: u.email || "",
        role: u.role || "user",
        lastActive: u.lastSignInAt
          ? new Date(u.lastSignInAt).toLocaleString()
          : "Never",
        stations: stationCountByUser.get(String(u.id)) || 0,
        createdAt: u.createdAt
          ? new Date(u.createdAt).toLocaleString()
          : "Unknown",
      }));
      setUsers(backendUsersMapped);
    }

    if (allBackendStations && allBackendStations.length > 0) {
      const backendStationsMapped: StationRecord[] = allBackendStations.map(
        (s: any) => ({
          id: String(s.id),
          name: s.name || "Unnamed Station",
          location: s.location || "Unknown",
          ownerId: String(s.ownerId || s.owner_id || 0),
          ownerName: s.ownerName || "Owner",
          members: s.members || 1,
          createdAt: s.createdAt
            ? new Date(s.createdAt).toLocaleString()
            : "Unknown",
          lastActive: s.updatedAt
            ? new Date(s.updatedAt).toLocaleString()
            : "Unknown",
          revenue: Number(s.revenue) || 0,
          currency: s.currency || "USD",
          country: s.country || "",
          code: s.code || "",
        }),
      );
      setStations(backendStationsMapped);
    }

    // If no backend data, fall back to localStorage scan
    if ((!allBackendUsers || allBackendUsers.length === 0) && !usersLoading) {
      const discoveredUsers: AppUser[] = [];
      const discoveredStations: StationRecord[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (
          key === "fuelpro_auth_identity" ||
          key.startsWith("fuelpro_auth_identity")
        ) {
          try {
            const val = JSON.parse(localStorage.getItem(key) || "{}");
            if (val.authId && !seenIds.has(val.authId)) {
              seenIds.add(val.authId);
              discoveredUsers.push({
                authId: val.authId,
                authMethod: val.authMethod || "unknown",
                name: val.name || "Unknown",
                email: val.email || "",
                role: val.role || "owner",
                lastActive: "Now",
                stations: 0,
                createdAt: "Unknown",
              });
            }
          } catch {
            /* ignore */
          }
        }

        if (key.includes("station") && key.startsWith("fuelpro")) {
          try {
            const val = JSON.parse(localStorage.getItem(key) || "{}");
            const stationsList =
              val.stations || (Array.isArray(val) ? val : val.id ? [val] : []);
            stationsList.forEach((s: StationData) => {
              if (
                s &&
                s.id &&
                !discoveredStations.some((ds) => ds.id === s.id)
              ) {
                discoveredStations.push({
                  id: s.id,
                  name: s.name || "Unnamed Station",
                  location: s.location || "Unknown",
                  ownerId: s.createdBy || "unknown",
                  ownerName: s.ownerName || "Unknown Owner",
                  members: (s.sharedUsers || []).length + 1,
                  createdAt: s.createdAt || "Unknown",
                  lastActive: s.updatedAt || s.createdAt || "Unknown",
                  // Set revenue to 0 for local stations - actual revenue comes from salesAnalytics
                  revenue: 0,
                });
              }
            });
          } catch {
            /* ignore */
          }
        }
      }

      discoveredUsers.forEach((u) => {
        u.stations = discoveredStations.filter(
          (s) => s.ownerId === u.authId,
        ).length;
      });

      if (users.length === 0) setUsers(discoveredUsers);
      if (stations.length === 0) setStations(discoveredStations);
    }

    setLoading(false);
  }, [
    isAuthenticated,
    allBackendUsers,
    allBackendStations,
    usersLoading,
    allStationsLoading,
  ]);

  /* ─── Persistence ───
   * Secrets & Feature Flags are now persisted by the cloud-backed
   * useFounderConsoleStore (Supabase app_kv + realtime sync), so the old
   * localStorage-only save effects are intentionally removed. The store
   * handles cross-device real-time propagation. Audit log is persisted via
   * the backend (useFounderBackend.logAudit) and/or the console store. */

  /* ─── Login Handler ───
   * SECURITY: This previously fell back to a hardcoded default credential
   * (FOUNDER / fuelpro2026) and had a logic bug where the validity check's
   * right-hand operand was an async IIFE — which returns a Promise object.
   * Promise objects are truthy, so `isValid` evaluated to true almost
   * unconditionally regardless of the password entered. Both issues meant
   * founder/admin access could be obtained without real credentials.
   * Fixed to authenticate exclusively via Supabase (loginFounder), which
   * performs a real sign-in and checks the founder/admin role server-side. */
  const handleLogin = async () => {
    if (isLocked) return;
    if (!loginUsername.trim() || !loginPassword) {
      setLoginError("Username and password are required");
      return;
    }

    setLoginError("");
    let result;
    try {
      result = await loginFounder(loginUsername.trim(), loginPassword);
    } catch (err) {
      console.error("[LoginDebug] loginFounder threw:", err);
      setLoginError(
        "Login error: " + (err instanceof Error ? err.message : "unknown"),
      );
      return;
    }

    if (result.success) {
      setFounderUserId(result.userId || null);
      // Fetch the unique identifier for display.
      if (result.userId) {
        import("@/react-app/lib/founder-auth").then((m) => {
          m.getFounderUniqueId(result.userId!).then(setFounderUniqueId);
        });
      }

      // Check if 2FA is enabled — load from CLOUD (profiles table), not
      // localStorage, so it is consistent across all devices.
      let faEnabled = false;
      let faSecret: string | null = null;
      if (result.userId) {
        const cloud2FA = await loadFounder2FA(result.userId);
        faEnabled = cloud2FA.enabled;
        faSecret = cloud2FA.secret;
      }

      if (faEnabled && faSecret) {
        setNeeds2FA(true);
        setLoginError("");
        return;
      }

      completeLogin();
    } else {
      const nextAttempts = loginAttempts + 1;
      setLoginAttempts(nextAttempts);
      setLoginError(
        result.error || `Invalid credentials. Attempt ${nextAttempts}/5`,
      );
      logAudit(
        "Login Failed",
        `Invalid login attempt #${nextAttempts}`,
        "danger",
      );
      if (nextAttempts >= 5) {
        setIsLocked(true);
        setLoginError("Too many failed attempts. Locked for 15 minutes.");
        setTimeout(
          () => {
            setIsLocked(false);
            setLoginAttempts(0);
            setLoginError("");
          },
          15 * 60 * 1000,
        );
      }
    }
  };

  const completeLogin = async () => {
    console.log(
      "[LoginDebug] completeLogin called, setting isAuthenticated=true",
    );
    setIsAuthenticated(true);

    // Get founder token from backend via REST API
    let token = null;
    const API_URL = getBackendUrl();

    // Only attempt the backend login when a backend is actually configured.
    // On static hosts (Cloudflare Pages, local dev without VITE_BACKEND_URL)
    // there are no /api/auth/* serverless functions, so the fetch would 405
    // against the host on every login. Local Supabase auth handles the
    // session in that case (token stays null, which is fine).
    if (API_URL) {
      try {
        // Try the founder-login REST endpoint first
        const res = await fetch(`${API_URL}/api/auth/founder-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: loginUsername.trim(),
            password: loginPassword,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.token) {
            token = data.token;
          }
        } else {
          // Try tRPC endpoint as fallback
          const trpcRes = await fetch(`${API_URL}/api/trpc/founderAuth.login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              json: { username: loginUsername.trim(), password: loginPassword },
            }),
          });
          const trpcData = await trpcRes.json();
          if (trpcData?.result?.data?.json?.token) {
            token = trpcData.result.data.json.token;
          }
        }
      } catch (e) {
        console.warn("Backend unavailable, using local auth");
        // Backend might be unavailable - continue with local auth
      }
    }

    // Store session with timestamp for 8-hour expiry
    localStorage.setItem(
      FOUNDER_SESSION_KEY,
      JSON.stringify({
        active: true,
        loginTime: Date.now(),
        username: loginUsername.trim(),
        token: token, // Store backend token for API calls
      }),
    );
    setLoginError("");
    setLoginAttempts(0);
    setNeeds2FA(false);
    setLogin2FACode("");
    logAudit("Login Successful", "Founder accessed admin panel", "success");
  };

  const handleVerify2FALogin = async () => {
    setLoginError("");
    if (!login2FACode || login2FACode.length !== 6) {
      setLoginError("Enter the 6-digit code");
      return;
    }

    // Load the 2FA secret from CLOUD (profiles table) — not localStorage —
    // so it works on any device the founder signs in from.
    let secret: string | null = null;
    if (founderUserId) {
      const cloud2FA = await loadFounder2FA(founderUserId);
      secret = cloud2FA.secret;
    }
    if (!secret) {
      // Fallback: legacy localStorage (for accounts set up before the cloud
      // migration on this device).
      try {
        const faSaved = localStorage.getItem(FOUNDER_2FA_KEY);
        if (faSaved) {
          const cfg = JSON.parse(faSaved);
          secret = cfg?.secret || null;
        }
      } catch {
        /* */
      }
    }

    if (!secret) {
      setLoginError("2FA configuration error");
      return;
    }

    const { verifyCode: verify } = await import("@/react-app/lib/totp");
    const decodedSecret = atob(secret);
    const valid = await verify(decodedSecret, login2FACode);

    if (valid) {
      completeLogin();
    } else {
      setLoginError("Invalid 2FA code");
      logAudit("2FA Login Failed", "Invalid TOTP code", "danger");
    }
  };

  /* ─── Forgot Password ─── */
  const handleForgotPassword = async () => {
    setForgotStatus({ sent: false });
    setForgotSending(true);
    const email = forgotEmail.trim() || loginUsername.trim();
    if (!email) {
      setForgotStatus({ sent: false, error: "Enter your username or email" });
      setForgotSending(false);
      return;
    }
    const result = await requestPasswordReset(email);
    if (result.success) {
      setForgotStatus({ sent: true });
      logAudit(
        "Password Reset Requested",
        `Reset email sent for ${email}`,
        "warning",
      );
    } else {
      setForgotStatus({ sent: false, error: result.error });
    }
    setForgotSending(false);
  };

  /* ─── Logout ─── */
  const handleLogout = () => {
    // Clear session data
    localStorage.removeItem(FOUNDER_SESSION_KEY);
    localStorage.removeItem("fuelpro_founder_2fa");
    setIsAuthenticated(false);
    setLoginUsername("");
    setLoginPassword("");
    setNeeds2FA(false);
    setLogin2FACode("");
    // Redirect to home
    window.location.hash = "/";
    window.location.reload();
  };

  // logAudit now comes from useFounderBackend (syncs to MySQL + localStorage).
  // The new section components log directly to consoleStore.addAudit (the
  // real-time cloud audit channel) so audit entries sync to all founder
  // devices instantly.

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.authMethod.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredStations = stations.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.location.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const totalRevenue = stations.reduce((sum, s) => sum + (s.revenue || 0), 0);
  // The Founder Console should show the REAL cross-owner counts from
  // /api/founder-stats (allBackendStations), NOT the owner-scoped
  // trpc.station.list count (backendStationCount) which only reflects the
  // current founder's own stations. Fall back to the owner-scoped/local count
  // only when the cross-owner fetch hasn't resolved yet.
  const effectiveStationCount =
    allBackendStations && allBackendStations.length > 0
      ? allBackendStations.length
      : backendStationCount > 0
        ? backendStationCount
        : stations.length;
  // Prefer the cross-owner total revenue from /api/founder-stats, then
  // salesAnalytics, then the sum of station revenues from the API.
  const effectiveRevenue =
    statsTotalRevenue > 0
      ? statsTotalRevenue
      : salesAnalytics?.totalRevenue
        ? Number(salesAnalytics.totalRevenue)
        : totalRevenue;
  // Determine the display currency for the global revenue figure. Use the
  // most common station currency if available, otherwise the detected
  // currency. This avoids showing "KSh" for a US-founder global console.
  const globalCurrency = (() => {
    if (stations.length > 0) {
      // Count currencies across stations; pick the most frequent
      const curCounts = new Map<string, number>();
      for (const s of stations) {
        const c = s.currency || "USD";
        curCounts.set(c, (curCounts.get(c) || 0) + 1);
      }
      let best = "USD";
      let bestCount = 0;
      for (const [c, n] of curCounts) {
        if (n > bestCount) {
          best = c;
          bestCount = n;
        }
      }
      return best;
    }
    return getDetectedCurrency();
  })();

  /* ─── Login Screen ─── */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <button
            onClick={() => (window.location.href = "/")}
            className="mb-6 text-sm text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
          >
            <ArrowLeft size={16} /> Back to FuelPro
          </button>

          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/20">
                <Crown size={32} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white font-serif">
                Founder Access
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Restricted. Authorized personnel only.
              </p>
            </div>

            {loginError && (
              <div
                className={`mb-4 p-3 rounded-xl flex items-start gap-2 text-xs ${
                  isLocked
                    ? "bg-red-500/10 border border-red-500/30 text-red-400"
                    : loginError.includes("Attempt")
                      ? "bg-amber-500/10 border border-amber-500/30 text-amber-400"
                      : "bg-red-500/10 border border-red-500/30 text-red-400"
                }`}
              >
                {isLocked ? (
                  <Lock size={14} className="mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                )}
                {loginError}
              </div>
            )}

            {!needs2FA ? (
              <>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <Users
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="text"
                      value={loginUsername}
                      onChange={(e) => {
                        setLoginUsername(e.target.value);
                        setLoginError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                      placeholder="Enter username"
                      className="w-full pl-10 pr-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        setLoginError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                      placeholder="Enter password"
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleLogin}
                  disabled={isLocked}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  <Shield size={18} /> {isLocked ? "Locked" : "Authenticate"}
                </button>

                {/* Forgot Password toggle */}
                {!showForgotPassword ? (
                  <button
                    onClick={() => {
                      setShowForgotPassword(true);
                      setForgotStatus({ sent: false });
                      setForgotEmail(loginUsername);
                    }}
                    className="w-full mt-3 text-xs text-gray-500 hover:text-amber-400 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Mail size={12} /> Forgot password? Reset via email
                  </button>
                ) : (
                  <div className="mt-4 p-4 bg-white/[0.03] border border-white/[0.08] rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                        <Key size={14} /> Password Reset
                      </span>
                      <button
                        onClick={() => {
                          setShowForgotPassword(false);
                          setForgotStatus({ sent: false });
                        }}
                        className="text-gray-500 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {forgotStatus.sent ? (
                      <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-2">
                        <CheckCircle2
                          size={14}
                          className="mt-0.5 text-green-400 flex-shrink-0"
                        />
                        <p className="text-xs text-green-300">
                          Reset link sent to your email. Click the link to set a
                          new password, then return here to sign in.
                        </p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] text-gray-500">
                          Enter your username or email. A password-reset link
                          will be emailed to you.
                        </p>
                        <input
                          type="text"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleForgotPassword()
                          }
                          placeholder="Username or email"
                          className="w-full px-4 py-2.5 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
                        />
                        {forgotStatus.error && (
                          <p className="text-xs text-red-400">
                            {forgotStatus.error}
                          </p>
                        )}
                        <button
                          onClick={handleForgotPassword}
                          disabled={forgotSending}
                          className="w-full py-2.5 bg-white/10 hover:bg-white/15 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {forgotSending ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" />{" "}
                              Sending…
                            </>
                          ) : (
                            <>
                              <Mail size={14} /> Send Reset Link
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                  <p className="text-xs text-blue-300 flex items-center gap-2">
                    <ShieldCheck size={14} /> Two-Factor Authentication Required
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>
                <div className="mb-6">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    2FA Code
                  </label>
                  <input
                    type="text"
                    value={login2FACode}
                    onChange={(e) => {
                      setLogin2FACode(
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      );
                      setLoginError("");
                    }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleVerify2FALogin()
                    }
                    placeholder="000000"
                    className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all font-mono tracking-widest text-center"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleVerify2FALogin}
                    className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                  >
                    <ShieldCheck size={18} /> Verify & Login
                  </button>
                  <button
                    onClick={() => {
                      setNeeds2FA(false);
                      setLogin2FACode("");
                      setLoginError("");
                    }}
                    className="px-4 py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl transition-colors"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            <div className="mt-4 flex items-center gap-2 justify-center flex-wrap">
              <Lock size={10} className="text-gray-600" />
              <p className="text-[10px] text-gray-600">
                Supabase Auth. 5-attempt lockout.{" "}
                {needs2FA ? "2FA protected (cross-device)." : ""}
              </p>
            </div>
            {founderUniqueId && (
              <div className="mt-2 text-center">
                <span className="text-[9px] text-gray-700 font-mono">
                  ID: {founderUniqueId}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     FOUNDER ACCESS CONSOLE - Authenticated View
     ═══════════════════════════════════════════════ */

  const navGroups = [
    {
      label: "Main",
      items: [
        { id: "overview" as SectionId, label: "Overview", icon: Activity },
        {
          id: "users" as SectionId,
          label: "All Users",
          icon: Users,
          // Prefer the cross-owner count from /api/founder-stats; fall back to
          // the local-state (localStorage scan) count until it resolves.
          count:
            allBackendUsers && allBackendUsers.length > 0
              ? allBackendUsers.length
              : users.length,
        },
        {
          id: "stations" as SectionId,
          label: "All Stations",
          icon: Building2,
          count: effectiveStationCount,
        },
        { id: "analytics" as SectionId, label: "Analytics", icon: Activity },
      ],
    },
    {
      label: "Administration",
      items: [
        {
          id: "secrets" as SectionId,
          label: "Secrets",
          icon: Key,
          count: secrets.length,
        },
        {
          id: "audit" as SectionId,
          label: "Audit Log",
          icon: Shield,
          count: auditLog.length,
        },
        {
          id: "flags" as SectionId,
          label: "Feature Flags",
          icon: ToggleRight,
          count: featureFlags.length,
        },
        {
          id: "consolesettings" as SectionId,
          label: "Console Settings",
          icon: Settings,
        },
        { id: "system" as SectionId, label: "System Health", icon: Server },
      ],
    },
    {
      label: "Security",
      items: [
        {
          id: "security" as SectionId,
          label: "Security & 2FA",
          icon: ShieldCheck,
        },
        {
          id: "ratelimit" as SectionId,
          label: "Rate Limits",
          icon: ShieldAlert,
        },
        {
          id: "backup" as SectionId,
          label: "Backup & Restore",
          icon: DatabaseBackup,
        },
      ],
    },
    {
      label: "Configuration",
      items: [
        { id: "config" as SectionId, label: "Site Config", icon: Settings },
        {
          id: "notifications" as SectionId,
          label: "Notifications",
          icon: Bell,
        },
        { id: "branding" as SectionId, label: "Branding", icon: Palette },
        { id: "email" as SectionId, label: "Email Templates", icon: Mail },
      ],
    },
    {
      label: "Monetization",
      items: [
        { id: "paywall" as SectionId, label: "Paywall Control", icon: Lock },
        {
          id: "paymentmethods" as SectionId,
          label: "Payment Methods",
          icon: CreditCard,
        },
        {
          id: "pricing" as SectionId,
          label: "Pricing Manager",
          icon: DollarSign,
        },
        { id: "subdash" as SectionId, label: "Sub. Dashboard", icon: Layers },
        { id: "coupons" as SectionId, label: "Coupons", icon: Tag },
        { id: "payouts" as SectionId, label: "Payments", icon: CreditCard },
        {
          id: "trialanalytics" as SectionId,
          label: "Trial Analytics",
          icon: Clock,
        },
      ],
    },
    {
      label: "Performance",
      items: [
        {
          id: "performance" as SectionId,
          label: "Performance Center",
          icon: Zap,
        },
      ],
    },
    {
      label: "Development",
      items: [
        { id: "api" as SectionId, label: "API & Webhooks", icon: Code },
        { id: "maintenance" as SectionId, label: "Maintenance", icon: Wrench },
        { id: "datamgmt" as SectionId, label: "Data Manager", icon: FolderCog },
        {
          id: "devcontrol" as SectionId,
          label: "Dev Control Center",
          icon: Terminal,
        },
        {
          id: "editor" as SectionId,
          label: "AI Website Editor",
          icon: Sparkles,
          count: editorHistory.length,
        },
      ],
    },
    {
      label: "Developer Tools",
      items: [
        {
          id: "commandpalette" as SectionId,
          label: "Command Palette",
          icon: Command,
        },
        {
          id: "webhooks" as SectionId,
          label: "Webhooks",
          icon: Webhook,
          count: advancedStore.webhooks.length,
        },
        {
          id: "apikeys" as SectionId,
          label: "API Keys",
          icon: KeyRound,
          count: advancedStore.apiKeys.length,
        },
        {
          id: "jobs" as SectionId,
          label: "Scheduled Jobs",
          icon: Clock,
          count: advancedStore.jobs.length,
        },
        {
          id: "experiments" as SectionId,
          label: "A/B Experiments",
          icon: FlaskConical,
          count: advancedStore.experiments.length,
        },
        {
          id: "healthchecks" as SectionId,
          label: "Health Checks",
          icon: HeartPulse,
          count: advancedStore.healthChecks.length,
        },
        {
          id: "dbquery" as SectionId,
          label: "Database Query",
          icon: Database,
        },
        {
          id: "cachemgmt" as SectionId,
          label: "Cache Manager",
          icon: DatabaseBackup,
        },
      ],
    },
    {
      label: "Platform Control",
      items: [
        {
          id: "announcements" as SectionId,
          label: "Announcements",
          icon: Megaphone,
          count: advancedStore.announcements.length,
        },
        {
          id: "maintwindows" as SectionId,
          label: "Maint. Windows",
          icon: Wrench,
          count: advancedStore.maintenanceWindows.length,
        },
        {
          id: "blocklist" as SectionId,
          label: "IP Blocklist",
          icon: ShieldBan,
          count: advancedStore.blocklist.length,
        },
        {
          id: "cors" as SectionId,
          label: "CORS Config",
          icon: Globe,
          count: advancedStore.corsOrigins.length,
        },
        {
          id: "envvars" as SectionId,
          label: "Env Variables",
          icon: Settings,
          count: advancedStore.envVars.length,
        },
        {
          id: "localization" as SectionId,
          label: "Localization",
          icon: Languages,
          count: advancedStore.languages.length,
        },
      ],
    },
    {
      label: "Observability",
      items: [
        {
          id: "errortracker" as SectionId,
          label: "Error Tracker",
          icon: AlertTriangle,
          count: advancedStore.errorLog.filter((e) => !e.resolved).length,
        },
        {
          id: "sessions" as SectionId,
          label: "Sessions",
          icon: Monitor,
          count: advancedStore.sessions.filter((s) => s.active).length,
        },
        {
          id: "logstreams" as SectionId,
          label: "Log Streams",
          icon: Radio,
          count: advancedStore.logStreams.length,
        },
        {
          id: "deliveries" as SectionId,
          label: "Webhook Logs",
          icon: Send,
          count: advancedStore.webhookDeliveries.length,
        },
      ],
    },
    {
      label: "DevOps",
      items: [
        {
          id: "taskqueue" as SectionId,
          label: "Task Queue",
          icon: ListChecks,
          count: advancedStore.taskQueue.filter(
            (t) => t.status === "queued" || t.status === "running",
          ).length,
        },
        {
          id: "rolematrix" as SectionId,
          label: "Role Matrix",
          icon: ShieldCheck,
        },
        {
          id: "releasecoord" as SectionId,
          label: "Release Coord.",
          icon: Rocket,
          count: advancedStore.releases.filter(
            (r) => r.status === "rolling" || r.status === "canary",
          ).length,
        },
        {
          id: "migrations" as SectionId,
          label: "Migrations",
          icon: Database,
          count: advancedStore.migrations.filter((m) => m.status === "pending")
            .length,
        },
        {
          id: "storage" as SectionId,
          label: "Storage",
          icon: HardDrive,
          count: advancedStore.storageItems.filter((s) => !s.isFolder).length,
        },
        {
          id: "ratelimits" as SectionId,
          label: "API Rate Limits",
          icon: Gauge,
          count: advancedStore.apiRateLimits.filter((r) => r.enabled).length,
        },
      ],
    },
  ];

  // NavItem is now a module-level component (stable type across re-renders).

  return (
    <div className="min-h-screen min-h-screen-dvh bg-[#0c0c0e] text-white flex">
      {/* ─── Sidebar ───
          Desktop (lg+): fixed 240px rail alongside content.
          Mobile/tablet (<lg): hidden by default, slides in as an overlay
          drawer when mobileSidebarOpen. This prevents the 240px sidebar from
          eating the viewport on phones (was leaving only 80-150px for content
          and crushing the Overview 4-col stat grid to ~0-13px per card). */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed lg:static z-50 inset-y-0 left-0 w-60 min-h-screen min-h-screen-dvh border-r border-white/[0.06] bg-[#111113] flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          mobileSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center">
            <Crown size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white font-serif">
              Founder Access
            </h1>
            <p className="text-[10px] text-gray-500">Global Console</p>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {navGroups.map((g) => (
            <div key={g.label} className="pb-2 pt-1">
              <p className="text-[9px] text-gray-600 uppercase tracking-wider px-4 mb-1">
                {g.label}
              </p>
              {g.items.map((item) => (
                <NavItem
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  icon={item.icon}
                  count={item.count}
                  active={activeSection === item.id}
                  onSelect={(id) => {
                    handleSetActiveSection(id);
                    setMobileSidebarOpen(false);
                  }}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-white/[0.06] space-y-2">
          <button
            onClick={() => (window.location.href = "/")}
            className="w-full flex items-center gap-3 px-4 py-2 text-gray-500 hover:text-gray-300 text-[13px] transition-colors"
          >
            <ArrowLeft size={16} /> Back to FuelPro
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-gray-500 hover:text-red-400 text-[13px] transition-colors"
          >
            <Lock size={16} /> End Session
          </button>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex-1 flex flex-col min-h-screen min-h-screen-dvh overflow-hidden w-0 lg:w-auto">
        <header className="h-14 border-b border-white/[0.06] flex items-center justify-between px-3 sm:px-6 bg-[#0c0c0e] flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile hamburger — opens the slide-in sidebar drawer.
                Hidden on lg+ where the sidebar is a persistent rail. */}
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <Shield size={14} className="text-amber-500 flex-shrink-0" />
            <span className="text-xs text-gray-500 hidden sm:inline flex-shrink-0">
              Super Admin
            </span>
            <span className="text-gray-700 hidden sm:inline">|</span>
            <span className="text-xs text-gray-400 truncate min-w-0 capitalize">
              {activeSection.replace(/([A-Z])/g, " $1").trim()}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="relative hidden sm:block">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600"
              />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30 w-28 sm:w-48"
              />
            </div>
            {/* Refresh button — reloads founder stats */}
            <button
              onClick={() => {
                // Force a reload to refresh stats
                window.location.reload();
              }}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
              aria-label="Refresh data"
              title="Refresh data"
            >
              <RefreshCw
                size={13}
                className={statsTotalRevenue > 0 ? "" : "animate-spin"}
              />
            </button>
            {/* Cloud Sync Status — collapse to icon-only on very small screens */}
            <div
              className={`flex items-center gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg ${cloudStatus.isOnline ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}
            >
              {cloudStatus.isOnline ? (
                <>
                  <Cloud size={12} className="text-emerald-400" />
                  <span className="text-[10px] text-emerald-300 hidden md:inline">
                    Cloud Synced
                  </span>
                </>
              ) : (
                <>
                  <CloudOff size={12} className="text-amber-400" />
                  <span className="text-[10px] text-amber-300 hidden md:inline">
                    No Cloud
                  </span>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-auto">
          {/* ══════ OVERVIEW ══════ */}
          {activeSection === "overview" && (
            <div className="space-y-6">
              {/* Extended stats grid — 8 cards with real-time data */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {[
                  {
                    label: "Users",
                    value:
                      allBackendUsers && allBackendUsers.length > 0
                        ? allBackendUsers.length
                        : users.length,
                    icon: Users,
                    color: "text-blue-400",
                    onClick: () => handleSetActiveSection("users"),
                  },
                  {
                    label: "Stations",
                    value: effectiveStationCount,
                    icon: Building2,
                    color: "text-green-400",
                    onClick: () => handleSetActiveSection("stations"),
                  },
                  {
                    label: "Revenue",
                    value: `${getCurrencySymbol(globalCurrency)} ${effectiveRevenue.toLocaleString()}`,
                    icon: DollarSign,
                    color: "text-amber-400",
                    onClick: () => handleSetActiveSection("analytics"),
                  },
                  {
                    label: "Secrets",
                    value: secrets.length,
                    icon: Key,
                    color: "text-purple-400",
                    onClick: () => handleSetActiveSection("secrets"),
                  },
                  {
                    label: "Feature Flags",
                    value: featureFlags.length,
                    icon: ToggleRight,
                    color: "text-indigo-400",
                    onClick: () => handleSetActiveSection("flags"),
                  },
                  {
                    label: "Audit Events",
                    value: auditLog.length,
                    icon: Shield,
                    color: "text-cyan-400",
                    onClick: () => handleSetActiveSection("audit"),
                  },
                  {
                    label: "Webhooks",
                    value: advancedStore.webhooks.length,
                    icon: Webhook,
                    color: "text-pink-400",
                    onClick: () => handleSetActiveSection("webhooks"),
                  },
                  {
                    label: "API Keys",
                    value: advancedStore.apiKeys.length,
                    icon: KeyRound,
                    color: "text-orange-400",
                    onClick: () => handleSetActiveSection("apikeys"),
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    onClick={s.onClick}
                    className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 hover:border-white/[0.12] cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <s.icon size={14} className={s.color} />
                        <span className="text-[11px] text-gray-500">
                          {s.label}
                        </span>
                      </div>
                      <ArrowRight
                        size={12}
                        className="text-gray-700 group-hover:text-gray-400 transition-colors"
                      />
                    </div>
                    <p className="text-xl font-bold text-white">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Quick Actions panel */}
              <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
                <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                  <Zap size={14} className="text-amber-400" />
                  Quick Actions
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {[
                    {
                      label: "Add Secret",
                      icon: Key,
                      section: "secrets" as SectionId,
                    },
                    {
                      label: "New Flag",
                      icon: ToggleRight,
                      section: "flags" as SectionId,
                    },
                    {
                      label: "Add Webhook",
                      icon: Webhook,
                      section: "webhooks" as SectionId,
                    },
                    {
                      label: "API Keys",
                      icon: KeyRound,
                      section: "apikeys" as SectionId,
                    },
                    {
                      label: "Dev Center",
                      icon: Terminal,
                      section: "devcontrol" as SectionId,
                    },
                    {
                      label: "Data Manager",
                      icon: FolderCog,
                      section: "datamgmt" as SectionId,
                    },
                    {
                      label: "DB Query",
                      icon: Database,
                      section: "dbquery" as SectionId,
                    },
                    {
                      label: "Schema",
                      icon: HardDrive,
                      section: "storage" as SectionId,
                    },
                    {
                      label: "Migrations",
                      icon: Database,
                      section: "migrations" as SectionId,
                    },
                    {
                      label: "Error Log",
                      icon: AlertTriangle,
                      section: "errortracker" as SectionId,
                    },
                    {
                      label: "Sessions",
                      icon: Monitor,
                      section: "sessions" as SectionId,
                    },
                    {
                      label: "Task Queue",
                      icon: ListChecks,
                      section: "taskqueue" as SectionId,
                    },
                  ].map((a) => (
                    <button
                      key={a.label}
                      onClick={() => handleSetActiveSection(a.section)}
                      className="flex flex-col items-center gap-1.5 p-3 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      <a.icon size={16} className="text-gray-500" />
                      <span className="text-[10px]">{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced stats row — developer datasets */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {[
                  {
                    label: "Errors",
                    value: advancedStore.errorLog.filter((e) => !e.resolved)
                      .length,
                    icon: AlertTriangle,
                    color: "text-red-400",
                    section: "errortracker" as SectionId,
                  },
                  {
                    label: "Sessions",
                    value: advancedStore.sessions.filter((s) => s.active)
                      .length,
                    icon: Monitor,
                    color: "text-amber-400",
                    section: "sessions" as SectionId,
                  },
                  {
                    label: "Jobs",
                    value: advancedStore.jobs.filter((j) => j.enabled).length,
                    icon: Clock,
                    color: "text-purple-400",
                    section: "jobs" as SectionId,
                  },
                  {
                    label: "Experiments",
                    value: advancedStore.experiments.filter(
                      (e) => e.status === "running",
                    ).length,
                    icon: FlaskConical,
                    color: "text-green-400",
                    section: "experiments" as SectionId,
                  },
                  {
                    label: "Announcements",
                    value: advancedStore.announcements.filter((a) => a.active)
                      .length,
                    icon: Megaphone,
                    color: "text-cyan-400",
                    section: "announcements" as SectionId,
                  },
                  {
                    label: "Blocklist",
                    value: advancedStore.blocklist.filter((b) => b.active)
                      .length,
                    icon: ShieldBan,
                    color: "text-pink-400",
                    section: "blocklist" as SectionId,
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    onClick={() => handleSetActiveSection(s.section)}
                    className="bg-[#161618] border border-white/[0.06] rounded-xl p-3 hover:border-white/[0.12] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <s.icon size={12} className={s.color} />
                      <span className="text-[10px] text-gray-500">
                        {s.label}
                      </span>
                    </div>
                    <p className="text-lg font-bold text-white">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Cloud Sync Status */}
              {!cloudStatus.isOnline && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-amber-500/20 rounded-lg">
                      <CloudOff size={24} className="text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-amber-300 mb-2">
                        Cloud Sync Status
                      </h3>
                      <p className="text-xs text-gray-400 mb-4">
                        {cloudStatus.status?.includes("root only")
                          ? "Backend is online but cloud sync features require the REST API. Railway deployment may be updating."
                          : "This system is currently using local storage. Data is not synced across devices."}
                      </p>
                      {cloudStatus.status?.includes("root only") && (
                        <div className="mb-4">
                          <p className="text-xs text-emerald-400 mb-2">
                            ✓ Backend Connected:
                          </p>
                          <p className="text-xs text-gray-500 font-mono">
                            {import.meta.env.VITE_BACKEND_URL ||
                              "Railway Backend (deprecated)"}
                          </p>
                        </div>
                      )}
                      <button
                        onClick={() => checkCloudStatus()}
                        className="mt-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs font-medium transition-colors"
                      >
                        <RefreshCw size={12} className="inline mr-1" />
                        Retry Connection
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-6">
                <h3 className="text-sm font-medium text-gray-300 mb-4">
                  Global Revenue Overview
                </h3>
                <div className="h-40 flex items-end gap-1.5">
                  {[65, 45, 80, 55, 70, 90, 60, 75, 85, 50, 95, 70].map(
                    (h, i) => (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center gap-1"
                      >
                        <div
                          className="w-full bg-gradient-to-t from-amber-600 to-amber-400 rounded-t-sm"
                          style={{ height: `${h}%` }}
                        />
                        <span className="text-[9px] text-gray-600">
                          {
                            [
                              "J",
                              "F",
                              "M",
                              "A",
                              "M",
                              "J",
                              "J",
                              "A",
                              "S",
                              "O",
                              "N",
                              "D",
                            ][i]
                          }
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">
                    Recent Audit Events
                  </h3>
                  <div className="space-y-2">
                    {auditLog.slice(0, 5).map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        {a.severity === "success" ? (
                          <CheckCircle2
                            size={11}
                            className="text-emerald-400"
                          />
                        ) : a.severity === "warning" ? (
                          <AlertTriangle size={11} className="text-amber-400" />
                        ) : a.severity === "danger" ? (
                          <XCircle size={11} className="text-red-400" />
                        ) : (
                          <Activity size={11} className="text-blue-400" />
                        )}
                        <span className="text-gray-400 flex-1 truncate">
                          {a.event}
                        </span>
                        <span className="text-gray-600">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">
                    Active Feature Flags
                  </h3>
                  <div className="space-y-2">
                    {featureFlags.slice(0, 5).map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${f.enabled ? "bg-green-400" : "bg-gray-600"}`}
                        />
                        <span className="text-gray-400 flex-1">{f.name}</span>
                        <span
                          className={
                            f.enabled ? "text-green-400" : "text-gray-600"
                          }
                        >
                          {f.enabled ? "On" : "Off"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════ USERS ══════ */}
          {activeSection === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-medium text-white">
                  All Registered Users
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {filteredUsers.length} of{" "}
                    {users.length + (allBackendUsers?.length || 0)} total
                  </span>
                  <button
                    onClick={() => {
                      const data = filteredUsers;
                      const csv = [
                        [
                          "Name",
                          "Email",
                          "Auth Method",
                          "Role",
                          "Stations",
                          "Status",
                          "Last Active",
                          "Created At",
                        ].join(","),
                        ...data.map((u) =>
                          [
                            u.name,
                            u.email,
                            u.authMethod,
                            u.role,
                            u.stations,
                            "Active",
                            u.lastActive,
                            u.createdAt,
                          ]
                            .map(
                              (v) =>
                                `"${(v || "").toString().replace(/"/g, '""')}"`,
                            )
                            .join(","),
                        ),
                      ].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `users_${Date.now()}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      logAudit(
                        "Export Users",
                        `${data.length} users exported to CSV`,
                        "info",
                      );
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    <Download size={13} />
                    Export CSV
                  </button>
                  <button
                    onClick={() => {
                      const data = filteredUsers;
                      const json = JSON.stringify(data, null, 2);
                      const blob = new Blob([json], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `users_${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      logAudit(
                        "Export Users",
                        `${data.length} users exported to JSON`,
                        "info",
                      );
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    <FileCode size={13} />
                    Export JSON
                  </button>
                </div>
              </div>

              {/* User stats summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "Total Users",
                    value: filteredUsers.length,
                    color: "text-blue-400",
                  },
                  {
                    label: "Owners",
                    value: filteredUsers.filter((u) => u.role === "owner")
                      .length,
                    color: "text-purple-400",
                  },
                  {
                    label: "Managers",
                    value: filteredUsers.filter((u) => u.role === "manager")
                      .length,
                    color: "text-indigo-400",
                  },
                  {
                    label: "Staff",
                    value: filteredUsers.filter((u) => u.role === "staff")
                      .length,
                    color: "text-green-400",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="bg-[#161618] border border-white/[0.06] rounded-xl p-3"
                  >
                    <p className="text-[10px] text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-[#161618] border border-white/[0.06] rounded-xl overflow-x-auto -mx-3 sm:mx-0">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {[
                        "User",
                        "Auth",
                        "Role",
                        "Stations",
                        "Status",
                        "Last Active",
                        "Actions",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-[11px] text-gray-500 font-medium px-4 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.authId}
                        className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm text-white">
                            {u.name || "Anonymous"}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {u.email || "No email"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] px-2 py-1 bg-white/5 rounded text-gray-400 capitalize">
                            {u.authMethod}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] px-2 py-1 rounded capitalize ${
                              u.role === "owner"
                                ? "bg-purple-500/15 text-purple-300"
                                : u.role === "manager"
                                  ? "bg-blue-500/15 text-blue-300"
                                  : u.role === "staff"
                                    ? "bg-green-500/15 text-green-300"
                                    : u.role === "founder" || u.role === "admin"
                                      ? "bg-red-500/15 text-red-300"
                                      : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {u.stations}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                            <Radio size={10} /> Active
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-gray-500">
                          {(() => {
                            const d = u.lastActive
                              ? new Date(u.lastActive)
                              : null;
                            return d && !isNaN(d.getTime())
                              ? d.toLocaleDateString()
                              : u.lastActive === "Never"
                                ? "Never"
                                : "—";
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const newRole = prompt(
                                  `Change role for ${u.name || u.email}?\nCurrent: ${u.role}\nEnter new role (owner/manager/staff):`,
                                  u.role,
                                );
                                if (newRole && newRole !== u.role) {
                                  logAudit(
                                    "Role Change",
                                    `${u.email}: ${u.role} → ${newRole}`,
                                    "warning",
                                  );
                                  toastSuccess(
                                    `Role change logged for ${u.email}: ${u.role} → ${newRole}. Use Supabase admin API to apply.`,
                                  );
                                }
                              }}
                              className="p-1 text-gray-500 hover:text-indigo-400 transition-colors"
                              title="Change role"
                            >
                              <Settings size={13} />
                            </button>
                            <button
                              onClick={() => {
                                const info = `User Details:\n\nName: ${u.name || "Anonymous"}\nEmail: ${u.email}\nAuth Method: ${u.authMethod}\nRole: ${u.role}\nStations: ${u.stations}\nLast Active: ${u.lastActive}\nCreated: ${u.createdAt}\nAuth ID: ${u.authId}`;
                                toastSuccess("User details logged to console");
                                console.log(info);
                              }}
                              className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                              title="View details"
                            >
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-center text-gray-600 py-12"
                        >
                          No users found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════ STATIONS ══════ */}
          {activeSection === "stations" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-medium text-white">
                  All Stations Worldwide
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {filteredStations.length} total
                  </span>
                  <button
                    onClick={() => {
                      const csv = [
                        [
                          "Name",
                          "Location",
                          "Owner",
                          "Members",
                          "Revenue",
                          "Status",
                          "Created",
                          "Last Active",
                        ].join(","),
                        ...filteredStations.map((s) =>
                          [
                            s.name,
                            s.location,
                            s.ownerName,
                            s.members,
                            s.revenue,
                            "Active",
                            s.createdAt,
                            s.lastActive,
                          ]
                            .map(
                              (v) =>
                                `"${(v || "").toString().replace(/"/g, '""')}"`,
                            )
                            .join(","),
                        ),
                      ].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `stations_${Date.now()}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      logAudit(
                        "Export Stations",
                        `${filteredStations.length} stations exported`,
                        "info",
                      );
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    <Download size={13} />
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Station stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "Total Stations",
                    value: filteredStations.length,
                    color: "text-green-400",
                  },
                  {
                    label: "Total Members",
                    value: filteredStations.reduce(
                      (s, st) => s + st.members,
                      0,
                    ),
                    color: "text-blue-400",
                  },
                  {
                    label: "Total Revenue",
                    value: `${getCurrencySymbol(getDetectedCurrency())} ${(filteredStations.reduce((s, st) => s + st.revenue, 0) / 1000).toFixed(0)}K`,
                    color: "text-amber-400",
                  },
                  {
                    label: "Avg Revenue",
                    value: `${getCurrencySymbol(getDetectedCurrency())} ${filteredStations.length > 0 ? (filteredStations.reduce((s, st) => s + st.revenue, 0) / filteredStations.length / 1000).toFixed(1) : 0}K`,
                    color: "text-purple-400",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="bg-[#161618] border border-white/[0.06] rounded-xl p-3"
                  >
                    <p className="text-[10px] text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredStations.map((s) => (
                  <div
                    key={s.id}
                    className="bg-[#161618] border border-white/[0.06] rounded-xl p-5 hover:border-white/[0.12] transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate">
                          {s.name}
                        </h3>
                        <p className="text-[11px] text-gray-500 truncate">
                          {s.location}
                        </p>
                      </div>
                      <div className="w-7 h-7 bg-green-500/10 rounded-lg flex items-center justify-center shrink-0">
                        <Building2 size={13} className="text-green-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Members", value: s.members },
                        {
                          label: "Revenue",
                          value: `${getCurrencySymbol(s.currency || globalCurrency)} ${s.revenue >= 1000 ? (s.revenue / 1000).toFixed(1) + "K" : s.revenue.toFixed(0)}`,
                        },
                        {
                          label: "Status",
                          value: "Active",
                          color: "text-emerald-400",
                        },
                      ].map((m) => (
                        <div
                          key={m.label}
                          className="bg-white/[0.02] rounded-lg p-2 text-center"
                        >
                          <p className="text-[10px] text-gray-500">{m.label}</p>
                          <p
                            className={`text-sm font-semibold ${m.color || "text-white"}`}
                          >
                            {m.value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-600 mt-2 flex items-center gap-2 flex-wrap">
                      <span>Owner: {s.ownerName}</span>
                      {s.currency && (
                        <span className="px-1.5 py-0.5 bg-white/[0.06] rounded text-gray-400">
                          {s.currency}
                        </span>
                      )}
                      {s.country && (
                        <span className="px-1.5 py-0.5 bg-white/[0.06] rounded text-gray-400">
                          {s.country}
                        </span>
                      )}
                      {s.code && (
                        <span className="px-1.5 py-0.5 bg-white/[0.06] rounded text-gray-400">
                          {s.code}
                        </span>
                      )}
                    </p>
                    <button
                      onClick={() => {
                        const info = `Station Details:\n\nName: ${s.name}\nLocation: ${s.location}\nOwner: ${s.ownerName}\nMembers: ${s.members}\nRevenue: ${getCurrencySymbol(getDetectedCurrency())} ${s.revenue.toLocaleString()}\nID: ${s.id}\nOwner ID: ${s.ownerId}\nCreated: ${s.createdAt}\nLast Active: ${s.lastActive}`;
                        toastSuccess("User details logged to console");
                        console.log(info);
                      }}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-blue-400 transition-colors mt-2"
                    >
                      <Eye size={11} />
                      Details
                    </button>
                  </div>
                ))}
                {filteredStations.length === 0 && (
                  <div className="col-span-2 text-center text-gray-600 py-12">
                    No stations found
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════ SECRETS ══════ */}
          {activeSection === "secrets" && (
            <SecretsManagerSection
              secrets={consoleStore.secrets}
              settings={consoleSettings}
              onUpsert={consoleStore.upsertSecret}
              onDelete={consoleStore.deleteSecret}
              onRotate={consoleStore.rotateSecret}
              logAudit={consoleStore.addAudit}
            />
          )}

          {/* ══════ AUDIT LOG ══════ */}
          {activeSection === "audit" && (
            <AuditLogManagerSection
              audit={consoleStore.audit}
              loading={consoleStore.loading}
              lastSync={consoleStore.lastSync}
              onClear={consoleStore.clearAudit}
              onReload={consoleStore.reload}
              logAudit={consoleStore.addAudit}
              retentionLimit={consoleSettings.auditRetention}
            />
          )}

          {/* ══════ FEATURE FLAGS ══════ */}
          {activeSection === "flags" && (
            <FeatureFlagsManagerSection
              flags={consoleStore.flags}
              settings={consoleSettings}
              onUpsert={consoleStore.upsertFlag}
              onToggle={consoleStore.toggleFlag}
              onDelete={consoleStore.deleteFlag}
              onBulkSet={consoleStore.bulkSetFlags}
              logAudit={consoleStore.addAudit}
            />
          )}

          {/* ══════ SYSTEM HEALTH ══════ */}
          {activeSection === "system" && (
            <SystemHealthManagerSection
              logAudit={(event, detail, severity) =>
                consoleStore.addAudit(
                  event,
                  detail,
                  severity ?? "info",
                  "FOUNDER",
                )
              }
            />
          )}

          {/* ══════ AI WEBSITE EDITOR ══════ */}
          {activeSection === "editor" && (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-amber-400" /> AI Website
                    Editor
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Describe changes and AI will generate code modifications
                  </p>
                </div>
                <div className="flex bg-white/5 rounded-lg p-0.5">
                  {[
                    {
                      id: "chat" as const,
                      label: "Instructions",
                      icon: Terminal,
                    },
                    { id: "files" as const, label: "Files", icon: Upload },
                    { id: "preview" as const, label: "History", icon: Clock },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setEditorTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${editorTab === tab.id ? "bg-amber-500/15 text-amber-300" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      <tab.icon size={13} /> {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {editorTab === "chat" && (
                <div className="flex-1 flex flex-col gap-4 min-h-0">
                  <div className="flex-1 bg-[#161618] border border-white/[0.06] rounded-xl p-4 overflow-auto min-h-0">
                    {editorOutput ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-3">
                          <Wand2 size={14} className="text-amber-400" />
                          <span className="text-xs text-amber-400 font-medium">
                            AI Output
                          </span>
                        </div>
                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap bg-black/30 p-4 rounded-lg overflow-x-auto">
                          {editorOutput}
                        </pre>
                      </div>
                    ) : editorHistory.length > 0 ? (
                      <div className="space-y-4">
                        {editorHistory.map((h, i) => (
                          <div
                            key={i}
                            className="border border-white/[0.06] rounded-lg p-3"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Terminal size={12} className="text-blue-400" />
                              <span className="text-[11px] text-blue-400 font-medium">
                                {h.instruction}
                              </span>
                              <span className="text-[10px] text-gray-600 ml-auto">
                                {new Date(h.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap bg-black/20 p-3 rounded-lg max-h-32 overflow-y-auto">
                              {h.output}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-600">
                        <Sparkles size={32} className="mb-3 text-gray-700" />
                        <p className="text-sm">
                          Describe what you want to change
                        </p>
                        <p className="text-xs mt-1">
                          AI will generate the code modifications
                        </p>
                        <div className="mt-6 space-y-2 w-full max-w-md">
                          {[
                            "Add a new dark theme to the dashboard",
                            "Create a new report tab for fuel efficiency",
                            "Add date range filter to all tables",
                            "Redesign the login page with animations",
                          ].map((s, i) => (
                            <button
                              key={i}
                              onClick={() => setEditorInstruction(s)}
                              className="w-full text-left px-3 py-2 text-xs text-gray-500 bg-white/[0.03] hover:bg-white/[0.06] rounded-lg transition-colors border border-white/[0.06]"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-4">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <textarea
                          value={editorInstruction}
                          onChange={(e) => setEditorInstruction(e.target.value)}
                          placeholder="Describe the changes you want to make..."
                          className="w-full h-20 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30 resize-none"
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-gray-600">
                            Cmd+Enter to submit
                          </span>
                          <span className="text-[10px] text-gray-600">
                            {editorInstruction.length} chars
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={executeEditor}
                        disabled={editorExecuting || !editorInstruction.trim()}
                        className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-700 disabled:to-gray-700 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2 self-start"
                      >
                        {editorExecuting ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />{" "}
                            Processing
                          </>
                        ) : (
                          <>
                            <Sparkles size={14} /> Generate
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {editorTab === "files" && (
                <div className="space-y-4">
                  <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-6 text-center">
                    <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Upload size={20} className="text-amber-400" />
                    </div>
                    <p className="text-sm text-white font-medium mb-1">
                      Upload Files
                    </p>
                    <p className="text-xs text-gray-500 mb-4">
                      Images, documents, or reference files for AI context
                    </p>
                    <label className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm rounded-lg transition-colors border border-amber-500/20 cursor-pointer">
                      <Upload size={14} /> Choose Files
                      <input
                        type="file"
                        multiple
                        accept="image/*,.pdf,.txt,.md,.json,.tsx,.ts,.css"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-4">
                      <h4 className="text-sm font-medium text-white mb-3">
                        Uploaded Files ({uploadedFiles.length})
                      </h4>
                      <div className="space-y-2">
                        {uploadedFiles.map((file, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg"
                          >
                            <FileCode size={14} className="text-amber-400" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white truncate">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-gray-500">
                                {file.type} - {(file.size / 1024).toFixed(1)} KB
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                setUploadedFiles((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                )
                              }
                              className="text-gray-500 hover:text-red-400"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {editorTab === "preview" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white">
                      Modification History
                    </h3>
                    {editorHistory.length > 0 && (
                      <button
                        onClick={() => setEditorHistory([])}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  {editorHistory.length === 0 ? (
                    <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-12 text-center text-gray-600">
                      <Clock size={24} className="mx-auto mb-2" />
                      <p className="text-sm">No modifications yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {editorHistory.map((h, i) => (
                        <div
                          key={i}
                          className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Cpu size={12} className="text-amber-400" />
                            <span className="text-xs text-amber-400 font-medium">
                              {h.instruction}
                            </span>
                            <span className="text-[10px] text-gray-600 ml-auto">
                              {new Date(h.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap bg-black/20 p-3 rounded-lg max-h-48 overflow-y-auto">
                            {h.output}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══════ NEW SECTIONS ══════ */}
          {/* Lazy-loaded: each founder section is a separate chunk so the
              founder bundle isn't 1+ MB on first paint. Only the active
              section's chunk is fetched on demand. */}
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-400" />
              </div>
            }
          >
            {activeSection === "security" && (
              <SecuritySection logAudit={logAudit} />
            )}
            {activeSection === "backup" && (
              <BackupSection logAudit={logAudit} />
            )}
            {activeSection === "config" && (
              <ConfigSection logAudit={logAudit} />
            )}
            {activeSection === "notifications" && (
              <NotificationsSection logAudit={logAudit} />
            )}
            {activeSection === "branding" && (
              <BrandingSection logAudit={logAudit} />
            )}
            {activeSection === "api" && <ApiSection logAudit={logAudit} />}
            {activeSection === "analytics" && (
              <AnalyticsSection
                logAudit={logAudit}
                backendRevenue={statsTotalRevenue}
                backendStationCount={allBackendStations?.length}
                backendUserCount={allBackendUsers?.length}
              />
            )}
            {activeSection === "maintenance" && (
              <MaintenanceSection logAudit={logAudit} />
            )}
            {activeSection === "email" && (
              <EmailTemplatesSection logAudit={logAudit} />
            )}
            {activeSection === "ratelimit" && (
              <RateLimitSection logAudit={logAudit} />
            )}
            {activeSection === "datamgmt" && (
              <DataManagementSection logAudit={logAudit} />
            )}

            {/* ══════ CONSOLE SETTINGS ══════ */}
            {activeSection === "consolesettings" && (
              <ConsoleSettingsSection
                settings={consoleSettings}
                lastSync={consoleStore.lastSync}
                onUpdate={consoleStore.updateSettings}
                logAudit={consoleStore.addAudit}
              />
            )}

            {/* ══════ MONETIZATION ══════ */}
            {activeSection === "pricing" && (
              <PricingManagerSection logAudit={logAudit} />
            )}
            {activeSection === "subdash" && (
              <SubscriptionDashboardSection logAudit={logAudit} />
            )}
            {activeSection === "coupons" && (
              <CouponSection logAudit={logAudit} />
            )}
            {activeSection === "payouts" && (
              <PayoutSection logAudit={logAudit} />
            )}
            {activeSection === "trialanalytics" && (
              <TrialAnalyticsSection logAudit={logAudit} />
            )}
            {activeSection === "performance" && (
              <PerformanceSection logAudit={logAudit} />
            )}
            {activeSection === "paywall" && (
              <PaywallControlSection logAudit={logAudit} />
            )}
            {activeSection === "paymentmethods" && (
              <PaymentMethodsSection logAudit={logAudit} />
            )}

            {/* ══════ DEVELOPER TOOLS ══════ */}
            {activeSection === "commandpalette" && (
              <CommandPaletteSection
                commands={navGroups.flatMap((g) =>
                  g.items.map((it) => ({
                    id: it.id,
                    label: it.label,
                    group: g.label,
                    keywords: it.label.toLowerCase(),
                    icon: it.icon,
                  })),
                )}
                onRun={(id) => handleSetActiveSection(id as SectionId)}
              />
            )}
            {activeSection === "webhooks" && (
              <WebhooksManagerSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "apikeys" && (
              <ApiKeysManagerSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "jobs" && (
              <ScheduledJobsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "experiments" && (
              <ExperimentsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "healthchecks" && (
              <HealthChecksSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "dbquery" && (
              <DatabaseQuerySection logAudit={consoleStore.addAudit} />
            )}
            {activeSection === "cachemgmt" && (
              <CacheManagementSection logAudit={consoleStore.addAudit} />
            )}

            {/* ══════ PLATFORM CONTROL ══════ */}
            {activeSection === "announcements" && (
              <AnnouncementsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "maintwindows" && (
              <MaintenanceWindowsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "blocklist" && (
              <BlocklistSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "cors" && (
              <CorsConfigSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "envvars" && (
              <EnvVarsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "localization" && (
              <LocalizationSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "errortracker" && (
              <ErrorTrackerSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "sessions" && (
              <SessionInspectorSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "taskqueue" && (
              <TaskQueueSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "logstreams" && (
              <LogStreamsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "rolematrix" && (
              <RoleMatrixSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "releasecoord" && (
              <ReleaseCoordinatorSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "migrations" && (
              <MigrationsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "deliveries" && (
              <WebhookDeliveriesSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "storage" && (
              <StorageExplorerSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
            {activeSection === "ratelimits" && (
              <ApiRateLimitsSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}

            {activeSection === "devcontrol" && (
              <DeveloperControlCenterSection
                store={advancedStore}
                logAudit={consoleStore.addAudit}
              />
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );

  /* ─── Editor submit handler ─── */
  function executeEditor() {
    const instruction = editorInstruction.trim();
    if (!instruction || editorExecuting) return;
    setEditorExecuting(true);
    setEditorOutput("");
    // Generate AI response immediately — no artificial delay
    const output = generateAIResponse(instruction);
    setEditorOutput(output);
    setEditorHistory((prev) =>
      [
        { instruction, output, timestamp: new Date().toISOString() },
        ...prev,
      ].slice(0, 50),
    );
    setEditorExecuting(false);
    setEditorInstruction("");
    logAudit(
      "AI Editor Used",
      `Instruction: ${instruction.slice(0, 100)}`,
      "info",
    );
  }

  /* ─── File upload handler ─── */
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedFiles((prev) => [
          ...prev,
          {
            name: file.name,
            type: file.type || "unknown",
            content: reader.result as string,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    logAudit(
      "File Uploaded",
      `${files.length} file(s) uploaded to AI Editor`,
      "info",
    );
  }

  /* ─── AI response generator ─── */
  function generateAIResponse(instruction: string): string {
    const lower = instruction.toLowerCase();
    if (
      lower.includes("theme") ||
      lower.includes("dark") ||
      lower.includes("color")
    ) {
      return `// Theme modification for FuelPro\n// Based on: "${instruction}"\n\n// 1. Update tailwind.config.js\ncolors: {\n  fuelpro: {\n    primary: '#d97706',\n    dark: '#0c0c0e',\n    surface: '#161618',\n    border: 'rgba(255,255,255,0.06)',\n  }\n}\n\n// 2. Update global CSS\n:root {\n  --fuelpro-bg: #0c0c0e;\n  --fuelpro-surface: #161618;\n  --fuelpro-accent: #d97706;\n}`;
    }
    if (
      lower.includes("filter") ||
      lower.includes("table") ||
      lower.includes("date")
    ) {
      return `// Date Range Filter for Tables\n// Based on: "${instruction}"\n\nfunction DateRangeFilter({ onFilter }: { onFilter: (s: Date, e: Date) => void }) {\n  const [start, setStart] = useState<Date | null>(null);\n  const [end, setEnd] = useState<Date | null>(null);\n  return (\n    <div className="flex items-center gap-2">\n      <input type="date" onChange={e => setStart(e.target.valueAsDate)} />\n      <span>to</span>\n      <input type="date" onChange={e => setEnd(e.target.valueAsDate)} />\n      <button onClick={() => start && end && onFilter(start, end)}>Apply</button>\n    </div>\n  );\n}`;
    }
    if (
      lower.includes("tab") ||
      lower.includes("report") ||
      lower.includes("fuel")
    ) {
      return `// New Fuel Efficiency Report Tab\n// Based on: "${instruction}"\n\n// 1. Register in tab configuration:\n{\n  id: 'fuel_efficiency',\n  label: 'Fuel Efficiency',\n  icon: 'TrendingUp',\n  component: 'FuelEfficiencyReport',\n  order: 24\n}\n\n// 2. Create component:\nexport default function FuelEfficiencyReport() {\n  const { sales } = useFuel();\n  const efficiency = useMemo(() => {\n    return sales.map(s => ({\n      ...s,\n      litersPerSale: s.quantity / (s.pumps.length || 1),\n    }));\n  }, [sales]);\n  return <div>{/* Charts and analysis */}</div>;\n}`;
    }
    return `// AI-Generated Code Modification\n// Instruction: "${instruction}"\n\n/*\n1. ANALYSIS:\n   - Review current component structure\n   - Identify files that need modification\n   - Plan state management updates\n\n2. IMPLEMENTATION:\n   - Modify target components\n   - Update TypeScript types\n   - Add necessary imports\n\n3. FILES TO MODIFY:\n   - Identify specific .tsx files\n   - Update styling if needed\n   - Add any new dependencies\n*/\n\n// To implement this change:\n// 1. Copy the relevant code above\n// 2. Paste into the target file\n// 3. Run npm run build to verify\n// 4. Test in browser`;
  }
}
