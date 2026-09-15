/**
 * AgreementsPanel — FuelPro "Agreements" tab.
 *
 * Contract management + e-signature workflow, ported from Reatech360's
 * `/admin/agreements`: draft → send for signature → signed (with signer
 * name + timestamp). Cloud-backed station-scoped, cross-device.
 */

import { FormEvent, useMemo, useState } from "react";
import {
  FileSignature,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { Agreement, useAgreements } from "@/react-app/lib/agreements-service";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function StatusBadge({ status }: { status: Agreement["status"] }) {
  const map: Record<Agreement["status"], string> = {
    draft: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
    sent: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    signed:
      "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full capitalize ${map[status]}`}
    >
      {status}
    </span>
  );
}

export default function AgreementsPanel() {
  const { currentStation } = useStations();
  const { user } = useAuth();
  const {
    agreements,
    loading,
    addAgreement,
    updateAgreement,
    deleteAgreement,
    sendForSignature,
    signAgreement,
  } = useAgreements(currentStation?.id, user?.id);

  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    clientName: "",
    clientEmail: "",
    terms: "",
    startDate: "",
    endDate: "",
  });
  const [busy, setBusy] = useState(false);
  const [signId, setSignId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [toast, setToast] = useState("");

  const stats = useMemo(() => {
    const signed = agreements.filter((a) => a.status === "signed").length;
    const sent = agreements.filter((a) => a.status === "sent").length;
    const draft = agreements.filter((a) => a.status === "draft").length;
    return { signed, sent, draft, total: agreements.length };
  }, [agreements]);

  function openCreate() {
    setEditId(null);
    setForm({
      title: "",
      clientName: "",
      clientEmail: "",
      terms: "",
      startDate: "",
      endDate: "",
    });
    setShowCreate(true);
  }

  function openEdit(a: Agreement) {
    setEditId(a.id);
    setForm({
      title: a.title,
      clientName: a.clientName,
      clientEmail: a.clientEmail,
      terms: a.terms,
      startDate: a.startDate ?? "",
      endDate: a.endDate ?? "",
    });
    setShowCreate(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.clientName.trim()) {
      setToast("Please enter a title and client name.");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setBusy(true);
    try {
      if (editId) {
        await updateAgreement(editId, {
          title: form.title.trim(),
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
          terms: form.terms,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        });
        setToast("Agreement updated.");
      } else {
        await addAgreement({
          title: form.title.trim(),
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
          terms: form.terms,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        });
        setToast("Agreement created as draft.");
      }
      setShowCreate(false);
      setTimeout(() => setToast(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Agreement) {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    await deleteAgreement(a.id);
    setToast("Agreement deleted.");
    setTimeout(() => setToast(""), 3000);
  }

  async function signSubmit(e: FormEvent) {
    e.preventDefault();
    if (!signId || !signerName.trim()) return;
    await signAgreement(signId, signerName.trim());
    setSignId(null);
    setSignerName("");
    setToast("Agreement signed.");
    setTimeout(() => setToast(""), 3000);
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <FileSignature className="w-8 h-8" />
            <div>
              <h2 className="text-xl font-bold">Agreements</h2>
              <p className="text-sm text-blue-100">
                Send contracts for signature and keep a record once signed
              </p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> New Agreement
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total",
            value: stats.total,
            color: "text-gray-900 dark:text-white",
          },
          {
            label: "Draft",
            value: stats.draft,
            color: "text-gray-500 dark:text-gray-400",
          },
          {
            label: "Awaiting signature",
            value: stats.sent,
            color: "text-amber-600 dark:text-amber-400",
          },
          {
            label: "Signed",
            value: stats.signed,
            color: "text-emerald-600 dark:text-emerald-400",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
          >
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[240px]">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : agreements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center">
          <FileSignature className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No agreements yet. Create a contract to send for signature.
          </p>
          <button
            onClick={openCreate}
            className="mt-3 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            <Plus size={14} /> New Agreement
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {agreements.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white truncate">
                    {a.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {a.clientName}
                    {a.clientEmail ? ` · ${a.clientEmail}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  <button
                    onClick={() => openEdit(a)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(a)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {a.terms && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                  {a.terms}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>Start {fmt(a.startDate)}</span>
                <span>End {fmt(a.endDate)}</span>
                {a.sentAt && <span>Sent {fmt(a.sentAt)}</span>}
                {a.status === "signed" && a.signerName && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    ✍ {a.signerName} signed {fmt(a.signedAt)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                {a.status === "draft" && (
                  <button
                    onClick={async () => {
                      await sendForSignature(a.id);
                      setToast("Agreement sent for signature.");
                      setTimeout(() => setToast(""), 3000);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs flex items-center gap-1.5"
                  >
                    <Send size={12} /> Send for signature
                  </button>
                )}
                {a.status === "sent" && (
                  <button
                    onClick={() => {
                      setSignId(a.id);
                      setSignerName(a.clientName);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center gap-1.5"
                  >
                    <FileSignature size={12} /> Sign now
                  </button>
                )}
                {(a.status === "draft" || a.status === "sent") &&
                  a.clientEmail && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Mail size={12} /> Will notify {a.clientEmail}
                    </span>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !busy && setShowCreate(false)}
        >
          <form
            onSubmit={submit}
            className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {editId ? "Edit Agreement" : "New Agreement"}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  Title
                </label>
                <input
                  required
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Fuel Supply Agreement 2026"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Client name
                  </label>
                  <input
                    required
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                    value={form.clientName}
                    onChange={(e) =>
                      setForm({ ...form, clientName: e.target.value })
                    }
                    placeholder="Signer name"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Client email
                  </label>
                  <input
                    type="email"
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                    value={form.clientEmail}
                    onChange={(e) =>
                      setForm({ ...form, clientEmail: e.target.value })
                    }
                    placeholder="client@example.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Start date
                  </label>
                  <input
                    type="date"
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    End date
                  </label>
                  <input
                    type="date"
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm({ ...form, endDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  Terms & conditions
                </label>
                <textarea
                  rows={4}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                  value={form.terms}
                  onChange={(e) => setForm({ ...form, terms: e.target.value })}
                  placeholder="Scope, pricing, delivery terms…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {editId ? "Save changes" : "Create agreement"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sign modal */}
      {signId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !busy && setSignId(null)}
        >
          <form
            onSubmit={signSubmit}
            className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Sign agreement
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Enter the signer's full name to record the signature.
            </p>
            <input
              required
              className="w-full mt-3 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full legal name"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setSignId(null)}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-1.5"
              >
                <FileSignature size={14} /> Sign now
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg bg-gray-900 text-white text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
