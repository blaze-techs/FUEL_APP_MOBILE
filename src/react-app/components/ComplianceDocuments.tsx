import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Eye,
  Download,
  Trash2,
  RefreshCcw,
  Bell,
  FileText,
  Search,
  Send,
  Link2,
  Mail,
  MessageCircle,
  X,
  Plus,
  Pencil,
  FileWarning,
  History,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { getSupabaseClient } from "@/supabase/client";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import PdfCanvasPreview from "@/react-app/components/PdfCanvasPreview";
import {
  buildWhatsAppWebUrl,
  buildMailtoUrl,
  type CommGatewayConfig,
} from "@/react-app/lib/payslip-delivery";
import {
  COMPLIANCE_DOCS_KEY,
  STATUS_META,
  computeDocStatus,
  filterComplianceDocs,
  newComplianceDoc,
  needsAutoRenewal,
  removeComplianceDoc,
  rollExpiry,
  summarizeComplianceDocs,
  upsertComplianceDoc,
  buildRenewalLetterPdf,
  dateToPeriod,
  compliancePeriodLabel,
  checkRequiredCoverage,
  docCoversPermit,
  type ComplianceDocument,
  type ComplianceDocStatus,
} from "@/react-app/lib/compliance-documents";
import {
  extractFromComplianceFile,
  mergeExtractedIntoDoc,
  type ExtractionMethod,
} from "@/react-app/lib/compliance-doc-parser";

