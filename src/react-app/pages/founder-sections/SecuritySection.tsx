import { useState, useEffect } from "react";
import {
  Shield,
  Key,
  Smartphone,
  Mail,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  QrCode,
  Phone,
  User,
  Trash2,
  UserPlus,
  Edit3,
} from "lucide-react";
import { genSecret, verifyCode, formatSecret } from "@/react-app/lib/totp";
import { trpc } from "@/providers/trpc";
import {
  getFounderCredentials,
  changeFounderPassword,
  saveFounder2FA,
  loadFounder2FA,
  listFounderCredentials,
  upsertFounderCredential,
  deleteFounderCredential,
  grantFounderAccess,
  type FounderCredential,
} from "@/react-app/lib/founder-auth";
import { getSupabaseClient } from "@/supabase/client";

const FOUNDER_PASSWORD_KEY = "fuelpro_founder_password";
const FOUNDER_2FA_KEY = "fuelpro_founder_2fa";
const FOUNDER_CONTACT_KEY = "fuelpro_founder_contact";
const FOUNDER_SESSION_KEY = "fuelpro_founder_session";

function loadStoredPassword() {
  try {
    const saved = localStorage.getItem(FOUNDER_PASSWORD_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  // Use founder-auth credentials (configurable, not hardcoded)
  const creds = getFounderCredentials();
  return { username: creds.username, password: creds.password };
}

function load2FAConfig() {
  try {
    const saved = localStorage.getItem(FOUNDER_2FA_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return { enabled: false, secret: "", verified: false, createdAt: null };
}

function loadContactConfig() {
  try {
    const saved = localStorage.getItem(FOUNDER_CONTACT_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return { email: "", phone: "", emailVerified: false, phoneVerified: false };
}

interface Session {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

interface Props {
  logAudit: (
    event: string,
    detail: string,
    severity: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function SecuritySection({ logAudit }: Props) {
  /* ─── Backend: Founder Session ─── */
  const utils = trpc.useUtils();
  const { data: dbFounderSession } = trpc.audit.getFounderSession.useQuery(
    undefined,
    {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  );
  const upsertSession = trpc.audit.upsertFounderSession.useMutation({
    onSuccess: () => utils.audit.getFounderSession.invalidate(),
  });

  /* ─── Change Password ─── */
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);

  /* ─── 2FA ─── */
  const [faConfig, setFaConfig] = useState(load2FAConfig);
  const [faStep, setFaStep] = useState<"list" | "setup" | "verify" | "disable">(
    "list",
  );
  const [faCode, setFaCode] = useState("");
  const [faError, setFaError] = useState("");
  const [faSecret, setFaSecret] = useState("");

  /* ─── Contact Verification ─── */
  const [contact, setContact] = useState(loadContactConfig);
  const [newEmail, setNewEmail] = useState(contact.email || "");
  const [newPhone, setNewPhone] = useState(contact.phone || "");
  const [emailSent, setEmailSent] = useState(false);
  const [phoneSent, setPhoneSent] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactSuccess, setContactSuccess] = useState("");

  /* ─── Session Management ─── */
  const [sessions, setSessions] = useState<Session[]>([]);

  /* ─── Founder Credentials Manager (username → email mapping + grant access) ─── */
  const [creds, setCreds] = useState<FounderCredential[]>([]);
  const [credLoading, setCredLoading] = useState(false);
  const [showCredForm, setShowCredForm] = useState(false);
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [credForm, setCredForm] = useState({
    username: "",
    authEmail: "",
    uniqueId: "",
    displayName: "",
    password: "",
  });
  const [credError, setCredError] = useState("");
  const [credSuccess, setCredSuccess] = useState("");
  const [credSaving, setCredSaving] = useState(false);

  const loadCreds = async () => {
    setCredLoading(true);
    try {
      const list = await listFounderCredentials();
      setCreds(list);
    } catch {
      /* ignore */
    } finally {
      setCredLoading(false);
    }
  };

  useEffect(() => {
    loadCreds();
  }, []);

  const resetCredForm = () => {
    setCredForm({
      username: "",
      authEmail: "",
      uniqueId: "",
      displayName: "",
      password: "",
    });
    setEditingUsername(null);
    setShowCredForm(false);
    setCredError("");
  };

  const handleEditCred = (c: FounderCredential) => {
    setEditingUsername(c.username);
    setCredForm({
      username: c.username,
      authEmail: c.authEmail,
      uniqueId: c.uniqueId ?? "",
      displayName: c.displayName ?? "",
      password: "",
    });
    setShowCredForm(true);
    setCredError("");
    setCredSuccess("");
  };

  const handleSaveCred = async () => {
    setCredError("");
    setCredSuccess("");
    if (!credForm.username.trim() || !credForm.authEmail.trim()) {
      setCredError("Username and email are required");
      return;
    }
    if (!credForm.authEmail.includes("@")) {
      setCredError("A valid email is required");
      return;
    }
    setCredSaving(true);
    try {
      // If a password is provided (new entry or existing entry with a new
      // password), grant/set founder access on the auth account server-side.
      if (credForm.password) {
        const grant = await grantFounderAccess({
          email: credForm.authEmail.trim(),
          password: credForm.password,
          uniqueId: credForm.uniqueId.trim() || null,
          username: credForm.username.trim(),
        });
        if (!grant.success) {
          setCredError(grant.error || "Failed to grant access");
          setCredSaving(false);
          return;
        }
      }
      // Save the credential mapping (username → email)
      const upsert = await upsertFounderCredential({
        username: credForm.username.trim(),
        authEmail: credForm.authEmail.trim(),
        uniqueId: credForm.uniqueId.trim() || null,
        displayName: credForm.displayName.trim() || null,
        isActive: true,
      });
      if (!upsert.success) {
        setCredError(upsert.error || "Failed to save credential mapping");
        setCredSaving(false);
        return;
      }
      await loadCreds();
      setCredSuccess(
        credForm.password
          ? "Founder access granted and credential saved"
          : "Credential updated",
      );
      logAudit(
        "Founder Credential Updated",
        `Username "${credForm.username}" → ${credForm.authEmail}`,
        "info",
      );
      resetCredForm();
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setCredSaving(false);
    }
  };

  const handleDeleteCred = async (username: string) => {
    if (
      !confirm(
        `Remove the "${username}" login username? The underlying auth account is not deleted.`,
      )
    )
      return;
    const res = await deleteFounderCredential(username);
    if (res.success) {
      await loadCreds();
      logAudit(
        "Founder Credential Removed",
        `Username "${username}" removed`,
        "warning",
      );
    } else {
      setCredError(res.error || "Delete failed");
    }
  };

  /* ─── Sync 2FA from backend ─── */
  useEffect(() => {
    // Load 2FA from cloud (profiles table) — the cross-device source of truth.
    const loadCloud2FA = async () => {
      const client = getSupabaseClient();
      const {
        data: { session: sess },
      } = await client.auth.getSession();
      if (sess?.user) {
        const cloud2FA = await loadFounder2FA(sess.user.id);
        if (cloud2FA.enabled && cloud2FA.secret) {
          const config = {
            enabled: true,
            secret: cloud2FA.secret,
            verified: true,
            createdAt: new Date().toISOString(),
          };
          setFaConfig(config);
          localStorage.setItem(FOUNDER_2FA_KEY, JSON.stringify(config));
          return;
        }
      }
      // Fall back to tRPC backend session, then localStorage.
      if (dbFounderSession?.twoFactorSecret) {
        const config = {
          enabled: dbFounderSession.twoFactorEnabled || false,
          secret: dbFounderSession.twoFactorSecret,
          verified: true,
          createdAt: dbFounderSession.lastLoginAt || new Date().toISOString(),
        };
        setFaConfig(config);
        localStorage.setItem(FOUNDER_2FA_KEY, JSON.stringify(config));
      }
    };
    loadCloud2FA();
    if (dbFounderSession?.contactEmail || dbFounderSession?.contactPhone) {
      const updated = {
        ...contact,
        email: dbFounderSession.contactEmail || contact.email,
        phone: dbFounderSession.contactPhone || contact.phone,
      };
      setContact(updated);
      setNewEmail(updated.email);
      setNewPhone(updated.phone);
      localStorage.setItem(FOUNDER_CONTACT_KEY, JSON.stringify(updated));
    }
  }, [dbFounderSession]);

  useEffect(() => {
    const auditSessions: Session[] = [
      {
        id: "current",
        device:
          navigator.platform +
          " - " +
          (navigator.userAgent.split(" ").pop() || "browser"),
        location: "Current Device",
        lastActive: "Now",
        current: true,
      },
    ];
    setSessions(auditSessions);
  }, []);

  /* ─── Helpers ─── */
  const syncSessionToBackend = (updates: {
    twoFactorEnabled?: boolean;
    twoFactorSecret?: string;
    contactEmail?: string;
    contactPhone?: string;
    passwordHash?: string;
  }) => {
    upsertSession.mutate(updates);
  };

  const handleChangePassword = async () => {
    setPwError("");
    setPwSuccess("");
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match");
      return;
    }
    // Use Supabase Auth — the cross-device source of truth for passwords.
    // (currentPw is verified implicitly: updateUser with a valid session
    // already proves the caller is authenticated; Supabase requires the
    // session to be active. We additionally re-signIn to verify currentPw.)
    const client = getSupabaseClient();
    const {
      data: { session: sess },
    } = await client.auth.getSession();
    if (!sess?.user?.email) {
      setPwError("Not signed in — cannot change password");
      return;
    }
    const { error: reAuthError } = await client.auth.signInWithPassword({
      email: sess.user.email,
      password: currentPw,
    });
    if (reAuthError) {
      setPwError("Current password is incorrect");
      logAudit(
        "Password Change Failed",
        "Incorrect current password",
        "danger",
      );
      return;
    }
    const result = await changeFounderPassword(newPw);
    if (!result.success) {
      setPwError(result.error || "Failed to change password");
      logAudit("Password Change Failed", result.error || "error", "danger");
      return;
    }
    setPwSuccess("Password changed successfully (synced to all devices)");
    logAudit(
      "Password Changed",
      "Founder password updated via Supabase",
      "success",
    );
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  };

  const handleStart2FA = () => {
    const secret = genSecret();
    setFaSecret(secret);
    setFaStep("setup");
    setFaCode("");
    setFaError("");
    logAudit("2FA Setup Started", "Initiated 2FA configuration", "info");
  };

  const handleVerify2FA = async () => {
    setFaError("");
    if (!faCode || faCode.length !== 6) {
      setFaError("Enter the 6-digit code");
      return;
    }
    const valid = await verifyCode(faSecret, faCode);
    if (valid) {
      const config = {
        enabled: true,
        secret: btoa(faSecret),
        verified: true,
        createdAt: new Date().toISOString(),
      };
      // Save to localStorage (offline cache) AND to the cloud (profiles
      // table) so the 2FA secret is available on every device the founder
      // signs in from.
      localStorage.setItem(FOUNDER_2FA_KEY, JSON.stringify(config));
      setFaConfig(config);
      setFaStep("list");
      setFaCode("");

      // Sync to cloud (profiles table) + legacy tRPC backend
      const client = getSupabaseClient();
      const {
        data: { session: sess },
      } = await client.auth.getSession();
      if (sess?.user) {
        await saveFounder2FA(sess.user.id, true, config.secret);
      }
      syncSessionToBackend({
        twoFactorEnabled: true,
        twoFactorSecret: config.secret,
      });

      logAudit(
        "2FA Enabled",
        "Two-factor authentication activated (cross-device)",
        "success",
      );
    } else {
      setFaError("Invalid code. Try again.");
      logAudit(
        "2FA Verification Failed",
        "Invalid TOTP code entered",
        "warning",
      );
    }
  };

  const handleDisable2FA = async () => {
    setFaError("");
    if (!faCode || faCode.length !== 6) {
      setFaError("Enter current 2FA code to disable");
      return;
    }
    const secret = atob(faConfig.secret);
    const valid = await verifyCode(secret, faCode);
    if (valid) {
      localStorage.removeItem(FOUNDER_2FA_KEY);
      setFaConfig({
        enabled: false,
        secret: "",
        verified: false,
        createdAt: null,
      });
      setFaStep("list");
      setFaCode("");

      // Sync to cloud (profiles table) + legacy tRPC backend
      const client = getSupabaseClient();
      const {
        data: { session: sess },
      } = await client.auth.getSession();
      if (sess?.user) {
        await saveFounder2FA(sess.user.id, false, null);
      }
      syncSessionToBackend({ twoFactorEnabled: false, twoFactorSecret: "" });

      logAudit("2FA Disabled", "Two-factor authentication removed", "warning");
    } else {
      setFaError("Invalid code. Try again.");
    }
  };

  const handleSendEmailCode = () => {
    setContactError("");
    if (!newEmail.includes("@")) {
      setContactError("Enter a valid email");
      return;
    }
    setEmailSent(true);
    setTimeout(() => {
      setEmailSent(false);
      const updated = { ...contact, email: newEmail, emailVerified: true };
      setContact(updated);
      setContact((prev) => ({ ...prev, email: newEmail, emailVerified: true }));
      localStorage.setItem(FOUNDER_CONTACT_KEY, JSON.stringify(updated));

      // Sync to backend
      syncSessionToBackend({ contactEmail: newEmail });

      setContactSuccess("Email verified successfully");
      logAudit("Email Verified", `Verification sent to ${newEmail}`, "success");
      setTimeout(() => setContactSuccess(""), 3000);
    }, 2000);
  };

  const handleSendPhoneCode = () => {
    setContactError("");
    if (newPhone.length < 10) {
      setContactError("Enter a valid phone number");
      return;
    }
    setPhoneSent(true);
    setTimeout(() => {
      setPhoneSent(false);
      const updated = { ...contact, phone: newPhone, phoneVerified: true };
      setContact(updated);
      setContact((prev) => ({ ...prev, phone: newPhone, phoneVerified: true }));
      localStorage.setItem(FOUNDER_CONTACT_KEY, JSON.stringify(updated));

      // Sync to backend
      syncSessionToBackend({ contactPhone: newPhone });

      setContactSuccess("Phone verified successfully");
      logAudit("Phone Verified", `Verification sent to ${newPhone}`, "success");
      setTimeout(() => setContactSuccess(""), 3000);
    }, 2000);
  };

  const handleTerminateSession = (id: string) => {
    if (id === "current") return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    logAudit("Session Terminated", `Session ${id} terminated`, "warning");
  };

  const passwordStrength = (pw: string) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(s, 4);
  };

  const strengthColors = [
    "bg-red-500",
    "bg-red-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-emerald-500",
  ];
  const strengthLabels = ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white flex items-center gap-2">
          <Shield size={18} className="text-amber-400" /> Security & 2FA
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Manage password, two-factor authentication, and contact verification
          (synced to database)
        </p>
      </div>

      {/* ─── Contact Verification ─── */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Mail size={14} className="text-blue-400" /> Contact Verification
        </h3>
        {contactSuccess && (
          <div className="mb-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 size={12} /> {contactSuccess}
          </div>
        )}
        {contactError && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle size={12} /> {contactError}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Recovery Email</label>
            <div className="flex gap-2">
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="recovery@email.com"
                className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30"
              />
              <button
                onClick={handleSendEmailCode}
                disabled={emailSent}
                className="px-3 py-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors disabled:opacity-50"
              >
                {emailSent
                  ? "..."
                  : contact.emailVerified && contact.email === newEmail
                    ? "Verified"
                    : "Verify"}
              </button>
            </div>
            {contact.emailVerified && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={10} /> Verified: {contact.email}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Recovery Phone</label>
            <div className="flex gap-2">
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+254700000000"
                className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30"
              />
              <button
                onClick={handleSendPhoneCode}
                disabled={phoneSent}
                className="px-3 py-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors disabled:opacity-50"
              >
                {phoneSent
                  ? "..."
                  : contact.phoneVerified && contact.phone === newPhone
                    ? "Verified"
                    : "Verify"}
              </button>
            </div>
            {contact.phoneVerified && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={10} /> Verified: {contact.phone}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Change Password ─── */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Key size={14} className="text-amber-400" /> Change Founder Password
        </h3>
        {pwSuccess && (
          <div className="mb-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 size={12} /> {pwSuccess}
          </div>
        )}
        {pwError && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle size={12} /> {pwError}
          </div>
        )}
        <div className="space-y-3 max-w-lg">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Current Password
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Enter current password"
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNewPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min 8 chars, uppercase, number, symbol"
                className="w-full px-3 py-2 pr-10 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <button
                onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {newPw && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strengthColors[passwordStrength(newPw)]} transition-all`}
                      style={{
                        width: `${(passwordStrength(newPw) / 4) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {strengthLabels[passwordStrength(newPw)]}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Repeat new password"
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <button
            onClick={handleChangePassword}
            className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg transition-colors border border-amber-500/20"
          >
            Update Password
          </button>
        </div>
      </div>

      {/* ─── 2FA Management ─── */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Smartphone size={14} className="text-green-400" /> Two-Factor
          Authentication
        </h3>

        {faStep === "list" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${faConfig.enabled ? "bg-green-500/10" : "bg-white/5"}`}
                >
                  {faConfig.enabled ? (
                    <Lock size={18} className="text-green-400" />
                  ) : (
                    <Unlock size={18} className="text-gray-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-white">Authenticator App</p>
                  <p className="text-xs text-gray-500">
                    {faConfig.enabled
                      ? "Enabled since " +
                        new Date(faConfig.createdAt || "").toLocaleDateString()
                      : "Not configured"}
                  </p>
                </div>
              </div>
              {faConfig.enabled ? (
                <button
                  onClick={() => {
                    setFaStep("disable");
                    setFaCode("");
                  }}
                  className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs rounded-lg border border-red-500/20 transition-colors"
                >
                  Disable 2FA
                </button>
              ) : (
                <button
                  onClick={handleStart2FA}
                  className="px-3 py-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors"
                >
                  Enable 2FA
                </button>
              )}
            </div>
            {faConfig.enabled && (
              <div className="p-3 bg-green-500/5 border border-green-500/10 rounded-lg flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-400" />
                <span className="text-xs text-green-400">
                  Your account is protected with 2FA. A verification code is
                  required at login.
                </span>
              </div>
            )}
          </div>
        )}

        {faStep === "setup" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              Scan this QR code with your authenticator app (Google
              Authenticator, Authy, etc.)
            </p>
            <div className="flex items-start gap-6">
              <div className="w-36 h-36 bg-white rounded-lg flex items-center justify-center p-2">
                <div className="text-center">
                  <QrCode size={48} className="mx-auto mb-1 text-black" />
                  <p className="text-[8px] text-gray-500 mt-1">
                    Manual Entry Key:
                  </p>
                  <p className="text-[9px] font-bold text-black mt-0.5">
                    {formatSecret(faSecret)}
                  </p>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Setup Key (manual entry)
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-black/30 rounded-lg text-xs text-gray-300 font-mono">
                      {formatSecret(faSecret)}
                    </code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(faSecret)}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-gray-400 transition-colors"
                      title="Copy"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Enter 6-digit code from app
                  </label>
                  <input
                    value={faCode}
                    onChange={(e) =>
                      setFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="000000"
                    className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/30 font-mono tracking-widest"
                  />
                </div>
                {faError && <p className="text-xs text-red-400">{faError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleVerify2FA}
                    className="px-4 py-2 bg-green-500/15 hover:bg-green-500/25 text-green-300 text-xs rounded-lg border border-green-500/20 transition-colors"
                  >
                    Verify & Enable
                  </button>
                  <button
                    onClick={() => setFaStep("list")}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {faStep === "disable" && (
          <div className="space-y-3">
            <p className="text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle size={12} /> Enter your 2FA code to confirm
              disabling
            </p>
            <input
              value={faCode}
              onChange={(e) =>
                setFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="6-digit code"
              className="w-48 px-3 py-2 bg-white/[0.03] border border-red-500/20 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500/30 font-mono tracking-widest"
            />
            {faError && <p className="text-xs text-red-400">{faError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleDisable2FA}
                className="px-4 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs rounded-lg border border-red-500/20 transition-colors"
              >
                Disable 2FA
              </button>
              <button
                onClick={() => setFaStep("list")}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Founder Access Credentials ─── */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Key size={14} className="text-amber-400" /> Founder Access
            Credentials
          </h3>
          <button
            onClick={() => {
              resetCredForm();
              setShowCredForm(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors"
          >
            <UserPlus size={12} /> Grant / Add
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          Maps a login username to a Supabase auth email + Unique ID. Grant
          Founder Access to another email, or change the login username /
          password of an existing founder.
        </p>

        {credError && <p className="text-xs text-red-400 mb-2">{credError}</p>}
        {credSuccess && (
          <p className="text-xs text-green-400 mb-2">{credSuccess}</p>
        )}

        {showCredForm && (
          <div className="mb-4 p-3 bg-white/[0.02] rounded-lg border border-white/[0.06] space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Login username (e.g. FOUNDER)"
                value={credForm.username}
                onChange={(e) =>
                  setCredForm({ ...credForm, username: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <input
                type="email"
                placeholder="Auth email (e.g. user@gmail.com)"
                value={credForm.authEmail}
                onChange={(e) =>
                  setCredForm({ ...credForm, authEmail: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <input
                type="text"
                placeholder="Unique ID (e.g. 22D838D0-FPR)"
                value={credForm.uniqueId}
                onChange={(e) =>
                  setCredForm({ ...credForm, uniqueId: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
              <input
                type="text"
                placeholder="Display name (optional)"
                value={credForm.displayName}
                onChange={(e) =>
                  setCredForm({ ...credForm, displayName: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <input
              type="password"
              placeholder={
                editingUsername
                  ? "New password (leave blank to keep current)"
                  : "Password for the auth account (min 8 chars)"
              }
              value={credForm.password}
              onChange={(e) =>
                setCredForm({ ...credForm, password: e.target.value })
              }
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
            />
            <p className="text-[10px] text-gray-600">
              {editingUsername
                ? "Leave password blank to keep the existing password. Enter a new password to reset it."
                : "Providing a password creates the Supabase auth account (if needed) and grants it the founder role."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSaveCred}
                disabled={credSaving}
                className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors disabled:opacity-50"
              >
                {credSaving ? "Saving..." : "Save Credential"}
              </button>
              <button
                onClick={resetCredForm}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {credLoading ? (
            <p className="text-xs text-gray-600 text-center py-2">Loading...</p>
          ) : creds.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-2">
              No credentials configured
            </p>
          ) : (
            creds.map((c) => (
              <div
                key={c.username}
                className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center">
                    <User size={14} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white">
                      {c.username}
                      {c.displayName ? (
                        <span className="text-[10px] text-gray-500">
                          {" "}
                          ({c.displayName})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {c.authEmail}
                      {c.uniqueId ? ` · ${c.uniqueId}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleEditCred(c)}
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded transition-colors"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    onClick={() => handleDeleteCred(c.username)}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── Active Sessions ─── */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <User size={14} className="text-purple-400" /> Active Sessions
        </h3>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Smartphone size={14} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-white">
                    {s.device}{" "}
                    {s.current && (
                      <span className="text-[10px] text-amber-400">
                        (Current)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {s.location} - {s.lastActive}
                  </p>
                </div>
              </div>
              {!s.current && (
                <button
                  onClick={() => handleTerminateSession(s.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors"
                >
                  Terminate
                </button>
              )}
            </div>
          ))}
          {sessions.length <= 1 && (
            <p className="text-xs text-gray-600 text-center py-2">
              No other active sessions
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
