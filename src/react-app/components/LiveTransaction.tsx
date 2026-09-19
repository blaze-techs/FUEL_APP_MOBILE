import { useState, useEffect } from "react";
import {
  CreditCard,
  Phone,
  Building2,
  Search,
  DollarSign,
  Clock,
  RefreshCw,
  Edit,
  Trash2,
  AlertTriangle,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  BarChart3,
  ArrowRight,
  TrendingUp,
  Users,
  FileText,
  Plug,
  Smartphone,
  Wallet,
  HandCoins,
  Settings,
  Link2,
  ExternalLink,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
  getDetectedCurrency,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import {
  getTransactions,
  addTransaction,
  updateTransaction,
  subscribeToTransactions,
  calculateSummary,
  switchToTab,
  onTabPayload,
  navigateToTab,
  type StkPushPrefill,
  type CreditPrefill,
  getMpesaConfig,
  getKopokopoConfig,
  getPayheroConfig,
  type UnifiedTransaction,
  type TransactionSummary,
  type MpesaIntegrationConfig,
  type KopokopoIntegrationConfig,
  type PayheroIntegrationConfig,
} from "@/react-app/lib/mpesa-integration-service";
import { formatNumber } from "@/react-app/utils/formatUtils";
import MobileMoneyFloat from "@/react-app/components/MobileMoneyFloat";

// Country ISO code → international dialing code. Covers every country where
// M-PESA-equivalent STK Push / mobile money is commonly used, plus all major
// countries, so the phone formatter is country-aware (was hardcoded +254 KE).
const DIALING_CODES: Record<string, string> = {
  KE: "254",
  UG: "256",
  TZ: "255",
  NG: "234",
  GH: "233",
  ZA: "27",
  RW: "250",
  ET: "251",
  IN: "91",
  US: "1",
  GB: "44",
  AE: "971",
  SA: "966",
  EG: "20",
  ZM: "260",
  MW: "265",
  MZ: "258",
  BW: "267",
  NA: "264",
  SL: "232",
  LR: "231",
  GM: "220",
  SN: "221",
  CI: "225",
  CM: "237",
  CG: "242",
  CD: "243",
  AO: "244",
  SD: "249",
  MA: "212",
  DZ: "213",
  TN: "216",
  LY: "218",
  PK: "92",
  BD: "880",
  ID: "62",
  PH: "63",
  MY: "60",
  TH: "66",
  VN: "84",
  CN: "86",
  JP: "81",
  KR: "82",
  AU: "61",
  NZ: "64",
  CA: "1",
  BR: "55",
  MX: "52",
  AR: "54",
  CL: "56",
  CO: "57",
  PE: "51",
  TR: "90",
  RU: "7",
  DE: "49",
  FR: "33",
  IT: "39",
  ES: "34",
  NL: "31",
  PT: "351",
  SE: "46",
  NO: "47",
  DK: "45",
  FI: "358",
  PL: "48",
};
function getDialingCode(): string {
  const cc = getDetectedCountryCode();
  return DIALING_CODES[cc] || "1";
}

interface PaymentSource {
  id: number;
  source_type: string;
  source_name: string;
  identifier: string;
  account_info: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface LiveTransaction {
  id: string;
  transaction_ref: string;
  transaction_type: string;
  amount: number;
  currency: string;
  sender_info: string;
  description: string;
  status: string;
  payment_method: string;
  transaction_time: string;
  source_name?: string;
  source_type?: string;
}

interface STKPushRequest {
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
}

export default function LiveTransaction() {
  const { state } = useFuel();
  const { user, token } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  // State management
  const [paymentSources, setPaymentSources] = useState<PaymentSource[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<LiveTransaction[]>(
    [],
  );
  const [filteredTransactions, setFilteredTransactions] = useState<
    LiveTransaction[]
  >([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal states
  const [showAddSource, setShowAddSource] = useState(false);
  const [showEditSource, setShowEditSource] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSTKPush, setShowSTKPush] = useState(false);
  const [selectedSource, setSelectedSource] = useState<PaymentSource | null>(
    null,
  );

  // Form states
  const [newSource, setNewSource] = useState({
    source_type: "mpesa_paybill",
    source_name: "",
    identifier: "",
    account_info: "",
  });

  const [stkPushData, setStkPushData] = useState<STKPushRequest>({
    phone_number: "",
    amount: 0,
    account_reference: "",
    transaction_desc: "",
  });

  const [stkPushStatus, setStkPushStatus] = useState<{
    loading: boolean;
    success: boolean;
    error: string;
    checkout_request_id?: string;
    pending?: boolean;
    pendingMessage?: string;
  }>({
    loading: false,
    success: false,
    error: "",
    pending: false,
  });

  // Manual payment recording (cash, bank transfer, M-PESA confirmation
  // received offline) — writes to the shared unified transaction store so
  // manual entries appear in the M-PESA Analyzer and across devices.
  const [showManualPayment, setShowManualPayment] = useState(false);
  const [manualPayment, setManualPayment] = useState<{
    sender_info: string;
    amount: number;
    account_reference: string;
    transaction_desc: string;
    payment_method: string;
    source_id: string;
  }>({
    sender_info: "",
    amount: 0,
    account_reference: "",
    transaction_desc: "",
    payment_method: "M-PESA",
    source_id: "",
  });

  // Shared unified transactions (interlinked with M-PESA Analyzer)
  const [sharedTxns, setSharedTxns] = useState<UnifiedTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);

  // Integration Hub linkage — M-PESA (Daraja) + Kopo Kopo config status,
  // so the STK Push and Add Source flows reflect whether a payment
  // integration is actually connected (configured in Integration Hub).
  const [mpesaConfig, setMpesaConfig] = useState<MpesaIntegrationConfig | null>(
    null,
  );
  const [kopoConfig, setKopoConfig] =
    useState<KopokopoIntegrationConfig | null>(null);
  const [payheroConfig, setPayheroConfig] =
    useState<PayheroIntegrationConfig | null>(null);
  const [stkProvider, setStkProvider] = useState<"mpesa" | "payhero">("mpesa");
  const mpesaConnected = !!(
    mpesaConfig?.enabled &&
    mpesaConfig?.consumerKey &&
    mpesaConfig?.consumerSecret &&
    mpesaConfig?.shortcode
  );
  const kopoConnected = !!(
    kopoConfig?.enabled &&
    kopoConfig?.tillNumber &&
    kopoConfig?.apiKey
  );
  const payheroConnected = !!(
    payheroConfig?.enabled &&
    payheroConfig?.apiUsername &&
    payheroConfig?.apiPassword &&
    payheroConfig?.channelId
  );

  // Load data on component mount.
  // NOTE: the 10s polling interval was removed — real-time Supabase
  // subscriptions (subscribeToTransactions below) push cross-device updates
  // instantly, so polling only burned bandwidth + risked overwriting an
  // in-progress edit with stale cloud data.
  useEffect(() => {
    if (user) {
      loadPaymentSources();
      loadLiveTransactions();
    }
  }, [user, stationId]);

  // Real-time subscription for payment sources so a source added/edited on
  // another device shows up instantly (was missing — only loaded on mount).
  useEffect(() => {
    if (!user) return;
    const unsub = cloudStorageService.subscribe<PaymentSource[]>(
      "payment_sources",
      stationId,
      (val) => {
        if (val && Array.isArray(val)) setPaymentSources(val);
      },
    );
    return () => unsub?.();
  }, [user, stationId]);

  // Load + subscribe to shared transactions (interlinked with M-PESA Analyzer)
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const txns = await getTransactions(stationId);
      if (mounted) {
        setSharedTxns(txns);
        setSummary(calculateSummary(txns));
      }
    })();
    const applyTransactions = (txns: UnifiedTransaction[]) => {
      const data = Array.isArray(txns) ? txns : [];
      setSharedTxns(data);
      setSummary(calculateSummary(data));
      setLiveTransactions(
        data.map((t) => ({
          id: String(t.id),
          transaction_ref: t.transaction_ref,
          transaction_type: t.transaction_type,
          amount: t.amount,
          currency: t.currency,
          sender_info: t.sender_info,
          description: t.description,
          status: t.status,
          payment_method: t.payment_method,
          transaction_time: t.transaction_time,
          source_name: t.source_name,
          source_type: t.source_type,
        })),
      );
    };

    const unsub = subscribeToTransactions(stationId, (txns) => {
      if (!mounted) return;
      applyTransactions(txns || []);
    });

    // Supabase Realtime is intentionally disabled by default to control
    // egress on the Free plan. The Live Transaction Monitor must still be
    // genuinely live, so use a lightweight 5-second reconciliation poll.
    // This also recovers automatically from missed realtime events.
    const refresh = async () => {
      if (!mounted || document.visibilityState === "hidden") return;
      try {
        const latest = await getTransactions(stationId);
        if (mounted) applyTransactions(latest);
      } catch (err) {
        console.warn("[LiveTransaction] background refresh failed:", err);
      }
    };
    const timer = setInterval(refresh, 5000);

    return () => {
      mounted = false;
      unsub();
      if (timer) clearInterval(timer);
    };
  }, [user, stationId]);

  // Load Integration Hub payment configs so STK Push / Add Source reflect
  // the real M-PESA Daraja + Kopo Kopo connection status.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const [mpesa, kopo, payhero] = await Promise.all([
        getMpesaConfig(stationId),
        getKopokopoConfig(stationId),
        getPayheroConfig(stationId),
      ]);
      if (!mounted) return;
      setMpesaConfig(mpesa);
      setKopoConfig(kopo);
      setPayheroConfig(payhero);
    })();
    return () => {
      mounted = false;
    };
  }, [user, stationId]);

  // Interlink receiver: another tab (Credit Management, Invoice) calls
  // navigateToTab("livetransaction", <StkPushPrefill>) to collect a payment —
  // pre-fill the STK Push form and open the modal.
  useEffect(() => {
    return onTabPayload("livetransaction", (raw) => {
      const p = (raw || {}) as StkPushPrefill;
      if (Object.keys(p).length === 0) return;
      setStkPushData((prev) => ({
        ...prev,
        phone_number: p.phone ? formatPhoneNumber(p.phone) : prev.phone_number,
        amount: p.amount ?? prev.amount,
        account_reference: p.account_reference ?? prev.account_reference,
        transaction_desc: p.transaction_desc ?? prev.transaction_desc,
      }));
      if (p.openStkPush) {
        setStkPushStatus({
          loading: false,
          success: false,
          error: "",
          pending: false,
        });
        setShowSTKPush(true);
      }
    });
  }, []);

  // Filter transactions when search parameters change
  useEffect(() => {
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);

      const filtered = liveTransactions.filter((tx) => {
        const txTime = new Date(tx.transaction_time);
        return txTime >= start && txTime <= end;
      });

      setFilteredTransactions(filtered);
    } else {
      setFilteredTransactions(liveTransactions);
    }
  }, [liveTransactions, startTime, endTime]);

  const loadPaymentSources = async () => {
    try {
      const sources =
        (await cloudStorageService.get<PaymentSource[]>(
          "payment_sources",
          stationId,
        )) || [];
      setPaymentSources(sources);
    } catch (error) {
      console.error("Error loading payment sources:", error);
      setError("Failed to load payment sources. Please try again.");
    }
  };

  const loadLiveTransactions = async () => {
    // The "Live Transaction Feed" must show the SAME records that
    // STK Push and the M-PESA Analyzer write to. Both write to the shared
    // `mpesa_transactions` store (mpesa-integration-service), so we read from
    // there — NOT the orphan `live_transactions` cloud key (which no code
    // anywhere writes, so the feed was permanently empty even though
    // transactions existed in the shared store).
    try {
      setIsRefreshing(true);
      const transactions = await getTransactions(stationId);
      // Map the shared UnifiedTransaction shape to the local LiveTransaction
      // view so the existing table render works unchanged.
      const mapped: LiveTransaction[] = transactions.map((t) => ({
        id: String(t.id),
        transaction_ref: t.transaction_ref,
        transaction_type: t.transaction_type,
        amount: t.amount,
        currency: t.currency,
        sender_info: t.sender_info,
        description: t.description,
        status: t.status,
        payment_method: t.payment_method,
        transaction_time: t.transaction_time,
        source_name: t.source_name,
        source_type: t.source_type,
      }));
      setLiveTransactions(mapped);
    } catch (error) {
      console.error("Error loading live transactions:", error);
      setError("Failed to load live transactions. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const addPaymentSource = async () => {
    if (!newSource.source_name.trim() || !newSource.identifier.trim()) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const existing =
        (await cloudStorageService.get<PaymentSource[]>(
          "payment_sources",
          stationId,
        )) || [];
      const newSourceRecord: PaymentSource = {
        id: Date.now(),
        source_type: newSource.source_type,
        source_name: newSource.source_name,
        identifier: newSource.identifier,
        account_info: newSource.account_info,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const updated = [...existing, newSourceRecord];
      await cloudStorageService.set<PaymentSource[]>(
        "payment_sources",
        updated,
        stationId,
      );

      setSuccess("Payment source added successfully");
      setShowAddSource(false);
      resetNewSource();
      setPaymentSources(updated);
    } catch (error) {
      console.error("Error adding payment source:", error);
      setError("Failed to add payment source. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const updatePaymentSource = async () => {
    if (
      !selectedSource ||
      !newSource.source_name.trim() ||
      !newSource.identifier.trim()
    ) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const existing =
        (await cloudStorageService.get<PaymentSource[]>(
          "payment_sources",
          stationId,
        )) || [];
      const updated = existing.map((source) =>
        source.id === selectedSource.id
          ? {
              ...source,
              source_type: newSource.source_type,
              source_name: newSource.source_name,
              identifier: newSource.identifier,
              account_info: newSource.account_info,
              updated_at: new Date().toISOString(),
            }
          : source,
      );
      await cloudStorageService.set<PaymentSource[]>(
        "payment_sources",
        updated,
        stationId,
      );

      setSuccess("Payment source updated successfully");
      setShowEditSource(false);
      setSelectedSource(null);
      resetNewSource();
      setPaymentSources(updated);
    } catch (error) {
      console.error("Error updating payment source:", error);
      setError("Failed to update payment source. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const deletePaymentSource = async () => {
    if (!selectedSource) return;

    try {
      setIsLoading(true);
      setError("");

      const existing =
        (await cloudStorageService.get<PaymentSource[]>(
          "payment_sources",
          stationId,
        )) || [];
      const updated = existing.filter(
        (source) => source.id !== selectedSource.id,
      );
      await cloudStorageService.set<PaymentSource[]>(
        "payment_sources",
        updated,
        stationId,
      );

      setSuccess("Payment source deleted successfully");
      setShowDeleteConfirm(false);
      setSelectedSource(null);
      setPaymentSources(updated);
    } catch (error) {
      console.error("Error deleting payment source:", error);
      setError("Failed to delete payment source. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const initiateStkPush = async () => {
    if (
      !stkPushData.phone_number ||
      !stkPushData.amount ||
      !stkPushData.account_reference
    ) {
      setStkPushStatus({
        loading: false,
        success: false,
        error: "Please fill in all required fields",
        pending: false,
      });
      return;
    }

    setStkPushStatus({
      loading: true,
      success: false,
      error: "",
      pending: false,
    });

    // Persist a durable pending record before contacting Daraja. The canonical
    // payment ledger remains the source of truth for settlement; this shared
    // feed is only the UI mirror used by the monitor and Analyzer.
    const checkoutRef = `STK_${crypto.randomUUID()}`;
    const currency = /^[A-Z]{3}$/.test(state.companyData?.currency || "")
      ? state.companyData?.currency
      : currentStation?.currency || getDetectedCurrency();
    const formattedPhone = formatPhoneNumber(stkPushData.phone_number);
    await addTransaction(
      {
        transaction_ref: checkoutRef,
        origin: "stk_push",
        transaction_type: "STK Push",
        amount: stkPushData.amount,
        currency,
        sender_info: formattedPhone,
        description: stkPushData.transaction_desc || "STK Push payment",
        status: "pending",
        payment_method: "M-PESA STK Push",
        transaction_time: new Date().toISOString(),
        account_reference: stkPushData.account_reference,
      },
      stationId,
    ).catch(() => {});

    // Refresh both feeds so the pending transaction appears immediately.
    loadLiveTransactions();

    // Route through the selected connected gateway. M-PESA remains the
    // default when both are configured; PayHero is automatically selected when
    // it is the only connected gateway.
    const usePayhero = stkProvider === "payhero" && payheroConnected && !!payheroConfig;
    const useMpesa = !usePayhero && mpesaReady;

    if (!useMpesa && !usePayhero) {
      setStkPushStatus({
        loading: false,
        success: false,
        error: "",
        pending: true,
        pendingMessage:
          "No connected STK gateway is ready. Configure M-PESA Daraja or PayHero Kenya in the Integration Hub.",
      });
      setStkPushData({
        phone_number: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
      });
      return;
    }

    try {
      let checkoutId: string | undefined;
      let gatewayLabel = "M-PESA";

      if (usePayhero) {
        const { payheroStkPush } =
          await import("@/react-app/lib/integrations-client");
        const data = await payheroStkPush(
          {
            apiUsername: payheroConfig!.apiUsername,
            apiPassword: payheroConfig!.apiPassword,
            channelId: payheroConfig!.channelId,
            accountReference:
              stkPushData.account_reference ||
              payheroConfig!.accountReference ||
              undefined,
          },
          {
            phoneNumber: formatPhoneNumber(stkPushData.phone_number),
            amount: stkPushData.amount,
            transactionDesc:
              stkPushData.transaction_desc || "Fuel purchase",
          },
        );
        if (!data.success) throw new Error(data.error || "PayHero rejected the STK request");
        checkoutId = data.reference
          ? String(data.reference)
          : data.checkout_request_id
            ? String(data.checkout_request_id)
            : undefined;
        gatewayLabel = "PayHero";
      } else {
        const { mpesaStkPush } =
          await import("@/react-app/lib/integrations-client");
        const data = await mpesaStkPush(
          {
            consumerKey: mpesaConfig!.consumerKey,
            consumerSecret: mpesaConfig!.consumerSecret,
            passkey: mpesaConfig!.passkey,
            shortcode: mpesaConfig!.shortcode,
            environment: mpesaConfig!.environment,
          },
          {
            phoneNumber: formatPhoneNumber(stkPushData.phone_number),
            amount: stkPushData.amount,
            accountReference: stkPushData.account_reference || "FuelPro",
            transactionDesc: stkPushData.transaction_desc || "STK Push payment",
          },
        );
        if (!data.success) throw new Error(data.error || "M-PESA rejected the STK request");
        checkoutId = data.checkout_request_id
          ? String(data.checkout_request_id)
          : undefined;
      }

      setStkPushStatus({
        loading: false,
        success: true,
        error: "",
        checkout_request_id: checkoutId,
      });
      if (checkoutId) startTransactionPolling(checkoutId, checkoutRef, usePayhero ? "payhero" : "mpesa");

      setSuccess(`${gatewayLabel} STK push sent successfully.`);
      setStkPushData({
        phone_number: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
      });
    } catch (error) {
      console.error("Error initiating STK push:", error);
      setStkPushStatus({
        loading: false,
        success: false,
        error: "",
        pending: true,
        pendingMessage:
          error instanceof Error
            ? error.message
            : "The payment gateway did not accept the request. The pending record remains visible in the M-PESA Analyzer.",
      });
      setStkPushData({
        phone_number: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
      });
    }
  };


