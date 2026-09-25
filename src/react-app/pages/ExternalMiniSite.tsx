import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Printer,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import {
  EXTERNAL_PORTAL_LABELS,
  externalMiniSiteShareLine,
  fetchExternalMiniSiteDoc,
  type ExternalMiniSiteDocument,
  type ExternalMiniSiteKind,
  type ExternalMiniSiteSection,
} from "@/react-app/lib/external-mini-site-service";
import { printElement } from "@/react-app/lib/unified-print";

function money(symbol: string, value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(value ?? "—");
}

function isMoneyLabel(label: string): boolean {
  return /amount|balance|limit|price|total|value|payment|spend|cost|rate|points/i.test(label);
}

function displayValue(symbol: string, label: string, value: unknown): string {
  return isMoneyLabel(label) ? money(symbol, value) : String(value ?? "—");
}

function portalTone(kind: ExternalMiniSiteKind) {
  switch (kind) {
    case "customer":
      return { gradient: "from-sky-600 via-cyan-600 to-indigo-700", soft: "bg-sky-50 dark:bg-sky-950/30", text: "text-sky-700 dark:text-sky-300" };
    case "fleet-customer":
    case "driver":
      return { gradient: "from-violet-600 via-indigo-600 to-fuchsia-700", soft: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-300" };
    case "supplier":
      return { gradient: "from-amber-500 via-orange-600 to-red-700", soft: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300" };
    case "invoice":
      return { gradient: "from-emerald-600 via-teal-600 to-cyan-700", soft: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300" };
    case "communication":
    case "support":
      return { gradient: "from-rose-600 via-pink-600 to-orange-600", soft: "bg-rose-50 dark:bg-rose-950/30", text: "text-rose-700 dark:text-rose-300" };
    case "loyalty":
      return { gradient: "from-fuchsia-600 via-purple-600 to-indigo-700", soft: "bg-fuchsia-50 dark:bg-fuchsia-950/30", text: "text-fuchsia-700 dark:text-fuchsia-300" };
    default:
      return { gradient: "from-slate-800 via-slate-700 to-sky-800", soft: "bg-slate-50 dark:bg-slate-900/50", text: "text-slate-700 dark:text-slate-300" };
  }
}

function portalSubtitle(kind: ExternalMiniSiteKind): string {
  switch (kind) {
    case "customer": return "Your account, invoices, statement and station payment information in one place.";
    case "fleet-customer": return "A focused view of fleet controls, vehicle activity and fuel usage.";
    case "driver": return "A simple mobile workspace for vehicle, card and fuel activity.";
    case "supplier": return "Shared supplier account information, purchase orders and delivery history.";
    case "invoice": return "Review the invoice, line items and the station's payment channels.";
    case "communication": return "Keep contact details and the latest station communication within reach.";
    case "support": return "Track the shared support case and contact the station directly.";
    case "loyalty": return "Your points, tier and loyalty activity, presented clearly.";
    case "service": return "Explore station services, operating hours and contact details.";
    default: return "A secure FuelPro external workspace.";
  }
}

function flattenSectionText(section: ExternalMiniSiteSection): string {
  const rows = (section.rows || []).map((row) => `${row.label} ${String(row.value ?? "")}`).join(" ");
  const table = (section.data || []).flat().map((cell) => String(cell ?? "")).join(" ");
  return `${section.title} ${rows} ${table}`.toLowerCase();
}

function getSectionCount(section: ExternalMiniSiteSection): number {
  if (section.data?.length) return section.data.length;
  if (section.rows?.length) return section.rows.length;
  return 0;
}

function getStatusTone(value: string) {
  const lower = value.toLowerCase();
  if (/paid|resolved|active|approved|complete|success/.test(lower)) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (/pending|open|processing|issued|unpaid|awaiting/.test(lower)) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (/failed|cancelled|revoked|expired|overdue|rejected|blocked/.test(lower)) return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

export default function ExternalMiniSite() {
  const { token = "" } = useParams();
  const [doc, setDoc] = useState<ExternalMiniSiteDocument | null>(null);
  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const printSurface = useRef<HTMLElement | null>(null);

  const load = async () => {
    setRefreshing(true);
    const value = await fetchExternalMiniSiteDoc(token);
    setDoc(value);
    setStatus(value ? "ready" : "missing");
    setRefreshing(false);
  };

  useEffect(() => { void load(); }, [token]);

  useEffect(() => {
    const meta = document.head.querySelector('meta[name="robots"]') || document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    if (!meta.parentElement) document.head.appendChild(meta);
    document.title = doc ? `${doc.title} — ${doc.entityName}` : "FuelPro Portal";
  }, [doc]);

  const tone = useMemo(() => portalTone(doc?.kind || "service"), [doc?.kind]);
  const filteredSections = useMemo(() => {
    if (!doc) return [];
    const q = query.trim().toLowerCase();
    return q ? doc.sections.filter((section) => flattenSectionText(section).includes(q)) : doc.sections;
  }, [doc, query]);
  const totalRecords = useMemo(() => (doc?.sections || []).reduce((sum, section) => sum + getSectionCount(section), 0), [doc]);

  const expiresAt = doc ? new Date(doc.expiresAt) : new Date();
  const asAt = doc ? new Date(doc.asAt) : new Date();
  const expiresInHours = doc ? Math.max(0, (expiresAt.getTime() - Date.now()) / 3600000) : 0;
  const expiryLabel = expiresInHours < 24 ? `${Math.max(1, Math.ceil(expiresInHours))}h left` : `${Math.ceil(expiresInHours / 24)}d left`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(externalMiniSiteUrlSafe(doc?.token || token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const share = async () => {
    if (!doc) return;
    const url = externalMiniSiteUrlSafe(doc.token);
    try {
      if (navigator.share) await navigator.share({ title: doc.title, text: `Open your ${doc.title}`, url });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {}
  };

  const toggleSection = (key: string) => setOpenSections((current) => ({ ...current, [key]: current[key] === false }));
  const openAll = () => doc && setOpenSections(Object.fromEntries(doc.sections.map((section) => [section.key, true])));
  const closeAll = () => doc && setOpenSections(Object.fromEntries(doc.sections.map((section) => [section.key, false])));

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /><div><p className="text-sm font-semibold dark:text-white">Opening secure FuelPro portal</p><p className="text-xs text-slate-500">Loading the latest shared records…</p></div></div></div>;
  }

  if (status === "missing" || !doc) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 dark:bg-slate-950"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"><AlertTriangle className="h-7 w-7 text-amber-600" /></div><h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">This FuelPro portal is not available</h1><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">The link may have expired or been revoked. Ask the station to issue a new secure link.</p><button onClick={() => window.history.back()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">Go back</button></div></div>;
  }

  const shareLine = externalMiniSiteShareLine(doc.token, `Open your ${doc.title}:`);
  const statusLabel = expiresInHours > 0 ? "Secure link active" : "Link expired";

  return (
    <main ref={printSurface} className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className={`bg-gradient-to-br ${tone.gradient} text-white`}>
        <div className="mx-auto max-w-6xl px-4 pb-7 pt-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-white/85">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur"><Sparkles className="h-4 w-4" /></div>
              <span>FUELPRO</span><span className="text-white/40">/</span><span>{EXTERNAL_PORTAL_LABELS[doc.kind]}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={share} className="inline-flex items-center gap-1.5 rounded-xl bg-white/12 px-3 py-2 text-xs font-semibold ring-1 ring-white/20 backdrop-blur hover:bg-white/20"><Share2 className="h-3.5 w-3.5" />{shared ? "Shared" : "Share"}</button>
              <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl bg-white/12 px-3 py-2 text-xs font-semibold ring-1 ring-white/20 backdrop-blur hover:bg-white/20"><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>

          <div className="mt-7 grid gap-6 lg:grid-cols-[1.6fr_0.8fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-[11px] font-semibold ring-1 ring-white/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />{statusLabel}</div>
              <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">{doc.entityName}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">{doc.subtitle || portalSubtitle(doc.kind)}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-white/75">
                <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Updated {asAt.toLocaleString()}</span>
                <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" /><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {expiryLabel}</span>
                {doc.stationName && <><span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" /><span>{doc.stationName}</span></>}
              </div>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
              <div className="flex items-center justify-between"><div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Portal access</p><p className="mt-1 text-lg font-bold">Private & shareable</p></div><ShieldCheck className="h-7 w-7 text-emerald-200" /></div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.min(100, Math.max(8, (expiresInHours / (24 * 30)) * 100))}%` }} /></div>
              <p className="mt-2 text-[11px] leading-5 text-white/60">This page is no-indexed and does not write directly to the payment or accounting ledger.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="-mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [CheckCircle2, "Access", statusLabel, "text-emerald-500"],
            [FileText, "Shared sections", String(doc.sections.length), tone.text],
            [Banknote, "Records", totalRecords.toLocaleString(), "text-amber-500"],
            [WalletCards, "Payment channels", String(doc.paymentMethods.length), "text-violet-500"],
          ].map(([Icon, label, value, iconClass], i) => {
            const IconComponent = Icon as typeof CheckCircle2;
            return <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><IconComponent className={`h-4 w-4 ${iconClass as string}`} /><p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label as string}</p><p className="mt-1 text-sm font-bold">{value as string}</p></div>;
          })}
        </div>

        <div className="sticky top-0 z-20 mt-5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this portal…" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm outline-none transition focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-800" />
              {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={openAll} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Expand all</button>
              <button onClick={closeAll} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Collapse all</button>
              <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh</button>
            </div>
          </div>
        </div>

        {query && <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Showing {filteredSections.length} of {doc.sections.length} sections matching <span className="font-semibold text-slate-800 dark:text-slate-200">“{query}”</span>.</div>}

        <div className="mt-5 space-y-4">
          {filteredSections.map((section) => {
            const expanded = openSections[section.key] !== false;
            const recordCount = getSectionCount(section);
            return <section id={`portal-section-${section.key}`} key={section.key} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => toggleSection(section.key)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6">
                <div className="flex min-w-0 items-start gap-3"><div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.soft}`}><FileText className={`h-4 w-4 ${tone.text}`} /></div><div className="min-w-0"><h2 className="truncate text-sm font-bold sm:text-base">{section.title}</h2><p className="mt-0.5 text-xs text-slate-400">{recordCount ? `${recordCount} ${recordCount === 1 ? "record" : "records"} shared` : "Information shared by the station"}</p></div></div>
                <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && <div className="border-t border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-6">
                {section.rows?.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{section.rows.map((row, i) => { const value = String(row.value ?? "—"); const statusValue = /status/i.test(row.label); return <div key={`${row.label}-${i}`} className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-800/55"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{row.label}</p>{statusValue ? <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusTone(value)}`}>{value}</span> : <p className="mt-1.5 break-words text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{displayValue(doc.currencySymbol, row.label, row.value)}</p>}</div>; })}</div>
                  : section.data?.length ? <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800"><table className="min-w-full text-xs"><thead className="bg-slate-50 dark:bg-slate-800"><tr>{(section.columns || []).map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{column}</th>)}</tr></thead><tbody>{section.data.map((row, i) => <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60 dark:border-slate-800 dark:odd:bg-slate-900 dark:even:bg-slate-800/40">{row.map((cell, j) => { const column = section.columns?.[j] || ""; const value = String(cell ?? "—"); return <td key={j} className="whitespace-nowrap px-4 py-3 align-top text-slate-700 dark:text-slate-200">{/status|state/i.test(column) ? <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${getStatusTone(value)}`}>{value}</span> : isMoneyLabel(column) ? money(doc.currencySymbol, cell) : value}</td>; })}</tr>)}</tbody></table></div>
                  : <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-8 text-center dark:border-slate-800"><FileText className="mx-auto h-5 w-5 text-slate-300" /><p className="mt-2 text-sm font-medium text-slate-500">No records shared for this section.</p></div>}
              </div>}
            </section>;
          })}

          {filteredSections.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900"><Search className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-sm font-semibold">No matching portal information</p><button onClick={() => setQuery("")} className="mt-3 text-xs font-semibold text-sky-600">Clear search</button></div>}
        </div>

        {(doc.paymentInstructions || doc.paymentMethods.length || doc.stationPhone || doc.stationEmail) && <section className="mt-5 overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50/70 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-5 py-5 text-white sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/75"><CreditCard className="h-4 w-4" />Payments & station help</div><h2 className="mt-2 text-xl font-black">Choose how you want to connect</h2><p className="mt-1 max-w-2xl text-sm text-white/75">Use the configured payment channel or contact the station. Payment status is reconciled by FuelPro; this portal does not mark payments as paid.</p></div><div className="rounded-2xl bg-white/10 px-3 py-2 text-right ring-1 ring-white/15"><p className="text-[10px] uppercase tracking-wide text-white/60">Currency</p><p className="mt-0.5 text-sm font-bold">{doc.currencySymbol || "Station configured"}</p></div></div></div>
          <div className="space-y-5 p-5 sm:p-6">
            {doc.paymentInstructions && <div className="rounded-2xl border border-emerald-200 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-emerald-900/50 dark:bg-slate-900/60 dark:text-slate-200"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Station instructions</p><p className="whitespace-pre-line">{doc.paymentInstructions}</p></div>}
            {doc.paymentMethods.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{doc.paymentMethods.map((method) => <div key={`${method.kind}-${method.number}`} className="rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900/50 dark:bg-slate-900"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{method.label}</p><div className="mt-2 flex items-center justify-between gap-3"><p className="font-mono text-base font-bold tracking-wide">{method.number}</p><button onClick={async () => { try { await navigator.clipboard.writeText(method.number); } catch {} }} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" aria-label={`Copy ${method.label}`}><Copy className="h-3.5 w-3.5" /></button></div>{method.accountRef && <p className="mt-1 text-xs text-slate-500">Account: {method.accountRef}</p>}</div>)}</div>}
            <div className="flex flex-wrap gap-2">
              {doc.stationPhone && <a href={`tel:${doc.stationPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"><Phone className="h-3.5 w-3.5" /> Call station</a>}
              {doc.stationEmail && <a href={`mailto:${doc.stationEmail}?subject=${encodeURIComponent(doc.title + " query")}`} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-slate-900 dark:text-slate-200"><Mail className="h-3.5 w-3.5" /> Email</a>}
              {doc.stationPhone && <a href={`https://wa.me/${doc.stationPhone.replace(/\D/g, "")}?text=${encodeURIComponent(shareLine)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-slate-900 dark:text-slate-200"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>}
            </div>
          </div>
        </section>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><ShieldCheck className="h-4 w-4 text-emerald-500" />Secure shared view · Link expires {expiresAt.toLocaleString()}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={share} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Share2 className="h-3.5 w-3.5" /> {shared ? "Shared" : "Share portal"}</button>
            <button onClick={() => void printElement(printSurface.current || document.body, { title: doc.title })} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"><Printer className="h-3.5 w-3.5" /> Print / Save PDF</button>
            {(doc.stationPhone || doc.stationEmail) && <a href={doc.stationPhone ? `https://wa.me/${doc.stationPhone.replace(/\D/g, "")}?text=${encodeURIComponent(shareLine)}` : `mailto:${doc.stationEmail || ""}?subject=${encodeURIComponent(doc.title + " query")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><ArrowUpRight className="h-3.5 w-3.5" /> Contact station</a>}
          </div>
        </div>

        <footer className="flex flex-col gap-2 px-1 py-5 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>FuelPro secure external portal</span><span>Shared records are read-only from this page.</span></footer>
      </div>
    </main>
  );
}

function externalMiniSiteUrlSafe(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/${token}`;
}
