/**
 * CompanyQrModal.tsx — secure, shareable "Company QR Code" modal.
 *
 * Replaces the old static (external qrserver.com) QR that encoded no access.
 * The owner now:
 *   1. Creates a revocable, expiring access GRANT (crypto-random code stored
 *      in the RLS-guarded `company_grants` table).
 *   2. Sees the QR rendered LOCALLY (qrcode lib → data URL, no external API,
 *      CSP-safe).
 *   3. Shares the link via WhatsApp (wa.me) / email (mailto:) deep links,
 *      copies it, or downloads the PNG.
 *   4. Revokes / rotates the grant at any time (revocation is enforced
 *      server-side so a replayed old link dies instantly).
 *
 * The shared link opens /#/station-access?grant=<code> — the unauthenticated
 * recipient redeems via the `redeem_company_grant` RPC and views the
 * station's read-only snapshot for the granted period.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import QRCode from "qrcode";
import {
  X,
  QrCode,
  Download,
  Copy,
  Trash2,
  Share2,
  ShieldCheck,
  Clock,
  User,
  Shield,
  Loader2,
  Check,
  Mail,
  MessageCircle,
  Settings2,
} from "lucide-react";
import {
  createCompanyGrant,
  listCompanyGrants,
  revokeCompanyGrant,
  deleteCompanyGrant,
  updateGrantMode,
  buildGrantLink,
  buildWhatsAppShareUrl,
  buildMailtoShareUrl,
  GRANT_TAB_PRESETS,
  grantModeLabel,
  type CompanyGrant,
  type GrantAccessMode,
} from "@/react-app/lib/company-grant-service";
import { useStations } from "@/react-app/context/StationContext";
import Modal from "@/react-app/components/ui/Modal";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface CompanyQrModalProps {
  stationName: string;
  companyName: string;
  onClose: () => void;
}

function fmtExpiry(ts: number | null): string {
  if (!ts) return "Never expires";
  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires in 1 day";
  if (days < 30) return `Expires in ${days} days`;
  const months = Math.round(days / 30.4);
  return `Expires in ~${months} month${months === 1 ? "" : "s"}`;
}

export default function CompanyQrModal({
  stationName,
  companyName,
  onClose,
}: CompanyQrModalProps) {
  const { currentStation } = useStations();
  const stationId = currentStation?.id || "";

  const [grants, setGrants] = useState<CompanyGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create-grant form state
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState("Staff");
  const [presetId, setPresetId] = useState("all");
  const [accessMode, setAccessMode] = useState<GrantAccessMode>("read");
  const [expiryDays, setExpiryDays] = useState(7);
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);

  // Active selection state
  const [activeGrant, setActiveGrant] = useState<CompanyGrant | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const loadGrants = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCompanyGrants(stationId);
      setGrants(list);
      // Keep the active selection pointing at a valid (non-revoked) grant.
      // Read the current selection via a ref so this callback is stable.
      const current = activeGrantRef.current;
      if (!current || !list.find((g) => g.id === current.id && !g.revoked)) {
        const next = list.find((g) => !g.revoked);
        setActiveGrant(next || null);
      }
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  const activeGrantRef = useRef<CompanyGrant | null>(null);
  useEffect(() => {
    activeGrantRef.current = activeGrant;
  }, [activeGrant]);

  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  // Modal hygiene (Escape-close + scroll-lock) lives in the shared Modal
  // wrapper below — see src/react-app/components/ui/Modal.tsx.

  // Refresh the QR whenever the active grant changes.
  useEffect(() => {
    if (!activeGrant || activeGrant.revoked) {
      setQrDataUrl("");
      return;
    }
    const link = buildGrantLink(activeGrant.code);
    QRCode.toDataURL(link, { width: 260, margin: 2, errorCorrectionLevel: "M" })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [activeGrant]);

  const handleCreate = async () => {
    if (!stationId) {
      toastError("No station selected.");
      return;
    }
    if (!memberName.trim()) {
      toastError("Enter the recipient/team name for this grant.");
      return;
    }
    setCreating(true);
    try {
      const preset = GRANT_TAB_PRESETS.find((p) => p.id === presetId);
      const grant = await createCompanyGrant(
        {
          memberName: memberName.trim(),
          memberRole,
          allowedTabs: preset?.tabs ?? [],
          readOnly: accessMode === "read",
          accessMode,
          expiresInDays: expiryDays > 0 ? expiryDays : undefined,
          maxUses: maxUses.trim() ? Number(maxUses) : null,
        },
        stationId,
      );
      setGrants([grant, ...grants.filter((g) => g.id !== grant.id)]);
      setActiveGrant(grant);
      setShowCreate(false);
      setMemberName("");
      setMaxUses("");
      toastSuccess(
        "QR grant created — it is revocable and expires automatically.",
      );
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to create grant.");
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = (g: CompanyGrant) => {
    setActiveGrant(g);
    setShowCreate(false);
  };

  const handleRevoke = async (g: CompanyGrant) => {
    if (
      !window.confirm(`Revoke this QR grant (${g.memberName})? Any shared
link will stop working immediately, even if someone already scanned it.`)
    )
      return;
    try {
      await revokeCompanyGrant(g.id, stationId);
      toastSuccess("Grant revoked — the shared link is now dead.");
      await loadGrants();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Revoke failed.");
    }
  };

  const handleDelete = async (g: CompanyGrant) => {
    if (
      !window.confirm(
        `Permanently delete this grant (${g.memberName})? This cannot be undone.`,
      )
    )
      return;
    try {
      await deleteCompanyGrant(g.id);
      toastSuccess("Grant deleted.");
      if (activeGrant?.id === g.id) setActiveGrant(null);
      await loadGrants();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const handleCycleGrantMode = async () => {
    if (!activeGrant || activeGrant.revoked) return;
    const next: GrantAccessMode =
      activeGrant.accessMode === "read"
        ? "edit"
        : activeGrant.accessMode === "edit"
          ? "full"
          : "read";
    try {
      await updateGrantMode(activeGrant.id, next, stationId);
      toastSuccess(`Access mode changed to ${grantModeLabel(next)}`);
      await loadGrants();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to change mode.");
    }
  };

  const handleCopy = () => {
    if (!activeGrant) return;
    const link = buildGrantLink(activeGrant.code);
    navigator.clipboard
      ?.writeText(link)
      .then(() => toastSuccess("Share link copied to clipboard."))
      .catch(() => {
        // Fallback for older browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          toastSuccess("Share link copied to clipboard.");
        } catch {
          toastError("Copy failed — long-press the link below to copy it.");
        }
        document.body.removeChild(ta);
      });
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.download = `fuelpro-${companyName || stationName || "station"}-access.png`;
    a.href = qrDataUrl;
    a.click();
  };

  const buildShareMessage = useCallback(
    (g: CompanyGrant): string => {
      const link = buildGrantLink(g.code);
      const tabs =
        g.allowedTabs.length === 0 ? "all sections" : g.allowedTabs.join(", ");
      const expiry = g.expiresAt
        ? ` — this link expires ${new Date(g.expiresAt).toLocaleString()}`
        : "";
      return `FuelPro — you've been granted read-only access to ${
        stationName || companyName
      } (${tabs}). Open the link to view the station dashboard${expiry}:\n${link}`;
    },
    [stationName, companyName],
  );

  const handleWhatsApp = () => {
    if (!activeGrant) return;
    const message = buildShareMessage(activeGrant);
    const to = prompt(
      "Recipient phone (recommended 2-digit country code + number, no + or spaces):",
      "",
    );
    if (to === null) return;
    const digits = (to || "").replace(/\D/g, "");
    if (!digits) {
      toastError("Enter a phone number to open WhatsApp.");
      return;
    }
    window.open(buildWhatsAppShareUrl(digits, message), "_blank");
  };

  const handleEmail = () => {
    if (!activeGrant) return;
    const message = buildShareMessage(activeGrant);
    const to = prompt(
      "Recipient email (optional — leave empty to open your mail client):",
      "",
    );
    if (to === null) return;
    const subject = `Access to ${stationName || companyName} (FuelPro)`;
    window.open(
      buildMailtoShareUrl({ to: (to || "").trim(), subject, body: message }),
      "_self",
    );
  };

  const activeLive = activeGrant && !activeGrant.revoked && activeGrant.enabled;

  const roleOptions = [
    "Owner",
    "Manager",
    "Staff",
    "Auditor",
    "Cashier",
    "Attendant",
  ];

  return (
    <Modal
      onClose={onClose}
      label="Company QR Code"
      className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 dark:border-white/10 p-4"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10 px-2 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <QrCode size={18} className="text-amber-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Company QR Code
          </h3>
          {activeLive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
              Live
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── QR preview + active grant ── */}
      <div className="mt-2">
        {activeLive && qrDataUrl ? (
          <div className="bg-white p-3 rounded-xl flex items-center justify-center border border-gray-200">
            <img
              src={qrDataUrl}
              alt="Company access QR — scan to open the shared station view"
              className="w-52 h-52"
            />
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-xl flex items-center justify-center border border-dashed border-gray-300 dark:border-white/10">
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center px-2">
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin inline" /> Loading…
                </>
              ) : grants.some((g) => !g.revoked && g.enabled) ? (
                "Select an active grant below to reveal its QR."
              ) : (
                "No active grants. Create one below — anyone who scans the QR gets a secure, revocable, expiring link to this station's read-only view."
              )}
            </p>
          </div>
        )}

        {activeGrant && (
          <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1 items-center">
            <span className="inline-flex items-center gap-1">
              <User size={11} /> {activeGrant.memberName}
            </span>
            <span className="inline-flex items-center gap-1">
              <Shield size={11} /> {activeGrant.memberRole} ·{" "}
              {grantModeLabel(
                activeGrant.accessMode ||
                  (activeGrant.readOnly ? "read" : "full"),
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {fmtExpiry(activeGrant.expiresAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Check size={11} /> {activeGrant.uses} redeems
              {activeGrant.maxUses ? ` / ${activeGrant.maxUses} max` : ""}
            </span>
            {activeGrant.revoked && (
              <span className="text-red-500">Revoked</span>
            )}
          </div>
        )}
      </div>

      {/* ── Share actions ── */}
      <div className="flex flex-wrap gap-2 mt-2">
        <button
          onClick={handleWhatsApp}
          disabled={!activeLive}
          aria-label="Share via WhatsApp"
          title="Share via WhatsApp"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <MessageCircle size={13} /> WhatsApp
        </button>
        <button
          onClick={handleEmail}
          disabled={!activeLive}
          aria-label="Share via email"
          title="Share via email"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <Mail size={13} /> Email
        </button>
        <button
          onClick={handleCopy}
          disabled={!activeLive}
          aria-label="Copy share link"
          title="Copy share link (the QR encodes this link)"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <Copy size={13} /> Copy link
        </button>
        <button
          onClick={handleDownload}
          disabled={!qrDataUrl}
          aria-label="Download QR code image"
          title="Download QR as PNG"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <Download size={13} /> PNG
        </button>
        <button
          onClick={handleCycleGrantMode}
          disabled={!activeGrant || activeGrant.revoked}
          aria-label="Change access mode"
          title="Change access mode (Read only → Edit only → Normal → Read only)"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <Settings2 size={13} /> Mode
        </button>
        <button
          onClick={() => activeGrant && handleRevoke(activeGrant)}
          disabled={!activeGrant || activeGrant.revoked}
          aria-label="Revoke this grant"
          title="Revoke — the shared link dies immediately, even if already scanned"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium disabled:opacity-40 transition-colors"
        >
          <ShieldCheck size={13} /> Revoke
        </button>
      </div>

      {activeGrant && (
        <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 break-all select-all">
          {buildGrantLink(activeGrant.code)}
        </p>
      )}

      {/* ── Create new grant ── */}
      <div className="mt-3">
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full py-2 h-10 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Share2 size={14} /> New secure shareable QR
          </button>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
              Create QR access grant
            </p>
            <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
              Recipient / team name (who is this for?)
            </label>
            <input
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder={`e.g. ${stationName || "Station"} manager`}
              className="w-full px-2.5 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-gray-400 dark:text-gray-500">
                Role
                <select
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value)}
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white text-xs"
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-gray-400 dark:text-gray-500">
                Access period
                <select
                  value={String(expiryDays)}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white text-xs"
                >
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="0">Never</option>
                </select>
              </label>
            </div>
            <label className="text-[10px] text-gray-400 dark:text-gray-500">
              Sections visible
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white text-xs"
              >
                {GRANT_TAB_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 mb-0.5 block">
              Access mode — you decide what this visitor can do
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["read", "edit", "full"] as GrantAccessMode[]).map((m) => {
                const [label, desc] = {
                  read: ["Read only", "View only"],
                  edit: ["Edit only", "Add/update, no deletes"],
                  full: ["Normal", "Full access"],
                }[m];
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAccessMode(m)}
                    aria-pressed={accessMode === m}
                    title={desc}
                    className={`px-2 py-1 rounded-lg text-[10px] border transition-colors ${
                      accessMode === m
                        ? "bg-amber-500/20 border-amber-500 text-amber-800 dark:text-amber-300 font-semibold"
                        : "bg-gray-100 dark:bg-white/10 border-gray-200 dark:border-white/20 text-gray-600 dark:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              <label className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                Max uses
                <input
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="∞"
                  inputMode="numeric"
                  className="w-16 ml-1 px-1.5 py-1 rounded-lg bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-900 dark:text-white text-xs"
                />
              </label>
            </div>
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 py-2 h-10 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white text-xs font-semibold disabled:opacity-50 transition-colors"
              >
                {creating ? (
                  <Loader2 size={13} className="animate-spin inline" />
                ) : (
                  "Create QR grant"
                )}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Grants list ── */}
      <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
          Active grants ({grants.filter((g) => !g.revoked && g.enabled).length})
        </p>
        {loading ? (
          <p className="text-xs text-gray-400 py-2">
            <Loader2 size={13} className="animate-spin inline" /> Loading
            grants…
          </p>
        ) : grants.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
            No grants yet. Create one above.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {grants.map((g) => {
              const live = !g.revoked && g.enabled;
              return (
                <div
                  key={g.id}
                  className={`rounded-lg border px-2.5 py-2 ${
                    activeGrant?.id === g.id && live
                      ? "border-amber-500/60 bg-amber-500/5"
                      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleSelect(g)}
                      disabled={!live}
                      className="text-left min-w-0 flex-1"
                    >
                      <span className="block text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                        {g.memberName}
                        {g.revoked ? " (revoked)" : ""}
                      </span>
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {g.memberRole} · {fmtExpiry(g.expiresAt)} · {g.uses}{" "}
                        redeems
                        {g.maxUses ? ` / ${g.maxUses}` : ""}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {g.id === activeGrant?.id && live && (
                        <span className="px-1 text-[9px] rounded-full bg-emerald-500/10 text-emerald-600">
                          QR
                        </span>
                      )}
                      <button
                        onClick={() =>
                          live ? handleRevoke(g) : handleDelete(g)
                        }
                        aria-label={
                          live
                            ? `Revoke ${g.memberName}`
                            : `Delete ${g.memberName}`
                        }
                        title={
                          live ? "Revoke (link dies now)" : "Delete permanently"
                        }
                        className={`p-1 rounded-md ${
                          live
                            ? "text-red-500 hover:bg-red-500/10"
                            : "text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"
                        }
                          `}
                      >
                        {live ? (
                          <ShieldCheck size={13} />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Security note ── */}
      <div className="mt-2 rounded-lg bg-blue-500/5 dark:bg-white/5 border border-blue-200 dark:border-white/10 p-2">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <ShieldCheck size={11} className="inline" /> Securely unique &
          revocable: each grant has a one-of-a-kind code, expires automatically,
          is read-only, and can be revoked instantly — old links stop working
          the moment you revoke, even if already scanned.
        </p>
      </div>
    </Modal>
  );
}
