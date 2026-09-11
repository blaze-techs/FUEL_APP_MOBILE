/**
 * UserProfileSettings.tsx
 * Allows users to change their username, email, password, phone, and avatar.
 * Uses Supabase Auth + profiles table (cross-device, cloud-backed).
 * Accessible from the Settings panel and Founder page.
 */
import React, { useState } from "react";
import {
  User,
  Mail,
  Phone,
  Lock,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  AtSign,
  KeyRound,
  Share2,
  Copy,
  Check,
  Users,
  FileUp,
  FileText,
  Trash2,
  Download,
  Clock,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  inviteMember,
  getStationMembers,
  revokeMember,
  type StationMember,
} from "@/react-app/lib/station-share-service";
import {
  uploadDocument,
  getDocuments,
  getDocumentUrl,
  downloadDocument,
  deleteDocument,
  type UserDocument,
} from "@/react-app/lib/document-service";

export default function UserProfileSettings() {
  const {
    user,
    updateProfile,
    updateEmail,
    updatePassword,
    resendEmailVerification,
  } = useAuth();
  const { currentStation } = useStations();

  // Profile form
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    username: user?.username || "",
    phone: user?.phone || "",
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileNotice, setProfileNotice] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  // Email form
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailNotice, setEmailNotice] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  // Password form
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwNotice, setPwNotice] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  // Share access
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [members, setMembers] = useState<StationMember[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareNotice, setShareNotice] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Documents
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docNotice, setDocNotice] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Load members and documents on mount / station change
  React.useEffect(() => {
    if (currentStation?.id) {
      getStationMembers(currentStation.id).then(setMembers);
    }
    getDocuments(currentStation?.id).then(setDocuments);
  }, [currentStation?.id]);

  const handleProfileSave = async () => {
    setProfileLoading(true);
    setProfileNotice(null);
    const result = await updateProfile({
      name: profileForm.name,
      username: profileForm.username,
      phone: profileForm.phone,
    });
    setProfileLoading(false);
    setProfileNotice(
      result.success
        ? {
            type: "success",
            msg: "Profile updated successfully! Changes sync across all your devices.",
          }
        : { type: "error", msg: result.error || "Failed to update profile" },
    );
    setTimeout(() => setProfileNotice(null), 4000);
  };

  const handleEmailUpdate = async () => {
    if (!newEmail) return;
    setEmailLoading(true);
    setEmailNotice(null);
    const result = await updateEmail(newEmail);
    setEmailLoading(false);
    setEmailNotice(
      result.success
        ? {
            type: "success",
            msg: "Email updated! You may receive a confirmation email from Supabase.",
          }
        : { type: "error", msg: result.error || "Failed to update email" },
    );
    if (result.success) setNewEmail("");
    setTimeout(() => setEmailNotice(null), 4000);
  };

  const handlePasswordUpdate = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPwNotice({ type: "error", msg: "Passwords do not match" });
      return;
    }
    setPwLoading(true);
    setPwNotice(null);
    const result = await updatePassword(passwordForm.newPassword);
    setPwLoading(false);
    setPwNotice(
      result.success
        ? {
            type: "success",
            msg: "Password updated successfully! Use it on any device.",
          }
        : { type: "error", msg: result.error || "Failed to update password" },
    );
    if (result.success)
      setPasswordForm({ newPassword: "", confirmPassword: "" });
    setTimeout(() => setPwNotice(null), 4000);
  };

  const handleInvite = async () => {
    if (!currentStation?.id || !inviteEmail) return;
    setShareLoading(true);
    setShareNotice(null);
    const result = await inviteMember(
      currentStation.id,
      inviteEmail,
      inviteRole,
    );
    setShareLoading(false);
    if (result.success) {
      const inviteUrl = result.error || "";
      setShareNotice({
        type: "success",
        msg: `Invite sent! Share this link: ${inviteUrl}`,
      });
      setInviteEmail("");
      getStationMembers(currentStation.id).then(setMembers);
    } else {
      setShareNotice({
        type: "error",
        msg: result.error || "Failed to send invite",
      });
    }
    setTimeout(() => setShareNotice(null), 6000);
  };

  const handleCopyInvite = (token: string | null, member: StationMember) => {
    if (!token) return;
    const url = `${window.location.origin}/?invite=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRevoke = async (memberId: string) => {
    if (!confirm("Remove this member's access?")) return;
    const result = await revokeMember(memberId);
    if (result.success && currentStation?.id) {
      getStationMembers(currentStation.id).then(setMembers);
    } else {
      setShareNotice({
        type: "error",
        msg: result.error || "Failed to revoke access",
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setDocLoading(true);
    setDocNotice(null);
    const results = [];
    for (const file of Array.from(files)) {
      const result = await uploadDocument(file, currentStation?.id);
      results.push({
        name: file.name,
        success: result.success,
        error: result.error,
      });
    }
    setDocLoading(false);
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    setDocNotice({
      type: failCount > 0 ? "error" : "success",
      msg:
        failCount > 0
          ? `${successCount} uploaded, ${failCount} failed. Last error: ${results.find((r) => !r.success)?.error}`
          : `${successCount} file(s) uploaded! Accessible from any device.`,
    });
    getDocuments(currentStation?.id).then(setDocuments);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setTimeout(() => setDocNotice(null), 5000);
  };

  const handleDownload = async (doc: UserDocument) => {
    // Compressed uploads (.gz) need in-browser decompression; non-compressed
    // files stream directly via the public URL.
    const result = await downloadDocument(doc);
    if (result?.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = doc.file_name;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      // Revoke object URLs (from decompressed blobs) to free memory. Direct
      // public URLs don't need revocation.
      if (result.blob) setTimeout(() => URL.revokeObjectURL(result.url), 10000);
    } else {
      setDocNotice({ type: "error", msg: "Failed to generate download URL" });
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm("Delete this file permanently?")) return;
    const result = await deleteDocument(docId);
    if (result.success) {
      getDocuments(currentStation?.id).then(setDocuments);
    } else {
      setDocNotice({ type: "error", msg: result.error || "Failed to delete" });
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none transition-colors";
  const labelClass =
    "text-gray-500 dark:text-gray-400 text-xs mb-2 block font-medium";
  const cardClass = "bg-white/5 border border-white/10 rounded-xl p-6 mb-6";
  const btnClass =
    "w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors";

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
        <User className="text-amber-400" size={24} /> User Profile
      </h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        Your unique ID:{" "}
        <code className="text-amber-400 text-xs bg-white/5 px-2 py-1 rounded">
          {user?.id || "—"}
        </code>
        <br />
        Changes sync across all your devices via Supabase cloud.
      </p>

      {/* Profile Info */}
      <div className={cardClass}>
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <AtSign size={20} className="text-amber-400" /> Profile Information
        </h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Full Name</label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) =>
                setProfileForm({ ...profileForm, name: e.target.value })
              }
              className={inputClass}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className={labelClass}>Username (unique identifier)</label>
            <input
              type="text"
              value={profileForm.username}
              onChange={(e) =>
                setProfileForm({ ...profileForm, username: e.target.value })
              }
              className={inputClass}
              placeholder="Choose a unique username"
            />
            <p className="text-gray-500 text-xs mt-1">
              This is your unique identifier across all devices.
            </p>
          </div>
          <div>
            <label className={labelClass}>Phone Number</label>
            <input
              type="tel"
              value={profileForm.phone}
              onChange={(e) =>
                setProfileForm({ ...profileForm, phone: e.target.value })
              }
              className={inputClass}
              placeholder="+1 555 000 0000"
            />
            {/* Country-aware phone guidance: basic international-format check
                so the user enters a globally-valid E.164-style number. */}
            {profileForm.phone &&
              !/^\+?[0-9\s\-()]{7,20}$/.test(profileForm.phone) && (
                <p className="text-amber-500 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> Use international format, e.g. +1
                  555 000 0000.
                </p>
              )}
          </div>
        </div>
        <button
          onClick={handleProfileSave}
          disabled={profileLoading}
          className={btnClass + " mt-4"}
        >
          {profileLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Save size={18} />
          )}
          Save Profile
        </button>
        {profileNotice && <NoticeBanner notice={profileNotice} />}
      </div>

      {/* Email Change */}
      <div className={cardClass}>
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Mail size={20} className="text-blue-400" /> Change Email
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-1.5 flex items-center gap-2 flex-wrap">
          Current email:{" "}
          <span className="font-semibold text-gray-900 dark:text-white">
            {user?.email}
          </span>
          {/* Email verification status — sourced from Supabase
              email_confirmed_at via the auth identity. */}
          {user?.emailVerified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-500 border border-green-500/20">
              <CheckCircle size={10} /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <AlertCircle size={10} /> Not verified
            </span>
          )}
        </p>
        {!user?.emailVerified && (
          <div className="mb-3 flex items-center gap-2 text-xs text-amber-500">
            <AlertCircle size={12} />
            Verify your email to secure your account and enable recovery.
            <button
              onClick={async () => {
                const r = await resendEmailVerification();
                setEmailNotice(
                  r.success
                    ? {
                        type: "success",
                        msg: "Verification email sent — check your inbox.",
                      }
                    : {
                        type: "error",
                        msg: r.error || "Could not send verification email.",
                      },
                );
              }}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              Resend verification email
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={inputClass}
            placeholder="new.email@example.com"
          />
          <button
            onClick={handleEmailUpdate}
            disabled={emailLoading || !newEmail}
            className="px-6 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white font-medium rounded-xl flex items-center gap-2 whitespace-nowrap"
          >
            {emailLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Mail size={18} />
            )}
            Update
          </button>
        </div>
        {emailNotice && <NoticeBanner notice={emailNotice} />}
      </div>

      {/* Password Change */}
      <div className={cardClass}>
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Lock size={20} className="text-emerald-400" /> Change Password
        </h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>
              New Password (min 8 characters)
            </label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  newPassword: e.target.value,
                })
              }
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className={labelClass}>Confirm New Password</label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  confirmPassword: e.target.value,
                })
              }
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
        </div>
        <button
          onClick={handlePasswordUpdate}
          disabled={pwLoading || !passwordForm.newPassword}
          className={btnClass + " mt-4 bg-emerald-500 hover:bg-emerald-600"}
        >
          {pwLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <KeyRound size={18} />
          )}
          Update Password
        </button>
        {pwNotice && <NoticeBanner notice={pwNotice} />}
      </div>

      {/* Share Access */}
      <div className={cardClass}>
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Share2 size={20} className="text-purple-400" /> Share Station Access
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          Invite team members to access{" "}
          <span className="font-semibold text-gray-900 dark:text-white">
            {currentStation?.name || "your station"}
          </span>{" "}
          from any device. They'll receive a link to accept access.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className={inputClass}
            placeholder="colleague@email.com"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
          >
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
            <option value="auditor">Auditor</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={shareLoading || !inviteEmail || !currentStation?.id}
            className="px-6 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 text-white font-medium rounded-xl flex items-center gap-2 whitespace-nowrap"
          >
            {shareLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Users size={18} />
            )}
            Invite
          </button>
        </div>
        {!currentStation?.id && (
          <p className="text-yellow-400 text-xs mb-3">
            Create or select a station first to share access.
          </p>
        )}

        {/* Members list */}
        {members.length > 0 && (
          <div className="space-y-2 mt-4">
            <p className="text-gray-500 dark:text-gray-400 text-xs font-medium">
              Current Members:
            </p>
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center">
                    <Users size={16} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">
                      {m.name || m.invited_email}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {m.invited_email} · {m.role} · {m.status}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "pending" && m.invite_token && (
                    <button
                      onClick={() => handleCopyInvite(m.invite_token, m)}
                      className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
                      title="Copy invite link"
                    >
                      {copiedToken === m.invite_token ? (
                        <Check size={16} className="text-emerald-400" />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(m.id)}
                    className="p-2 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400"
                    title="Remove access"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {shareNotice && <NoticeBanner notice={shareNotice} />}
      </div>

      {/* Cross-Device Documents */}
      <div className={cardClass}>
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <FileUp size={20} className="text-orange-400" /> Cross-Device File
          Storage
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          Upload files from this device and access them from any other device or
          browser when you log in. Files are stored in Supabase cloud storage
          (not localStorage).
        </p>
        <div
          className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center cursor-pointer hover:border-amber-500/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp size={32} className="mx-auto text-gray-500 mb-2" />
          <p className="text-white text-sm font-medium">
            Click to upload files
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Any file type · Stored in cloud · Accessible from any device
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileUpload}
            className="hidden"
            disabled={docLoading}
          />
        </div>

        {docLoading && (
          <div className="flex items-center justify-center gap-2 mt-4 text-amber-400">
            <Loader2 size={18} className="animate-spin" /> Uploading...
          </div>
        )}

        {documents.length > 0 && (
          <div className="space-y-2 mt-4">
            <p className="text-gray-500 dark:text-gray-400 text-xs font-medium">
              Your Files ({documents.length}):
            </p>
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center shrink-0">
                    <FileText size={16} className="text-orange-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">
                      {doc.file_name}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {doc.category} ·{" "}
                      {doc.file_size
                        ? `${(doc.file_size / 1024).toFixed(1)} KB`
                        : "—"}{" "}
                      · {doc.mime_type || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-500 text-xs hidden sm:flex items-center gap-1">
                    <Clock size={12} />{" "}
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDownload(doc)}
                    className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
                    title="Download/View"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="p-2 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {docNotice && <NoticeBanner notice={docNotice} />}
      </div>
    </div>
  );
}

function NoticeBanner({
  notice,
}: {
  notice: { type: "success" | "error"; msg: string };
}) {
  return (
    <div
      className={`mt-3 p-3 rounded-xl flex items-start gap-2 text-sm ${
        notice.type === "success"
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      }`}
    >
      {notice.type === "success" ? (
        <CheckCircle size={18} className="shrink-0 mt-0.5" />
      ) : (
        <AlertCircle size={18} className="shrink-0 mt-0.5" />
      )}
      <span className="break-all">{notice.msg}</span>
    </div>
  );
}
