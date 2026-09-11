import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/context/AuthContext";
import { getSupabaseClient } from "@/supabase/client";
import {
  KeyRound,
  ArrowLeft,
  Mail,
  Lock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  MailCheck,
} from "lucide-react";

export default function PasswordReset() {
  const navigate = useNavigate();
  const { requestPasswordReset, isPending, error, clearError } = useAuth();
  const [step, setStep] = useState<"email" | "sent" | "newpass" | "success">(
    "email",
  );
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining

  // Detect Supabase recovery redirect — when a user clicks the email link,
  // Supabase exchanges the token in the URL and fires a PASSWORD_RECOVERY event.
  // We detect this via the URL hash containing "type=recovery" and skip to newpass.
  useEffect(() => {
    const supabase = getSupabaseClient();
    let mounted = true;

    const checkRecovery = async () => {
      const hash = window.location.hash || window.location.search;
      const isRecovery =
        hash.includes("type=recovery") ||
        hash.includes("type=signup") ||
        hash.includes("access_token") ||
        hash.includes("error_code");

      if (isRecovery) {
        // Let Supabase exchange the token
        const { data, error: sessionErr } = await supabase.auth.getSession();
        if (mounted && data.session && !sessionErr) {
          setStep("newpass");
        }
      }
    };

    checkRecovery();

    // Also listen for the PASSWORD_RECOVERY event (fires on token exchange)
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" && session && mounted) {
          setStep("newpass");
        }
      },
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Countdown timer for the resend cooldown. Ticks down every second and
  // clears at zero, re-enabling the Resend button.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown > 0]);

  const handleRequestCode = async () => {
    clearError();
    setLocalError("");
    if (!email.trim() || !email.includes("@")) {
      setLocalError("Please enter a valid email address");
      return;
    }
    const result = await requestPasswordReset(email.trim().toLowerCase());
    if (result.success) {
      setStep("sent");
      // Start a 60s cooldown after a successful send so the user can't
      // immediately resend and trip Supabase's email rate limit.
      setResendCooldown(60);
    } else {
      setLocalError(result.message);
    }
  };

  const handleResetPassword = async () => {
    clearError();
    setLocalError("");
    if (newPassword.length < 8) {
      setLocalError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }

    setResetPending(true);
    try {
      const supabase = getSupabaseClient();
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      setResetPending(false);
      if (updateErr) {
        setLocalError(updateErr.message);
        return;
      }
      setSuccessMsg(
        "Password reset successfully! You can now sign in with your new password.",
      );
      setStep("success");
    } catch (err: any) {
      setResetPending(false);
      setLocalError(err.message || "Failed to reset password");
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0) return; // safety: don't fire during cooldown
    clearError();
    setLocalError("");
    const result = await requestPasswordReset(email);
    if (result.success) {
      setLocalError("");
      setSuccessMsg("Reset email resent. Check your inbox.");
      setTimeout(() => setSuccessMsg(""), 5000);
      setResendCooldown(60); // restart cooldown after a successful resend
    } else {
      setLocalError(result.message);
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-slate-950 p-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <button
          onClick={() => navigate("/login")}
          className="mb-6 text-sm text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Sign In
        </button>

        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/20">
              <KeyRound size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white font-serif">
              {step === "email" && "Reset Password"}
              {step === "sent" && "Check Your Email"}
              {step === "newpass" && "New Password"}
              {step === "success" && "All Set!"}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {step === "email" && "Enter your email to receive a reset link"}
              {step === "sent" && `We sent a password reset link to ${email}`}
              {step === "newpass" && "Create a strong new password"}
              {step === "success" && successMsg}
            </p>
          </div>

          {/* Error */}
          {displayError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {displayError}
            </div>
          )}

          {/* Step 1: Email */}
          {step === "email" && (
            <>
              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
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
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearError();
                      setLocalError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleRequestCode()}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                  />
                </div>
              </div>
              <button
                onClick={handleRequestCode}
                disabled={isPending}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none flex items-center justify-center gap-2 fp-icon-only"
                title="Refresh"
                aria-label="Refresh"
              >
                {isPending ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Sending...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Send Reset Code
                  </>
                )}
              </button>
            </>
          )}

          {/* Step 2: Email Sent — waiting for user to click the link in email */}
          {step === "sent" && (
            <>
              <div className="mb-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl text-center">
                <MailCheck size={32} className="mx-auto text-blue-400 mb-3" />
                <p className="text-sm text-white mb-2">
                  We sent a password reset link to:
                </p>
                <p className="text-sm font-medium text-amber-400 break-all">
                  {email}
                </p>
                <p className="text-xs text-gray-400 mt-3">
                  Click the link in your email to set a new password. The link
                  expires in 1 hour.
                </p>
              </div>
              <button
                onClick={handleResendCode}
                disabled={isPending || resendCooldown > 0}
                className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Sending...
                  </>
                ) : resendCooldown > 0 ? (
                  <>
                    <Mail size={16} /> Resend available in {resendCooldown}s
                  </>
                ) : (
                  <>
                    <Mail size={16} /> Resend Reset Link
                  </>
                )}
              </button>
              <button
                onClick={() => setStep("email")}
                className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Use a different email
              </button>
              {successMsg && (
                <p className="mt-3 text-xs text-emerald-400 text-center">
                  {successMsg}
                </p>
              )}
            </>
          )}

          {/* Step 3: New Password */}
          {step === "newpass" && (
            <>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type={showPw ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setLocalError("");
                        clearError();
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleResetPassword()
                      }
                      placeholder="Min 8 characters"
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                    />
                    <button
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setLocalError("");
                        clearError();
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleResetPassword()
                      }
                      placeholder="Repeat password"
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                    />
                    <button
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={handleResetPassword}
                disabled={resetPending}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {resetPending ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />{" "}
                    Resetting...
                  </>
                ) : (
                  <>
                    <KeyRound size={16} /> Reset Password
                  </>
                )}
              </button>
            </>
          )}

          {/* Step 4: Success */}
          {step === "success" && (
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
              <p className="text-sm text-emerald-400 mb-6">{successMsg}</p>
              <button
                onClick={() => navigate("/login")}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
              >
                <ArrowLeft size={16} /> Go to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
