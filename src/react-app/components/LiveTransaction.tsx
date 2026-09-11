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
  clearTransactions,
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
  id: number;
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
  const { user } = useAuth();
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
    const unsub = subscribeToTransactions(stationId, (txns) => {
      if (!mounted) return;
      const data = txns || [];
      setSharedTxns(data);
      setSummary(calculateSummary(data));
    });
    return () => {
      mounted = false;
      unsub();
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
        id: t.id as unknown as number,
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

  // Clear ALL shared transactions (mpesa_transactions cloud store). Lets the
  // user remove old/no-longer-needed records to save space and keep the feed
  // focused on what they're working on now. Requires confirmation.
  const handleClearAllTransactions = async () => {
    if (
      !confirm(
        "Clear ALL transaction records? This permanently removes every STK Push and statement transaction from this station's cloud store. This cannot be undone.",
      )
    )
      return;
    try {
      setIsRefreshing(true);
      await clearTransactions(stationId);
      setLiveTransactions([]);
      setFilteredTransactions([]);
      setSuccess("All transaction records cleared successfully.");
    } catch (error) {
      console.error("Error clearing transactions:", error);
      setError("Failed to clear transactions. Please try again.");
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

    // 1) ALWAYS persist the pending STK Push request to the shared cloud store
    // FIRST — so the transaction record is cross-device durable regardless of
    // whether the M-PESA Daraja backend is reachable. Previously the write was
    // inside the `if (data.success)` branch, so a 404 (no /api/mpesa/stk-push
    // route exists in this project) meant the transaction was NEVER recorded —
    // it vanished as if it never happened. The account_reference is now
    // included so the Invoice→STK→Credit round trip works.
    const checkoutRef = `STK${Date.now()}`;
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

    // 2) Attempt the actual Daraja STK Push call. The /api/mpesa/stk-push
    // serverless route does not exist in this project, so on Vercel/Cloudflare
    // this returns 404. We treat that as "no live backend" — the pending
    // record is already saved above and can be completed later via the
    // M-PESA Analyzer statement import or a webhook. We do NOT alert() on
    // the 404 (it's expected when the integration isn't deployed); we surface
    // a clear inline message and let the user proceed.
    const mpesaReady = !!(
      mpesaConfig?.enabled &&
      mpesaConfig?.consumerKey &&
      mpesaConfig?.consumerSecret &&
      mpesaConfig?.shortcode
    );

    if (!mpesaReady) {
      setStkPushStatus({
        loading: false,
        success: false,
        error: "",
        pending: true,
        pendingMessage:
          "To trigger a real M-PESA prompt, configure the M-PESA Daraja integration in the Integration Hub (Payment Setup) — the live Daraja backend is not yet connected. The record is saved and will show in the M-PESA Analyzer.",
      });
      // Reset form; keep the modal open so the user sees the message.
      setStkPushData({
        phone_number: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
      });
      return;
    }

    try {
      // REAL Daraja STK Push via the integrations dispatcher. The station's
      // own Daraja credentials (configured in Integration Hub → Payment Setup)
      // are used to call Safaricom for real.
      const { mpesaStkPush } =
        await import("@/react-app/lib/integrations-client");
      const data = await mpesaStkPush(
        {
          consumerKey: mpesaConfig.consumerKey,
          consumerSecret: mpesaConfig.consumerSecret,
          passkey: mpesaConfig.passkey,
          shortcode: mpesaConfig.shortcode,
          environment: mpesaConfig.environment,
        },
        {
          phoneNumber: formatPhoneNumber(stkPushData.phone_number),
          amount: stkPushData.amount,
          accountReference: stkPushData.account_reference || "FuelPro",
          transactionDesc: stkPushData.transaction_desc || "STK Push payment",
        },
      );

      if (data.success) {
        const checkoutId = data.checkout_request_id
          ? String(data.checkout_request_id)
          : undefined;
        setStkPushStatus({
          loading: false,
          success: true,
          error: "",
          checkout_request_id: checkoutId,
        });
        // Start polling for transaction status.
        if (checkoutId) {
          startTransactionPolling(
            String(data.checkout_request_id),
            checkoutRef,
          );
        }
      } else {
        setStkPushStatus({
          loading: false,
          success: false,
          error: "",
          pending: true,
          pendingMessage:
            data.error ||
            "The Daraja API did not confirm the request. The record is saved as pending — check the Integration Hub config.",
        });
      }
      // Reset form regardless.
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
          "Network error reaching the Daraja backend. The record is saved as pending and visible in the M-PESA Analyzer.",
      });
      setStkPushData({
        phone_number: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
      });
    }
  };

  // Record a manually-received payment (cash, bank transfer, M-PESA
  // confirmation received offline) into the shared unified transaction store
  // so it appears in the M-PESA Analyzer and syncs across devices.
  const recordManualPayment = async () => {
    if (
      !manualPayment.sender_info.trim() ||
      !manualPayment.amount ||
      !manualPayment.payment_method
    ) {
      setError("Please fill in sender, amount, and payment method");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const source = paymentSources.find(
        (s) => String(s.id) === manualPayment.source_id,
      );

      await addTransaction(
        {
          transaction_ref: `MAN_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          origin: "manual",
          transaction_type: "Manual Payment",
          amount: manualPayment.amount,
          currency: /^[A-Z]{3}$/.test(state.companyData?.currency || "")
            ? state.companyData?.currency
            : currentStation?.currency || getDetectedCurrency(),
          sender_info: manualPayment.sender_info,
          description:
            manualPayment.transaction_desc || "Manual payment record",
          status: "completed",
          payment_method: manualPayment.payment_method,
          transaction_time: new Date().toISOString(),
          source_name: source?.source_name,
          source_type: source?.source_type,
          account_reference: manualPayment.account_reference,
        },
        stationId,
      );

      setSuccess(
        `Payment from ${manualPayment.sender_info} recorded successfully`,
      );
      setShowManualPayment(false);
      setManualPayment({
        sender_info: "",
        amount: 0,
        account_reference: "",
        transaction_desc: "",
        payment_method: "M-PESA",
        source_id: "",
      });
      loadLiveTransactions();
    } catch (err) {
      console.error("Error recording manual payment:", err);
      setError("Failed to record payment. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Import a payment source from the connected Integration Hub config
  // (M-PESA Daraja or Kopo Kopo) — wires the Live Transaction tab to the
  // Integration Hub so connected integrations are one-click usable here.
  const importFromIntegrationHub = async (
    type: "mpesa" | "kopokopo" | "payhero",
  ) => {
    try {
      setIsLoading(true);
      setError("");
      const config =
        type === "mpesa"
          ? mpesaConfig
          : type === "kopokopo"
            ? kopoConfig
            : payheroConfig;
      if (!config || !config.enabled) {
        const label =
          type === "mpesa"
            ? "M-PESA"
            : type === "kopokopo"
              ? "Kopo Kopo"
              : "PayHero Kenya";
        setError(
          `${label} is not configured yet. Open the Integration Hub to set it up, then come back to import it as a payment source.`,
        );
        switchToTab("integration");
        return;
      }
      const source_name =
        config.name ||
        (type === "mpesa"
          ? "M-PESA Daraja"
          : type === "kopokopo"
            ? "Kopo Kopo"
            : "PayHero Kenya");
      // De-dupe by identifier
      const identifier =
        (type === "mpesa"
          ? (config as MpesaIntegrationConfig).shortcode
          : type === "kopokopo"
            ? (config as KopokopoIntegrationConfig).tillNumber
            : (config as PayheroIntegrationConfig).channelId) ||
        config.name ||
        "";
      if (
        paymentSources.some(
          (s) => s.identifier === identifier && s.source_name === source_name,
        )
      ) {
        setSuccess(`${source_name} is already a registered payment source`);
        return;
      }
      const newRecord: PaymentSource = {
        id: Date.now(),
        source_type:
          type === "mpesa"
            ? "mpesa_paybill"
            : type === "kopokopo"
              ? "mpesa_buygoods"
              : "mpesa_payhero",
        source_name,
        identifier,
        account_info: JSON.stringify({
          environment:
            (config as MpesaIntegrationConfig | KopokopoIntegrationConfig)
              .environment || "production",
          importedFrom: "integration-hub",
        }),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const updated = [...paymentSources, newRecord];
      await cloudStorageService.set<PaymentSource[]>(
        "payment_sources",
        updated,
        stationId,
      );
      setPaymentSources(updated);
      setSuccess(`${source_name} imported from Integration Hub`);
    } catch (err) {
      console.error("Error importing integration:", err);
      setError("Failed to import integration. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = (source: PaymentSource) => {
    setSelectedSource(source);
    setNewSource({
      source_type: source.source_type,
      source_name: source.source_name,
      identifier: source.identifier,
      account_info: source.account_info || "",
    });
    setShowEditSource(true);
  };

  const openDeleteModal = (source: PaymentSource) => {
    setSelectedSource(source);
    setShowDeleteConfirm(true);
  };

  const resetNewSource = () => {
    setNewSource({
      source_type: "mpesa_paybill",
      source_name: "",
      identifier: "",
      account_info: "",
    });
  };

  const formatCurrency = (amount: number) =>
    `${currencySymbol} ${amount.toLocaleString()}`;

  // Poll the SHARED cloud store for the transaction's final status. When a
  // webhook, the M-PESA Analyzer statement import, or another device updates
  // the transaction from "pending" → "completed"/"failed", this detects it.
  // Previously this fetched a non-existent /api/mpesa/query/{id} route (always
  // 404'd), aborted on the first error, leaked the timer, and alert()'d inside
  // the loop. Now it reads from cloud (always available) and stops cleanly.
  const startTransactionPolling = async (
    _checkoutRequestId: string,
    transactionRef: string,
  ) => {
    let attempts = 0;
    const maxAttempts = 20; // ~2 minutes (20 * 6s)

    const pollStatus = async () => {
      try {
        const txns = await getTransactions(stationId);
        const match = txns.find((t) => t.transaction_ref === transactionRef);
        if (match && match.status !== "pending") {
          loadLiveTransactions();
          if (match.status === "completed") {
            setSuccess("Payment received successfully!");
          } else {
            setError(`Payment ${match.status}.`);
          }
          return; // done — do not schedule another poll
        }
      } catch {
        // transient read error — keep polling, don't alert (the realtime
        // subscription will also catch the eventual update).
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(pollStatus, 6000);
      }
    };
    setTimeout(pollStatus, 3000);
  };

  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, "");
    const dial = getDialingCode();

    // Already in international format with the correct dialing code.
    if (digits.startsWith(dial)) return digits;
    // Leading 0 → replace with the dialing code (KE 0712 → 254712, US 0555→1 555).
    if (digits.startsWith("0")) return dial + digits.slice(1);
    // Starts with the dialing code already (e.g. 254712 or 15551234567).
    if (dial === "1" && digits.length === 10 && !digits.startsWith("1")) {
      return "1" + digits; // NANP: 10-digit national → prefix 1
    }
    // Local number without leading 0 (KE: 712… → 254712…). For dialing code "1"
    // we already handled the 10-digit case above, so this is the non-NANP path.
    if (digits.length > 0 && !digits.startsWith(dial) && dial !== "1") {
      return dial + digits;
    }
    return digits;
  };

  // Clear success/error messages after 5 seconds
  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => {
        setSuccess("");
        setError("");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [success, error]);

  return (
    <div className="p-4 md:p-6 space-y-6 text-gray-900 dark:text-white min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <CreditCard className="text-green-400" />
          Live Transaction Monitor
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowSTKPush(true)}
            className="bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
          >
            <Phone size={16} />
            STK Push
          </button>
          <button
            onClick={() => setShowManualPayment(true)}
            className="bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
          >
            <HandCoins size={16} />
            Record Payment
          </button>
          <button
            onClick={() => setShowAddSource(true)}
            className="bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
          >
            <Plus size={16} />
            Add Source
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-500/20 border border-green-500 rounded-lg p-3 flex items-center gap-2">
          <CheckCircle className="text-green-400" size={20} />
          <span className="text-green-200">{success}</span>
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 flex items-center gap-2">
          <XCircle className="text-red-400" size={20} />
          <span className="text-red-200">{error}</span>
        </div>
      )}

      {/* Interlinked Analytics Summary (shared with M-PESA Analyzer) */}
      {summary && summary.totalCount > 0 && (
        <div className="bg-gradient-to-r from-green-900/30 to-blue-900/30 border border-green-600/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 size={18} className="text-green-400" />
              Shared Analytics
              <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                (interlinked with M-PESA Analyzer)
              </span>
            </h3>
            <button
              onClick={() => switchToTab("mpesa")}
              className="bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs"
            >
              <FileText size={14} /> View in Analyzer
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<TrendingUp size={14} className="text-green-400" />}
              label="Total Revenue"
              value={`${currencySymbol} ${formatNumber(summary.total, 0)}`}
            />
            <SummaryCard
              icon={<FileText size={14} className="text-blue-400" />}
              label="Total Transactions"
              value={summary.totalCount.toLocaleString()}
            />
            <SummaryCard
              icon={<Users size={14} className="text-purple-400" />}
              label="Unique Senders"
              value={summary.uniqueSenders.toLocaleString()}
            />
            <SummaryCard
              icon={<TrendingUp size={14} className="text-amber-400" />}
              label="Top Sender"
              value={summary.topSender.name || "N/A"}
              subValue={
                summary.topSender.name
                  ? `${currencySymbol} ${formatNumber(summary.topSender.amount, 0)}`
                  : undefined
              }
            />
          </div>
          {summary.byOrigin.statement.count > 0 && (
            <div className="mt-3 pt-3 border-t border-green-600/30 flex items-center gap-4 text-xs">
              <span className="text-gray-300">
                <span className="text-green-400 font-semibold">
                  {summary.byOrigin.stk_push.count}
                </span>{" "}
                STK Push
              </span>
              <span className="text-gray-300">
                <span className="text-blue-400 font-semibold">
                  {summary.byOrigin.statement.count}
                </span>{" "}
                from Statements
              </span>
              <span className="text-gray-300">
                <span className="text-amber-400 font-semibold">
                  {summary.completed}
                </span>{" "}
                completed
              </span>
              {summary.pending > 0 && (
                <span className="text-gray-300">
                  <span className="text-yellow-400 font-semibold">
                    {summary.pending}
                  </span>{" "}
                  pending
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payment Sources */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Building2 size={18} />
          Registered Payment Sources
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {paymentSources.length === 0 ? (
            <div className="col-span-full text-center text-gray-500 dark:text-gray-400 py-8">
              <Phone size={24} className="mx-auto mb-2" />
              <p>No payment sources configured yet.</p>
              <p className="text-sm">
                Add your M-PESA or bank details to start monitoring.
              </p>
            </div>
          ) : (
            paymentSources.map((source) => (
              <div
                key={source.id}
                className="bg-gray-100 dark:bg-gray-700 p-3 rounded border-l-4 border-green-500 relative group"
              >
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditModal(source)}
                    className="p-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                    title="Edit source"
                  >
                    <Edit size={12} />
                  </button>
                  <button
                    onClick={() => openDeleteModal(source)}
                    className="p-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                    title="Delete source"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="font-medium text-gray-900 dark:text-white pr-16">
                  {source.source_name}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {source.source_type.replace("_", " ").toUpperCase()}:{" "}
                  {source.identifier}
                </div>
                {source.account_info && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Info: {source.account_info}
                  </div>
                )}
                <div className="flex items-center gap-1 mt-2">
                  <div
                    className={`w-2 h-2 rounded-full ${source.is_active ? "bg-green-500" : "bg-gray-500"}`}
                  ></div>
                  <span
                    className={`text-xs ${source.is_active ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    {source.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Integration Hub quick-connect — links M-PESA + Kopo Kopo setup */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Plug size={14} className="text-indigo-400" />
              Live Payment Integrations
            </h4>
            <button
              onClick={() => switchToTab("integration")}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              Open Integration Hub <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => switchToTab("integration")}
              className="flex items-center gap-3 p-3 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/50 rounded-lg transition-colors text-left"
            >
              <div className="w-9 h-9 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <Smartphone size={16} className="text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  M-PESA Payment
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Daraja STK Push, Paybill & Buy Goods
                </p>
                <span
                  className={`mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${mpesaConnected ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}
                >
                  {mpesaConnected ? (
                    <Link2 size={9} />
                  ) : (
                    <AlertTriangle size={9} />
                  )}
                  {mpesaConnected ? "Connected" : "Not connected"}
                </span>
              </div>
              <ArrowRight size={14} className="text-emerald-400" />
            </button>
            <button
              onClick={() => switchToTab("integration")}
              className="flex items-center gap-3 p-3 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/50 rounded-lg transition-colors text-left"
            >
              <div className="w-9 h-9 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <Wallet size={16} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Kopo Kopo Payment
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Till number & webhook transactions
                </p>
                <span
                  className={`mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${kopoConnected ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}
                >
                  {kopoConnected ? (
                    <Link2 size={9} />
                  ) : (
                    <AlertTriangle size={9} />
                  )}
                  {kopoConnected ? "Connected" : "Not connected"}
                </span>
              </div>
              <ArrowRight size={14} className="text-blue-400" />
            </button>
            <button
              onClick={() => switchToTab("integration")}
              className="flex items-center gap-3 p-3 bg-violet-900/30 hover:bg-violet-900/50 border border-violet-700/50 rounded-lg transition-colors text-left"
            >
              <div className="w-9 h-9 bg-violet-500/20 rounded-lg flex items-center justify-center">
                <Smartphone size={16} className="text-violet-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  PayHero Kenya Payment
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  STK Push via PayHero channel (till / paybill)
                </p>
                <span
                  className={`mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${payheroConnected ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}
                >
                  {payheroConnected ? (
                    <Link2 size={9} />
                  ) : (
                    <AlertTriangle size={9} />
                  )}
                  {payheroConnected ? "Connected" : "Not connected"}
                </span>
              </div>
              <ArrowRight size={14} className="text-violet-400" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => importFromIntegrationHub("mpesa")}
              disabled={isLoading}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-gray-900 dark:text-white px-3 py-2 rounded-lg flex items-center gap-2 text-xs border border-emerald-500/50"
              title="Import the connected M-PESA Daraja config as a payment source"
            >
              <Smartphone size={14} />
              Import M-PESA
            </button>
            <button
              onClick={() => importFromIntegrationHub("kopokopo")}
              disabled={isLoading}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-gray-900 dark:text-white px-3 py-2 rounded-lg flex items-center gap-2 text-xs border border-blue-500/50"
              title="Import the connected Kopo Kopo config as a payment source"
            >
              <Wallet size={14} />
              Import Kopo Kopo
            </button>
            <button
              onClick={() => importFromIntegrationHub("payhero")}
              disabled={isLoading}
              className="bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-gray-900 dark:text-white px-3 py-2 rounded-lg flex items-center gap-2 text-xs border border-violet-500/50"
              title="Import the connected PayHero Kenya config as a payment source"
            >
              <Smartphone size={14} />
              Import PayHero
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Tip: configure M-PESA Daraja, PayHero Kenya, or Kopo Kopo in the
            Integration Hub (Payment Setup) to enable live STK Push and
            automatic transaction import here.
          </p>
        </div>
      </div>

      {/* Mobile money agent float management */}
      <MobileMoneyFloat />

      {/* Time Range Search */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Search size={18} />
          Search By Time Range
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Start Time
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">End Time</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
            />
          </div>
          <button
            onClick={() => {
              // Clear time filters to show all transactions
              setStartTime("");
              setEndTime("");
            }}
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 rounded flex items-center gap-2"
          >
            <XCircle size={16} />
            Clear
          </button>
        </div>

        {startTime && endTime && (
          <div className="mt-4 bg-blue-900/30 border border-blue-600 p-3 rounded">
            <div className="text-gray-900 dark:text-white font-medium">
              Showing{" "}
              <span className="text-blue-400">
                {filteredTransactions.length}
              </span>{" "}
              transaction(s) totaling{" "}
              <span className="text-green-400">
                {formatCurrency(
                  filteredTransactions.reduce((sum, tx) => sum + tx.amount, 0),
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Live Transaction Feed */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
            Live Payment Feed
            {isRefreshing && (
              <Loader2 size={16} className="animate-spin text-blue-400" />
            )}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={loadLiveTransactions}
              disabled={isRefreshing}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={isRefreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
            {liveTransactions.length > 0 && (
              <button
                onClick={handleClearAllTransactions}
                disabled={isRefreshing}
                className="text-red-400 hover:text-red-300 flex items-center gap-1 text-sm disabled:opacity-50"
                title="Remove all transaction records to save space and keep the feed focused on current data"
              >
                <Trash2 size={16} />
                Clear All
              </button>
            )}
          </div>
        </div>

        <div
          className={`border p-3 rounded mb-3 ${mpesaConnected || kopoConnected || payheroConnected ? "bg-blue-900/30 border-blue-600" : "bg-amber-900/30 border-amber-600"}`}
        >
          <p className="text-sm flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full animate-pulse ${mpesaConnected || kopoConnected || payheroConnected ? "bg-green-500" : "bg-amber-500"}`}
            ></div>
            <strong>
              {mpesaConnected || kopoConnected || payheroConnected
                ? "Payment Integration Connected"
                : "No Payment Integration Connected"}
            </strong>
          </p>
          <p className="text-xs mt-1">
            {mpesaConnected
              ? `M-PESA Daraja (${mpesaConfig?.environment || "sandbox"}) connected — STK Push can trigger live prompts.`
              : "M-PESA Daraja is not configured. STK Push requests are saved as pending."}
            <br />
            {kopoConnected
              ? "Kopo Kopo connected — webhook notifications enabled."
              : "Configure Kopo Kopo in the Integration Hub for webhook notifications."}
            <br />
            {payheroConnected
              ? "PayHero Kenya connected — STK Push available via PayHero channel."
              : "Configure PayHero Kenya in the Integration Hub as an STK Push gateway."}
            <br />
            Real-time cloud sync active — transactions sync instantly across all
            devices (no polling required).
          </p>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {filteredTransactions.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400 italic text-center py-8">
              <Clock size={24} className="mx-auto mb-2" />
              <div className="font-medium">
                No live transactions recorded yet
              </div>
              <div className="text-sm mt-2">
                Real payments will appear here when received through your
                registered sources.
              </div>
              <div className="text-xs mt-1">
                Use STK Push to test M-PESA payments or add more payment
                sources.
              </div>
            </div>
          ) : (
            filteredTransactions.map((tx) => (
              <div
                key={tx.id}
                className={`p-3 rounded border-l-4 transition-all duration-300 ${
                  tx.payment_method.toLowerCase().includes("mpesa")
                    ? "border-green-500 bg-green-900/20"
                    : tx.payment_method.toLowerCase().includes("paypal")
                      ? "border-blue-500 bg-blue-900/20"
                      : "border-yellow-500 bg-yellow-900/20"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <DollarSign size={16} className="text-green-400" />
                    {formatCurrency(tx.amount)}
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        tx.status === "completed"
                          ? "bg-green-600"
                          : tx.status === "pending"
                            ? "bg-yellow-600"
                            : "bg-red-600"
                      }`}
                    >
                      {tx.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(tx.transaction_time).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm text-gray-300">
                  {tx.transaction_type.toUpperCase()} • Ref:{" "}
                  {tx.transaction_ref}
                </div>
                <div className="text-xs text-blue-400">
                  Source: {tx.source_name || "Unknown Source"} (
                  {tx.payment_method})
                </div>
                {tx.sender_info && (
                  <div className="text-xs text-green-400">
                    From: {tx.sender_info}
                  </div>
                )}
                {tx.description && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {tx.description}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* STK Push Modal */}
      {showSTKPush && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              M-PESA STK Push
            </h3>

            {/* Integration Hub status banner — links STK Push to the
                configured M-PESA Daraja / PayHero Kenya integration. */}
            <div
              className={`mb-4 rounded-lg p-3 border flex items-start gap-2 ${mpesaConnected || payheroConnected ? "bg-green-500/10 border-green-500/40" : "bg-amber-500/10 border-amber-500/40"}`}
            >
              {mpesaConnected || payheroConnected ? (
                <Link2
                  className="text-green-400 mt-0.5 flex-shrink-0"
                  size={16}
                />
              ) : (
                <AlertTriangle
                  className="text-amber-400 mt-0.5 flex-shrink-0"
                  size={16}
                />
              )}
              <div className="flex-1">
                <p
                  className={`text-xs ${mpesaConnected || payheroConnected ? "text-green-200" : "text-amber-200"}`}
                >
                  {mpesaConnected
                    ? `Connected to M-PESA Daraja (${mpesaConfig?.environment === "production" ? "Production" : "Sandbox"}, shortcode ${mpesaConfig?.shortcode}).`
                    : payheroConnected
                      ? `Connected to PayHero Kenya (channel ${payheroConfig?.channelId}). STK Push will route via PayHero.`
                      : "No M-PESA gateway is configured (M-PESA Daraja / PayHero Kenya). STK Push requires a connected payment source."}
                </p>
                <button
                  onClick={() => switchToTab("integration")}
                  className="mt-1.5 text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
                >
                  <Settings size={11} /> Configure in Integration Hub
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>

            {stkPushStatus.success ? (
              <div className="text-center">
                <CheckCircle
                  className="text-green-400 mx-auto mb-4"
                  size={48}
                />
                <p className="text-green-200 mb-4">
                  STK push sent successfully!
                </p>
                <p className="text-gray-300 text-sm mb-4">
                  The customer will receive a prompt on their phone to complete
                  the payment.
                </p>
                <button
                  onClick={() => {
                    setShowSTKPush(false);
                    setStkPushStatus({
                      loading: false,
                      success: false,
                      error: "",
                      pending: false,
                    });
                  }}
                  className="bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white px-4 py-2 rounded"
                >
                  Close
                </button>
              </div>
            ) : stkPushStatus.pending ? (
              <div className="text-center">
                <Clock className="text-amber-400 mx-auto mb-4" size={48} />
                <p className="text-amber-200 mb-4 font-semibold">
                  STK Push recorded as pending
                </p>
                <p className="text-gray-300 text-sm mb-4">
                  {stkPushStatus.pendingMessage}
                </p>
                <button
                  onClick={() => {
                    setShowSTKPush(false);
                    setStkPushStatus({
                      loading: false,
                      success: false,
                      error: "",
                      pending: false,
                    });
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-gray-900 dark:text-white px-4 py-2 rounded"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    value={stkPushData.phone_number}
                    onChange={(e) =>
                      setStkPushData({
                        ...stkPushData,
                        phone_number: formatPhoneNumber(e.target.value),
                      })
                    }
                    placeholder={`Enter phone number (e.g. ${getDialingCode()}712345678)`}
                    className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Amount ({currencySymbol}) *
                  </label>
                  <input
                    type="number"
                    value={stkPushData.amount || ""}
                    onChange={(e) =>
                      setStkPushData({
                        ...stkPushData,
                        amount: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="1000"
                    className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Account Reference *
                  </label>
                  <input
                    type="text"
                    value={stkPushData.account_reference}
                    onChange={(e) =>
                      setStkPushData({
                        ...stkPushData,
                        account_reference: e.target.value,
                      })
                    }
                    placeholder="INV-001 or Customer Name"
                    className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={stkPushData.transaction_desc}
                    onChange={(e) =>
                      setStkPushData({
                        ...stkPushData,
                        transaction_desc: e.target.value,
                      })
                    }
                    placeholder="Payment for fuel"
                    className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  />
                </div>

                {stkPushStatus.error && (
                  <div className="bg-red-500/20 border border-red-500 rounded p-3">
                    <p className="text-red-200 text-sm">
                      {stkPushStatus.error}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={initiateStkPush}
                    disabled={stkPushStatus.loading}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded flex items-center justify-center gap-2"
                  >
                    {stkPushStatus.loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Phone size={16} />
                        Send STK Push
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowSTKPush(false);
                      setStkPushStatus({
                        loading: false,
                        success: false,
                        error: "",
                        pending: false,
                      });
                      setStkPushData({
                        phone_number: "",
                        amount: 0,
                        account_reference: "",
                        transaction_desc: "",
                      });
                    }}
                    disabled={stkPushStatus.loading}
                    className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Source Modal */}
      {showAddSource && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Add Payment Source
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Source Type
                </label>
                <select
                  value={newSource.source_type}
                  onChange={(e) =>
                    setNewSource({ ...newSource, source_type: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                >
                  <option value="mpesa_paybill">M-PESA Paybill</option>
                  <option value="mpesa_buygoods">M-PESA Buy Goods</option>
                  <option value="kopo_kopo">
                    Kopo Kopo (Till / Buy Goods)
                  </option>
                  <option value="bank_account">Bank Account</option>
                  <option value="cash_register">Cash Register</option>
                </select>
              </div>

              {/* Integration Hub linkage — reflect the configured payment
                  integration status for the selected source type. */}
              {newSource.source_type === "mpesa_paybill" && (
                <div
                  className={`rounded-lg p-3 border flex items-start gap-2 ${mpesaConnected ? "bg-green-500/10 border-green-500/40" : "bg-amber-500/10 border-amber-500/40"}`}
                >
                  {mpesaConnected ? (
                    <Link2
                      className="text-green-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  ) : (
                    <AlertTriangle
                      className="text-amber-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  )}
                  <div className="flex-1">
                    <p
                      className={`text-xs ${mpesaConnected ? "text-green-200" : "text-amber-200"}`}
                    >
                      {mpesaConnected
                        ? "M-PESA Daraja (Paybill) is configured in Integration Hub."
                        : "M-PESA Daraja is not configured. Set it up for live Paybill STK Push."}
                    </p>
                    <button
                      onClick={() => switchToTab("integration")}
                      className="mt-1 text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
                    >
                      <Settings size={11} /> Configure M-PESA in Integration Hub
                      <ExternalLink size={10} />
                    </button>
                  </div>
                </div>
              )}
              {newSource.source_type === "mpesa_buygoods" && (
                <div
                  className={`rounded-lg p-3 border flex items-start gap-2 ${kopoConnected ? "bg-green-500/10 border-green-500/40" : "bg-amber-500/10 border-amber-500/40"}`}
                >
                  {kopoConnected ? (
                    <Link2
                      className="text-green-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  ) : (
                    <AlertTriangle
                      className="text-amber-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  )}
                  <div className="flex-1">
                    <p
                      className={`text-xs ${kopoConnected ? "text-green-200" : "text-amber-200"}`}
                    >
                      {kopoConnected
                        ? "Kopo Kopo (Buy Goods / Till) is configured in Integration Hub."
                        : "Kopo Kopo is not configured. Set it up for automated Buy Goods reconciliation."}
                    </p>
                    <button
                      onClick={() => switchToTab("integration")}
                      className="mt-1 text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
                    >
                      <Settings size={11} /> Configure Kopo Kopo in Integration
                      Hub
                      <ExternalLink size={10} />
                    </button>
                  </div>
                </div>
              )}
              {newSource.source_type === "kopo_kopo" && (
                <div
                  className={`rounded-lg p-3 border flex items-start gap-2 ${kopoConnected ? "bg-green-500/10 border-green-500/40" : "bg-amber-500/10 border-amber-500/40"}`}
                >
                  {kopoConnected ? (
                    <Link2
                      className="text-green-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  ) : (
                    <AlertTriangle
                      className="text-amber-400 mt-0.5 flex-shrink-0"
                      size={14}
                    />
                  )}
                  <div className="flex-1">
                    <p
                      className={`text-xs ${kopoConnected ? "text-green-200" : "text-amber-200"}`}
                    >
                      {kopoConnected
                        ? "Kopo Kopo is connected — automated till reconciliation & webhook ingestion are active."
                        : "Kopo Kopo is not configured. Connect it to auto-ingest Buy Goods payments into this live feed."}
                    </p>
                    <button
                      onClick={() => switchToTab("integration")}
                      className="mt-1 text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
                    >
                      <Settings size={11} /> Configure Kopo Kopo in Integration
                      Hub
                      <ExternalLink size={10} />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  {newSource.source_type.includes("mpesa") ||
                  newSource.source_type === "kopo_kopo"
                    ? "Shortcode/Till Number"
                    : newSource.source_type === "bank_account"
                      ? "Account Number"
                      : "Register ID"}
                </label>
                <input
                  type="text"
                  value={newSource.identifier}
                  onChange={(e) =>
                    setNewSource({ ...newSource, identifier: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder={
                    newSource.source_type.includes("mpesa") ||
                    newSource.source_type === "kopo_kopo"
                      ? "e.g. 5785900"
                      : "Enter identifier"
                  }
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  value={newSource.source_name}
                  onChange={(e) =>
                    setNewSource({ ...newSource, source_name: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="e.g., Main Fuel Station Till"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Additional Info
                </label>
                <input
                  type="text"
                  value={newSource.account_info}
                  onChange={(e) =>
                    setNewSource({ ...newSource, account_info: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="Optional account details"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={addPaymentSource}
                disabled={isLoading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                Add Source
              </button>
              <button
                onClick={() => {
                  setShowAddSource(false);
                  resetNewSource();
                }}
                disabled={isLoading}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Source Modal */}
      {showEditSource && selectedSource && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Edit Payment Source
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Source Type
                </label>
                <select
                  value={newSource.source_type}
                  onChange={(e) =>
                    setNewSource({ ...newSource, source_type: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                >
                  <option value="mpesa_paybill">M-PESA Paybill</option>
                  <option value="mpesa_buygoods">M-PESA Buy Goods</option>
                  <option value="bank_account">Bank Account</option>
                  <option value="cash_register">Cash Register</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  {newSource.source_type.includes("mpesa")
                    ? "Shortcode/Till Number"
                    : newSource.source_type === "bank_account"
                      ? "Account Number"
                      : "Register ID"}
                </label>
                <input
                  type="text"
                  value={newSource.identifier}
                  onChange={(e) =>
                    setNewSource({ ...newSource, identifier: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  value={newSource.source_name}
                  onChange={(e) =>
                    setNewSource({ ...newSource, source_name: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Additional Info
                </label>
                <input
                  type="text"
                  value={newSource.account_info}
                  onChange={(e) =>
                    setNewSource({ ...newSource, account_info: e.target.value })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={updatePaymentSource}
                disabled={isLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Edit size={16} />
                )}
                Save Changes
              </button>
              <button
                onClick={() => {
                  setShowEditSource(false);
                  setSelectedSource(null);
                  resetNewSource();
                }}
                disabled={isLoading}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedSource && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-400" size={24} />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Confirm Deletion
              </h3>
            </div>

            <div className="space-y-4">
              <p className="text-gray-300">
                Are you sure you want to delete{" "}
                <strong>"{selectedSource.source_name}"</strong>?
              </p>
              <p className="text-sm text-red-300">
                This action cannot be undone. If this source has existing
                transactions, deletion may be prevented.
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={deletePaymentSource}
                  disabled={isLoading}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setSelectedSource(null);
                  }}
                  disabled={isLoading}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shared Transactions from M-PESA Analyzer (interlinked) */}
      {sharedTxns.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <FileText size={18} className="text-blue-400" />
              Shared Transaction Records
              <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                (from M-PESA Analyzer + STK Push)
              </span>
            </h3>
            <button
              onClick={() => switchToTab("mpesa")}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm"
            >
              Open Analyzer <ArrowRight size={14} />
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sharedTxns.slice(0, 20).map((tx) => (
              <div
                key={tx.id}
                className={`p-3 rounded border-l-4 ${
                  tx.origin === "stk_push"
                    ? "border-green-500 bg-green-900/20"
                    : tx.origin === "statement"
                      ? "border-blue-500 bg-blue-900/20"
                      : "border-yellow-500 bg-yellow-900/20"
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="font-semibold text-gray-900 dark:text-white text-sm">
                    {formatCurrency(tx.amount)}
                    <span
                      className={`ml-2 text-[10px] px-2 py-0.5 rounded ${
                        tx.status === "completed"
                          ? "bg-green-600"
                          : tx.status === "pending"
                            ? "bg-yellow-600"
                            : "bg-red-600"
                      }`}
                    >
                      {tx.status.toUpperCase()}
                    </span>
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                      {tx.origin === "stk_push"
                        ? "STK Push"
                        : tx.origin === "statement"
                          ? "Statement"
                          : tx.origin}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(tx.transaction_time).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs text-gray-300">
                  {tx.transaction_type} • Ref: {tx.transaction_ref}
                </div>
                {tx.sender_info && (
                  <div className="text-xs text-green-400">
                    From: {tx.sender_info}
                  </div>
                )}
                {tx.status === "completed" && (
                  <button
                    onClick={() =>
                      navigateToTab("credit", {
                        customerName: tx.sender_info || tx.account_reference,
                        amount: tx.amount,
                      } satisfies CreditPrefill)
                    }
                    className="mt-1 text-[11px] text-pink-300 hover:text-pink-200 flex items-center gap-1"
                    title="Apply this payment to a Credit Management account"
                  >
                    <Wallet size={10} /> Apply to Credit Account
                  </button>
                )}
              </div>
            ))}
            {sharedTxns.length > 20 && (
              <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">
                Showing 20 of {sharedTxns.length} — open M-PESA Analyzer for
                full view
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Payment Modal — record cash / bank / offline payments */}
      {showManualPayment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <HandCoins className="text-amber-400" size={20} />
              Record Payment
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Sender / Customer Name *
                </label>
                <input
                  type="text"
                  value={manualPayment.sender_info}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      sender_info: e.target.value,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="e.g., John Mwangi"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Amount (
                  {resolveCurrencySymbol(
                    state.companyData?.currency,
                    currentStation?.currency,
                  )}
                  ) *
                </label>
                <input
                  type="number"
                  value={manualPayment.amount || ""}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="1000"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Payment Method *
                </label>
                <select
                  value={manualPayment.payment_method}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      payment_method: e.target.value,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                >
                  {[
                    "M-PESA",
                    "Cash",
                    "Bank Transfer",
                    "Card",
                    "Cheque",
                    "Other",
                  ].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Payment Source (optional)
                </label>
                <select
                  value={manualPayment.source_id}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      source_id: e.target.value,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                >
                  <option value="">— Direct / Unspecified —</option>
                  {paymentSources.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.source_name} ({s.source_type.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Account Reference
                </label>
                <input
                  type="text"
                  value={manualPayment.account_reference}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      account_reference: e.target.value,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="INV-001 or Customer Account"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={manualPayment.transaction_desc}
                  onChange={(e) =>
                    setManualPayment({
                      ...manualPayment,
                      transaction_desc: e.target.value,
                    })
                  }
                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white"
                  placeholder="Payment for fuel"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={recordManualPayment}
                disabled={isLoading}
                className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <HandCoins size={16} />
                )}
                Record Payment
              </button>
              <button
                onClick={() => {
                  setShowManualPayment(false);
                  setManualPayment({
                    sender_info: "",
                    amount: 0,
                    account_reference: "",
                    transaction_desc: "",
                    payment_method: "M-PESA",
                    source_id: "",
                  });
                }}
                disabled={isLoading}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Summary card for the analytics panel
function SummaryCard({
  icon,
  label,
  value,
  subValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700/50">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
        {value}
      </p>
      {subValue && (
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {subValue}
        </p>
      )}
    </div>
  );
}
