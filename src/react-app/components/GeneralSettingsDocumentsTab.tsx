/**
 * GeneralSettingsDocumentsTab.tsx
 * "Documents" settings sub-tab — reverse-engineered from Reatech360's
 * "Invoices Settings" / "Quotations Settings":
 *  - Configurable numbering (prefix, separator, padding, year placement)
 *  - Selectable PDF templates (Classic / Modern Minimal / Bold Header)
 *  - Default payment terms + pre-filled notes / terms & conditions
 *  - Bank payment details (incl. SWIFT/BIC)
 *  - Auto payment reminders + late fees for overdue invoices
 *
 * Persisted to the station-scoped "documents_config" cloud key (used by the
 * Invoice tab + the Quotations module).
 */
import { useEffect, useMemo, useState } from "react";
import { FileText, Banknote, BellRing, Hash } from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  type DocumentsConfig,
  type PdfTemplate,
  type InvoiceSeparator,
  PAYMENT_TERMS_OPTIONS,
  PDF_TEMPLATES,
  buildSequencePreview,
  normalizeDocumentsConfig,
  saveDocumentsConfig,
} from "@/react-app/lib/invoice-config";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-amber-500" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

const inputClass =
  "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-h-[40px]";

export default function GeneralSettingsDocumentsTab() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [cfg, setCfg] = useState<DocumentsConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Prefer the in-memory cache for an instant first render, then the
        // authoritative cloud row.
        const cached = cloudStorageService.getCached<unknown>(
          "documents_config",
          stationId,
        );
        const initial = normalizeDocumentsConfig(cached);
        if (!cancelled) {
          setCfg(initial);
          setLoaded(true);
        }
        const cloud = await cloudStorageService.get<unknown>(
          "documents_config",
          stationId,
        );
        if (!cancelled) {
          setCfg(normalizeDocumentsConfig(cloud));
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const update = (patch: Partial<DocumentsConfig>) => {
    setCfg((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateNumbering = (patch: Partial<DocumentsConfig["numbering"]>) => {
    setCfg((prev) =>
      prev ? { ...prev, numbering: { ...prev.numbering, ...patch } } : prev,
    );
  };

  const updateBank = (patch: Partial<DocumentsConfig["bankDetails"]>) => {
    setCfg((prev) =>
      prev ? { ...prev, bankDetails: { ...prev.bankDetails, ...patch } } : prev,
    );
  };

  const updateReminders = (patch: Partial<DocumentsConfig["reminders"]>) => {
    setCfg((prev) =>
      prev ? { ...prev, reminders: { ...prev.reminders, ...patch } } : prev,
    );
  };

  const updateLateFee = (
    patch: Partial<DocumentsConfig["reminders"]["lateFee"]>,
  ) => {
    setCfg((prev) =>
      prev
        ? {
            ...prev,
            reminders: {
              ...prev.reminders,
              lateFee: { ...prev.reminders.lateFee, ...patch },
            },
          }
        : prev,
    );
  };

  const preview = useMemo(() => {
    if (!cfg) return "";
    const start =
      cfg.numbering.prefix?.toLowerCase() === "quo"
        ? cfg.quotationNextNumber
        : cfg.invoiceNextNumber;
    return buildSequencePreview(cfg.numbering, start);
  }, [cfg]);

  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await saveDocumentsConfig(cfg, stationId);
      toastSuccess("Document settings saved");
    } catch (e) {
      toastError("Failed to save document settings");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded || !cfg) {
    return (
      <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Loading document settings…
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      <SectionCard title="Invoice & Quotation Numbering" icon={Hash}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Prefix">
            <input
              className={inputClass}
              value={cfg.numbering.prefix}
              onChange={(e) => updateNumbering({ prefix: e.target.value })}
              placeholder="INV"
              maxLength={8}
            />
          </Field>
          <Field label="Separator">
            <select
              className={inputClass}
              value={cfg.numbering.separator || "none"}
              onChange={(e) =>
                updateNumbering({
                  separator: (e.target.value === "none"
                    ? ""
                    : e.target.value) as InvoiceSeparator,
                })
              }
            >
              <option value="-">Dash (INV-0001)</option>
              <option value="_">Underscore (INV_0001)</option>
              <option value="/">Slash (INV/0001)</option>
              <option value=".">Period (INV.0001)</option>
              <option value="none">None (INV0001)</option>
            </select>
          </Field>
          <Field label="Padding">
            <select
              className={inputClass}
              value={cfg.numbering.padding}
              onChange={(e) =>
                updateNumbering({ padding: parseInt(e.target.value, 10) || 4 })
              }
            >
              <option value={3}>3 digits (001)</option>
              <option value={4}>4 digits (0001)</option>
              <option value={5}>5 digits (00001)</option>
              <option value={6}>6 digits (000001)</option>
            </select>
          </Field>
          <Field label="Include year in number">
            <select
              className={inputClass}
              value={cfg.numbering.year}
              onChange={(e) =>
                updateNumbering({
                  year: e.target.value as "none" | "before" | "after",
                })
              }
            >
              <option value="none">No (INV-0001)</option>
              <option value="before">Before number (INV-2026-0001)</option>
              <option value="after">After number (INV-0001-2026)</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Preview sequence: <span className="font-mono">{preview}</span>
        </div>
      </SectionCard>

      <SectionCard title="PDF Template" icon={FileText}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.keys(PDF_TEMPLATES) as PdfTemplate[]).map((key) => {
            const t = PDF_TEMPLATES[key];
            const active = cfg.invoiceTemplate === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => update({ invoiceTemplate: key })}
                className={`p-4 rounded-xl border-2 text-left transition-colors ${
                  active
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                }`}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t.description}
                </p>
                {active && (
                  <span className="inline-block mt-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    ✓ Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Invoice Defaults" icon={FileText}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Default payment terms">
            <select
              className={inputClass}
              value={cfg.defaultPaymentTerms}
              onChange={(e) => update({ defaultPaymentTerms: e.target.value })}
            >
              {PAYMENT_TERMS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Default customer notes">
          <textarea
            className={inputClass}
            rows={2}
            value={cfg.defaultCustomerNotes}
            onChange={(e) => update({ defaultCustomerNotes: e.target.value })}
            placeholder="e.g. Thank you for your business. Payment is due within 30 days."
          />
        </Field>
        <Field label="Default terms & conditions">
          <textarea
            className={inputClass}
            rows={2}
            value={cfg.defaultTermsConditions}
            onChange={(e) => update({ defaultTermsConditions: e.target.value })}
            placeholder="e.g. Payment is due within the agreed terms. All disputes must be raised within 7 days."
          />
        </Field>
      </SectionCard>

      <SectionCard title="Bank Payment Details" icon={Banknote}>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Shown under “Payment Details” on every invoice PDF, alongside the
          online payment link.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Bank Name">
            <input
              className={inputClass}
              value={cfg.bankDetails.bankName}
              onChange={(e) => updateBank({ bankName: e.target.value })}
            />
          </Field>
          <Field label="Account Name">
            <input
              className={inputClass}
              value={cfg.bankDetails.accountName}
              onChange={(e) => updateBank({ accountName: e.target.value })}
            />
          </Field>
          <Field label="Account Number">
            <input
              className={inputClass}
              value={cfg.bankDetails.accountNumber}
              onChange={(e) => updateBank({ accountNumber: e.target.value })}
            />
          </Field>
          <Field label="Branch">
            <input
              className={inputClass}
              value={cfg.bankDetails.branch}
              onChange={(e) => updateBank({ branch: e.target.value })}
            />
          </Field>
          <Field label="SWIFT / BIC">
            <input
              className={inputClass}
              value={cfg.bankDetails.swiftBic}
              onChange={(e) => updateBank({ swiftBic: e.target.value })}
              placeholder="e.g. KCBLKENX"
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Late Payment & Reminders" icon={BellRing}>
        <Toggle
          checked={cfg.reminders.enabled}
          onChange={(v) => updateReminders({ enabled: v })}
          label="Auto-send payment reminders"
          description="Notify customers when invoices become overdue. Requires Email Integration to be enabled."
        />
        {cfg.reminders.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <Field label="Reminder grace (days after due)">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={cfg.reminders.days}
                onChange={(e) =>
                  updateReminders({
                    days: parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </Field>
          </div>
        )}
        <Toggle
          checked={cfg.reminders.lateFee.enabled}
          onChange={(v) => updateLateFee({ enabled: v })}
          label="Apply late fee on overdue invoices"
          description="Adds a percentage-based fee to invoices that remain unpaid past a set number of days."
        />
        {cfg.reminders.lateFee.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <Field label="Late fee rate (%)">
              <input
                type="number"
                step="0.1"
                min={0}
                className={inputClass}
                value={cfg.reminders.lateFee.ratePct}
                onChange={(e) =>
                  updateLateFee({
                    ratePct: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </Field>
            <Field label="Apply after (days past due)">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={cfg.reminders.lateFee.afterDays}
                onChange={(e) =>
                  updateLateFee({
                    afterDays: parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </Field>
          </div>
        )}
      </SectionCard>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 min-h-[40px]"
          onClick={() => {
            setCfg(normalizeDocumentsConfig(cfg));
          }}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[40px]"
        >
          {saving ? "Saving…" : "Save document settings"}
        </button>
      </div>
    </div>
  );
}
