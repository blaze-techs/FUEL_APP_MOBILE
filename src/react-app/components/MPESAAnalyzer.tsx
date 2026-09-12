import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  FileText,
  TrendingUp,
  CheckCircle2,
  Download,
  RefreshCw,
  Sparkles,
  Zap,
  Calculator,
  Trash2,
  X,
  AlertTriangle,
  ShieldCheck,
  Shield,
  Ban,
  Wallet,
  ClipboardPaste,
  Bug,
  CreditCard,
  ArrowRight,
  Radio,
  Link2,
  Save,
  Database,
} from "lucide-react";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { getGeminiUrl } from "@/utils/apiConfig";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ocrPdf, ocrImage } from "@/react-app/lib/ocr-service";
import {
  getCurrencySymbol,
  getDetectedCurrency,
} from "@/react-app/lib/currency";
import {
  addBatchTransactions,
  getTransactions,
  getKopokopoConfig,
  clearTransactions,
  subscribeToTransactions,
  switchToTab,
  navigateToTab,
  type UnifiedTransaction,
} from "@/react-app/lib/mpesa-integration-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { toastError } from "@/react-app/lib/toast";

// ============================================================
// M-PESA Inflow Analyzer v5 - RESTRUCTURED
// Three input methods: PDF Upload, Manual Text Paste, AI
// Extracts ONLY: Details, Paid In, Balance
// ============================================================

interface InflowRecord {
  details: string;
  paidIn: number;
  balance: number;
  receipt: string;
  date: string;
  time: string;
  isOnline: boolean;
}

interface ExcludedRecord {
  receipt: string;
  date: string;
  type: string;
  amount: number;
  reason: string;
}

interface AnalysisStats {
  totalInflows: number;
  totalAmount: number;
  uniqueCustomers: number;
  onlinePayments: number;
  averagePayment: number;
  topCustomer: { name: string; amount: number; count: number };
  dateRange: { from: string; to: string };
  cleanRevenue: {
    genuineRevenue: number;
    excludedLoans: number;
    excludedCharges: number;
    excludedTransfers: number;
    totalExcluded: number;
    excludedRecords: ExcludedRecord[];
  };
  balanceAnalysis: {
    recordedNet: number;
    trueInflow: number;
    unrecordedInflow: number;
    discrepancy: number;
    hasUnrecorded: boolean;
    confidence: string;
  };
}

type InputMethod = "pdf" | "paste" | "ai";
type ProcessingMode = "auto" | "pattern" | "ai";

const SKIP_KEYWORDS = [
  "Loan Disbursement",
  "Merchant to ",
  "Overdraft Repayment",
  "Merchant Payment Charge",
  "Pay merchant Charge",
  "Funds Transfer",
  "Merchant to Merchant",
  "Buy Goods",
  "Withdraw to Bank",
  "Withdraw at Agent",
  "Sell Airtime",
  "Pay Bill",
  "Pay Merchant Charge",
  "Merchant Pay Utility",
];

