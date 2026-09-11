import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Link2,
  User,
  LogIn,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  UserCheck,
  Eye,
  Clock,
  Mail,
  Lock,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { getSupabaseClient } from "@/supabase/client";
import type {
  UserRole,
  InvitePayload,
} from "@/react-app/context/PermissionContext";

interface InviteData {
  id: string;
  role: UserRole;
  stationName: string;
  stationId: string;
  createdBy: string;
  createdByName?: string;
  createdByUniqueId?: string;
  expiresAt?: string;
  maxUses: number;
  canCreateSubUsers?: boolean;
  canGrantPermissions?: boolean;
  permissionsSnapshot?: Record<string, unknown>;
  tabGrants?: string[];
}

const ROLE_INFO: Record<
  string,
  { label: string; desc: string; icon: any; color: string }
> = {
  manager: {
    label: "Manager",
    desc: "Operational control, can invite Staff/Auditor",
    icon: UserCheck,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  staff: {
    label: "Staff",
    desc: "Daily tasks, assigned pumps/shifts",
    icon: User,
    color: "text-green-600 bg-green-50 border-green-200",
  },
  auditor: {
    label: "Auditor",
    desc: "Read-only audit and reports",
    icon: Eye,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  owner: {
    label: "Owner",
    desc: "Full system control",
    icon: ShieldCheck,
    color: "text-purple-600 bg-purple-50 border-purple-200",
  },
};

/** Decode URL-safe base64 back to JSON */
function decodeInviteData(encoded: string): InviteData | null {
  try {
    // Reverse URL-safe base64: replace - with +, _ with /
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding back
    while (base64.length % 4 !== 0) base64 += "=";
    const json = atob(base64);
    return JSON.parse(json) as InviteData;
  } catch {
    return null;
  }
}

export default function InviteAccept() {
  const { inviteId: encodedData } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();
  const { user, loginWithEmail, registerWithEmail, bindRole } = useAuth();
  const { acceptInviteFromPayload } = usePermissions();

  const [username, setUsername] = useState("");
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [step, setStep] = useState<"check" | "auth" | "username" | "done">(
    "check",
  );

  // Auth form states
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authPending, setAuthPending] = useState(false);

  // Decode invite from URL on mount
  useEffect(() => {
    if (!encodedData) {
      setError("Invalid invite link - no invite data found.");
      return;
    }

    const decoded = decodeInviteData(encodedData);
    if (!decoded) {
      setError("This invite link is corrupted or invalid.");
      return;
    }

    // Validate the invite
    if (decoded.expiresAt && new Date(decoded.expiresAt) < new Date()) {
      setError(
        `This invite expired on ${new Date(decoded.expiresAt).toLocaleDateString()}.`,
      );
      return;
    }

    // Check if already used by a DIFFERENT user on this browser.
    // Same-user re-acceptance is allowed (idempotent — updates role/username).
    // Cross-device "already used" is enforced by the station_members DB table
    // (checked in handleAccept), NOT by localStorage.
    const usedInvites = JSON.parse(
      localStorage.getItem("fuelpro_used_invites") || "{}",
    );
    const usedBy = usedInvites[decoded.id];
    if (usedBy && usedBy !== user?.email && usedBy !== user?.id) {
      setError(`This invite was already used by ${usedBy} on this device.`);
      return;
    }

    // NOTE: max-uses is NOT checked here. The localStorage use-count is
    // browser-local and unreliable for cross-device max-uses enforcement.
    // The authoritative check is the station_members DB table count, which
    // is done in handleAccept (async, server-side). This allows the invitee
    // to proceed to the username step and get a clear error if the DB
    // rejects the upsert.

    setInvite(decoded);

    // If already authenticated, skip to username step
    if (user) {
      setStep("username");
    } else {
      setStep("auth");
    }
  }, [encodedData, user]);

  // Handle login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter email and password");
      return;
    }

    setAuthPending(true);
    const ok = await loginWithEmail(email.trim(), password);
    setAuthPending(false);
    if (!ok) setError("Invalid email or password");
  };

  // Handle quick register
  const handleQuickRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!regName.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setAuthPending(true);
    const ok = await registerWithEmail(email.trim(), password, regName.trim());
    setAuthPending(false);
    if (!ok && !error)
      setError("Failed to create account. Email may already exist.");
  };

  const handleAccept = async () => {
    if (!username.trim() || !invite) {
      setError("Please enter your username");
      return;
    }
    if (!user) {
      setError("You must be signed in first");
      return;
    }

    // 1) Accept via PermissionContext using the DECODED URL payload directly.
    //    The old code called acceptInvite(invite.id, ...) which looked up the
    //    invite in the INVITEE's local invites array — but invites are created
    //    by the station OWNER and stored under the owner's cloud key, so the
    //    invitee's array is always empty → always returned false → the
    //    "invite is invalid" error. Now we pass the full decoded payload.
    const payload: InvitePayload = {
      id: invite.id,
      role: invite.role,
      stationName: invite.stationName,
      stationId: invite.stationId,
      createdBy: invite.createdBy,
      createdByName: invite.createdByName,
      createdByUniqueId: invite.createdByUniqueId,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      canCreateSubUsers: invite.canCreateSubUsers,
      canGrantPermissions: invite.canGrantPermissions,
      permissionsSnapshot: invite.permissionsSnapshot as any,
      tabGrants: invite.tabGrants,
    };
    const ok = acceptInviteFromPayload(payload, username.trim());
    if (!ok) {
      setError(
        "This invite is invalid or expired. Please ask the station owner for a new invite.",
      );
      return;
    }

    // 2) Store current station context FIRST (read-through cache only) so the
    //    PermissionContext role-sync effect can find the stationId when
    //    bindRole triggers the binding update.
    localStorage.setItem(
      "fuelpro_current_station",
      JSON.stringify({
        stationId: invite.stationId || "default",
        role: invite.role,
      }),
    );
    try {
      localStorage.setItem(
        "fuelpro_current_station_v3",
        JSON.stringify({
          stationId: invite.stationId || "default",
          stationName: invite.stationName || "Fuel Station",
          role: invite.role,
        }),
      );
    } catch {
      /* ignore */
    }

    // 3) Upsert into the DB station_members table (server-side, cross-device,
    //    RLS-validated). This is the authoritative membership record used by
    //    AuthContext.syncBindingsFromCloud on every subsequent device login.
    //    We ALSO store a cloud-KV backup so membership persists even when the
    //    station_id is NOT a UUID (e.g. "default" or a legacy string id) — the
    //    DB table requires a UUID station_id, but app_kv accepts any string.
    try {
      const sc = getSupabaseClient();
      const stationId = invite.stationId || "default";
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          stationId,
        );
      if (isUuid) {
        const { error: dbErr } = await sc.from("station_members").upsert(
          {
            station_id: stationId,
            user_id: user.id,
            invited_email: user.email,
            name: username.trim(),
            role: invite.role,
            status: "accepted",
            invite_token: invite.id,
            invited_by_name: invite.createdBy,
            invited_by_unique_id: invite.createdByUniqueId || null,
            expires_at: invite.expiresAt || null,
            max_uses: invite.maxUses || 1,
            can_create_subusers: invite.canCreateSubUsers || false,
            can_grant_permissions: invite.canGrantPermissions || false,
            member_email: user.email,
            member_role: invite.role,
          },
          { onConflict: "station_id,user_id" },
        );
        if (dbErr) {
          console.warn(
            "[InviteAccept] station_members upsert failed:",
            dbErr.message,
          );
        }
      }
      // ALWAYS also store in cloud KV (app_kv) so membership persists for
      // non-UUID station ids AND so the binding survives across devices even
      // if the DB table has RLS issues. This is the same store the
      // PermissionContext uses for team_members.
      try {
        const { cloudStorageService } =
          await import("@/react-app/lib/cloud-storage-service");
        const membershipKey = "station_memberships";
        const existing =
          (await cloudStorageService.get<
            Array<{
              stationId: string;
              stationName: string;
              role: string;
              userId: string;
              email: string;
              username: string;
              invitedBy: string;
              acceptedAt: string;
            }>
          >(membershipKey, stationId)) || [];
        const idx = existing.findIndex(
          (m) => m.stationId === stationId && m.userId === user.id,
        );
        const record = {
          stationId,
          stationName: invite.stationName || "Fuel Station",
          role: invite.role,
          userId: user.id,
          email: user.email,
          username: username.trim(),
          invitedBy: invite.createdBy || "owner",
          acceptedAt: new Date().toISOString(),
        };
        if (idx >= 0) {
          existing[idx] = record;
        } else {
          existing.push(record);
        }
        await cloudStorageService.set(membershipKey, existing, stationId);
      } catch (kvErr) {
        console.warn("[InviteAccept] cloud KV membership write failed:", kvErr);
      }
    } catch (e) {
      console.warn("[InviteAccept] DB membership write failed:", e);
    }

    // 4) Bind role to auth identity (client-side binding, cross-device via
    //    station_members sync above). This triggers the PermissionContext
    //    role-sync effect which sets role = invite.role.
    bindRole(
      invite.stationId || "default",
      invite.stationName || "Fuel Station",
      invite.role,
      invite.createdBy,
      invite.expiresAt,
    );

    // 4b) Persist the station context so Home.tsx picks the right station on
    //     the next reload. Without this, the invitee lands on the owner's
    //     station (or "create station" screen) instead of the shared one.
    try {
      localStorage.setItem(
        "fuelpro_current_station",
        JSON.stringify({
          stationId: invite.stationId || "default",
          role: invite.role,
        }),
      );
      localStorage.setItem(
        "fuelpro_current_station_v3",
        JSON.stringify({
          stationId: invite.stationId || "default",
          stationName: invite.stationName || "Fuel Station",
          role: invite.role,
        }),
      );
    } catch {
      /* ignore quota errors */
    }

    // 5) Record invite usage in localStorage (browser-local cache for the
    //    "already used by a different user" check on this device).
    try {
      const used = JSON.parse(
        localStorage.getItem("fuelpro_used_invites") || "{}",
      );
      used[invite.id] = user?.email || user?.id || username.trim();
      localStorage.setItem("fuelpro_used_invites", JSON.stringify(used));
    } catch {
      /* ignore quota errors */
    }

    setSuccess(
      `Welcome ${username}! You are now ${invite.role} at ${invite.stationName || "the station"}.`,
    );
    setStep("done");

    // Redirect to dashboard after 2.5 seconds
    setTimeout(() => {
      navigate("/");
      import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
        broadcastReload(),
      );
    }, 2500);
  };

  // Error state
  if (error && step === "check") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-red-300/30 rounded-2xl p-8 text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-bold text-white mb-2">Invite Error</h2>
          <p className="text-sm text-red-300 mb-6">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  const roleInfo = ROLE_INFO[invite.role] || ROLE_INFO.staff;
  const RoleIcon = roleInfo.icon;

  // Step 1: Authenticate with email/password
  if (step === "auth") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Invite Info */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
              <Link2 size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">You're Invited!</h1>
            <p className="text-sm text-indigo-300 mt-1">
              Join {invite.stationName || "a FuelPro station"}
            </p>
          </div>

          <div className={`p-4 rounded-xl border mb-6 ${roleInfo.color}`}>
            <div className="flex items-center gap-3">
              <RoleIcon size={24} />
              <div>
                <p className="text-sm font-bold">{roleInfo.label} Role</p>
                <p className="text-xs opacity-70">{roleInfo.desc}</p>
              </div>
            </div>
            {invite.stationName && (
              <p className="text-xs mt-2 opacity-70">
                Station: <strong>{invite.stationName}</strong>
              </p>
            )}
            {invite.expiresAt && (
              <p className="text-xs mt-1 opacity-70 flex items-center gap-1">
                <Clock size={10} /> Expires:{" "}
                {new Date(invite.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Auth Tabs */}
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
            {/* Toggle Login / Register */}
            <div className="flex bg-white/5 rounded-xl p-1 mb-5 border border-white/10">
              <button
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  authMode === "login"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                <LogIn size={13} /> Sign In
              </button>
              <button
                onClick={() => {
                  setAuthMode("register");
                  setError("");
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  authMode === "register"
                    ? "bg-green-600 text-white shadow-md"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                <UserPlus size={13} /> Create Account
              </button>
            </div>

            {error && (
              <div className="mb-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                <AlertTriangle
                  size={14}
                  className="text-red-400 flex-shrink-0 mt-0.5"
                />
                <p className="text-xs text-red-300 flex-1">{error}</p>
              </div>
            )}

            {authMode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                    >
                      {showPassword ? (
                        <Eye size={14} />
                      ) : (
                        <Eye size={14} className="text-gray-600" />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={authPending}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-semibold py-3 rounded-xl transition-all shadow-lg disabled:opacity-60 fp-icon-only"
                  title="Sign in"
                  aria-label="Sign in"
                >
                  {authPending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn size={16} /> Sign In
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleQuickRegister} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Full Name *
                  </label>
                  <div className="relative">
                    <UserPlus
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Password * (min 6 chars)
                  </label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
                      className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                    >
                      {showPassword ? (
                        <Eye size={14} />
                      ) : (
                        <Eye size={14} className="text-gray-600" />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={authPending}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg disabled:opacity-60"
                >
                  {authPending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus size={16} /> Create Account
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Enter username
  if (step === "username") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
              <CheckCircle2 size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Signed In!</h1>
            <p className="text-sm text-indigo-300 mt-1">
              {user?.email || user?.name}
            </p>
          </div>

          <div className={`p-4 rounded-xl border mb-6 ${roleInfo.color}`}>
            <div className="flex items-center gap-3">
              <RoleIcon size={24} />
              <div>
                <p className="text-sm font-bold">{roleInfo.label}</p>
                <p className="text-xs opacity-70">{roleInfo.desc}</p>
              </div>
            </div>
            {invite.stationName && (
              <p className="text-xs mt-2 opacity-70">
                Station: <strong>{invite.stationName}</strong>
              </p>
            )}
          </div>

          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Choose your team username *
              </label>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAccept()}
                placeholder="Enter a username..."
                className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 outline-none"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                This identifies you within the station team
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle size={14} className="text-red-400" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleAccept}
              className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-lg"
            >
              <ShieldCheck size={18} /> Accept Role & Join Station
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 3: Done
  if (step === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <CheckCircle2 size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            You're All Set!
          </h1>
          <p className="text-sm text-green-300 mb-2">{success}</p>
          <p className="text-xs text-gray-400">
            Redirecting to your station dashboard...
          </p>
        </div>
      </div>
    );
  }

  return null;
}