const BUCKET = "fuelpro-files";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function uploadComplianceFile(
  file: File,
): Promise<{ path: string; publicUrl: string }> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in — cannot upload the document.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `documents/${user.id}/${Date.now()}-comp-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

async function deleteComplianceFile(path?: string): Promise<void> {
  if (!path) return;
  try {
    await getSupabaseClient().storage.from(BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () =>
      resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(blob);
  });
}

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function ComplianceDocuments({
  requiredPermits = [],
  onAddRequiredPermit,
}: {
  requiredPermits?: string[];
  /**
   * Called when a saved document does not match any required compliance
   * document — the parent registers its type as a new station requirement
   * (uploaded documents are never dismissed).
   */
  onAddRequiredPermit?: (permit: string) => void;
}) {
  const { user } = useAuth();
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  // ── 3-ref cloud-guard pattern (see AGENTS.md) ─────────────────────────
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const docsRef = useRef<ComplianceDocument[]>([]);
  const autoRenewRanRef = useRef(false);

  const [docs, setDocs] = useState<ComplianceDocument[]>(() => {
    const cached = cloudStorageService.getCached<ComplianceDocument[]>(
      COMPLIANCE_DOCS_KEY,
      stationId,
    );
    return Array.isArray(cached) ? cached : [];
  });
  docsRef.current = docs;

  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState<number | "">("");
  const [filterYear, setFilterYear] = useState<number | "">("");
  const [filterStatus, setFilterStatus] = useState<ComplianceDocStatus | "">(
    "",
  );
  const [showRecords, setShowRecords] = useState(true);

  const [editor, setEditor] = useState<ComplianceDocument | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editorNoExpiry, setEditorNoExpiry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [extractionMethod, setExtractionMethod] =
    useState<ExtractionMethod | null>(null);

  const [preview, setPreview] = useState<{
    doc: ComplianceDocument;
    bytes: Uint8Array;
    objectUrl?: string;
    text?: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [renewTarget, setRenewTarget] = useState<ComplianceDocument | null>(
    null,
  );
  const [renewExpiry, setRenewExpiry] = useState("");
  const [renewFile, setRenewFile] = useState<File | null>(null);
  const [renewNote, setRenewNote] = useState("");
  const [sendMenuFor, setSendMenuFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [autoRenewBusy, setAutoRenewBusy] = useState(false);

  // ── persistence ────────────────────────────────────────────────────────
  const persist = (next: ComplianceDocument[]) => {
    if (!cloudLoadCompleteRef.current) return;
    localModifiedRef.current = true;
    cloudStorageService
      .set(COMPLIANCE_DOCS_KEY, next, stationId)
      .then(() => {
        localModifiedRef.current = false;
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const cloud = await cloudStorageService.get<ComplianceDocument[]>(
          COMPLIANCE_DOCS_KEY,
          stationId,
        );
        if (!cancelled && Array.isArray(cloud) && !localModifiedRef.current) {
          setDocs(cloud);
        }
      } finally {
        if (!cancelled) {
          cloudLoadCompleteRef.current = true;
          if (localModifiedRef.current) {
            cloudStorageService
              .set(COMPLIANCE_DOCS_KEY, docsRef.current, stationId)
              .then(() => {
                localModifiedRef.current = false;
              })
              .catch(() => {});
          }
        }
      }
      unsub = cloudStorageService.subscribe<ComplianceDocument[]>(
        COMPLIANCE_DOCS_KEY,
        stationId,
        (val) => {
          if (Array.isArray(val) && !localModifiedRef.current) setDocs(val);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user, stationId]);

  // ── auto-renewal engine: for expired docs with autoRenew ON, generate the
  // renewal request letter automatically (once per expiry), upload it, and
  // email it to the issuing authority when a gateway + issuer email exist. ──
  useEffect(() => {
    if (!cloudLoadCompleteRef.current || autoRenewRanRef.current) return;
    const pending = docs.filter((d) => needsAutoRenewal(d));
    if (pending.length === 0) return;
    autoRenewRanRef.current = true;
    (async () => {
      setAutoRenewBusy(true);
      let working = [...docsRef.current];
      let requested = 0;
      let emailed = 0;
      let failed = 0;
      const gateway =
        (await cloudStorageService
          .get<CommGatewayConfig>("comm_integration_config", stationId)
          .catch(() => null)) || {};
      for (const doc of pending) {
        try {
          const pdf = buildRenewalLetterPdf({
            doc,
            stationName:
              state.companyData?.name || currentStation?.name || "Fuel Station",
            stationAddress: state.companyData?.physicalAddress || "",
            stationPhone: state.companyData?.contacts || "",
            stationEmail: state.companyData?.email || "",
          });
          const blob = pdf.output("blob");
          const letterFile = new File(
            [blob],
            `Renewal_Request_${(doc.name || "permit").replace(/[^a-zA-Z0-9]+/g, "_")}_${doc.expiryDate}.pdf`,
            { type: "application/pdf" },
          );
          const up = await uploadComplianceFile(letterFile);
          const updated: ComplianceDocument = {
            ...doc,
            autoRenewedFor: doc.expiryDate,
            renewalRequestedAt: new Date().toISOString(),
            renewalLetterPath: up.path,
            renewalLetterUrl: up.publicUrl,
            history: [
              ...doc.history,
              {
                archivedAt: new Date().toISOString(),
                expiryDate: doc.expiryDate,
                fileName: doc.fileName,
                note: "Auto-renewal request generated",
              },
            ],
          };
          if (doc.issuerEmail && gateway.emailEnabled && gateway.emailApiKey) {
            try {
              const { callIntegration } =
                await import("@/react-app/lib/integrations-client");
              const res = await callIntegration("email-send", {
                provider: gateway.emailProvider || "sendgrid",
                to: doc.issuerEmail,
                subject: `Renewal request — ${doc.name || doc.permitType} (${doc.expiryDate})`,
                text: `Please find attached our renewal application for ${doc.name}.\n\nDownload: ${up.publicUrl}`,
                fromEmail: gateway.senderEmail || gateway.smtpUser || "",
                fromName:
                  gateway.stationName ||
                  state.companyData?.name ||
                  "Fuel Station",
                apiKey: gateway.emailApiKey,
                domain: gateway.emailDomain,
                attachment: {
                  filename: letterFile.name,
                  contentBase64: await fileToBase64(blob),
                  mimeType: "application/pdf",
                },
              });
              if (res.success) emailed++;
            } catch {
              /* letter still generated + stored */
            }
          }
          working = upsertComplianceDoc(working, updated);
          requested++;
        } catch {
          failed++;
        }
      }
      setDocs(working);
      persist(working);
      setAutoRenewBusy(false);
      if (requested > 0) {
        toastSuccess(
          `Auto-renewal: ${requested} renewal request letter(s) generated${emailed ? `, ${emailed} emailed to the issuing authority` : ""}. Download them from the document cards.`,
        );
      }
      if (failed > 0)
        toastError(`${failed} auto-renewal request(s) failed to generate.`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, user, stationId]);

  // ── derived ────────────────────────────────────────────────────────────
  const stats = useMemo(() => summarizeComplianceDocs(docs), [docs]);
  const filtered = useMemo(
    () =>
      filterComplianceDocs(docs, {
        search,
        month: filterMonth,
        year: filterYear,
        status: filterStatus,
      }),
    [docs, search, filterMonth, filterYear, filterStatus],
  );
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const d of docs) {
      const e = dateToPeriod(d.expiryDate);
      const i = dateToPeriod(d.issueDate);
      if (e) years.add(e.year);
      if (i) years.add(i.year);
      years.add(new Date(d.createdAt).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [docs]);

  // ── required-permit coverage (upload checks against required documents) ──
  const coverage = useMemo(
    () => checkRequiredCoverage(docs, requiredPermits),
    [docs, requiredPermits],
  );

  // ── actions ────────────────────────────────────────────────────────────
  // Auto-feed empty fields from the uploaded file's contents — text PDFs are
  // read directly; scans/images are analyzed visually with on-device OCR.
  const handleEditorFile = async (f: File | null) => {
    setEditorFile(f);
    setAutoFilled([]);
    setExtractionMethod(null);
    setOcrProgress(null);
    if (!f || !editor) return;
    setExtracting(true);
    try {
      const ex = await extractFromComplianceFile(f, requiredPermits, {
        onOcrProgress: (p) => setOcrProgress(p),
      });
      setExtractionMethod(ex.method ?? null);
      setEditor((cur) => {
        if (!cur) return cur;
        const { doc, filled } = mergeExtractedIntoDoc(cur, ex);
        setAutoFilled(filled);
        if (
          ex.expiryDate &&
          !cur.expiryDate &&
          !editorNoExpiry &&
          ex.expiryDate <= new Date().toISOString().slice(0, 10)
        ) {
          // extracted expiry already past — flag it so the user notices
          toastError(
            `This document appears to have expired on ${ex.expiryDate}.`,
          );
        }
        return doc;
      });
    } finally {
      setExtracting(false);
      setOcrProgress(null);
    }
  };

  const openAdd = (permitType = "") => {
    setAutoFilled([]);
    setEditor(newComplianceDoc({ permitType }));
    setEditorFile(null);
    setEditorNoExpiry(false);
  };

  const openEdit = (doc: ComplianceDocument) => {
    setAutoFilled([]);
    setEditor({ ...doc });
    setEditorFile(null);
    setEditorNoExpiry(!doc.expiryDate);
  };

  const saveEditor = async () => {
    if (!editor) return;
    if (!editor.name.trim()) {
      toastError("Document name is required.");
      return;
    }
    setSaving(true);
    try {
      let next: ComplianceDocument = {
        ...editor,
        name: editor.name.trim(),
        permitType: editor.permitType.trim(),
        issuer: editor.issuer.trim(),
        expiryDate: editorNoExpiry ? "" : editor.expiryDate,
      };
      if (editorFile) {
        if (editorFile.size > MAX_FILE_BYTES) {
          toastError("File is too large (max 10 MB).");
          setSaving(false);
          return;
        }
        const up = await uploadComplianceFile(editorFile);
        if (editor.filePath) await deleteComplianceFile(editor.filePath);
        next = {
          ...next,
          filePath: up.path,
          fileUrl: up.publicUrl,
          fileName: editorFile.name,
          mimeType: editorFile.type || "application/octet-stream",
          fileSize: editorFile.size,
        };
      }
      const list = upsertComplianceDoc(docsRef.current, next);
      setDocs(list);
      persist(list);
      setEditor(null);
      setEditorFile(null);
      // Check the upload against the required compliance documents: confirm
      // what it covers — and if it matches NOTHING, never dismiss it: the
      // document type becomes a new required compliance document instead.
      const after = checkRequiredCoverage(list, requiredPermits);
      const coversNow = requiredPermits.filter((p) => docCoversPermit(next, p));
      const parts = [
        `"${next.name}" saved${next.fileName ? " with file" : ""}.`,
      ];
      if (coversNow.length > 0) {
        parts.push(
          `Covers required: ${coversNow.slice(0, 3).join(", ")}${coversNow.length > 3 ? ` +${coversNow.length - 3} more` : ""}.`,
        );
      } else {
        const newRequirement = next.permitType || next.name;
        if (newRequirement) {
          onAddRequiredPermit?.(newRequirement);
          parts.push(
            `Added "${newRequirement}" to your station's required compliance documents.`,
          );
        }
      }
      if (after.missing.length > 0) {
        parts.push(
          `Still missing ${after.missing.length} required document(s): ${after.missing.slice(0, 3).join(", ")}${after.missing.length > 3 ? "…" : ""}.`,
        );
      } else if (requiredPermits.length > 0) {
        parts.push("All required compliance documents are now on file. ✓");
      }
      toastSuccess(parts.join(" "));
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteDoc = async (doc: ComplianceDocument) => {
    if (!window.confirm(`Delete "${doc.name}" and its uploaded file?`)) return;
    const list = removeComplianceDoc(docsRef.current, doc.id);
    setDocs(list);
    persist(list);
    await deleteComplianceFile(doc.filePath);
    toastSuccess("Document deleted.");
  };

  const openPreview = async (doc: ComplianceDocument) => {
    if (!doc.fileUrl) {
      toastError("No file uploaded for this document yet.");
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(doc.fileUrl);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mime = doc.mimeType || "";
      if (mime.startsWith("image/")) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setPreview({ doc, bytes, objectUrl: url });
      } else if (
        mime.startsWith("text/") ||
        /\.(txt|csv|json|md)$/i.test(doc.fileName || "")
      ) {
        setPreview({ doc, bytes, text: new TextDecoder().decode(bytes) });
      } else {
        setPreview({ doc, bytes });
      }
    } catch (e) {
      toastError("Could not load the preview: " + (e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Revoke preview object URLs on change/close.
  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview]);

  const downloadDoc = (doc: ComplianceDocument) => {
    if (!doc.fileUrl) {
      toastError("No file uploaded for this document yet.");
      return;
    }
    const a = document.createElement("a");
    a.href = doc.fileUrl;
    a.download = doc.fileName || doc.name;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  const shareWhatsApp = (doc: ComplianceDocument) => {
    const status = computeDocStatus(doc);
    const msg =
      `${doc.name} (${doc.permitType || "compliance document"})` +
      `${doc.expiryDate ? ` — expires ${doc.expiryDate} (${status.daysLeft !== null && status.daysLeft >= 0 ? `${status.daysLeft} days left` : "EXPIRED"})` : ""}` +
      `${doc.fileUrl ? `\n${doc.fileUrl}` : ""}`;
    window.open(buildWhatsAppWebUrl("", msg), "_blank", "noopener");
  };

  const shareEmail = (doc: ComplianceDocument) => {
    const status = computeDocStatus(doc);
    window.location.href = buildMailtoUrl({
      to: doc.issuerEmail || "",
      subject: `${doc.name} — compliance document`,
      body:
        `${doc.name}\nType: ${doc.permitType || "-"}\nIssuer: ${doc.issuer || "-"}\n` +
        `Issued: ${doc.issueDate || "-"}\nExpires: ${doc.expiryDate || "no expiry"}` +
        `${status.daysLeft !== null ? ` (${status.daysLeft >= 0 ? `${status.daysLeft} days left` : "EXPIRED"})` : ""}\n\n` +
        `${doc.fileUrl ? `Download: ${doc.fileUrl}\n\n` : ""}` +
        `— Sent from FuelPro Compliance`,
    });
  };

  const copyLink = async (doc: ComplianceDocument) => {
    if (!doc.fileUrl) {
      toastError("No file uploaded for this document yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(doc.fileUrl);
      toastSuccess("Public download link copied.");
    } catch {
      toastError("Could not copy the link.");
    }
  };

  const openRenew = (doc: ComplianceDocument) => {
    setRenewTarget(doc);
    setRenewExpiry(rollExpiry(doc.expiryDate, doc.renewalPeriodMonths || 12));
    setRenewFile(null);
    setRenewNote("");
  };

  const confirmRenew = async () => {
    if (!renewTarget) return;
    if (!renewExpiry) {
      toastError("Pick the new expiry date.");
      return;
    }
    setSaving(true);
    try {
      let next: ComplianceDocument = {
        ...renewTarget,
        expiryDate: renewExpiry,
        autoRenewedFor: undefined,
        renewalRequestedAt: undefined,
        renewalLetterPath: undefined,
        renewalLetterUrl: undefined,
        history: [
          ...renewTarget.history,
          {
            archivedAt: new Date().toISOString(),
            expiryDate: renewTarget.expiryDate,
            fileName: renewTarget.fileName,
            note: renewNote.trim() || "Renewed",
          },
        ],
      };
      if (renewFile) {
        if (renewFile.size > MAX_FILE_BYTES) {
          toastError("File is too large (max 10 MB).");
          setSaving(false);
          return;
        }
        const up = await uploadComplianceFile(renewFile);
        if (renewTarget.filePath)
          await deleteComplianceFile(renewTarget.filePath);
        next = {
          ...next,
          filePath: up.path,
          fileUrl: up.publicUrl,
          fileName: renewFile.name,
          mimeType: renewFile.type || "application/octet-stream",
          fileSize: renewFile.size,
        };
      }
      const list = upsertComplianceDoc(docsRef.current, next);
      setDocs(list);
      persist(list);
      setRenewTarget(null);
      toastSuccess(`"${next.name}" renewed until ${renewExpiry}.`);
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "Name",
        "Type",
        "Issuer",
        "Issued",
        "Expiry",
        "Days Left",
        "Status",
        "Period (expiry)",
        "File",
        "Auto-Renew",
      ],
      ...filtered.map((d) => {
        const s = computeDocStatus(d);
        const p = dateToPeriod(d.expiryDate);
        return [
          d.name,
          d.permitType,
          d.issuer,
          d.issueDate || "-",
          d.expiryDate || "no expiry",
          s.daysLeft ?? "-",
          STATUS_META[s.status].label,
          p ? compliancePeriodLabel(p.month, p.year) : "-",
          d.fileName || "-",
          d.autoRenew ? "yes" : "no",
        ];
      }),
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `compliance_records_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div
        className={`grid grid-cols-2 ${requiredPermits.length > 0 ? "sm:grid-cols-5" : "sm:grid-cols-4"} gap-2`}
      >
        {[
          {
            label: "Documents",
            value: stats.total,
            cls: "text-gray-900 dark:text-white",
          },
          { label: "Active", value: stats.active, cls: "text-emerald-600" },
          {
            label: "Expiring soon",
            value: stats.expiring,
            cls: "text-amber-600",
          },
          { label: "Expired", value: stats.expired, cls: "text-red-600" },
          ...(requiredPermits.length > 0
            ? [
                {
                  label: "Required on file",
                  value: `${coverage.covered.length}/${requiredPermits.length}`,
                  cls:
                    coverage.missing.length === 0
                      ? "text-emerald-600"
                      : "text-blue-600",
                },
              ]
            : []),
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center"
          >
            <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {stats.expired + stats.expiring > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Bell size={16} className="mt-0.5 shrink-0" />
          <span>
            {stats.expired > 0 && `${stats.expired} expired. `}
            {stats.expiring > 0 &&
              `${stats.expiring} expiring within the reminder window. `}
            You are also notified from the notification bell. Documents with
            auto-renew enabled get a renewal request letter generated
            automatically{autoRenewBusy ? " (generating…)" : ""}.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => openAdd()}
          className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2"
        >
          <Plus size={15} /> Upload / Track Document
        </button>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="btn btn-secondary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Download size={14} /> Export Records (CSV)
        </button>
        <button
          onClick={() => setShowRecords((v) => !v)}
          className="btn btn-secondary px-4 py-2 text-sm"
        >
          Records {showRecords ? "Hide" : "Show"} ({docs.length})
        </button>
      </div>

      {/* Required compliance documents coverage (checked on every upload) */}
      {requiredPermits.length > 0 && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            coverage.missing.length === 0
              ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700"
              : "border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800"
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p
              className={`text-xs font-semibold ${
                coverage.missing.length === 0
                  ? "text-emerald-800 dark:text-emerald-300"
                  : "text-blue-800 dark:text-blue-300"
              }`}
            >
              Required compliance documents: {coverage.covered.length}/
              {requiredPermits.length} on file
              {coverage.missing.length === 0 && " — fully compliant ✓"}
            </p>
            {coverage.missing.length > 0 && (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                {coverage.missing.length} missing
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {requiredPermits.map((p) => {
              const covered = coverage.covered.includes(p);
              return covered ? (
                <span
                  key={p}
                  className="px-2 py-1 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1"
                >
                  <CheckCircle2 size={11} /> {p}
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => openAdd(p)}
                  title={`Upload ${p}`}
                  className="px-2 py-1 rounded-full text-[11px] font-medium border border-dashed border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                >
                  + {p}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Records filters */}
      {showRecords && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="relative sm:col-span-2">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, type, issuer, notes…"
                className="input pl-8 w-full"
              />
            </div>
            <select
              value={filterMonth}
              onChange={(e) =>
                setFilterMonth(e.target.value ? Number(e.target.value) : "")
              }
              className="input"
            >
              <option value="">All months</option>
              {MONTH_OPTIONS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={(e) =>
                setFilterYear(e.target.value ? Number(e.target.value) : "")
              }
              className="input"
            >
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                "",
                "active",
                "expiring",
                "expired",
                "renewal-pending",
                "no-expiry",
              ] as const
            ).map((s) => (
              <button
                key={s || "all"}
                onClick={() => setFilterStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterStatus === s
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {s === "" ? "All" : STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Document cards */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
            {docs.length === 0 ? (
              <>
                <FileWarning size={28} className="mx-auto mb-2 opacity-50" />
                No compliance documents yet — upload a permit, license or
                certificate to start tracking its expiry.
              </>
            ) : (
              "No documents match the current filters."
            )}
          </div>
        )}
        {filtered.map((doc) => {
          const { status, daysLeft } = computeDocStatus(doc);
          const meta = STATUS_META[status];
          const expiryPeriod = dateToPeriod(doc.expiryDate);
          return (
            <div
              key={doc.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText size={15} className="text-blue-500 shrink-0" />
                    <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {doc.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.badge}`}
                    >
                      {meta.label}
                      {daysLeft !== null &&
                        status !== "no-expiry" &&
                        (daysLeft >= 0
                          ? ` · ${daysLeft}d`
                          : ` · ${-daysLeft}d ago`)}
                    </span>
                    {doc.autoRenew && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700">
                        Auto-renew
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {doc.permitType || "Document"}
                    {doc.issuer ? ` · ${doc.issuer}` : ""}
                    {expiryPeriod &&
                      ` · ${compliancePeriodLabel(expiryPeriod.month, expiryPeriod.year)}`}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Issued {doc.issueDate || "—"} → Expires{" "}
                    {doc.expiryDate || "never"}
                    {doc.fileName ? ` · ${doc.fileName}` : " · no file"}
                  </p>
                  {doc.renewalLetterUrl && (
                    <a
                      href={doc.renewalLetterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-600 dark:text-indigo-400 underline"
                    >
                      Renewal request letter (auto-generated)
                    </a>
                  )}
                  {doc.history.length > 0 && (
                    <button
                      onClick={() =>
                        setHistoryFor(historyFor === doc.id ? null : doc.id)
                      }
                      className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5 hover:underline"
                    >
                      <History size={11} /> {doc.history.length} renewal
                      {doc.history.length > 1 ? "s" : ""} on record
                    </button>
                  )}
                  {historyFor === doc.id && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-600 pl-2">
                      {doc.history.map((h, i) => (
                        <li key={i}>
                          {new Date(h.archivedAt).toLocaleDateString()} —
                          expired {h.expiryDate || "—"}
                          {h.fileName ? ` (${h.fileName})` : ""}
                          {h.note ? ` — ${h.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => openPreview(doc)}
                    disabled={previewLoading}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                    title="Preview"
                    aria-label={`Preview ${doc.name}`}
                  >
                    <Eye size={15} />
                  </button>
                  <button
                    onClick={() => downloadDoc(doc)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                    title="Download"
                    aria-label={`Download ${doc.name}`}
                  >
                    <Download size={15} />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setSendMenuFor(sendMenuFor === doc.id ? null : doc.id)
                      }
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      title="Send / share"
                      aria-label={`Send ${doc.name}`}
                    >
                      <Send size={15} />
                    </button>
                    {sendMenuFor === doc.id && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 w-48">
                        <button
                          onClick={() => {
                            shareWhatsApp(doc);
                            setSendMenuFor(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <MessageCircle size={14} /> WhatsApp
                        </button>
                        <button
                          onClick={() => {
                            shareEmail(doc);
                            setSendMenuFor(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Mail size={14} /> Email
                        </button>
                        <button
                          onClick={() => {
                            copyLink(doc);
                            setSendMenuFor(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Link2 size={14} /> Copy public link
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openRenew(doc)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-emerald-600"
                    title="Mark renewed"
                    aria-label={`Renew ${doc.name}`}
                  >
                    <RefreshCcw size={15} />
                  </button>
                  <button
                    onClick={() => openEdit(doc)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                    title="Edit"
                    aria-label={`Edit ${doc.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => deleteDoc(doc)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                    title="Delete"
                    aria-label={`Delete ${doc.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add/Edit modal ─────────────────────────────────────────────── */}
      {editor && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setEditor(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">
                {docs.some((d) => d.id === editor.id)
                  ? "Edit Document"
                  : "Add Compliance Document"}
              </h3>
              <button
                onClick={() => setEditor(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Document name *
                </label>
                <input
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                  className="input w-full"
                  placeholder="e.g. EPRA Retail Licence 2026"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Permit / requirement type
                </label>
                <input
                  value={editor.permitType}
                  onChange={(e) =>
                    setEditor({ ...editor, permitType: e.target.value })
                  }
                  className="input w-full"
                  list="compliance-permit-types"
                  placeholder="e.g. Fire Certificate"
                />
                <datalist id="compliance-permit-types">
                  {requiredPermits.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {requiredPermits.length > 0 &&
                  (editor.permitType.trim() || editor.name.trim()) && (
                    <p className="text-[11px] mt-1 text-gray-500 dark:text-gray-400">
                      {(() => {
                        const covers = requiredPermits.filter((p) =>
                          docCoversPermit(editor, p),
                        );
                        return covers.length > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ✓ Covers required: {covers.join(", ")}
                          </span>
                        ) : (
                          <span className="text-indigo-600 dark:text-indigo-400">
                            ✚ New document type — it will be added to your
                            station&apos;s required compliance documents when
                            you save.
                          </span>
                        );
                      })()}
                    </p>
                  )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Issuing authority
                </label>
                <input
                  value={editor.issuer}
                  onChange={(e) =>
                    setEditor({ ...editor, issuer: e.target.value })
                  }
                  className="input w-full"
                  placeholder="e.g. EPRA / County Government"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Authority email (for auto-renew)
                </label>
                <input
                  type="email"
                  value={editor.issuerEmail || ""}
                  onChange={(e) =>
                    setEditor({ ...editor, issuerEmail: e.target.value })
                  }
                  className="input w-full"
                  placeholder="licensing@authority.go.ke"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Issue date
                </label>
                <input
                  type="date"
                  value={editor.issueDate}
                  onChange={(e) =>
                    setEditor({ ...editor, issueDate: e.target.value })
                  }
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Expiry date
                </label>
                <input
                  type="date"
                  value={editor.expiryDate}
                  disabled={editorNoExpiry}
                  onChange={(e) =>
                    setEditor({ ...editor, expiryDate: e.target.value })
                  }
                  className="input w-full disabled:opacity-50"
                />
                <label className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={editorNoExpiry}
                    onChange={(e) => setEditorNoExpiry(e.target.checked)}
                  />
                  Does not expire
                </label>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Remind days before expiry
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={editor.reminderDays}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      reminderDays: Math.max(
                        1,
                        Math.min(365, Number(e.target.value) || 30),
                      ),
                    })
                  }
                  className="input w-full"
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={editor.autoRenew}
                    onChange={(e) =>
                      setEditor({ ...editor, autoRenew: e.target.checked })
                    }
                  />
                  Auto-renew — when this expires, automatically generate a
                  renewal request letter
                  {editor.issuerEmail ? " and email it to the authority" : ""}
                </label>
                {editor.autoRenew && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    Renewal period
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={editor.renewalPeriodMonths}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          renewalPeriodMonths: Math.max(
                            1,
                            Math.min(120, Number(e.target.value) || 12),
                          ),
                        })
                      }
                      className="input w-20"
                    />
                    months
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  File (PDF / image / scan, max 10 MB)
                </label>
                <input
                  type="file"
                  accept=".pdf,image/*,.txt,.csv,.doc,.docx"
                  onChange={(e) =>
                    void handleEditorFile(e.target.files?.[0] || null)
                  }
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {extracting && (
                  <p className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mt-1">
                    <Loader2 size={12} className="animate-spin" />
                    {ocrProgress !== null
                      ? `Visually analyzing the document (OCR)… ${Math.round(
                          ocrProgress * 100,
                        )}%`
                      : "Reading document to auto-fill the details…"}
                  </p>
                )}
                {!extracting && autoFilled.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                    Auto-filled from the document: {autoFilled.join(", ")}.
                    {extractionMethod === "ocr" &&
                      " Scanned document — fields read by visual (OCR) analysis."}{" "}
                    Please review before saving.
                  </p>
                )}
                {editor.fileName && !editorFile && (
                  <p className="text-xs text-gray-400 mt-1">
                    Current file: {editor.fileName} (choose a file to replace)
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Notes
                </label>
                <textarea
                  value={editor.notes || ""}
                  onChange={(e) =>
                    setEditor({ ...editor, notes: e.target.value })
                  }
                  className="input w-full"
                  rows={2}
                  placeholder="Licence number, conditions, contacts…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditor(null)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveEditor}
                disabled={saving}
                className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? "Saving…" : "Save Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Renew modal ────────────────────────────────────────────────── */}
      {renewTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setRenewTarget(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" /> Renew "
              {renewTarget.name}"
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              The current version (expired {renewTarget.expiryDate || "—"}) is
              archived into the renewal history.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                New expiry date
              </label>
              <input
                type="date"
                value={renewExpiry}
                onChange={(e) => setRenewExpiry(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                Upload renewed document (optional)
              </label>
              <input
                type="file"
                accept=".pdf,image/*,.txt,.csv,.doc,.docx"
                onChange={(e) => setRenewFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                Note (optional)
              </label>
              <input
                value={renewNote}
                onChange={(e) => setRenewNote(e.target.value)}
                className="input w-full"
                placeholder="e.g. Renewed at county office"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenewTarget(null)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmRenew}
                disabled={saving}
                className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? "Renewing…" : "Mark Renewed"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ──────────────────────────────────────────────── */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-2 md:p-6 z-50"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="min-w-0">
                <h3 className="text-sm md:text-lg font-bold truncate text-gray-900 dark:text-white">
                  {preview.doc.name}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {preview.doc.permitType || "Document"} ·{" "}
                  {preview.doc.fileName}
                  {preview.doc.expiryDate &&
                    ` · expires ${preview.doc.expiryDate}`}
                </p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {preview.objectUrl ? (
                <div className="h-full overflow-y-auto bg-gray-100 dark:bg-gray-900 p-3">
                  <img
                    src={preview.objectUrl}
                    alt={`${preview.doc.name} scan`}
                    className="w-full h-auto rounded-lg bg-white"
                  />
                </div>
              ) : preview.text !== undefined ? (
                <pre className="h-full overflow-auto bg-gray-100 dark:bg-gray-900 p-4 text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {preview.text}
                </pre>
              ) : (
                <PdfCanvasPreview bytes={preview.bytes} />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setPreview(null)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Close
              </button>
              <button
                onClick={() => {
                  downloadDoc(preview.doc);
                }}
                className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2"
              >
                <Download size={14} /> Download
              </button>
              <button
                onClick={() => {
                  shareWhatsApp(preview.doc);
                }}
                className="btn btn-secondary px-4 py-2 text-sm flex items-center gap-2"
              >
                <MessageCircle size={14} /> WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {previewLoading && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-5 py-4 flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading preview…
          </div>
        </div>
      )}

      {/* hidden upload affordance for layout stability */}
      <span className="hidden">
        <Upload size={1} />
      </span>
    </div>
  );
}
