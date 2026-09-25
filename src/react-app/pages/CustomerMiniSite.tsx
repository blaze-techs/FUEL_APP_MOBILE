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
  Download,
  FileText,
  Files,
  Loader2,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Printer,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  CUSTOMER_MINI_SITE_FILE_CATEGORIES,
  CUSTOMER_MINI_SITE_MAX_FILE_BYTES,
  customerMiniSiteShareLine,
  fetchExternalMiniSiteDoc,
  listCustomerMiniSiteFiles,
  uploadCustomerMiniSiteFile,
  requestCustomerMiniSitePayment,
  type CustomerMiniSiteFile,
  type CustomerMiniSiteFileCategory,
  type ExternalMiniSiteDocument,
  type ExternalMiniSiteSection,
} from "@/react-app/lib/external-mini-site-service";
import { printElement } from "@/react-app/lib/unified-print";

function money(symbol: string, value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(value ?? "—");
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function csv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function saveCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob([rows.map((row) => row.map(csv).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function statusClass(value: string): string {
  const v = value.toLowerCase();
  if (/paid|resolved|active|approved|complete|success/.test(v)) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (/pending|open|processing|issued|unpaid|awaiting/.test(v)) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (/failed|cancelled|expired|overdue|rejected|blocked/.test(v)) return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function sectionText(section: ExternalMiniSiteSection): string {
  return [
    section.title,
    ...(section.rows || []).flatMap((row) => [row.label, String(row.value ?? "")]),
    ...(section.data || []).flat(),
  ].join(" ").toLowerCase();
}

export default function CustomerMiniSite() {
  const { token = "" } = useParams();
  const [doc, setDoc] = useState<ExternalMiniSiteDocument | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [files, setFiles] = useState<CustomerMiniSiteFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileFilter, setFileFilter] = useState<"All" | CustomerMiniSiteFileCategory>("All");
  const [fileCategory, setFileCategory] = useState<CustomerMiniSiteFileCategory>("Other");
  const [fileDescription, setFileDescription] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const printRef = useRef<HTMLElement | null>(null);

  const load = async () => {
    setRefreshing(true);
    const next = await fetchExternalMiniSiteDoc(token);
    setDoc(next);
    setState(next?.kind === "customer" ? "ready" : "missing");
    setRefreshing(false);
  };

  const loadFiles = async () => {
    if (!doc || doc.kind !== "customer") return;
    setFilesLoading(true);
    try { setFiles(await listCustomerMiniSiteFiles(doc.token)); }
    finally { setFilesLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);
  useEffect(() => {
    if (doc?.kind === "customer") {
      void loadFiles();
      if (doc.customerPhone) setPaymentPhone(doc.customerPhone);
    }
  }, [doc]);

  useEffect(() => {
    const meta = document.head.querySelector('meta[name="robots"]') || document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    if (!meta.parentElement) document.head.appendChild(meta);
    document.title = doc ? `${doc.entityName} — Customer Site · ${doc.stationName || "FuelPro"}` : "Customer Site · FuelPro";
    return () => { meta.setAttribute("content", "noindex, nofollow"); };
  }, [doc]);

  const balance = useMemo(() => {
    const row = doc?.sections.flatMap((section) => section.rows || []).find((item) => /^balance$/i.test(item.label));
    return Number(row?.value) || 0;
  }, [doc]);

  const statement = useMemo(
    () => doc?.sections.find((section) => /statement|activity/i.test(section.title) && section.data?.length),
    [doc],
  );
  const invoices = useMemo(
    () => doc?.sections.find((section) => /invoice/i.test(section.title) && section.data?.length),
    [doc],
  );

  const filteredSections = useMemo(() => {
    if (!doc) return [];
    const q = query.trim().toLowerCase();
    return q ? doc.sections.filter((section) => sectionText(section).includes(q)) : doc.sections;
  }, [doc, query]);

  const filteredFiles = useMemo(
    () => fileFilter === "All" ? files : files.filter((file) => file.category === fileFilter),
    [files, fileFilter],
  );

  const updated = doc ? new Date(doc.asAt) : new Date();
  const expiry = doc ? new Date(doc.expiresAt) : new Date();
  const hours = doc ? Math.max(0, (expiry.getTime() - Date.now()) / 3600000) : 0;
  const expiryText = hours < 24 ? `${Math.max(1, Math.ceil(hours))}h left` : `${Math.ceil(hours / 24)}d left`;

  const exportSection = (section: ExternalMiniSiteSection | undefined, filename: string) => {
    if (!section?.data?.length) return;
    saveCsv(filename, [section.columns || [], ...section.data]);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: doc?.entityName || "FuelPro customer site",
          text: customerMiniSiteShareLine(token),
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
      }
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {}
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!doc || doc.kind !== "customer" || !list?.length) return;
    setFilesLoading(true);
    setUploadMessage("");
    let success = 0;
    for (const file of Array.from(list).slice(0, 10)) {
      if (file.size < 1 || file.size > CUSTOMER_MINI_SITE_MAX_FILE_BYTES) {
        setUploadMessage(`Skipped ${file.name}: maximum size is ${fileSize(CUSTOMER_MINI_SITE_MAX_FILE_BYTES)}.`);
        continue;
      }
      const saved = await uploadCustomerMiniSiteFile(doc.token, file, {
        category: fileCategory,
        description: fileDescription.trim() || undefined,
      });
      if (saved) {
        setFiles((current) => [saved, ...current]);
        success++;
      } else {
        setUploadMessage(`Could not upload ${file.name}. Check file type, size and connection.`);
      }
    }
    setFileDescription("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (success) setUploadMessage(`${success} document${success === 1 ? "" : "s"} uploaded and tied to this station/customer workspace.`);
    setFilesLoading(false);
  };

  const pay = async () => {
    if (!doc || doc.kind !== "customer") return;
    setPaymentBusy(true);
    setPaymentMessage("");
    const result = await requestCustomerMiniSitePayment(doc.token, {
      amount: Number(paymentAmount || (balance > 0 ? Math.round(balance) : 1)),
      phoneNumber: paymentPhone || doc.customerPhone || "",
    });
    setPaymentMessage(
      result
        ? `M-PESA request sent. Reference: ${result.checkoutRequestId || result.transactionId}. Complete the prompt; FuelPro will reconcile the final result.`
        : "Online M-PESA payment is unavailable for this station/link. Use the configured payment instructions or contact the station.",
    );
    setPaymentBusy(false);
  };

  const openFile = (url?: string) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><div className="rounded-3xl border border-white/10 bg-white/5 px-8 py-7 text-center backdrop-blur-xl"><Loader2 className="mx-auto h-6 w-6 animate-spin text-sky-300" /><p className="mt-3 text-sm font-bold">Opening customer workspace…</p><p className="mt-1 text-xs text-white/50">Loading station-linked records</p></div></div>;
  }

  if (state === "missing" || !doc || doc.kind !== "customer") {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6 text-white"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15"><AlertTriangle className="h-7 w-7 text-amber-300" /></div><h1 className="mt-5 text-xl font-black">Customer site unavailable</h1><p className="mt-2 text-sm leading-6 text-white/60">This customer/organization link may have expired, been revoked, or be intended for another portal type.</p></div></div>;
  }

  return (
    <main ref={printRef} className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="bg-gradient-to-br from-sky-700 via-cyan-700 to-indigo-800 text-white">
        <div className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-white/80"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20"><Sparkles className="h-4 w-4" /></div><span>FUELPRO</span><span className="text-white/35">/</span><span>Customer & Organization Site</span></div>
            <div className="flex gap-2"><button onClick={share} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20 hover:bg-white/20"><Share2 className="h-3.5 w-3.5" />{shared ? "Shared" : "Share"}</button><button onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20 hover:bg-white/20"><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}</button></div>
          </div>
          <div className="mt-7 grid gap-6 lg:grid-cols-[1.55fr_0.85fr] lg:items-end">
            <div><div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold ring-1 ring-white/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Secure station-linked access</div><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">{doc.entityName}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">Your dedicated workspace for invoices, statements, station records, documents, payments and communication with {doc.stationName || "your station"}.</p><div className="mt-5 flex flex-wrap gap-3 text-xs text-white/70"><span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Updated {updated.toLocaleString()}</span><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Link {expiryText}</span></div></div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.15em] text-white/55">Station connection</p><p className="mt-1 text-lg font-bold">{doc.stationName || "FuelPro station"}</p></div><ShieldCheck className="h-7 w-7 text-emerald-200" /></div><p className="mt-3 text-[11px] leading-5 text-white/60">Read-only station records are shared through the customer link. Uploaded customer files are stored in a separate private customer area.</p></div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="-mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
          [CheckCircle2, "Access", "Active", "text-emerald-500"],
          [Banknote, "Outstanding", money(doc.currencySymbol,balance), "text-sky-500"],
          [Files, "Documents", String(files.length), "text-violet-500"],
          [WalletCards, "Payment routes", String(doc.paymentMethods.length), "text-amber-500"],
        ].map(([Icon,label,value,iconClass],i)=>{const I=Icon as typeof CheckCircle2;return <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><I className={`h-4 w-4 ${iconClass as string}`} /><p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">{label as string}</p><p className="mt-1 text-sm font-black">{value as string}</p></div>})}</div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="#records" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm hover:shadow-md dark:border-sky-900/60 dark:bg-sky-950/20"><WalletCards className="h-5 w-5 text-sky-600" /><p className="mt-2 text-sm font-black">Account & records</p><p className="mt-1 text-xs text-slate-500">Statement, invoices and account data</p></a>
          <a href="#documents" className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm hover:shadow-md dark:border-violet-900/60 dark:bg-violet-950/20"><Files className="h-5 w-5 text-violet-600" /><p className="mt-2 text-sm font-black">Document centre</p><p className="mt-1 text-xs text-slate-500">Upload, view, download and print</p></a>
          <a href="#payments" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm hover:shadow-md dark:border-emerald-900/60 dark:bg-emerald-950/20"><CreditCard className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-sm font-black">Make payment</p><p className="mt-1 text-xs text-slate-500">Use the configured station route</p></a>
          <a href="#contact" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm hover:shadow-md dark:border-amber-900/60 dark:bg-amber-950/20"><MessageCircle className="h-5 w-5 text-amber-600" /><p className="mt-2 text-sm font-black">Contact station</p><p className="mt-1 text-xs text-slate-500">Questions, support and requests</p></a>
        </div>

        <section id="records" className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Account records</p><h2 className="mt-1 text-xl font-black">Your information from this station</h2><p className="mt-1 text-sm text-slate-500">The sections below are generated from the station/customer records attached to this secure link.</p></div><div className="text-right"><p className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding balance</p><p className="mt-1 text-2xl font-black">{money(doc.currencySymbol,balance)}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2">{statement && <button onClick={() => exportSection(statement,"customer-statement.csv")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><Download className="h-3.5 w-3.5" /> Download statement</button>}{invoices && <button onClick={() => exportSection(invoices,"customer-invoices.csv")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><Download className="h-3.5 w-3.5" /> Download invoices</button>}<button onClick={() => void printElement(printRef.current || document.body,{title:`${doc.entityName} Customer Workspace`})} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"><Printer className="h-3.5 w-3.5" /> Print workspace</button></div>
        </section>

        <div className="sticky top-0 z-30 mt-5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search all account records…" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm dark:border-slate-700 dark:bg-slate-800" />{query && <button onClick={()=>setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400" aria-label="Clear search"><X className="h-3.5 w-3.5"/></button>}</div><div className="flex gap-2"><button onClick={()=>setSectionsOpen(Object.fromEntries(doc.sections.map(s=>[s.key,true])))} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700">Expand all</button><button onClick={()=>setSectionsOpen(Object.fromEntries(doc.sections.map(s=>[s.key,false])))} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700">Collapse</button><button onClick={()=>void load()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}/>Refresh</button></div></div></div>

        <section id="documents" className="mt-5 overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-sm dark:border-violet-900/60 dark:bg-slate-900">
          <div className="bg-gradient-to-r from-violet-700 to-indigo-700 px-5 py-5 text-white sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Private document centre</p><h2 className="mt-1 text-xl font-black">Upload, view, print & download</h2><p className="mt-1 text-sm text-white/75">Exchange supporting documents with the station without putting them in the public station file area.</p></div><Files className="h-8 w-8 text-white/70"/></div></div>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-4 dark:border-violet-800 dark:bg-violet-950/20"><div className="flex flex-wrap items-center gap-3"><Upload className="h-5 w-5 text-violet-600"/><div><p className="text-sm font-black">Add documents to this customer workspace</p><p className="text-xs text-slate-500">Up to 10 files at a time · max {fileSize(CUSTOMER_MINI_SITE_MAX_FILE_BYTES)} each</p></div><label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-800"><Paperclip className="h-3.5 w-3.5"/>Choose files<input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.csv,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx" className="hidden" onChange={(e)=>void uploadFiles(e.target.files)}/></label></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><select value={fileCategory} onChange={(e)=>setFileCategory(e.target.value as CustomerMiniSiteFileCategory)} className="h-10 rounded-xl border border-violet-200 bg-white px-3 text-sm dark:border-violet-800 dark:bg-slate-900">{CUSTOMER_MINI_SITE_FILE_CATEGORIES.map((category)=><option key={category}>{category}</option>)}</select><input value={fileDescription} onChange={(e)=>setFileDescription(e.target.value)} placeholder="Optional file description" className="h-10 rounded-xl border border-violet-200 bg-white px-3 text-sm dark:border-violet-800 dark:bg-slate-900"/></div>{uploadMessage && <p className="mt-2 text-xs font-bold text-violet-700 dark:text-violet-300">{uploadMessage}</p>}</div>

            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2 overflow-x-auto"><button onClick={()=>setFileFilter("All")} className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${fileFilter==="All" ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>All ({files.length})</button>{CUSTOMER_MINI_SITE_FILE_CATEGORIES.map((category)=><button key={category} onClick={()=>setFileFilter(category)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold ${fileFilter===category ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>{category}</button>)}</div><button onClick={()=>void loadFiles()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><RefreshCw className={`h-3.5 w-3.5 ${filesLoading ? "animate-spin" : ""}`}/>Refresh files</button></div>

            {filesLoading && files.length===0 ? <div className="py-10 text-center text-sm text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin"/><p className="mt-2">Loading documents…</p></div> : filteredFiles.length===0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-10 text-center dark:border-slate-800"><Files className="mx-auto h-7 w-7 text-slate-300"/><p className="mt-3 text-sm font-black">No documents in this view</p><p className="mt-1 text-xs text-slate-500">Upload supporting records or ask the station to attach a station-shared document.</p></div> : <div className="grid gap-3 md:grid-cols-2">{filteredFiles.map((file)=><article key={file.id} className="rounded-2xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800"><div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/30"><FileText className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{file.name}</p><p className="mt-1 text-xs text-slate-500">{file.category} · {fileSize(file.size)} · {new Date(file.uploadedAt).toLocaleString()} · {file.source === "station" ? "Station shared" : "Customer upload"}</p>{file.description && <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{file.description}</p>}</div></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>openFile(file.viewUrl)} disabled={!file.viewUrl} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><FileText className="h-3.5 w-3.5"/>View</button><a href={file.downloadUrl || "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><Download className="h-3.5 w-3.5"/>Download</a><button onClick={()=>openFile(file.viewUrl)} disabled={!file.viewUrl} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"><Printer className="h-3.5 w-3.5"/>Print / view</button></div></article>)}</div>}
          </div>
        </section>

        <section id="payments" className="mt-5 overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50/70 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-5 py-5 text-white sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Payments</p><h2 className="mt-1 text-xl font-black">Make a payment to this station</h2><p className="mt-1 text-sm text-white/75">The request enters the existing FuelPro payment reconciliation path. The portal never changes an invoice to Paid itself.</p></div>
          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900/50 dark:bg-slate-900"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-500">Amount<input type="number" min={1} max={500000} value={paymentAmount || (balance > 0 ? String(Math.min(500000,Math.round(balance))) : "1")} onChange={(e)=>setPaymentAmount(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-black dark:border-slate-700 dark:bg-slate-800"/></label><label className="text-xs font-bold text-slate-500">M-PESA phone<input inputMode="tel" value={paymentPhone || doc.customerPhone || ""} onChange={(e)=>setPaymentPhone(e.target.value)} placeholder="07xx xxx xxx" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"/></label></div><button onClick={()=>void pay()} disabled={paymentBusy || !(paymentPhone || doc.customerPhone)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{paymentBusy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}{paymentBusy ? "Sending request…" : "Send M-PESA STK Push"}</button>{paymentMessage && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-xs font-semibold leading-5 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">{paymentMessage}</p>}</div>
            <div className="space-y-3">{doc.paymentMethods.map((method)=><div key={`${method.kind}-${method.number}`} className="rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900/50 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{method.label}</p><p className="mt-1 font-mono text-base font-black">{method.number}</p></div><button onClick={async()=>{try{await navigator.clipboard.writeText(method.number)}catch{}}} className="rounded-xl border border-slate-200 p-2 text-slate-500 dark:border-slate-700" aria-label={`Copy ${method.label}`}><Copy className="h-3.5 w-3.5"/></button></div>{method.accountRef && <p className="mt-1 text-xs text-slate-500">Account: {method.accountRef}</p>}</div>)}{doc.paymentInstructions && <div className="rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900/50 dark:bg-slate-900"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Station instructions</p><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{doc.paymentInstructions}</p></div>}</div>
          </div>
        </section>

        <div className="mt-5 space-y-4">
          {filteredSections.map((section) => {
            const isOpen = sectionsOpen[section.key] !== false;
            const count = section.data?.length || section.rows?.length || 0;
            return <section key={section.key} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><button onClick={()=>setSectionsOpen((current)=>({...current,[section.key]:!isOpen}))} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800"><FileText className="h-4 w-4 text-sky-600"/></div><div className="min-w-0"><h2 className="truncate text-sm font-black sm:text-base">{section.title}</h2><p className="text-xs text-slate-400">{count ? `${count} records shared` : "Station-shared information"}</p></div></div><ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}/></button>{isOpen && <div className="border-t border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-6">{section.rows?.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{section.rows.map((row,i)=><div key={`${row.label}-${i}`} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{row.label}</p>{/status/i.test(row.label) ? <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(String(row.value ?? "—"))}`}>{String(row.value ?? "—")}</span> : <p className="mt-1.5 break-words text-sm font-semibold">{/amount|balance|limit|price|total|value|payment|spend|cost|rate/i.test(row.label) ? money(doc.currencySymbol,row.value) : String(row.value ?? "—")}</p>}</div>)}</div> : section.data?.length ? <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800"><table className="min-w-full text-xs"><thead className="bg-slate-50 dark:bg-slate-800"><tr>{(section.columns || []).map((column)=><th key={column} className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{column}</th>)}</tr></thead><tbody>{section.data.map((row,i)=><tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50 dark:border-slate-800 dark:odd:bg-slate-900 dark:even:bg-slate-800/40">{row.map((cell,j)=>{const column=section.columns?.[j] || "";const value=String(cell ?? "—");return <td key={j} className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{/status|state/i.test(column) ? <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(value)}`}>{value}</span> : /amount|balance|limit|price|total|value|payment|spend|cost|rate/i.test(column) ? money(doc.currencySymbol,cell) : value}</td>})}</tr>)}</tbody></table></div> : <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-800">No records shared.</p>}</div>}</section>;
          })}
        </div>

        <section id="contact" className="mt-5 overflow-hidden rounded-3xl border border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-5 text-white sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Communication</p><h2 className="mt-1 text-xl font-black">Talk to your station</h2><p className="mt-1 text-sm text-white/75">Questions about invoices, statements, payments, documents or services can be sent using the station's configured contact details.</p></div>
          <div className="flex flex-wrap gap-2 p-5 sm:p-6">
            {doc.stationPhone && <a href={`tel:${doc.stationPhone.replace(/[^\d+]/g,"")}`} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white"><Phone className="h-3.5 w-3.5"/>Call station</a>}
            {doc.stationEmail && <a href={`mailto:${doc.stationEmail}?subject=${encodeURIComponent("FuelPro customer/organization request")}&body=${encodeURIComponent(`Hello ${doc.stationName || "station"},\\n\\nI need assistance with my customer/organization workspace for ${doc.entityName}.\\n\\nRequest:\\n`)}`} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-xs font-bold dark:border-amber-900/50 dark:bg-slate-900"><Mail className="h-3.5 w-3.5"/>Email station</a>}
            {doc.stationPhone && <a href={`https://wa.me/${doc.stationPhone.replace(/\D/g,"")}?text=${encodeURIComponent(`Hello ${doc.stationName || "station"}, I need help with my customer/organization account ${doc.entityName}.`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-xs font-bold dark:border-amber-900/50 dark:bg-slate-900"><MessageCircle className="h-3.5 w-3.5"/>WhatsApp</a>}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500"/><span>Private customer workspace · Link expires {expiry.toLocaleString()}</span></div><div className="flex gap-2"><button onClick={()=>void printElement(printRef.current || document.body,{title:`${doc.entityName} Customer Workspace`})} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"><Printer className="h-3.5 w-3.5"/>Print / Save PDF</button><button onClick={share} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700"><Share2 className="h-3.5 w-3.5"/>Share</button></div></footer>
      </div>
    </main>
  );
}
