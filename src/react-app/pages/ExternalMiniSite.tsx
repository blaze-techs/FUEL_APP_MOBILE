import { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Printer,
  WalletCards,
} from "lucide-react";
import {
  externalMiniSiteShareLine,
  fetchExternalMiniSiteDoc,
  type ExternalMiniSiteDocument,
} from "@/react-app/lib/external-mini-site-service";
import { printElement } from "@/react-app/lib/unified-print";

function money(symbol: string, value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(value ?? "—");
}

function isMoneyLabel(label: string): boolean {
  return /amount|balance|limit|price|total|value|payment|spend|cost/i.test(label);
}

export default function ExternalMiniSite() {
  const { token = "" } = useParams();
  const [doc, setDoc] = useState<ExternalMiniSiteDocument | null>(null);
  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchExternalMiniSiteDoc(token).then((value) => {
      if (cancelled) return;
      setDoc(value);
      setStatus(value ? "ready" : "missing");
    });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const meta = document.head.querySelector('meta[name="robots"]') || document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    if (!meta.parentElement) document.head.appendChild(meta);
    document.title = doc ? `${doc.title} — ${doc.entityName}` : "FuelPro Portal";
  }, [doc]);

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>;
  }

  if (status === "missing" || !doc) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6"><div className="max-w-md text-center"><AlertTriangle className="mx-auto w-8 h-8 text-amber-500" /><h1 className="mt-3 text-lg font-semibold dark:text-white">This FuelPro portal is not available</h1><p className="mt-2 text-sm text-gray-500 dark:text-gray-400">The link may have expired or been revoked. Ask the station to issue a new link.</p></div></div>;
  }

  const shareLine = externalMiniSiteShareLine(doc.token, `Open your ${doc.title}:`);
  const surface = document.querySelector("main") as HTMLElement | null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(externalMiniSiteUrlSafe(doc.token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 space-y-4">
        <header className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-500">{doc.title}</p>
              <h1 className="mt-1 text-2xl font-bold truncate">{doc.entityName}</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{doc.stationName || "FuelPro station"}</p>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500"><CalendarClock className="w-3.5 h-3.5" /> As at {new Date(doc.asAt).toLocaleString()} · Link expires {new Date(doc.expiresAt).toLocaleString()}</p>
            </div>
            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium"><Copy className="w-3.5 h-3.5" />{copied ? "Copied" : "Copy link"}</button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"><CheckCircle2 className="w-4 h-4 text-emerald-500" /><p className="mt-2 text-xs text-gray-500">Portal</p><p className="mt-1 text-sm font-semibold">{doc.title}</p></div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"><FileText className="w-4 h-4 text-sky-500" /><p className="mt-2 text-xs text-gray-500">Sections</p><p className="mt-1 text-sm font-semibold">{doc.sections.length}</p></div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"><CreditCard className="w-4 h-4 text-amber-500" /><p className="mt-2 text-xs text-gray-500">Payment channels</p><p className="mt-1 text-sm font-semibold">{doc.paymentMethods.length}</p></div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"><WalletCards className="w-4 h-4 text-violet-500" /><p className="mt-2 text-xs text-gray-500">Currency</p><p className="mt-1 text-sm font-semibold">{doc.currencySymbol || "Configured by station"}</p></div>
        </div>

        {doc.sections.map((section) => (
          <section key={section.key} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800"><h2 className="text-sm font-semibold">{section.title}</h2></div>
            <div className="p-5">
              {section.rows?.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {section.rows.map((row, i) => <div key={`${row.label}-${i}`} className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2"><p className="text-[11px] text-gray-500">{row.label}</p><p className="mt-0.5 text-sm font-semibold">{isMoneyLabel(row.label) ? money(doc.currencySymbol, row.value) : String(row.value ?? "—")}</p></div>)}
                </div>
              ) : section.data?.length ? (
                <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead><tr>{(section.columns || []).map((column) => <th key={column} className="px-3 py-2 text-left uppercase tracking-wide text-[10px] text-gray-400">{column}</th>)}</tr></thead><tbody>{section.data.map((row, i) => <tr key={i} className="border-t border-gray-100 dark:border-gray-800">{row.map((cell,j) => <td key={j} className="px-3 py-2">{String(cell ?? "—")}</td>)}</tr>)}</tbody></table></div>
              ) : <p className="text-sm text-gray-500">No records shared for this section.</p>}
            </div>
          </section>
        ))}

        {(doc.paymentInstructions || doc.paymentMethods.length || doc.stationPhone || doc.stationEmail) && (
          <section className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-900/10 p-5 space-y-3">
            <div className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-600" /><h2 className="text-sm font-semibold">Payments & station contact</h2></div>
            {doc.paymentInstructions && <p className="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">{doc.paymentInstructions}</p>}
            {doc.paymentMethods.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{doc.paymentMethods.map((m) => <div key={`${m.kind}-${m.number}`} className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-white/70 dark:bg-black/10 px-3 py-2"><p className="text-xs text-gray-500">{m.label}</p><p className="font-mono text-sm font-semibold">{m.number}</p>{m.accountRef && <p className="text-xs text-gray-500">Account: {m.accountRef}</p>}</div>)}</div>}
            <div className="flex flex-wrap gap-2">
              {doc.stationPhone && <a href={`tel:${doc.stationPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><Phone className="w-3.5 h-3.5" /> Call station</a>}
              {doc.stationEmail && <a href={`mailto:${doc.stationEmail}?subject=${encodeURIComponent(doc.title + " query")}`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-medium"><Mail className="w-3.5 h-3.5" /> Email station</a>}
              {doc.stationPhone && <a href={`https://wa.me/${doc.stationPhone.replace(/\D/g, "")}?text=${encodeURIComponent(shareLine)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-medium"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>}
            </div>
            <p className="text-[11px] text-gray-500">Payment status is not changed by this page. Payments must enter FuelPro through the station's configured reconciliation flow.</p>
          </section>
        )}

        <div className="flex justify-end">
          <button onClick={() => void printElement(surface || document.body, { title: doc.title })} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium"><Printer className="w-3.5 h-3.5" /> Print portal</button>
        </div>
      </div>
    </div>
  );
}

function externalMiniSiteUrlSafe(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/${token}`;
}