export default function MPESAAnalyzer() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = getCurrencySymbol(currentStation?.currency);

  // Input state
  const [inputMethod, setInputMethod] = useState<InputMethod>("pdf");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [showRawText, setShowRawText] = useState(false);
  const [extractedRawLines, setExtractedRawLines] = useState<string[]>([]);

  // Processing state
  const [inflowData, setInflowData] = useState<InflowRecord[]>([]);
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [kopoPulling, setKopoPulling] = useState(false);

  // REAL Kopo Kopo pull — fetches the station's actual incoming payments
  // from the Kopo Kopo API (client_id/secret configured in Integration Hub →
  // Payment Setup) and imports them into the shared transaction store. When
  // not configured, the user is told exactly what to set up — never faked.
  const pullFromKopokopo = async () => {
    setKopoPulling(true);
    try {
      const cfg = await getKopokopoConfig(stationId);
      if (!cfg?.enabled || !cfg.clientId || !cfg.clientSecret) {
        toastError(
          "Kopo Kopo is not configured. Set the client ID + secret in Integration Hub → Payment Setup to pull real payments.",
        );
        return;
      }
      const { kopokopoPull } =
        await import("@/react-app/lib/integrations-client");
      const res = await kopokopoPull({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        tillNumber: cfg.tillNumber,
        environment: cfg.environment,
      });
      if (!res.success) {
        toastError(`Kopo Kopo pull failed: ${res.error || "API error"}`);
        return;
      }
      const payments = (res.payments || []) as Array<Record<string, unknown>>;
      if (payments.length === 0) {
        import("@/react-app/lib/toast").then(({ toastInfo }) =>
          toastInfo("Kopo Kopo returned no incoming payments."),
        );
        return;
      }
      const txns: UnifiedTransaction[] = payments.map((p, idx) => ({
        id: String(p.id || p.reference || `KK${Date.now()}_${idx}`),
        transaction_ref: String(p.reference || p.id || `KK${Date.now()}`),
        origin: "kopokopo" as const,
        transaction_type: String(p.type || "Incoming Payment"),
        amount: Number(p.amount) || 0,
        currency: String(p.currency || "KES"),
        sender_info: String(p.sender_phone || p.sender_name || ""),
        description: `Kopo Kopo ${p.type || "payment"} (till ${p.till_number || cfg.tillNumber})`,
        status: "completed" as const,
        payment_method: "Kopo Kopo",
        transaction_time: String(p.initiation_time || new Date().toISOString()),
        receipt: String(p.reference || p.id || ""),
        is_online: true,
      }));
      const result = await addBatchTransactions(txns, stationId);
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess(
          `Pulled ${payments.length} real payment(s) from Kopo Kopo — ${result.added} new, ${result.skipped} already imported.`,
        ),
      );
    } catch (e) {
      toastError(`Kopo Kopo pull error: ${(e as Error).message}`);
    } finally {
      setKopoPulling(false);
    }
  };
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("auto");
  const [actualMethodUsed, setActualMethodUsed] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [validationWarning, setValidationWarning] = useState<string>("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>("");
  // Range filter state
  const [receiptFilter, setReceiptFilter] = useState("");
  const [timeRangeStart, setTimeRangeStart] = useState("");
  const [timeRangeEnd, setTimeRangeEnd] = useState("");
  const [rangeFilterTotal, setRangeFilterTotal] = useState<number | null>(null);
  const [rangeFilterCount, setRangeFilterCount] = useState(0);
  const [showRangeFilter, setShowRangeFilter] = useState(false);
  // The range filter previously only COMPUTED a total but did NOT filter the
  // visible table — the user saw "Filtered Result: Ksh X from N transactions"
  // but the table below still showed ALL rows. Now we keep the filtered set
  // and apply it to the rendered table (combined with the text search).
  const [rangeFiltered, setRangeFiltered] = useState<InflowRecord[] | null>(
    null,
  );

  // Interlinked state — shared transactions with Live Transaction tab
  const [sharedTxns, setSharedTxns] = useState<UnifiedTransaction[]>([]);
  const [savedToShared, setSavedToShared] = useState<{
    added: number;
    skipped: number;
  } | null>(null);
  const [showLiveFeed, setShowLiveFeed] = useState(false);

  // Load + subscribe to shared transactions (interlinked with Live Transaction)
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const txns = await getTransactions(stationId);
      if (mounted) setSharedTxns(txns);
    })();
    const unsub = subscribeToTransactions(stationId, (txns) => {
      if (mounted) setSharedTxns(txns || []);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [user, stationId]);

  // Restore the last extraction from the shared store on mount/refresh.
  // Previously the analyzer's working state (inflowData) was in-memory only —
  // a page refresh wiped the table even though the transactions were safely in
  // the cloud store. Now we hydrate from the shared store so the user's last
  // extraction reappears without re-processing.
  useEffect(() => {
    if (!user || sharedTxns.length === 0) return;
    // Only restore if there's no in-progress extraction (avoid clobbering).
    if (inflowData.length > 0) return;
    const restored: InflowRecord[] = sharedTxns
      .filter((tx) => tx.origin === "statement")
      .map((tx) => ({
        details: tx.sender_info || tx.description || "",
        paidIn: Number(tx.amount) || 0,
        balance: Number(tx.balance) || 0,
        receipt: tx.receipt || "",
        date: tx.date || "",
        time: tx.time || "",
        isOnline: !!tx.is_online,
      }));
    if (restored.length > 0) {
      setInflowData(restored);
      setStats(calculateStats(restored, []));
      addProgress(
        `Restored ${restored.length} transactions from cloud (previous session).`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sharedTxns]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addProgress = useCallback((msg: string) => {
    setProgress((prev) => [...prev, msg]);
  }, []);

  // ===== CORE PATTERN EXTRACTION =====
  const extractFromLines = (
    lines: string[],
  ): { inflows: InflowRecord[]; excluded: ExcludedRecord[] } => {
    const inflows: InflowRecord[] = [];
    const excluded: ExcludedRecord[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || !line.includes("Completed")) continue;

      // Extract amounts: last 3 are [Paid In, Withdrawn, Balance]
      const amounts: number[] = [];
      for (const m of line.matchAll(
        /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})/g,
      )) {
        amounts.push(parseFloat(m[1].replace(/,/g, "")));
      }
      if (amounts.length < 3) continue;

      const paidIn = amounts[amounts.length - 3];
      const withdrawn = amounts[amounts.length - 2];
      const balance = amounts[amounts.length - 1];

      // Extract receipt
      const receiptMatch = line.match(/\b([A-Z0-9]{10})\b/);
      const receipt = receiptMatch ? receiptMatch[1] : "";

      // Extract date
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : "";

      // Detect transaction type
      let txType = "unknown";
      if (line.includes("Merchant Payment from")) txType = "merchant_payment";
      else if (line.includes("Loan Disbursement")) txType = "loan_disbursement";
      else if (line.includes("Biashara Overdraft")) txType = "overdraft";
      else if (
        line.includes("Pay merchant Charge") ||
        line.includes("Pay Merchant Charge")
      )
        txType = "merchant_charge";
      else if (line.includes("Merchant Payment Charge"))
        txType = "payment_charge";
      else if (line.includes("Merchant to Utility")) txType = "utility_payment";
      else if (line.includes("Merchant Pay Utility")) txType = "utility_pay";
      else if (line.includes("Merchant to Merchant"))
        txType = "merchant_transfer";
      else if (line.includes("Funds Transfer")) txType = "funds_transfer";

      // Handle exclusions (loans, charges, etc.)
      const isLoan = txType === "loan_disbursement" || txType === "overdraft";
      const isCharge =
        txType === "merchant_charge" || txType === "payment_charge";
      const isUtility =
        txType === "utility_payment" || txType === "utility_pay";
      const isTransfer =
        txType === "merchant_transfer" || txType === "funds_transfer";

      if (isLoan && paidIn > 0) {
        excluded.push({
          receipt,
          date,
          type: txType,
          amount: paidIn,
          reason: "Loan/Overdraft - not operating revenue",
        });
        continue;
      }

      // Skip zero or negative Paid In
      if (paidIn <= 0) {
        if ((isCharge || isUtility || isTransfer) && withdrawn > 0) {
          excluded.push({
            receipt,
            date,
            type: txType,
            amount: withdrawn,
            reason: isCharge
              ? "Merchant charge"
              : isUtility
                ? "Utility payment"
                : "Transfer",
          });
        }
        continue;
      }

      // Skip non-inflow types
      if (SKIP_KEYWORDS.some((k) => line.includes(k))) continue;

      // Must be "Merchant Payment from"
      if (!line.includes("Merchant Payment from")) continue;

      // Context lines for name extraction
      const contextLines: string[] = [];
      for (let j = 1; j <= 3; j++) {
        if (i + j < lines.length) contextLines.push(lines[i + j].trim());
      }
      const fullContext = contextLines.join(" ");

      let details = "";
      const isOnline =
        line.includes("Online") || fullContext.includes("Online");

      // Phone extraction
      const phoneMatch = fullContext.match(/((?:254)?\d{2,4}\*+\d{3})/);
      const phone = phoneMatch ? phoneMatch[1] : "";

      // Name extraction
      const nameMatch = fullContext.match(
        /(?:\d{3,4}\*+\d{3}|254\d{0,3}\*+\d{3})\s*-\s*(.+?)(?:\s+Merchant|\s+Payment|$)/i,
      );

      if (nameMatch) {
        let name = nameMatch[1].trim();
        name = name
          .replace(/\s+(ENERGY|SWAFIA|Customer|Merchant|Payment)\s*$/gi, "")
          .trim();

        // Surname continuation fix
        for (const ctxLine of contextLines.slice(1)) {
          const surnameMatch = ctxLine.match(
            /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+Payment\s+ENERGY/,
          );
          if (surnameMatch) {
            for (const word of surnameMatch[1].split(/\s+/)) {
              if (!name.toLowerCase().includes(word.toLowerCase()))
                name += ` ${word}`;
            }
            break;
          }
        }

        if (phone && name) details = `Payment from ${phone} - ${name}`;
        else if (name) details = name;
      }

      if (!details)
        details = isOnline ? "Merchant Payment (Online)" : "Merchant Payment";

      const timeMatch =
        line.match(/(\d{2}:\d{2}:\d{2})/) ||
        fullContext.match(/(\d{2}:\d{2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : "";

      inflows.push({ details, paidIn, balance, receipt, date, time, isOnline });
    }

    return { inflows, excluded };
  };

  // ===== PDF TEXT EXTRACTION (v5 - robust) =====
  const extractPDFText = async (
    file: File,
  ): Promise<{ lines: string[]; error?: string }> => {
    try {
      const arrayBuffer = await file.arrayBuffer();

      // Dynamic import of pdfjs-dist
      let pdfjs: any;
      try {
        pdfjs = await import("pdfjs-dist");
      } catch (importErr) {
        return {
          lines: [],
          error:
            "pdfjs-dist library not available. Please use Manual Text Paste mode instead.",
        };
      }

      // Bundled same-origin worker (the unpkg CDN worker is blocked by the
      // site CSP worker-src 'self').
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const lines: string[] = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const items = tc.items as any[];

        // Group items by row using y-position with tolerance
        const rowMap = new Map<number, { x: number; text: string }[]>();

        for (const item of items) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] * 10) / 10;
          const x = item.transform[4];

          // Find existing row within 3px
          let found = false;
          for (const [ry, row] of rowMap) {
            if (Math.abs(ry - y) < 3) {
              row.push({ x, text: item.str });
              found = true;
              break;
            }
          }
          if (!found) {
            rowMap.set(y, [{ x, text: item.str }]);
          }
        }

        // Sort rows top-to-bottom, then items left-to-right
        const sortedRows = Array.from(rowMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, row]) => {
            row.sort((a, b) => a.x - b.x);
            return row
              .map((i) => i.text)
              .join(" ")
              .trim();
          })
          .filter(Boolean);

        lines.push(...sortedRows);
      }

      return { lines };
    } catch (err: any) {
      return { lines: [], error: err.message || "Failed to extract PDF text" };
    }
  };

  // ===== AI EXTRACTION =====
  const extractWithAI = async (text: string): Promise<InflowRecord[]> => {
    const geminiUrl = getGeminiUrl();
    if (!geminiUrl) {
      throw new Error(
        "Gemini API key not configured. Please set VITE_GEMINI_API_KEY environment variable.",
      );
    }

    const allRecords: InflowRecord[] = [];
    const chunkSize = 20000;
    // Track AI failures so we can surface them to the user instead of silently
    // returning [] (which the old code did — a total AI failure looked
    // identical to "no transactions found").
    let failedChunks = 0;
    let lastError = "";
    const totalChunks = Math.ceil(text.length / chunkSize);

    for (let offset = 0; offset < text.length; offset += chunkSize) {
      const chunk = text.slice(offset, offset + chunkSize);
      const prompt = `Extract ONLY "Merchant Payment from" inflow transactions from this M-PESA statement. For each, return: {"details":"Phone - Customer Name","paidIn":number,"balance":number,"receipt":"10-char code","date":"YYYY-MM-DD","time":"HH:MM:SS"}. Return JSON array only. Exclude loans, charges, transfers.\n\n${chunk}`;

      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.05,
              responseMimeType: "application/json",
            },
          }),
        });
        if (!response.ok) {
          failedChunks++;
          lastError = `HTTP ${response.status} ${response.statusText}`;
          addProgress(
            `⚠️ AI chunk ${Math.floor(offset / chunkSize) + 1}/${totalChunks} failed: ${lastError}`,
          );
          continue;
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        let parsed: any[] = [];
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const jsonMatch = rawText.match(/\[[\s\S]*\]/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        const records = (Array.isArray(parsed) ? parsed : [parsed])
          .filter(Boolean)
          .map((item: any) => ({
            details: String(item.details || "Payment").trim(),
            paidIn: parseFloat(item.paidIn || 0),
            balance: parseFloat(item.balance || 0),
            receipt: String(item.receipt || ""),
            date: String(item.date || ""),
            time: String(item.time || ""),
            isOnline: String(item.details || "")
              .toLowerCase()
              .includes("online"),
          }))
          .filter((r: InflowRecord) => r.paidIn > 0 && r.paidIn < 99999999);

        allRecords.push(...records);
        addProgress(
          `AI processed ${Math.min(offset + chunkSize, text.length).toLocaleString()} / ${text.length.toLocaleString()} chars`,
        );
      } catch (err) {
        // Was silently swallowed — now track + log so the user knows AI failed.
        failedChunks++;
        lastError = err instanceof Error ? err.message : String(err);
        addProgress(
          `⚠️ AI chunk ${Math.floor(offset / chunkSize) + 1}/${totalChunks} error: ${lastError}`,
        );
      }
    }

    // If EVERY chunk failed and we got nothing, throw so processWithAI can
    // alert the user (was: silently returned [] → UI showed "0 inflows").
    if (
      allRecords.length === 0 &&
      failedChunks === totalChunks &&
      totalChunks > 0
    ) {
      throw new Error(
        `AI extraction failed for all ${totalChunks} chunk(s). Last error: ${lastError}. Try the Pattern extraction mode or paste the text manually.`,
      );
    }
    if (failedChunks > 0) {
      addProgress(
        `⚠️ ${failedChunks}/${totalChunks} AI chunk(s) failed — partial results shown.`,
      );
    }

    return allRecords;
  };

  // ===== STATS CALCULATION =====
  const calculateStats = (
    records: InflowRecord[],
    excluded: ExcludedRecord[],
  ): AnalysisStats => {
    const totalAmount = records.reduce((s, r) => s + r.paidIn, 0);
    const customerMap = new Map<string, { amount: number; count: number }>();
    for (const r of records) {
      const name =
        r.details.replace(/Payment from\s+\S+\s*-\s*/, "").trim() || r.details;
      const ex = customerMap.get(name) || { amount: 0, count: 0 };
      ex.amount += r.paidIn;
      ex.count++;
      customerMap.set(name, ex);
    }
    let topCustomer = { name: "", amount: 0, count: 0 };
    for (const [name, d] of customerMap) {
      if (d.amount > topCustomer.amount) topCustomer = { name, ...d };
    }
    const dates = records
      .map((r) => r.date)
      .filter(Boolean)
      .sort();

    // ===== BALANCE ANALYSIS: True Inflow Detection =====
    // Sort by datetime to compute balance deltas
    const sorted = [...records].sort((a, b) => {
      const ta = `${a.date || "0000-00-00"}T${a.time || "00:00:00"}`;
      const tb = `${b.date || "0000-00-00"}T${b.time || "00:00:00"}`;
      return ta.localeCompare(tb);
    });

    let trueInflow = 0;
    let totalBalanceDelta = 0;
    let positiveDeltas = 0;
    const balanceDeltas: {
      receipt: string;
      prevBalance: number;
      currBalance: number;
      delta: number;
    }[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      if (i === 0) continue; // Skip first — no previous
      const prev = sorted[i - 1];
      if (prev.balance > 0 && curr.balance > 0) {
        const delta = curr.balance - prev.balance;
        totalBalanceDelta += Math.max(delta, 0);
        if (delta > 0) {
          trueInflow += delta;
          positiveDeltas++;
        }
        balanceDeltas.push({
          receipt: curr.receipt,
          prevBalance: prev.balance,
          currBalance: curr.balance,
          delta: Math.round(delta * 100) / 100,
        });
      }
    }

    const recordedNet = totalAmount; // Sum of all parsed Paid In
    const unrecordedInflow = Math.max(trueInflow - recordedNet, 0);
    // Guard against NaN/Infinity when recordedNet is 0 or the amounts are
    // NaN (bad parse). Was `recordedNet > 0 ? ... : 0` which still produced
    // NaN if trueInflow was NaN.
    const safeRecorded =
      Number.isFinite(recordedNet) && recordedNet > 0 ? recordedNet : 0;
    const safeTrue = Number.isFinite(trueInflow) ? trueInflow : 0;
    const discrepancy =
      safeRecorded > 0
        ? Math.min(Math.abs(safeTrue - safeRecorded) / safeRecorded, 1)
        : 0;
    const hasUnrecorded = unrecordedInflow > 0.01;
    const confidence =
      balanceDeltas.length >= 3
        ? hasUnrecorded
          ? "Medium — unrecorded inflows detected via balance deltas"
          : "High — balance matches recorded inflows"
        : balanceDeltas.length > 0
          ? "Low — insufficient balance data for analysis"
          : "N/A — no balance data available";

    return {
      totalInflows: records.length,
      totalAmount,
      uniqueCustomers: customerMap.size,
      onlinePayments: records.filter((r) => r.isOnline).length,
      averagePayment: records.length > 0 ? totalAmount / records.length : 0,
      topCustomer,
      dateRange: { from: dates[0] || "", to: dates[dates.length - 1] || "" },
      cleanRevenue: {
        genuineRevenue: totalAmount,
        excludedLoans: excluded
          .filter((e) => e.reason.includes("Loan"))
          .reduce((s, e) => s + e.amount, 0),
        excludedCharges: excluded
          .filter((e) => e.reason.includes("charge"))
          .reduce((s, e) => s + e.amount, 0),
        excludedTransfers: excluded
          .filter(
            (e) =>
              e.reason.includes("Utility") || e.reason.includes("Transfer"),
          )
          .reduce((s, e) => s + e.amount, 0),
        totalExcluded: excluded.reduce((s, e) => s + e.amount, 0),
        excludedRecords: excluded,
      },
      balanceAnalysis: {
        recordedNet,
        trueInflow: Math.round(trueInflow * 100) / 100,
        unrecordedInflow: Math.round(unrecordedInflow * 100) / 100,
        // Store as a percentage (0-100), guarded against NaN/Infinity.
        discrepancy: Number.isFinite(discrepancy)
          ? Math.round(discrepancy * 1000) / 10
          : 0,
        hasUnrecorded,
        confidence,
      },
    };
  };

  // ===== MAIN PROCESS =====
  const processPDFs = async () => {
    if (!pdfFiles.length) return;
    setIsProcessing(true);
    setProgress([]);
    setInflowData([]);
    setStats(null);
    setValidationWarning("");
    setDebugInfo("");
    setExtractedRawLines([]);

    try {
      addProgress(
        `Reading ${pdfFiles.length} file(s) (PDF or photo — scanned documents are read visually via OCR)...`,
      );

      const allLines: string[] = [];
      for (const file of pdfFiles) {
        // Photo/screenshot of a statement — OCR directly.
        if (file.type.startsWith("image/")) {
          addProgress(`Reading photo "${file.name}" visually (OCR)...`);
          const ocrText = await ocrImage(file);
          const ocrLines = ocrText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (ocrLines.length) {
            addProgress(`OCR read ${ocrLines.length} lines from the photo`);
            allLines.push(...ocrLines);
          } else {
            addProgress(
              `OCR found no readable text in "${file.name}" — try a clearer photo.`,
            );
          }
          continue;
        }

        addProgress(`Extracting text from "${file.name}"...`);
        const { lines, error } = await extractPDFText(file);

        if (error) {
          addProgress(`ERROR: ${error}`);
          setDebugInfo(
            `PDF Extraction Error: ${error}\n\nTry using "Manual Text Paste" mode instead. Copy text from your PDF viewer and paste it.`,
          );
          setIsProcessing(false);
          return;
        }

        // Scanned statement (image-only PDF) — the text layer is empty, so
        // read the pages visually with the shared on-device OCR engine.
        if (lines.join(" ").trim().length < 40) {
          addProgress(
            `No text layer in "${file.name}" — reading the scan visually (OCR)...`,
          );
          const ocrText = await ocrPdf(file, { maxPages: 5 });
          const ocrLines = ocrText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (ocrLines.length) {
            addProgress(
              `OCR read ${ocrLines.length} lines from "${file.name}"`,
            );
            allLines.push(...ocrLines);
            continue;
          }
          addProgress(
            `OCR found no readable text in "${file.name}" — try a clearer scan or Manual Text Paste.`,
          );
          continue;
        }

        addProgress(`Extracted ${lines.length} lines from "${file.name}"`);
        allLines.push(...lines);
      }

      setExtractedRawLines(allLines);

      if (processingMode === "ai") {
        await processWithAI(allLines.join("\n"));
      } else {
        await processWithPattern(allLines);
      }
    } catch (err: any) {
      addProgress(`Fatal error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const processPaste = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    setProgress([]);
    setInflowData([]);
    setStats(null);
    setValidationWarning("");
    setDebugInfo("");

    try {
      const lines = pastedText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      addProgress(`Pasted text: ${lines.length} lines`);
      setExtractedRawLines(lines);

      if (processingMode === "ai") {
        await processWithAI(pastedText);
      } else {
        await processWithPattern(lines);
      }
    } catch (err: any) {
      addProgress(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const processWithPattern = async (lines: string[]) => {
    setActualMethodUsed("Pattern (Regex)");
    addProgress("Running pattern extraction...");

    // Quick scan for validation
    let quickCount = 0;
    for (const line of lines) {
      if (!line.includes("Completed")) continue;
      const amounts: number[] = [];
      for (const m of line.matchAll(
        /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})/g,
      )) {
        amounts.push(parseFloat(m[1].replace(/,/g, "")));
      }
      if (
        amounts.length >= 3 &&
        amounts[amounts.length - 3] > 0 &&
        line.includes("Merchant Payment from")
      ) {
        quickCount++;
      }
    }
    addProgress(
      `Quick scan: ${quickCount} potential "Merchant Payment from" transactions found`,
    );

    if (quickCount === 0) {
      setDebugInfo(
        `No "Merchant Payment from" transactions found with Paid In > 0.\n\nDebug:\n- Total lines: ${lines.length}\n- Lines with "Completed": ${lines.filter((l) => l.includes("Completed")).length}\n- Lines with "Merchant Payment": ${lines.filter((l) => l.includes("Merchant Payment")).length}\n\nThe PDF text may not have been extracted correctly. Try the "Manual Text Paste" method: open the PDF in a viewer, select all text, copy, and paste it here.`,
      );
      return;
    }

    const { inflows: records, excluded } = extractFromLines(lines);
    const st = calculateStats(records, excluded);

    setInflowData(records);
    setStats(st);
    addProgress(
      `Done! ${records.length} inflows extracted | Total: ${currencySymbol} ${formatNumber(st.totalAmount, 2)}`,
    );
    setValidationWarning(
      `Validated: ${records.length} inflows | ${currencySymbol} ${formatNumber(st.totalAmount, 2)} | ${excluded.length} excluded (loans/charges)`,
    );

    // Save to shared unified store (interlinked with Live Transaction)
    await saveToSharedStore(records);
  };

  const processWithAI = async (text: string) => {
    setActualMethodUsed("AI (Gemini)");
    addProgress("Sending to AI for extraction...");

    try {
      const records = await extractWithAI(text);
      const st = calculateStats(records, []);

      setInflowData(records);
      setStats(st);
      addProgress(`AI complete! ${records.length} inflows found`);

      // Save to shared unified store (interlinked with Live Transaction)
      await saveToSharedStore(records);
    } catch (err) {
      // Was not caught — extractWithAI threw but processWithAI had no
      // try/catch, so the error propagated as an unhandled rejection and the
      // UI just showed "0 inflows" with no explanation.
      const msg = err instanceof Error ? err.message : String(err);
      addProgress(`⚠️ AI extraction failed: ${msg}`);
      toastError(
        `AI extraction failed: ${msg}. Try Pattern extraction mode instead.`,
      );
      setInflowData([]);
      setStats(null);
    }
  };

  /**
   * Persist extracted inflows to the shared `mpesa_transactions` cloud store
   * so they appear in the Live Transaction tab's feed. De-duplicates by
   * receipt number to avoid double-imports.
   */
  const saveToSharedStore = async (records: InflowRecord[]) => {
    if (!user || records.length === 0) {
      setSavedToShared(null);
      return;
    }
    try {
      const txns = records.map((r, idx) => ({
        // De-dup key: use the real receipt when present. When the receipt is
        // blank (common for pasted statements), the OLD fallback
        // `STMT${date}${time}` collapsed to the literal "STMT" when date/time
        // were also empty → addBatchTransactions deduped EVERY empty-receipt
        // inflow into ONE record, silently dropping all but the first. Now we
        // build a unique synthetic ref from the index + amount + sender so
        // each receipt-less inflow gets its own row (and still de-dups a
        // genuinely re-imported identical row).
        transaction_ref:
          r.receipt ||
          `STMT-${idx}-${r.paidIn}-${(r.details || "").slice(0, 20)}`,
        origin: "statement" as const,
        transaction_type: "Merchant Payment",
        amount: r.paidIn,
        // Use the station's currency consistently (was getDetectedCurrency()
        // which can disagree with the display currencySymbol).
        currency: getDetectedCurrency(),
        sender_info: r.details,
        description: r.details,
        status: "completed" as const,
        payment_method: r.isOnline ? "M-PESA Online" : "M-PESA",
        transaction_time:
          r.date || r.time
            ? `${r.date || "1970-01-01"}T${r.time || "00:00:00"}`
            : new Date().toISOString(),
        receipt: r.receipt,
        balance: r.balance,
        is_online: r.isOnline,
        date: r.date,
        time: r.time,
      }));
      const result = await addBatchTransactions(txns, stationId);
      setSavedToShared(result);
      addProgress(
        `Shared store: ${result.added} added, ${result.skipped} duplicates skipped`,
      );
    } catch (err) {
      // Surface the failure instead of silently swallowing it (the old code
      // only console.error'd, so the user saw a false "saved" success and
      // the transactions never reached the shared store → cross-device sync
      // silently dropped them).
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to save to shared store:", err);
      setSavedToShared(null);
      addProgress(`⚠️ Failed to save to shared store: ${msg}`);
      toastError(
        `Could not save ${records.length} transactions to the shared store. Error: ${msg}. You can re-run the extraction to retry.`,
      );
    }
  };

  /**
   * Clear ALL extracted inflow data from both the local working state AND the
   * shared cloud store. Lets the user remove old/no-longer-needed records to
   * save space and keep the analyzer focused on current data.
   */
  const handleClearAllData = async () => {
    if (
      !confirm(
        "Clear ALL M-PESA analyzer data? This removes every extracted inflow from this session AND the shared cloud store (also clears the Live Transaction feed). This cannot be undone.",
      )
    )
      return;
    setInflowData([]);
    setRangeFiltered(null);
    setStats(null);
    setSavedToShared(null);
    setPastedText("");
    setPdfFiles([]);
    setProgress([]);
    try {
      await clearTransactions(stationId);
    } catch (err) {
      console.error("Failed to clear shared store:", err);
    }
  };

  // ===== FILE HANDLING =====
  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    // PDFs (text or scanned) AND photos/screenshots of statements — images
    // are read visually with the on-device OCR engine.
    const valid = Array.from(files).filter(
      (f) =>
        f.name.toLowerCase().endsWith(".pdf") || f.type.startsWith("image/"),
    );
    if (!valid.length) return;
    setPdfFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (idx: number) =>
    setPdfFiles((prev) => prev.filter((_, i) => i !== idx));

  // ===== EXPORT =====
  const exportCSV = () => {
    if (!inflowData.length) return;
    const header = `Details,Paid In (${currencySymbol}),Balance (${currencySymbol}),Receipt,Date,Time\n`;
    const rows = inflowData.map((r) =>
      [
        `"${(r.details || "").replace(/"/g, '""')}"`,
        r.paidIn.toFixed(2),
        r.balance.toFixed(2),
        r.receipt,
        r.date,
        r.time,
      ].join(","),
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mpesa_inflows_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = (() => {
    // Start from the range-filtered set if active, otherwise all inflows.
    const base = rangeFiltered ?? inflowData;
    if (!searchTerm) return base;
    const q = searchTerm.toLowerCase();
    // Search across details, receipt, date, and amount (was details-only
    // — a user searching for a receipt number or amount found nothing).
    return base.filter(
      (r) =>
        r.details.toLowerCase().includes(q) ||
        r.receipt.toLowerCase().includes(q) ||
        r.date.toLowerCase().includes(q) ||
        r.time.toLowerCase().includes(q) ||
        String(r.paidIn).includes(q) ||
        String(r.balance).includes(q),
    );
  })();

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-green-100 dark:bg-green-900/30 rounded-xl">
          <FileText size={24} className="text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            M-PESA Inflow Analyzer
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
            Extract <strong>Details</strong>, <strong>Paid In</strong>,{" "}
            <strong>Balance</strong> from M-PESA statements
          </p>
        </div>
        {/* Cross-tab navigation to Live Transaction */}
        <button
          onClick={() => switchToTab("livetransaction")}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Radio size={16} className="animate-pulse" />
          Live Transaction
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Interlinked banner */}
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
        <Link2 size={16} className="text-blue-500 flex-shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong>Interlinked with Live Transaction:</strong> Extracted inflows
          are saved to a shared cloud store and appear in the Live Transaction
          feed. Real-time STK Push transactions appear below in the shared feed.
        </p>
      </div>

      {/* Saved-to-shared indicator */}
      {savedToShared && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
          <Database size={16} className="text-emerald-500 flex-shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            <strong>{savedToShared.added}</strong> transaction
            {savedToShared.added !== 1 ? "s" : ""} saved to shared store →
            visible in Live Transaction tab
            {savedToShared.skipped > 0 &&
              ` (${savedToShared.skipped} duplicate${savedToShared.skipped !== 1 ? "s" : ""} skipped)`}
          </p>
        </div>
      )}

      {/* Input Method Tabs */}
      <div className="flex gap-2">
        {[
          {
            id: "pdf" as const,
            label: "PDF Upload",
            desc: "Upload PDF files",
            icon: Upload,
          },
          {
            id: "paste" as const,
            label: "Manual Paste",
            desc: "Paste copied text",
            icon: ClipboardPaste,
          },
          {
            id: "ai" as const,
            label: "AI Only",
            desc: "Gemini AI extraction",
            icon: Sparkles,
          },
        ].map(({ id, label, desc, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setInputMethod(id)}
            className={`flex-1 px-4 py-3 rounded-xl text-xs font-semibold transition-all ${
              inputMethod === id
                ? "bg-green-600 text-gray-900 dark:text-white shadow-lg"
                : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
            }`}
          >
            <Icon size={16} className="mx-auto mb-1" />
            <div>{label}</div>
            <div className="text-[10px] opacity-70 font-normal">{desc}</div>
          </button>
        ))}
      </div>

      {/* Processing Mode */}
      <div className="flex gap-2">
        <p className="text-xs text-gray-500 self-center mr-2">Extraction:</p>
        {[
          { mode: "auto" as const, label: "Auto", icon: Zap },
          { mode: "pattern" as const, label: "Pattern", icon: Calculator },
          { mode: "ai" as const, label: "AI", icon: Sparkles },
        ].map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            onClick={() => setProcessingMode(mode)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              processingMode === mode
                ? "bg-indigo-600 text-gray-900 dark:text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-500 dark:text-gray-400"
            }`}
          >
            <Icon size={12} className="inline mr-1" />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        {/* REAL Kopo Kopo API pull — imports the station's actual incoming
            payments from the Kopo Kopo institution (not a statement parse). */}
        <button
          onClick={pullFromKopokopo}
          disabled={kopoPulling}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-all"
          title="Pull real incoming payments from the Kopo Kopo API (configure in Integration Hub → Payment Setup)"
        >
          {kopoPulling ? "Pulling…" : "Pull from Kopo Kopo (live API)"}
        </button>
      </div>

      {/* ===== PDF UPLOAD INPUT ===== */}
      {inputMethod === "pdf" && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            multiple
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
          <Upload
            size={36}
            className="mx-auto mb-3 text-gray-500 dark:text-gray-400"
          />
          <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-2">
            Upload M-PESA statement(s) — PDF or a photo/scan of the statement
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Scanned documents &amp; photos are read visually (OCR)
            automatically. You can also switch to &quot;Manual Paste&quot; mode.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-xl text-sm font-medium transition-colors"
          >
            Select Statement Files
          </button>

          {pdfFiles.length > 0 && (
            <div className="mt-4 space-y-2 text-left max-w-md mx-auto">
              {pdfFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText
                      size={14}
                      className="text-green-500 flex-shrink-0"
                    />
                    <span className="text-xs dark:text-gray-900 dark:text-white truncate">
                      {f.name}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={processPDFs}
            disabled={isProcessing || pdfFiles.length === 0}
            className={`mt-4 w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
              isProcessing || !pdfFiles.length
                ? "bg-gray-400 text-gray-900 dark:text-white cursor-not-allowed"
                : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-gray-900 dark:text-white shadow-lg"
            }`}
            title="Refresh"
            aria-label="Refresh"
          >
            {isProcessing ? (
              <>
                <RefreshCw size={18} className="animate-spin" /> Processing...
              </>
            ) : (
              <>
                <TrendingUp size={18} /> Extract Inflows
              </>
            )}
          </button>
        </div>
      )}

      {/* ===== MANUAL TEXT PASTE INPUT ===== */}
      {inputMethod === "paste" && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-green-300 dark:border-green-700 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ClipboardPaste
              size={24}
              className="text-green-500 flex-shrink-0 mt-1"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                Manual Text Paste (Most Reliable)
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                Open the M-PESA PDF in any viewer, select all text (Ctrl+A),
                copy (Ctrl+C), and paste below. This method bypasses browser PDF
                extraction issues.
              </p>
            </div>
          </div>

          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`Paste M-PESA statement text here...\n\nExample format:\nTI66P7TDSE 2025-09-06 Merchant Payment from Completed 80.00 0.00 200.00 Customer 578590-\n18:26:32 0746***921 - john doe\nMerchant Payment\n...`}
            className="w-full h-64 px-4 py-3 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-mono dark:text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none resize-y"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {pastedText.length.toLocaleString()} characters |{" "}
              {pastedText.split("\n").length.toLocaleString()} lines
            </p>
            <button
              onClick={processPaste}
              disabled={isProcessing || !pastedText.trim()}
              className={`px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${
                isProcessing || !pastedText.trim()
                  ? "bg-gray-400 text-gray-900 dark:text-white cursor-not-allowed"
                  : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-gray-900 dark:text-white shadow-lg"
              }`}
              title="Refresh"
              aria-label="Refresh"
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={18} className="animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <TrendingUp size={18} /> Extract Inflows
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ===== AI ONLY INPUT ===== */}
      {inputMethod === "ai" && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-purple-300 dark:border-purple-700 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <Sparkles
              size={24}
              className="text-purple-500 flex-shrink-0 mt-1"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                AI Extraction
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                Paste any M-PESA statement text and let AI extract the inflows.
                Best for non-standard formats.
              </p>
            </div>
          </div>

          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste M-PESA statement text here for AI analysis..."
            className="w-full h-64 px-4 py-3 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-mono dark:text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none resize-y"
          />

          <button
            onClick={processPaste}
            disabled={isProcessing || !pastedText.trim()}
            className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
              isProcessing || !pastedText.trim()
                ? "bg-gray-400 text-gray-900 dark:text-white cursor-not-allowed"
                : "bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-gray-900 dark:text-white shadow-lg"
            }`}
            title="Refresh"
            aria-label="Refresh"
          >
            {isProcessing ? (
              <>
                <RefreshCw size={18} className="animate-spin" /> AI
                Processing...
              </>
            ) : (
              <>
                <Sparkles size={18} /> Extract with AI
              </>
            )}
          </button>
        </div>
      )}

      {/* Debug Info */}
      {(debugInfo || extractedRawLines.length > 0) && (
        <div className="space-y-2">
          {debugInfo && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Bug
                  size={16}
                  className="text-amber-500 flex-shrink-0 mt-0.5"
                />
                <pre className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap font-mono">
                  {debugInfo}
                </pre>
              </div>
            </div>
          )}
          {extractedRawLines.length > 0 && (
            <button
              onClick={() => setShowRawText(!showRawText)}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              {showRawText ? "Hide" : "Show"} extracted raw text (
              {extractedRawLines.length} lines)
            </button>
          )}
          {showRawText && extractedRawLines.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 max-h-[300px] overflow-y-auto">
              <pre className="text-[10px] text-gray-300 font-mono whitespace-pre-wrap">
                {extractedRawLines.slice(0, 100).join("\n")}
                {extractedRawLines.length > 100 &&
                  `\n... (${extractedRawLines.length - 100} more lines)`}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {progress.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="space-y-1">
            {progress.map((p, i) => (
              <p
                key={i}
                className="text-xs text-blue-800 dark:text-blue-200 font-mono"
              >
                {p}
              </p>
            ))}
          </div>
          {actualMethodUsed && (
            <p className="text-[10px] text-blue-500 mt-2">
              Method: {actualMethodUsed}
            </p>
          )}
        </div>
      )}

      {/* Validation */}
      {validationWarning && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-start gap-2">
          <CheckCircle2
            size={16}
            className="text-green-500 flex-shrink-0 mt-0.5"
          />
          <p className="text-xs text-green-700 dark:text-green-300">
            {validationWarning}
          </p>
        </div>
      )}

      {/* Clean Revenue */}
      {stats && stats.cleanRevenue.totalExcluded > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={18} className="text-emerald-600" />
            <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300 uppercase">
              Clean Revenue Breakdown
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {currencySymbol}{" "}
                {formatNumber(stats.cleanRevenue.genuineRevenue, 0)}
              </p>
              <p className="text-[10px] text-emerald-600">Operating Revenue</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">
                {currencySymbol}{" "}
                {formatNumber(stats.cleanRevenue.excludedLoans, 0)}
              </p>
              <p className="text-[10px] text-red-500">Excluded (Loans)</p>
            </div>
            <div>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                {currencySymbol}{" "}
                {formatNumber(stats.cleanRevenue.excludedCharges, 0)}
              </p>
              <p className="text-[10px] text-orange-500">Excluded (Charges)</p>
            </div>
            <div>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {currencySymbol}{" "}
                {formatNumber(stats.cleanRevenue.excludedTransfers, 0)}
              </p>
              <p className="text-[10px] text-purple-500">
                Excluded (Transfers)
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              <Ban size={12} className="inline mr-1" />
              Excluded items are <strong>NOT</strong> operating revenue
            </p>
            <button
              onClick={() => setShowExcluded(!showExcluded)}
              className="text-xs text-emerald-600 underline"
            >
              {showExcluded ? "Hide" : "Show"} excluded (
              {stats.cleanRevenue.excludedRecords.length})
            </button>
          </div>
        </div>
      )}

      {/* Excluded Table */}
      {showExcluded &&
        stats &&
        stats.cleanRevenue.excludedRecords.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-red-50 dark:bg-red-900/30">
                  <tr>
                    <th className="text-left px-3 py-2 text-red-600 dark:text-red-400">
                      Receipt
                    </th>
                    <th className="text-left px-3 py-2 text-red-600 dark:text-red-400">
                      Type
                    </th>
                    <th className="text-right px-3 py-2 text-red-600 dark:text-red-400">
                      Amount
                    </th>
                    <th className="text-left px-3 py-2 text-red-600 dark:text-red-400">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.cleanRevenue.excludedRecords.map((item, i) => (
                    <tr
                      key={i}
                      className="border-b border-red-100 dark:border-red-900/20"
                    >
                      <td className="px-3 py-2 font-mono text-[10px] text-gray-500">
                        {item.receipt}
                      </td>
                      <td className="px-3 py-2 capitalize">
                        {item.type.replace(/_/g, " ")}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600">
                        {formatNumber(item.amount, 2)}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.totalInflows.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-500">Total Inflows</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {currencySymbol} {formatNumber(stats.totalAmount, 0)}
            </p>
            <p className="text-[10px] text-gray-500">Total Received</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stats.uniqueCustomers}
            </p>
            <p className="text-[10px] text-gray-500">Unique Customers</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {currencySymbol} {formatNumber(stats.averagePayment, 0)}
            </p>
            <p className="text-[10px] text-gray-500">Average Payment</p>
          </div>
        </div>
      )}

      {/* Top Customer + Period */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
            <p className="text-[10px] text-amber-600 font-medium uppercase">
              Top Customer
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white mt-1">
              {stats.topCustomer.name}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {currencySymbol} {formatNumber(stats.topCustomer.amount, 0)}{" "}
              across {stats.topCustomer.count} payment
              {stats.topCustomer.count !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-xl p-4 border border-blue-200 dark:border-indigo-800">
            <p className="text-[10px] text-blue-600 font-medium uppercase">
              Period
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white mt-1">
              {stats.dateRange.from || "N/A"} to {stats.dateRange.to || "N/A"}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400">
              {stats.onlinePayments} online payment
              {stats.onlinePayments !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}

      {/* ===== Balance Analysis: True Inflow Detection ===== */}
      {stats && stats.balanceAnalysis.recordedNet > 0 && (
        <div
          className={`rounded-xl border p-4 ${
            stats.balanceAnalysis.hasUnrecorded
              ? "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 border-amber-200 dark:border-amber-800"
              : "bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10 border-emerald-200 dark:border-emerald-800"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <Shield
              size={16}
              className={
                stats.balanceAnalysis.hasUnrecorded
                  ? "text-amber-500"
                  : "text-emerald-500"
              }
            />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Balance Analysis: True Inflow
            </h3>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                stats.balanceAnalysis.hasUnrecorded
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {stats.balanceAnalysis.confidence}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {currencySymbol}{" "}
                {formatNumber(stats.balanceAnalysis.recordedNet, 0)}
              </p>
              <p className="text-[9px] text-gray-500">Recorded Net (Paid In)</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {currencySymbol}{" "}
                {formatNumber(stats.balanceAnalysis.trueInflow, 0)}
              </p>
              <p className="text-[9px] text-gray-500">
                True Inflow (Balance Delta +)
              </p>
            </div>
            <div
              className={`bg-white dark:bg-gray-800 rounded-lg p-3 border text-center ${
                stats.balanceAnalysis.hasUnrecorded
                  ? "border-amber-300 dark:border-amber-700"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <p
                className={`text-lg font-bold ${stats.balanceAnalysis.hasUnrecorded ? "text-amber-600 dark:text-amber-400" : "text-gray-600 dark:text-gray-500 dark:text-gray-400"}`}
              >
                {currencySymbol}{" "}
                {formatNumber(stats.balanceAnalysis.unrecordedInflow, 0)}
              </p>
              <p className="text-[9px] text-gray-500">Unrecorded Inflow</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {Number.isFinite(stats.balanceAnalysis.discrepancy)
                  ? `${stats.balanceAnalysis.discrepancy.toFixed(1)}%`
                  : "—"}
              </p>
              <p className="text-[9px] text-gray-500">Discrepancy Rate</p>
            </div>
          </div>

          {stats.balanceAnalysis.hasUnrecorded && (
            <div className="flex items-start gap-2 p-2 bg-amber-100 dark:bg-amber-900/20 rounded-lg">
              <AlertTriangle
                size={14}
                className="text-amber-500 flex-shrink-0 mt-0.5"
              />
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                <strong>Warning:</strong> The receipt parser detected{" "}
                <strong>
                  {currencySymbol}{" "}
                  {formatNumber(stats.balanceAnalysis.unrecordedInflow, 0)}
                </strong>{" "}
                in unrecorded inflows. The statement Balance column shows higher
                growth than the parsed receipts, suggesting some transactions
                were omitted or could not be parsed. Consider using the Balance
                delta method for your financial reporting.
              </p>
            </div>
          )}

          {!stats.balanceAnalysis.hasUnrecorded &&
            stats.balanceAnalysis.confidence.includes("High") && (
              <div className="flex items-start gap-2 p-2 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg">
                <CheckCircle2
                  size={14}
                  className="text-emerald-500 flex-shrink-0 mt-0.5"
                />
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  <strong>Good:</strong> Recorded inflows match the Balance
                  column. The parser captured all transactions accurately.
                </p>
              </div>
            )}
        </div>
      )}

      {/* Range Filter Section */}
      {inflowData.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/10 dark:to-purple-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4">
          <button
            onClick={() => setShowRangeFilter(!showRangeFilter)}
            className="flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2"
          >
            <Calculator size={16} /> Range Filter: Total Valid Inflow
            <span className="text-xs text-indigo-500">
              {showRangeFilter ? "(hide)" : "(show)"}
            </span>
          </button>
          {showRangeFilter && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase mb-1 block">
                    Receipt No (e.g. UED9N3YOMC)
                  </label>
                  <input
                    type="text"
                    value={receiptFilter}
                    onChange={(e) =>
                      setReceiptFilter(e.target.value.toUpperCase())
                    }
                    placeholder="UED9N3YOMC"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono dark:text-gray-900 dark:text-white uppercase"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase mb-1 block">
                    From (Date/Time)
                  </label>
                  <input
                    type="datetime-local"
                    value={timeRangeStart}
                    onChange={(e) => setTimeRangeStart(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase mb-1 block">
                    To (Date/Time)
                  </label>
                  <input
                    type="datetime-local"
                    value={timeRangeEnd}
                    onChange={(e) => setTimeRangeEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    let rf = inflowData;
                    if (receiptFilter.trim()) {
                      rf = rf.filter((r) =>
                        r.receipt
                          .toUpperCase()
                          .includes(receiptFilter.toUpperCase()),
                      );
                    }
                    if (timeRangeStart) {
                      const start = new Date(timeRangeStart).getTime();
                      rf = rf.filter((r) => {
                        const d = new Date(
                          `${r.date}T${r.time || "00:00:00"}`,
                        ).getTime();
                        return !isNaN(d) && d >= start;
                      });
                    }
                    if (timeRangeEnd) {
                      const end = new Date(timeRangeEnd).getTime();
                      rf = rf.filter((r) => {
                        const d = new Date(
                          `${r.date}T${r.time || "23:59:59"}`,
                        ).getTime();
                        return !isNaN(d) && d <= end;
                      });
                    }
                    const total = rf.reduce((s, r) => s + r.paidIn, 0);
                    setRangeFilterTotal(total);
                    setRangeFilterCount(rf.length);
                    // Apply the filter to the visible table (was missing —
                    // the old code computed the total but left the table
                    // showing ALL rows).
                    setRangeFiltered(rf);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white rounded-lg text-xs font-semibold flex items-center gap-2"
                >
                  <Calculator size={14} /> Calculate Total
                </button>
                <button
                  onClick={() => {
                    setReceiptFilter("");
                    setTimeRangeStart("");
                    setTimeRangeEnd("");
                    setRangeFilterTotal(null);
                    setRangeFilterCount(0);
                    setRangeFiltered(null);
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold flex items-center gap-2"
                >
                  <X size={14} /> Reset
                </button>
              </div>
              {rangeFilterTotal !== null && (
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-indigo-200">
                  <p className="text-xs text-gray-500">Filtered Result:</p>
                  <p className="text-xl font-bold text-indigo-700 dark:text-indigo-400">
                    {currencySymbol} {formatNumber(rangeFilterTotal, 2)}
                  </p>
                  <p className="text-xs text-gray-500">
                    from {rangeFilterCount} transaction
                    {rangeFilterCount !== 1 ? "s" : ""}
                    {receiptFilter
                      ? ` matching receipt "${receiptFilter}"`
                      : ""}
                    {timeRangeStart || timeRangeEnd ? ` within time range` : ""}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inflows Table */}
      {inflowData.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp size={18} className="text-green-500" />
              Inflows ({filtered.length.toLocaleString()}
              {searchTerm || rangeFiltered
                ? ` of ${inflowData.length.toLocaleString()}`
                : ""}
              )
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search details, receipt, amount…"
                className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white w-48"
              />
              <button
                onClick={exportCSV}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <Download size={14} /> CSV
              </button>
              {inflowData.length > 0 && (
                <button
                  onClick={handleClearAllData}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-2"
                  title="Remove all extracted inflow data (local + cloud) to save space and keep the analyzer focused on current data"
                >
                  <Trash2 size={14} /> Clear All
                </button>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700 z-10">
                  <tr className="border-b border-gray-200 dark:border-gray-600">
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300 w-[50%]">
                      Details
                    </th>
                    <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300">
                      Paid In
                    </th>
                    <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300">
                      Balance
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300">
                      Receipt
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/10"
                    >
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                        <div className="flex items-center gap-1.5">
                          {item.isOnline && (
                            <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">
                              Online
                            </span>
                          )}
                          <span>{item.details}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400">
                        {formatNumber(item.paidIn, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-500 dark:text-gray-400">
                        {formatNumber(item.balance, 2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                        {item.receipt}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {item.date} {item.time}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && searchTerm && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                No matches for &quot;{searchTerm}&quot;
              </p>
            )}
          </div>
        </>
      )}

      {/* ===== Shared Live Feed (interlinked with Live Transaction) ===== */}
      {sharedTxns.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-2xl border border-blue-200 dark:border-blue-800 p-4">
          <button
            onClick={() => setShowLiveFeed(!showLiveFeed)}
            className="flex items-center justify-between w-full text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2"
          >
            <span className="flex items-center gap-2">
              <CreditCard size={16} />
              Shared Transaction Feed
              <span className="text-xs text-blue-500 font-normal">
                (interlinked with Live Transaction — {sharedTxns.length} total)
              </span>
            </span>
            <span className="text-xs text-blue-500">
              {showLiveFeed ? "(hide)" : "(show)"}
            </span>
          </button>
          {showLiveFeed && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {sharedTxns.slice(0, 50).map((tx) => (
                <div
                  key={tx.id}
                  className={`flex items-center justify-between p-3 rounded-lg border-l-4 ${
                    tx.origin === "stk_push"
                      ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                      : tx.origin === "statement"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                        {currencySymbol} {formatNumber(tx.amount, 2)}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded ${
                          tx.status === "completed"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : tx.status === "pending"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {tx.status}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-500 dark:text-gray-400">
                        {tx.origin === "stk_push"
                          ? "STK Push"
                          : tx.origin === "statement"
                            ? "Statement"
                            : tx.origin}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {tx.sender_info || tx.description} • Ref:{" "}
                      {tx.transaction_ref}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-3">
                    {(() => {
                      // Guard against "Invalid Date" when transaction_time is
                      // empty/missing (was `new Date(tx.transaction_time).toLocaleString()`
                      // which rendered "Invalid Date" for statement imports
                      // with no date).
                      if (!tx.transaction_time) return "—";
                      const d = new Date(tx.transaction_time);
                      return isNaN(d.getTime()) ? "—" : d.toLocaleString();
                    })()}
                  </div>
                </div>
              ))}
              {sharedTxns.length > 50 && (
                <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">
                  Showing 50 of {sharedTxns.length} — open Live Transaction tab
                  for full feed
                </p>
              )}
              <button
                onClick={() => switchToTab("livetransaction")}
                className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                <Radio size={14} /> Open Live Transaction Tab
                <ArrowRight size={14} />
              </button>
              {/* Cross-tab interlinks — let the user act on the analyzed
                  inflows without re-entering data. Was missing entirely. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <button
                  onClick={() => navigateToTab("integration")}
                  className="py-2 bg-purple-600 hover:bg-purple-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  title="Configure M-PESA Daraja / Kopo Kopo in Integration Hub"
                >
                  <Link2 size={12} /> Integration Hub
                </button>
                <button
                  onClick={() => navigateToTab("invoice")}
                  className="py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  title="Create an invoice for a customer"
                >
                  <FileText size={12} /> New Invoice
                </button>
                <button
                  onClick={() => navigateToTab("credit")}
                  className="py-2 bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  title="Manage customer credit accounts"
                >
                  <CreditCard size={12} /> Credit
                </button>
                <button
                  onClick={() => navigateToTab("expenses")}
                  className="py-2 bg-rose-600 hover:bg-rose-700 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                  title="Record an expense"
                >
                  <Wallet size={12} /> Expenses
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
