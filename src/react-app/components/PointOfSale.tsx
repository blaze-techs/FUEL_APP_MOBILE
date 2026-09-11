import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Printer,
  CreditCard,
  Smartphone,
  Banknote,
  Receipt,
  X,
  Check,
  Settings,
  QrCode,
  Star,
  Award,
  Loader2,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import {
  navigateToTab,
  type FuelPricePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { formatNumber } from "@/react-app/utils/formatUtils";
import {
  CANONICAL_FUEL_TYPES,
  getVATRate,
  normalizeFuelType,
} from "@/react-app/config/pricing";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
  getCurrencyByCountry,
  getDetectedCountryCode,
  isKenyaStation,
} from "@/react-app/lib/currency";
import { getCountryById } from "@/react-app/config/countries";
import QRCode from "qrcode";
import { useLoyalty } from "@/react-app/lib/useLoyalty";
import { LoyaltyCustomer, TIER_COLORS } from "@/react-app/lib/loyaltyProgram";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { emit } from "@/react-app/lib/automation-engine";
import {
  addTransaction,
  getMpesaConfig,
  getPayheroConfig,
  type UnifiedTransaction,
} from "@/react-app/lib/mpesa-integration-service";
import {
  darajaConfigured,
  mpesaStkPush,
  mpesaStkQuery,
  payheroStkPush,
  payheroQueryStatus,
  payheroConfigured,
} from "@/react-app/lib/integrations-client";
import SubTabBar from "@/react-app/components/SubTabBar";
import SuccessCelebration from "@/react-app/components/ui/SuccessCelebration";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { resolveContractPrice } from "@/react-app/lib/contract-pricing";
import { lazy, Suspense } from "react";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const EnhancedPOSView = lazy(() =>
  import("@/react-app/features/pos-enhanced/EnhancedPOS").then((m) => ({
    default: m.default,
  })),
);

interface CartItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Canonical fuel-type label (e.g. "Super Petrol", "Diesel", "Kerosene",
   * "LPG"). Widened from "PMS"|"AGO" so ANY configured fuel type can be sold
   * and tracked — not just Petrol/Diesel. */
  fuelType?: string;
  litres?: number;
  vatCategory: "A" | "B" | "E"; // A=standard-rated, B=0%, E=Exempt
  hsCode?: string;
}

interface POSTransaction {
  id: string;
  items: CartItem[];
  subtotal: number;
  vatA: number; // Standard-rate VAT
  vatB: number; // 0% VAT
  vatE: number; // Exempt
  totalVat: number;
  total: number;
  paymentMethod: string;
  customerPhone?: string;
  customerName?: string;
  customerPin?: string;
  timestamp: string;
  receiptNumber: string;
  invoiceNumber: string;
  cashier: string;
  cuInvoiceNo: string;
  cuSignature: string;
  fiscalCounter: number;
  qrCodeData: string;
}

export default function PointOfSale() {
  const { state, dispatch } = useFuel();
  const { user } = useAuth();
  const { currentStation } = useStations();
  const [posView, setPosView] = useState<"standard" | "enhanced">("standard");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("pos", setPosView);
  const stationId = currentStation?.id;
  // Resolve currency symbol from companyData first, then the station record,
  // then the detected currency. This ensures a US station shows "$" even if
  // companyData.currency was stored as a symbol (e.g. "KSh") from a stale
  // session.
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  // A station is treated as Kenyan (KRA eTIMS / 16% VAT) when the
  // timezone+station-data detector resolves Kenya OR the station explicitly
  // carries a KRA PIN AND is in Kenya. The country gate on the KRA-PIN check
  // is essential: a US/EU station may have a leftover KRA PIN in its data
  // (e.g. from a template or migration) but must NOT be forced into the Kenya
  // tax regime. isKenyaStation() reads localStorage synchronously and may
  // return false on a fresh device before cloud station data hydrates, so we
  // also check currentStation.country directly as a fast path.
  const stationCountry = (
    (currentStation as { country?: string })?.country ||
    state.companyData?.country ||
    state.companyData?.county ||
    ""
  ).toUpperCase();
  const hasKraPin = Boolean(
    currentStation?.kraPin || state.companyData?.kraPin,
  );
  // Kenya tax regime (KRA eTIMS / 16% VAT) applies ONLY when we can
  // positively confirm the station is in Kenya. The old `hasKraPin &&
  // stationCountry !== "US"` gate was wrong: on a fresh device before
  // cloud hydration, stationCountry is "" (empty), so `!== "US"` was
  // true and a leftover KRA PIN forced Kenya mode on a US station.
  // Now we require an explicit "KE" country OR the timezone/station-data
  // detector to resolve Kenya. A KRA PIN alone NEVER activates Kenya mode.
  const kenyaStation =
    stationCountry === "KE" || (stationCountry === "" && isKenyaStation());
  const fuelTypeApi = useStationFuelTypes(stationId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "mpesa" | "card" | "bank"
  >("cash");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  // Customer Price Lists (Credit tab → Price Lists) — a contract-priced
  // customer gets their agreed price instead of the station's standard
  // price. Subscribing here keeps POS in sync without prop drilling.
  const { data: customerPriceRules } = useCloudKV<
    { id: string; customer: string; fuelType: string; price: number }[]
  >("customer_price_lists", stationId, []);
  const [customerPin, setCustomerPin] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);
  // Success celebration overlay (Peak-End rule, design spec file 7)
  const [showCelebration, setShowCelebration] = useState(false);
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [txnSearch, setTxnSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [currentTransaction, setCurrentTransaction] =
    useState<POSTransaction | null>(null);
  // Load POS transactions from cloud on mount (cross-device sync). The
  // `transactions` state is initialized from the synchronous in-memory cache
  // (getCached) so the first render is instant; the async cloud fetch then
  // refreshes it with the authoritative cross-device source of truth.
  const [transactions, setTransactions] = useState<POSTransaction[]>(() => {
    if (!user) return [];
    const cached = cloudStorageService.getCached<POSTransaction[]>(
      "pos_transactions",
      stationId,
    );
    if (cached && Array.isArray(cached)) return cached;
    try {
      const local = JSON.parse(
        localStorage.getItem("fuelpro_pos_transactions") || "[]",
      );
      if (Array.isArray(local)) return local;
    } catch {
      /* ignore */
    }
    return [];
  });
  const [fiscalCounter, setFiscalCounter] = useState(1);
  // Race-condition guard: prevents the async cloud-load effect from
  // overwriting local state (processPayment) before the load completes, and
  // prevents the real-time echo from wiping uncommitted local edits. Without
  // this, switching to the tab shows cached transactions for a glimpse then
  // the cloud load wipes them (the "flash then blank" bug).
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;
  // The selected quick-sale fuel — the canonical display LABEL of the active
  // fuel type (e.g. "Super Petrol", "Diesel", "Kerosene", "LPG"). Defaults to
  // the canonical petrol label so the first render works before cloud data
  // hydrates. The buttons below render dynamically from the station's active
  // fuel types (fuel_types_config), so a station with Kerosene/LPG/V-Power
  // configured can sell those from POS too — not just hardcoded Petrol/Diesel.
  const [quickSaleFuel, setQuickSaleFuel] = useState<string>(
    CANONICAL_FUEL_TYPES.petrol.label,
  );
  const [quickSaleLitres, setQuickSaleLitres] = useState("");
  const [customItemName, setCustomItemName] = useState("");
  const [customItemPrice, setCustomItemPrice] = useState("");
  const [stkPushStatus, setStkPushStatus] = useState<
    "idle" | "pending" | "success" | "failed"
  >("idle");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const receiptRef = useRef<HTMLDivElement>(null);

  // ─── Loyalty Integration ───
  // Use the REAL station id (not a LocationContext-derived value that may be
  // "default" / mismatched) so loyalty customers are scoped to the actual
  // station and cross-device cloud data resolves correctly.
  const loyaltyStationId = stationId || "default";
  const {
    earnPoints,
    findCustomerByPhone,
    findCustomerByCard,
    config: loyaltyConfig,
  } = useLoyalty(loyaltyStationId);
  const [loyaltyCustomer, setLoyaltyCustomer] =
    useState<LoyaltyCustomer | null>(null);
  const [showLoyaltyScanner, setShowLoyaltyScanner] = useState(false);

  // Loyalty lookup by phone or card number
  const lookupLoyaltyCustomer = useCallback(
    (input: string) => {
      let customer = findCustomerByPhone(input);
      if (!customer) {
        customer = findCustomerByCard(input);
      }
      setLoyaltyCustomer(customer || null);
      return customer;
    },
    [findCustomerByPhone, findCustomerByCard],
  );

  // Auto-lookup when phone changes
  useEffect(() => {
    if (customerPhone && customerPhone.length >= 7) {
      const found = lookupLoyaltyCustomer(customerPhone);
      if (!found) {
        setLoyaltyCustomer(null);
      }
    } else if (!customerPhone) {
      setLoyaltyCustomer(null);
    }
  }, [customerPhone, lookupLoyaltyCustomer]);

  // Refresh POS transactions from the authoritative cloud source on mount /
  // user / station change. The instant initial render comes from the
  // `transactions` useState initializer (cache/localStorage); this async fetch
  // resolves the true cross-device state and reconciles any divergence.
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      const cloud = await cloudStorageService.get<POSTransaction[]>(
        "pos_transactions",
        stationId,
      );
      if (
        !cancelled &&
        cloud &&
        Array.isArray(cloud) &&
        !localModifiedRef.current
      ) {
        setTransactions(cloud);
        // Seed the fiscal counter from the persisted sale history so invoice
        // numbers never collide across sessions/devices (a fresh device would
        // otherwise reset to #1 and re-generate today's invoice numbers).
        setFiscalCounter((prev) => Math.max(prev, cloud.length + 1));
      }
      if (!cancelled) cloudLoadCompleteRef.current = true;
    })();
    // Real-time cross-device sync: a sale completed on another device appears
    // in "Recent Transactions" instantly without a page reload.
    const unsub = cloudStorageService.subscribe<POSTransaction[]>(
      "pos_transactions",
      stationId,
      (val) => {
        if (!val || !Array.isArray(val) || localModifiedRef.current) return;
        setTransactions(val);
        setFiscalCounter((prev) => Math.max(prev, val.length + 1));
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, stationId]);

  // Post-load flush: if the user made changes before/during the cloud load,
  // re-push the latest local state to cloud so it's not lost.
  useEffect(() => {
    if (cloudLoadCompleteRef.current && localModifiedRef.current) {
      cloudStorageService
        .set("pos_transactions", transactionsRef.current, stationId)
        .catch(() => {});
    }
  }, [cloudLoadCompleteRef.current]);

  // Award points after successful transaction
  const awardLoyaltyPoints = (transaction: POSTransaction) => {
    if (!loyaltyCustomer || !loyaltyConfig?.isEnabled) return;

    // Calculate total liters from fuel items
    const fuelItems = transaction.items.filter((item) => item.litres);
    const totalLiters = fuelItems.reduce(
      (sum, item) => sum + (item.litres || 0),
      0,
    );
    const fuelType = fuelItems[0]?.fuelType || "PMS";

    if (totalLiters > 0) {
      earnPoints(
        loyaltyCustomer.id,
        transaction.id,
        transaction.total,
        totalLiters,
        fuelType,
        transaction.cashier || "POS",
      );

      // Refresh customer data
      setLoyaltyCustomer((prev) =>
        prev ? findCustomerByPhone(prev.phone) || prev : null,
      );
    }
  };

  // KRA ETR Settings from company data
  const etrConfig = {
    kraPin: state.companyData.kraPin || (kenyaStation ? "P000000000X" : ""),
    vatRegNo: state.companyData.vatRegNo || "",
    etrSerialNo: state.companyData.etrSerialNo || "ETR-00000000",
    cuSerialNo: state.companyData.cuSerialNo || "CU-00000000",
    invoicePrefix: state.companyData.etrInvoicePrefix || "INV",
    businessName: state.companyData.name || "FuelPro Station",
    address: state.companyData.physicalAddress || state.companyData.poBox || "",
    town: state.companyData.town || "",
    county: state.companyData.county || "",
    phone: state.companyData.contacts || "",
    email: state.companyData.email || "",
  };

  // Country-aware VAT rate: resolve the station's ISO country code and look it
  // up in the unified TAX_RATES table. Defaults to 0% only when the country is
  // genuinely unknown. Resolution order:
  //   1. The station's explicit country field (authoritative — set by the
  //      user during setup/wizard). A KRA PIN alone does NOT override a
  //      non-Kenyan country: a US/EU station may carry a leftover KRA PIN
  //      from a template but must use its own tax regime.
  //   2. If isKenyaStation() (timezone + station data detection) → KE.
  //   3. The browser/timezone-detected country code.
  //   4. "KE" as a final default (the app's primary market) — never 0% by
  //      accident, which would produce non-compliant receipts.
  const detectedCountryCode = getDetectedCountryCode();
  const countryCode = currentStation?.country
    ? currentStation.country
    : kenyaStation
      ? "KE"
      : detectedCountryCode || "KE";
  const VAT_RATE = getVATRate(countryCode);
  const vatPercent = (VAT_RATE * 100).toFixed(2);

  // Locale for date/number formatting — derived from the STATION's country
  // (never a hardcoded "en-KE"), so a German station formats dates in de-DE.
  // Falls back to the browser locale if the station country is unknown.
  const stationLocale = useMemo(() => {
    const profile = getCountryById(countryCode.toUpperCase());
    const langs = profile?.languages;
    const cc = profile?.id || countryCode;
    if (langs && langs.length > 0 && cc) {
      try {
        return new Intl.Locale(`${langs[0]}-${cc.toUpperCase()}`).toString();
      } catch {
        /* fall through */
      }
    }
    return undefined; // browser default
  }, [countryCode]);

  // Generate unique invoice number. The counter gives a human-readable
  // sequence; a short random suffix guarantees global uniqueness across
  // devices/sessions (two devices loading the same counter seed and selling
  // concurrently would otherwise collide on the same day).
  const generateInvoiceNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const counter = String(fiscalCounter).padStart(6, "0");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${etrConfig.invoicePrefix}${year}${month}${day}${counter}${suffix}`;
  };

  // Generate CU Invoice Number (Control Unit format)
  const generateCUInvoiceNo = () => {
    const date = new Date();
    const timestamp = date.getTime().toString().slice(-10);
    return `${etrConfig.cuSerialNo.slice(-8)}${timestamp}`;
  };

  // Generate verification signature (simulated - real implementation needs KRA API)
  const generateSignature = (invoiceNo: string, total: number) => {
    const data = `${invoiceNo}${total.toFixed(2)}${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash)
      .toString(16)
      .toUpperCase()
      .padStart(16, "0")
      .slice(0, 16);
  };

  // Generate QR code for receipt verification
  const generateQRData = async (
    transaction: Omit<POSTransaction, "qrCodeData">,
  ) => {
    const qrData = {
      pin: etrConfig.kraPin,
      inv: transaction.invoiceNumber,
      date: transaction.timestamp,
      total: transaction.total.toFixed(2),
      vat: transaction.totalVat.toFixed(2),
      cu: etrConfig.cuSerialNo,
      sig: transaction.cuSignature,
    };

    // Country-aware verification URL — Kenya stations validate at KRA iTax;
    // others use a generic FuelPro verification endpoint so the QR is never
    // hardcoded to a Kenya-only authority.
    const profile = getCountryById(countryCode.toUpperCase());
    const verifyUrl =
      profile?.fuelRegulations?.priceSettingBody &&
      countryCode.toUpperCase() === "KE"
        ? "https://itax.kra.go.ke/etims/validate"
        : `${window.location.origin}/verify`;
    const qrString = `${verifyUrl}?data=${encodeURIComponent(JSON.stringify(qrData))}`;

    try {
      const qrUrl = await QRCode.toDataURL(qrString, {
        width: 120,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      return { qrString, qrUrl };
    } catch (err) {
      console.error("QR generation error:", err);
      return { qrString, qrUrl: "" };
    }
  };

  const generateReceiptNumber = () => {
    const date = new Date();
    const prefix = "FP";
    const timestamp = date.getTime().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    return `${prefix}${timestamp}${random}`;
  };

  const addFuelToCart = () => {
    const litres = parseFloat(quickSaleLitres) || 0;
    if (litres <= 0) return;

    const label = quickSaleFuel;
    // Use the unified bus-fresh price (falls back to legacy state field if the
    // station has no matching fuel_types_config entry) so the charged total
    // always matches the displayed per-litre price.
    let price =
      fuelTypeApi.getPriceFor(label) ??
      (fuelTypeApi.canonicalOf(label) === "diesel"
        ? state.dieselPrice
        : state.petrolPrice) ??
      0;
    // Contract price override: a standing Customer Price List (Credit tab →
    // Price Lists) takes precedence over the station-wide fuel price when a
    // customer is attached to the sale.
    price =
      resolveContractPrice(customerName, label, price, customerPriceRules) ??
      price;
    const total = litres * price;
    const fuelName = label;
    // Resolve the fuel code (PMS/AGO/IK/LPG…) from the configured entry if
    // available; fall back to the canonical code so the receipt still has a
    // machine-readable fuel identifier for unknown custom fuels.
    const canonical = fuelTypeApi.canonicalOf(label);
    const configuredCode = fuelTypeApi.findFuelType(label)?.code;
    const _fuelCode =
      configuredCode ||
      (canonical ? CANONICAL_FUEL_TYPES[canonical]?.code : undefined) ||
      (canonical === "diesel" ? "AGO" : "PMS");

    const newItem: CartItem = {
      id: `fuel-${Date.now()}`,
      name: fuelName,
      quantity: 1,
      unitPrice: total,
      total: total,
      // Store the canonical fuel-type LABEL (e.g. "Super Petrol", "Kerosene",
      // "LPG") so the receipt groups fuels correctly by their real type —
      // NOT collapsed into "PMS"/"AGO". This is the key fix: a Kerosene/LPG
      // sale no longer masquerades as Petrol/Diesel on the receipt.
      fuelType: label,
      litres: litres,
      vatCategory: "A", // Fuel is standard-rated (VAT-able)
      hsCode: canonical === "diesel" ? "2710.19.20" : "2710.12.10",
    };

    setCart([...cart, newItem]);
    setQuickSaleLitres("");
  };

  const addCustomItem = () => {
    if (!customItemName || !customItemPrice) return;

    const price = parseFloat(customItemPrice) || 0;
    const newItem: CartItem = {
      id: `custom-${Date.now()}`,
      name: customItemName,
      quantity: 1,
      unitPrice: price,
      total: price,
      vatCategory: "A", // Default to standard-rate VAT
    };

    setCart([...cart, newItem]);
    setCustomItemName("");
    setCustomItemPrice("");
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(
      cart.map((item) => {
        if (item.id === itemId) {
          const newQty = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQty, total: item.unitPrice * newQty };
        }
        return item;
      }),
    );
  };

  const removeItem = (itemId: string) => {
    setCart(cart.filter((item) => item.id !== itemId));
  };

  const clearCart = () => {
    setCart([]);
  };

  // Calculate VAT by category
  const calculateVAT = () => {
    let vatA = 0;
    const vatB = 0,
      vatE = 0;
    let taxableA = 0,
      taxableB = 0,
      exemptE = 0;

    cart.forEach((item) => {
      const itemTotal = item.total;
      if (item.vatCategory === "A") {
        // VAT inclusive calculation
        const taxable = itemTotal / (1 + VAT_RATE);
        const vat = itemTotal - taxable;
        taxableA += taxable;
        vatA += vat;
      } else if (item.vatCategory === "B") {
        taxableB += itemTotal;
        // 0% VAT
      } else {
        exemptE += itemTotal;
      }
    });

    return { vatA, vatB, vatE, taxableA, taxableB, exemptE };
  };

  const { vatA, taxableA, taxableB, exemptE } = calculateVAT();
  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const totalVat = vatA;
  const total = subtotal;

  const initiateSTKPush = async () => {
    if (!customerPhone) {
      import("@/react-app/lib/toast").then(({ toastWarning }) =>
        toastWarning("Please enter customer phone number for M-Pesa payment"),
      );
      return;
    }

    setStkPushStatus("pending");

    // REAL STK Push over whichever gateway is configured: M-PESA Daraja
    // first, then PayHero Kenya as the automatic fallback. Both are real
    // institution calls via /api/integrations. The station's own credentials
    // live in Integration Hub → Payment Setup (owner-scoped cloud KV).
    // When neither is configured we do NOT fake a payment — we say exactly
    // what to configure.
    try {
      const cfg = await getMpesaConfig(stationId);
      const darajaReady = !!cfg?.enabled && darajaConfigured(cfg);
      const phCfg = await getPayheroConfig(stationId);
      const phReady = !!phCfg?.enabled && payheroConfigured(phCfg);

      if (!darajaReady && !phReady) {
        setStkPushStatus("failed");
        import("@/react-app/lib/toast").then(({ toastError }) =>
          toastError(
            "No M-PESA gateway configured. Set up M-PESA Daraja, PayHero Kenya, or Kopo Kopo in Integration Hub → Payment Setup.",
          ),
        );
        return;
      }

      // ── PayHero Kenya path ──────────────────────────────────────────────
      if (!darajaReady && phReady) {
        const ref = phCfg.accountReference || `POS-${generateInvoiceNumber()}`;
        const res = await payheroStkPush(phCfg, {
          phoneNumber: customerPhone,
          amount: total,
          transactionDesc: ref,
        });
        if (!res.success || !(res.reference || res.checkout_request_id)) {
          setStkPushStatus("failed");
          import("@/react-app/lib/toast").then(({ toastError }) =>
            toastError(
              `PayHero STK Push failed: ${res.error || "PayHero rejected the request"}`,
            ),
          );
          return;
        }
        import("@/react-app/lib/toast").then(({ toastInfo }) =>
          toastInfo(
            "STK Push sent via PayHero — ask the customer to enter their M-PESA PIN on their phone.",
          ),
        );
        const reference = String(res.reference || res.checkout_request_id);
        let attempts = 0;
        const pollPayhero = async (): Promise<void> => {
          attempts++;
          try {
            const q = await payheroQueryStatus(phCfg, reference);
            const status = String(q.status || "").toUpperCase();
            if (q.success || status === "SUCCESS" || status === "COMPLETED") {
              setStkPushStatus("success");
              processPayment();
              return;
            }
            const failed =
              status === "FAILED" ||
              status === "REJECTED" ||
              status === "CANCELLED";
            if (failed) {
              setStkPushStatus("failed");
              import("@/react-app/lib/toast").then(({ toastError }) =>
                toastError(
                  `M-PESA payment not completed via PayHero: ${String(q.result_desc || q.status || "failed")}`,
                ),
              );
              return;
            }
          } catch {
            /* transient — keep polling */
          }
          if (attempts >= 20) {
            setStkPushStatus("failed");
            import("@/react-app/lib/toast").then(({ toastError }) =>
              toastError(
                "M-PESA payment timed out waiting for the customer (PayHero). No sale was recorded.",
              ),
            );
            return;
          }
          setTimeout(pollPayhero, 6000);
        };
        setTimeout(pollPayhero, 6000);
        return;
      }

      // ── Daraja path ─────────────────────────────────────────────────────
      const res = await mpesaStkPush(cfg, {
        phoneNumber: customerPhone,
        amount: total,
        accountReference: currentStation?.code || "FuelPro",
        transactionDesc: `POS sale ${generateInvoiceNumber()}`,
      });

      if (!res.success || !res.checkout_request_id) {
        setStkPushStatus("failed");
        import("@/react-app/lib/toast").then(({ toastError }) =>
          toastError(
            `M-PESA STK Push failed: ${res.error || "Daraja rejected the request"}`,
          ),
        );
        return;
      }

      // Daraja accepted the request — the customer's phone is now prompting
      // for their M-PESA PIN. Poll Daraja for the REAL result.
      import("@/react-app/lib/toast").then(({ toastInfo }) =>
        toastInfo(
          "STK Push sent — ask the customer to enter their M-PESA PIN on their phone.",
        ),
      );
      const checkoutId = String(res.checkout_request_id);
      let attempts = 0;
      const poll = async (): Promise<void> => {
        attempts++;
        try {
          const q = await mpesaStkQuery(cfg, checkoutId);
          const rc = q.result_code !== undefined ? String(q.result_code) : "";
          if (rc === "0") {
            // REAL payment confirmed by Safaricom.
            setStkPushStatus("success");
            processPayment();
            return;
          }
          if (rc !== "") {
            // Final failure (1032 cancelled, 1037 timeout, 1 insufficient, etc.)
            setStkPushStatus("failed");
            import("@/react-app/lib/toast").then(({ toastError }) =>
              toastError(
                `M-PESA payment not completed: ${(q.result_desc as string) || `code ${rc}`}`,
              ),
            );
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        if (attempts >= 20) {
          setStkPushStatus("failed");
          import("@/react-app/lib/toast").then(({ toastError }) =>
            toastError(
              "M-PESA payment timed out waiting for the customer. No sale was recorded.",
            ),
          );
          return;
        }
        setTimeout(poll, 6000);
      };
      setTimeout(poll, 6000);
    } catch (e) {
      setStkPushStatus("failed");
      import("@/react-app/lib/toast").then(({ toastError }) =>
        toastError(`M-PESA STK Push error: ${(e as Error).message}`),
      );
    }
  };

  const processPayment = async () => {
    if (cart.length === 0) return;

    const invoiceNumber = generateInvoiceNumber();
    const cuInvoiceNo = generateCUInvoiceNo();
    const cuSignature = generateSignature(invoiceNumber, total);
    const receiptNumber = generateReceiptNumber();
    const timestamp = new Date().toISOString();

    // Cashier identity: prefer the logged-in user's name, then their email
    // local-part, then a station-scoped fallback — never a hardcoded "Cashier 1".
    const cashier =
      user?.name ||
      (user?.email ? user.email.split("@")[0] : undefined) ||
      currentStation?.name ||
      "Cashier";

    const transactionData: Omit<POSTransaction, "qrCodeData"> = {
      id: `txn-${Date.now()}`,
      items: [...cart],
      subtotal: taxableA + taxableB + exemptE,
      vatA,
      vatB: 0,
      vatE: exemptE,
      totalVat,
      total,
      paymentMethod,
      customerPhone: paymentMethod === "mpesa" ? customerPhone : undefined,
      customerName: customerName || undefined,
      customerPin: customerPin || undefined,
      timestamp,
      receiptNumber,
      invoiceNumber,
      cashier,
      cuInvoiceNo,
      cuSignature,
      fiscalCounter,
    };

    // ─── REAL KRA eTIMS submission (Kenya stations with OSCU credentials) ───
    // When the station configured its eTIMS credentials (Tax Settings → eTIMS
    // Branch ID + CMC Key), the sale is ACTUALLY submitted to the Kenya
    // Revenue Authority and the receipt carries the REAL KRA control-unit
    // receipt signature + KRA QR URL — replacing the local stand-in. If KRA
    // rejects/unreachable, the sale still completes locally but the user is
    // told honestly that the eTIMS submission failed (never fake KRA data).
    if (
      kenyaStation &&
      state.companyData?.etimsBhfId &&
      state.companyData?.etimsCmcKey
    ) {
      try {
        const { kraEtimsInvoice } =
          await import("@/react-app/lib/integrations-client");
        const etimsResult = await kraEtimsInvoice(
          {
            tin: etrConfig.kraPin,
            bhfId: state.companyData.etimsBhfId,
            cmcKey: state.companyData.etimsCmcKey,
            environment: state.companyData.etimsEnvironment || "sandbox",
          },
          {
            custTin: customerPin || "",
            custNm: customerName || "",
            trdInvcNo: invoiceNumber,
            items: cart.map((i) => ({
              itemNm: i.name,
              qty: i.quantity,
              prc: i.unitPrice,
              taxTyCd: "A",
            })),
            paymentType:
              paymentMethod === "cash"
                ? "01"
                : paymentMethod === "mpesa"
                  ? "06"
                  : paymentMethod === "card"
                    ? "05"
                    : "02",
          },
        );
        if (etimsResult.success && etimsResult.receipt_signature) {
          // REAL KRA control-unit data onto the receipt.
          transactionData.cuSignature = String(etimsResult.receipt_signature);
          transactionData.cuInvoiceNo = String(
            etimsResult.internal_data || transactionData.cuInvoiceNo,
          );
          import("@/react-app/lib/toast").then(({ toastSuccess }) =>
            toastSuccess(
              "Sale submitted to KRA eTIMS — real fiscal receipt issued.",
            ),
          );
        } else {
          import("@/react-app/lib/toast").then(({ toastWarning }) =>
            toastWarning(
              `KRA eTIMS submission failed: ${etimsResult.error || "rejected"}. The sale is saved locally with a non-fiscal receipt.`,
            ),
          );
        }
      } catch (etimsErr) {
        console.warn("eTIMS submission error:", etimsErr);
        import("@/react-app/lib/toast").then(({ toastWarning }) =>
          toastWarning(
            "KRA eTIMS unreachable. The sale is saved locally with a non-fiscal receipt.",
          ),
        );
      }
    }

    const { qrString, qrUrl } = await generateQRData(transactionData);
    setQrCodeUrl(qrUrl);

    const transaction: POSTransaction = {
      ...transactionData,
      qrCodeData: qrString,
    };

    // CLOUD-FIRST persistence — the cloud (app_kv) is the source of truth, NOT
    // localStorage. We merge the new transaction into the cloud-backed
    // `transactions` state (loaded on mount), persist the merged list to cloud,
    // then mirror to localStorage ONLY as a read-through cache. This prevents
    // the cross-device data-loss bug where a new device with empty localStorage
    // would overwrite the cloud with just the single new transaction,
    // destroying every prior sale from other devices.
    const merged = [transaction, ...transactions];
    const trimmed = merged.slice(0, 200); // keep the most recent 200
    localModifiedRef.current = true;
    setTransactions(trimmed);
    try {
      localStorage.setItem(
        "fuelpro_pos_transactions",
        JSON.stringify(trimmed.map((t) => ({ ...t, savedAt: timestamp }))),
      );
    } catch (cacheErr) {
      console.warn("POS localStorage cache write failed:", cacheErr);
    }
    await cloudStorageService.set("pos_transactions", trimmed, stationId);

    // Sale is now persisted to cloud — notify the automation engine so
    // downstream reactions (stock adjustment, dashboard refresh, reorder
    // checks) fire.
    emit({
      type: "sale:completed",
      stationId: currentStation?.id || "",
      total,
      items: cart,
    });

    // Sync fuel sales to salesHistory for reporting
    syncFuelSalesToHistory(cart, timestamp, paymentMethod);

    // ─── Award Loyalty Points ───
    const transactionForLoyalty: POSTransaction = {
      ...transactionData,
      qrCodeData: "",
    };
    awardLoyaltyPoints(transactionForLoyalty);

    // Add a CREDIT sale (bank/deferred) to delivery tracking so the customer
    // owes a balance. Cash and M-Pesa are settled on the spot — they are NOT
    // debt. Previously card/bank were wrongly treated as debt too.
    if (
      customerName &&
      (paymentMethod === "bank" || paymentMethod === "card")
    ) {
      addToDeliveryTracking(cart, customerName, timestamp);
    }

    // ─── Interlink: M-Pesa POS sale → shared unified transaction store ───
    // An M-Pesa sale completed at the POS is a real digital inflow, so mirror
    // it into the shared `mpesa_transactions` cloud store. It then appears in
    // the Live Transaction feed + M-PESA Analyzer (cross-device) just like an
    // STK Push / statement inflow, keeping all payment records in one place.
    if (paymentMethod === "mpesa") {
      const unified: UnifiedTransaction = {
        id: transaction.id,
        transaction_ref: receiptNumber,
        origin: "stk_push",
        transaction_type: "POS M-Pesa Sale",
        amount: total,
        currency:
          state.companyData?.currency || getCurrencyByCountry(countryCode),
        sender_info: customerPhone || "",
        description: `POS sale ${invoiceNumber} (${cart
          .map((i) => i.name)
          .join(", ")})`,
        status: "completed",
        payment_method: "M-PESA",
        transaction_time: timestamp,
        receipt: receiptNumber,
        is_online: true,
        date: timestamp.split("T")[0],
        time: new Date(timestamp).toLocaleTimeString(),
        account_reference: currentStation?.code || undefined,
      };
      addTransaction(unified, currentStation?.id).catch(() => {});
    }

    setCurrentTransaction(transaction);
    setShowReceipt(true);
    setShowCelebration(true);
    setCart([]);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerPin("");
    setStkPushStatus("idle");
    setFiscalCounter(fiscalCounter + 1);
  };

  // Sync POS fuel sales to salesHistory for integrated reporting
  const syncFuelSalesToHistory = (
    items: CartItem[],
    timestamp: string,
    payment: string,
  ) => {
    const date = timestamp.split("T")[0];
    const shift = new Date(timestamp).getHours() < 14 ? "Day" : "Night";
    const key = `${date}_${shift}`;

    // Calculate fuel totals from POS items. Group by canonical fuel type so
    // Kerosene/LPG/V-Power sales are tracked under their own fuel, not
    // collapsed into PMS/AGO. Petrol→pmsLitres, Diesel→agoLitres for legacy
    // backward compatibility; other fuels tracked in posSales.byType.
    let pmsLitres = 0,
      pmsAmount = 0;
    let agoLitres = 0,
      agoAmount = 0;
    const byTypeLitres: Record<string, number> = {};
    const byTypeAmount: Record<string, number> = {};

    items.forEach((item) => {
      if (!item.fuelType) return;
      const canonical = normalizeFuelType(item.fuelType);
      const litres = item.litres || item.quantity;
      byTypeLitres[item.fuelType] = (byTypeLitres[item.fuelType] || 0) + litres;
      byTypeAmount[item.fuelType] =
        (byTypeAmount[item.fuelType] || 0) + item.total;
      if (canonical === "petrol") {
        pmsLitres += litres;
        pmsAmount += item.total;
      } else if (canonical === "diesel") {
        agoLitres += litres;
        agoAmount += item.total;
      }
    });

    if (
      pmsLitres === 0 &&
      agoLitres === 0 &&
      Object.keys(byTypeLitres).length === 0
    )
      return;

    // Get existing sales data or create new
    const existingSales = state.salesHistory[key] || {
      date,
      shift,
      pmsPumps: state.pmsPumps,
      agoPumps: state.agoPumps,
      fuelPumpsByType: state.fuelPumpsByType,
      expenses: [],
      tillPayment: 0,
      pmsPrice: state.pmsPrice,
      agoPrice: state.agoPrice,
      fuelPricesByType: state.fuelPricesByType,
      pmsTankOpening: state.pmsTankOpening,
      pmsTankClosing: state.pmsTankClosing,
      agoTankOpening: state.agoTankOpening,
      agoTankClosing: state.agoTankClosing,
      posSales: {
        pmsLitres: 0,
        pmsAmount: 0,
        agoLitres: 0,
        agoAmount: 0,
        byTypeLitres: {},
        byTypeAmount: {},
      },
    };

    // Accumulate POS sales
    const posSales = existingSales.posSales || {
      pmsLitres: 0,
      pmsAmount: 0,
      agoLitres: 0,
      agoAmount: 0,
      byTypeLitres: {},
      byTypeAmount: {},
    };
    posSales.pmsLitres += pmsLitres;
    posSales.pmsAmount += pmsAmount;
    posSales.agoLitres += agoLitres;
    posSales.agoAmount += agoAmount;
    posSales.byTypeLitres = {
      ...(posSales.byTypeLitres || {}),
    };
    posSales.byTypeAmount = {
      ...(posSales.byTypeAmount || {}),
    };
    for (const ft of Object.keys(byTypeLitres)) {
      posSales.byTypeLitres[ft] =
        (posSales.byTypeLitres[ft] || 0) + byTypeLitres[ft];
      posSales.byTypeAmount[ft] =
        (posSales.byTypeAmount[ft] || 0) + byTypeAmount[ft];
    }

    // Update till payment for M-Pesa transactions
    const tillPayment =
      existingSales.tillPayment +
      (payment === "mpesa" ? pmsAmount + agoAmount : 0);

    dispatch({
      type: "SET_SALES_HISTORY",
      payload: {
        ...state.salesHistory,
        [key]: { ...existingSales, posSales, tillPayment },
      },
    });
  };

  // Add credit sales to delivery tracking for customer accounts
  const addToDeliveryTracking = (
    items: CartItem[],
    customer: string,
    timestamp: string,
  ) => {
    const fuelItems = items.filter((item) => item.fuelType);
    if (fuelItems.length === 0) return;

    const date = timestamp.split("T")[0];
    const totalLitres = fuelItems.reduce(
      (sum, item) => sum + (item.litres || item.quantity),
      0,
    );
    const totalAmount = fuelItems.reduce((sum, item) => sum + item.total, 0);
    const fuelType = fuelItems[0].fuelType || "PMS";

    const newRow = {
      date,
      reg: "POS",
      fuel: fuelType,
      litres: totalLitres,
      amount: totalAmount,
      name: customer,
      debt: totalAmount,
    };

    const updatedRows = [...state.deliveryData.rows, newRow];
    const totals = {
      totalSupplied: updatedRows.reduce(
        (sum, row) => sum + (row.amount || 0),
        0,
      ),
      totalPayments: state.deliveryData.totals.totalPayments,
      balanceDue: updatedRows.reduce((sum, row) => sum + (row.debt || 0), 0),
    };

    dispatch({
      type: "SET_DELIVERY_DATA",
      payload: { ...state.deliveryData, rows: updatedRows, totals },
    });
  };

  const printReceipt = () => {
    if (!receiptRef.current) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const receiptContent = receiptRef.current.innerHTML;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Tax Invoice - ${currentTransaction?.invoiceNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Courier New', monospace; 
              font-size: 11px; 
              padding: 5px;
              max-width: 80mm;
              margin: 0 auto;
              line-height: 1.3;
            }
            .receipt-header { text-align: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #000; }
            .receipt-header h2 { font-size: 14px; margin: 4px 0; font-weight: bold; }
            .receipt-header p { margin: 2px 0; font-size: 10px; }
            .tax-invoice-title { font-size: 12px; font-weight: bold; margin: 8px 0; text-align: center; background: #000; color: #fff; padding: 4px; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .double-divider { border-top: 2px solid #000; margin: 6px 0; }
            .info-row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 10px; }
            .info-row span:first-child { font-weight: bold; }
            .item-header { display: flex; justify-content: space-between; font-weight: bold; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px; }
            .item-row { margin: 4px 0; }
            .item-name { font-weight: bold; font-size: 10px; }
            .item-details { display: flex; justify-content: space-between; font-size: 9px; margin-left: 8px; }
            .vat-summary { margin: 8px 0; font-size: 10px; }
            .vat-row { display: flex; justify-content: space-between; margin: 2px 0; }
            .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 12px; margin: 4px 0; }
            .grand-total { font-size: 14px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 4px 0; }
            .etr-section { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #000; text-align: center; font-size: 9px; }
            .etr-section p { margin: 2px 0; }
            .etr-section .signature { font-family: monospace; font-size: 8px; letter-spacing: 1px; margin: 4px 0; word-break: break-all; }
            .qr-code { text-align: center; margin: 8px 0; }
            .qr-code img { max-width: 100px; height: auto; }
            .footer { text-align: center; margin-top: 10px; font-size: 9px; }
            .footer p { margin: 2px 0; }
            @media print { body { margin: 0; padding: 2mm; } }
          </style>
        </head>
        <body>
          ${receiptContent}
          <script>window.print(); window.close();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(stationLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Generate QR code when transaction changes
  useEffect(() => {
    if (currentTransaction) {
      QRCode.toDataURL(currentTransaction.qrCodeData, {
        width: 120,
        margin: 1,
      })
        .then((url) => setQrCodeUrl(url))
        .catch(console.error);
    }
  }, [currentTransaction]);

  const updateCompanyData = (field: string, value: string) => {
    dispatch({
      type: "SET_COMPANY_DATA",
      payload: { ...state.companyData, [field]: value },
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <SubTabBar
        tabs={[
          { id: "standard", label: "Standard POS" },
          { id: "enhanced", label: "Enhanced POS" },
        ]}
        active={posView}
        onChange={(id) => setPosView(id as "standard" | "enhanced")}
      />
      {posView === "enhanced" ? (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <span className="ml-2 text-gray-500">
                Loading Enhanced POS...
              </span>
            </div>
          }
        >
          <EnhancedPOSView />
        </Suspense>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
              <ShoppingCart size={24} />
              Point of Sale
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSettings(true)}
                className="btn btn-outline btn-sm flex items-center gap-1"
              >
                <Settings size={16} />
                {kenyaStation ? "KRA Settings" : "Tax Settings"}
              </button>
              <div className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
                Fiscal #{fiscalCounter} | Today: {transactions.length}
              </div>
            </div>
          </div>

          {/* Today's Sales Summary — quick stats bar */}
          {(() => {
            const today = new Date().toDateString();
            const todayTxns = transactions.filter(
              (t) =>
                t.timestamp && new Date(t.timestamp).toDateString() === today,
            );
            const todayTotal = todayTxns.reduce(
              (sum, t) => sum + (Number(t.total) || 0),
              0,
            );
            const avgSale =
              todayTxns.length > 0 ? todayTotal / todayTxns.length : 0;
            if (todayTxns.length === 0) return null;
            return (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 border border-green-200 dark:border-green-800">
                  <div className="text-[10px] uppercase text-green-600 dark:text-green-400 font-semibold">
                    Today's Revenue
                  </div>
                  <div className="text-lg font-bold text-green-700 dark:text-green-300">
                    {currencySymbol}
                    {formatNumber(todayTotal)}
                  </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 border border-blue-200 dark:border-blue-800">
                  <div className="text-[10px] uppercase text-blue-600 dark:text-blue-400 font-semibold">
                    Transactions
                  </div>
                  <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                    {todayTxns.length}
                  </div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 border border-purple-200 dark:border-purple-800">
                  <div className="text-[10px] uppercase text-purple-600 dark:text-purple-400 font-semibold">
                    Avg Sale
                  </div>
                  <div className="text-lg font-bold text-purple-700 dark:text-purple-300">
                    {currencySymbol}
                    {formatNumber(avgSale)}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* KRA / Tax Compliance Banner */}
          {kenyaStation ? (
            !etrConfig.kraPin || etrConfig.kraPin === "P000000000X" ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
                  <QrCode size={16} />
                  <span>
                    <strong>KRA eTIMS Setup Required:</strong> Configure your
                    KRA PIN and ETR details in Settings for tax-compliant
                    receipts.
                  </span>
                </p>
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-2">
                <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
                  <Check size={16} />
                  <span>
                    <strong>KRA eTIMS Ready:</strong> PIN: {etrConfig.kraPin} |
                    ETR: {etrConfig.etrSerialNo}
                  </span>
                </p>
              </div>
            )
          ) : (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200 flex items-center gap-2">
                <Settings size={16} />
                <span>
                  <strong>Tax Settings:</strong> Configure your VAT/tax
                  registration in Settings for compliant receipts.
                </span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Quick Sale Panel */}
            <div className="lg:col-span-2 space-y-2">
              {/* Fuel Quick Sale */}
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Quick Fuel Sale</h3>
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="flex flex-wrap gap-2">
                    {/* Render one button per ACTIVE fuel type configured for this
                    station (from fuel_types_config, via useStationFuelTypes).
                    Falls back to the canonical Petrol + Diesel buttons when
                    the station has no configured fuel types yet (first run /
                    before cloud hydration) so POS is never empty. */}
                    {(() => {
                      const active = fuelTypeApi.activeFuelTypes;
                      if (active.length > 0) {
                        return active.map((ft) => {
                          const selected =
                            fuelTypeApi.labelOf(ft.name) === quickSaleFuel;
                          return (
                            <button
                              key={ft.id || ft.name}
                              onClick={() =>
                                setQuickSaleFuel(fuelTypeApi.labelOf(ft.name))
                              }
                              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                                selected
                                  ? "bg-green-500 text-gray-900 dark:text-white"
                                  : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {fuelTypeApi.labelOf(ft.name)} ({currencySymbol}{" "}
                              {(fuelTypeApi.getPriceFor(ft.name) ?? 0).toFixed(
                                2,
                              )}
                              /L)
                            </button>
                          );
                        });
                      }
                      // Fallback: no configured fuel types — show canonical
                      // Petrol + Diesel so the cashier can still make a sale.
                      return (
                        <>
                          <button
                            onClick={() =>
                              setQuickSaleFuel(
                                CANONICAL_FUEL_TYPES.petrol.label,
                              )
                            }
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                              quickSaleFuel ===
                              CANONICAL_FUEL_TYPES.petrol.label
                                ? "bg-green-500 text-gray-900 dark:text-white"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {CANONICAL_FUEL_TYPES.petrol.label} (
                            {currencySymbol}{" "}
                            {(
                              fuelTypeApi.getPriceFor(
                                CANONICAL_FUEL_TYPES.petrol.label,
                              ) ??
                              state.petrolPrice ??
                              0
                            ).toFixed(2)}
                            /L)
                          </button>
                          <button
                            onClick={() =>
                              setQuickSaleFuel(
                                CANONICAL_FUEL_TYPES.diesel.label,
                              )
                            }
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                              quickSaleFuel ===
                              CANONICAL_FUEL_TYPES.diesel.label
                                ? "bg-yellow-500 text-gray-900 dark:text-white"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {CANONICAL_FUEL_TYPES.diesel.label} (
                            {currencySymbol}{" "}
                            {(
                              fuelTypeApi.getPriceFor(
                                CANONICAL_FUEL_TYPES.diesel.label,
                              ) ??
                              state.dieselPrice ??
                              0
                            ).toFixed(2)}
                            /L)
                          </button>
                        </>
                      );
                    })()}
                    <button
                      onClick={() =>
                        navigateToTab("fueltypes", {
                          view: "fueltypes",
                        } as FuelPricePrefill)
                      }
                      className="px-3 py-2 rounded-lg font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 text-sm"
                      title="Edit fuel types & prices in Fuel Type Manager"
                    >
                      Edit Fuels
                    </button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      value={quickSaleLitres}
                      onChange={(e) => setQuickSaleLitres(e.target.value)}
                      placeholder="Litres"
                      className="w-32 px-3 py-2 rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                      step="0.1"
                    />
                    <span className="text-gray-500">
                      = {currencySymbol}{" "}
                      {formatNumber(
                        (parseFloat(quickSaleLitres) || 0) *
                          (fuelTypeApi.getPriceFor(quickSaleFuel) ??
                            (fuelTypeApi.canonicalOf(quickSaleFuel) === "diesel"
                              ? state.dieselPrice
                              : state.petrolPrice) ??
                            0),
                      )}
                    </span>
                    <button onClick={addFuelToCart} className="btn btn-primary">
                      <Plus size={16} /> Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Item */}
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Add Custom Item</h3>
                <div className="flex flex-wrap gap-4 items-end">
                  <input
                    type="text"
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    placeholder="Item name"
                    className="flex-1 min-w-[150px] px-3 py-2 rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                  />
                  <input
                    type="number"
                    value={customItemPrice}
                    onChange={(e) => setCustomItemPrice(e.target.value)}
                    placeholder={`Price (${currencySymbol})`}
                    className="w-32 px-3 py-2 rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                  />
                  <button onClick={addCustomItem} className="btn btn-outline">
                    <Plus size={16} /> Add Item
                  </button>
                </div>
              </div>

              {/* Cart */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Current Sale</h3>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {cart.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ShoppingCart
                      size={48}
                      className="mx-auto mb-2 opacity-30"
                    />
                    <p>No items in cart</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{item.name}</p>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            {item.litres && <span>{item.litres} Litres</span>}
                            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs">
                              VAT-{item.vatCategory}
                            </span>
                            {item.hsCode && (
                              <span className="text-xs">HS: {item.hsCode}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {!item.litres && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateQuantity(item.id, -1)}
                                className="p-1 rounded bg-gray-200 dark:bg-gray-700"
                              >
                                <Minus size={14} />
                              </button>
                              <span className="w-8 text-center">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.id, 1)}
                                className="p-1 rounded bg-gray-200 dark:bg-gray-700"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          )}
                          <span className="font-semibold w-24 text-right">
                            {currencySymbol} {formatNumber(item.total)}
                          </span>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Payment Panel */}
            <div className="space-y-2">
              {/* Customer Info (Optional) */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Customer Info (Optional)
                  </h3>
                  {loyaltyConfig?.isEnabled && (
                    <button
                      onClick={() => setShowLoyaltyScanner(!showLoyaltyScanner)}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg"
                    >
                      <Award size={12} />
                      {loyaltyCustomer ? "Loyalty Active" : "Add Loyalty"}
                    </button>
                  )}
                </div>

                {/* Loyalty Customer Status */}
                {loyaltyCustomer && (
                  <div
                    className={`mb-3 p-3 rounded-lg ${TIER_COLORS[loyaltyCustomer.tier].bg}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Star
                          size={16}
                          className={TIER_COLORS[loyaltyCustomer.tier].text}
                        />
                        <div>
                          <p
                            className={`text-sm font-semibold ${TIER_COLORS[loyaltyCustomer.tier].text}`}
                          >
                            {loyaltyCustomer.name}
                          </p>
                          <p
                            className={`text-xs ${TIER_COLORS[loyaltyCustomer.tier].text}`}
                          >
                            {loyaltyCustomer.tier} Member •{" "}
                            {loyaltyCustomer.points.toLocaleString()} pts
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setLoyaltyCustomer(null);
                          setCustomerPhone("");
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Loyalty Scanner Modal */}
                {showLoyaltyScanner && (
                  <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <p className="text-xs text-gray-500 mb-2">
                      Enter phone number or card number
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customerPhone}
                        onChange={(e) => {
                          setCustomerPhone(e.target.value);
                          if (e.target.value.length >= 7) {
                            lookupLoyaltyCustomer(e.target.value);
                          }
                        }}
                        placeholder="Phone or Card Number"
                        className="flex-1 px-3 py-2 text-sm rounded-lg border dark:bg-gray-700 dark:border-gray-600"
                      />
                      <button
                        onClick={() => setShowLoyaltyScanner(false)}
                        className="px-3 py-2 text-sm text-gray-500"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name"
                    className="w-full px-3 py-2 text-sm rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                  />
                  <input
                    type="text"
                    value={customerPin}
                    onChange={(e) =>
                      setCustomerPin(e.target.value.toUpperCase())
                    }
                    placeholder={
                      kenyaStation
                        ? "Customer KRA PIN (for B2B)"
                        : "Customer Tax ID (for B2B)"
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Payment Summary</h3>

                {/* VAT Breakdown */}
                <div className="space-y-1 mb-4 text-sm">
                  <div className="flex justify-between text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <span>Taxable (A-{vatPercent}%):</span>
                    <span>
                      {currencySymbol} {formatNumber(taxableA)}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    <span>VAT ({vatPercent}%):</span>
                    <span>
                      {currencySymbol} {formatNumber(vatA)}
                    </span>
                  </div>
                  {taxableB > 0 && (
                    <div className="flex justify-between text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <span>Zero-rated (B-0%):</span>
                      <span>
                        {currencySymbol} {formatNumber(taxableB)}
                      </span>
                    </div>
                  )}
                  {exemptE > 0 && (
                    <div className="flex justify-between text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <span>Exempt (E):</span>
                      <span>
                        {currencySymbol} {formatNumber(exemptE)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>
                      {currencySymbol} {formatNumber(total)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentMethod("cash")}
                      className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-all ${
                        paymentMethod === "cash"
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                          : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <Banknote size={20} />
                      <span className="text-sm">Cash</span>
                    </button>
                    <button
                      onClick={() => setPaymentMethod("mpesa")}
                      className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-all ${
                        paymentMethod === "mpesa"
                          ? "border-green-500 bg-green-50 dark:bg-green-900/30"
                          : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <Smartphone size={20} />
                      <span className="text-sm">M-Pesa</span>
                    </button>
                    <button
                      onClick={() => setPaymentMethod("card")}
                      className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-all ${
                        paymentMethod === "card"
                          ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30"
                          : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <CreditCard size={20} />
                      <span className="text-sm">Card</span>
                    </button>
                    <button
                      onClick={() => setPaymentMethod("bank")}
                      className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-all ${
                        paymentMethod === "bank"
                          ? "border-orange-500 bg-orange-50 dark:bg-orange-900/30"
                          : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <Receipt size={20} />
                      <span className="text-sm">Bank</span>
                    </button>
                  </div>

                  {paymentMethod === "mpesa" && (
                    <div className="space-y-2">
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Customer phone number"
                        className="w-full px-3 py-2 rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                      />
                      <button
                        onClick={initiateSTKPush}
                        disabled={
                          stkPushStatus === "pending" ||
                          !customerPhone ||
                          cart.length === 0
                        }
                        className="w-full btn bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white disabled:opacity-50 fp-icon-only"
                        title="Confirm"
                        aria-label="Confirm"
                      >
                        {stkPushStatus === "pending" ? (
                          <>Processing STK Push...</>
                        ) : stkPushStatus === "success" ? (
                          <>
                            <Check size={16} /> Payment Received
                          </>
                        ) : (
                          <>Send STK Push</>
                        )}
                      </button>
                    </div>
                  )}

                  {paymentMethod !== "mpesa" && (
                    <button
                      onClick={processPayment}
                      disabled={cart.length === 0}
                      className="w-full btn btn-primary text-lg py-3 disabled:opacity-50"
                    >
                      Complete Sale
                    </button>
                  )}
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Recent Transactions</h3>
                  {transactions.length > 0 && (
                    <button
                      onClick={() => setShowAllTxns(!showAllTxns)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {showAllTxns ? "Show Recent" : "Show All"}
                    </button>
                  )}
                </div>
                {transactions.length > 5 && (
                  <input
                    type="text"
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                    placeholder="Search by invoice # or payment method..."
                    className="w-full px-3 py-2 mb-2 text-sm rounded-lg border dark:bg-gray-800 dark:border-gray-600"
                  />
                )}
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {transactions.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No transactions yet
                    </p>
                  ) : (
                    (showAllTxns ? transactions : transactions.slice(0, 5))
                      .filter((t) => {
                        if (!txnSearch.trim()) return true;
                        const q = txnSearch.toLowerCase();
                        return (
                          t.invoiceNumber.toLowerCase().includes(q) ||
                          t.paymentMethod.toLowerCase().includes(q) ||
                          (t.customerName || "").toLowerCase().includes(q)
                        );
                      })
                      .map((txn) => (
                        <div
                          key={txn.id}
                          className="p-2 bg-gray-50 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                          onClick={() => {
                            setCurrentTransaction(txn);
                            setShowReceipt(true);
                          }}
                        >
                          <div className="flex justify-between text-sm">
                            <span className="font-mono text-xs">
                              {txn.invoiceNumber}
                            </span>
                            <span className="font-semibold">
                              {currencySymbol} {formatNumber(txn.total)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{txn.paymentMethod.toUpperCase()}</span>
                            <span>{formatDate(txn.timestamp)}</span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tax/KRA Settings Modal */}
          {showSettings && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-900 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
                  <h3 className="font-semibold">
                    {kenyaStation
                      ? "KRA eTIMS / ETR Configuration"
                      : "Tax / VAT Configuration"}
                  </h3>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800 rounded"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4 space-y-2">
                  {kenyaStation && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                      <p>
                        <strong>Note:</strong> To enable full KRA eTIMS
                        compliance, you must register with KRA at{" "}
                        <a
                          href="https://itax.kra.go.ke"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          itax.kra.go.ke
                        </a>{" "}
                        and obtain your ETR device credentials.
                      </p>
                    </div>
                  )}
                  {!kenyaStation && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                      <p>
                        <strong>Note:</strong> Configure your tax registration
                        details for compliant receipts. The VAT rate is
                        auto-detected from your station's country.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Business Name
                      </label>
                      <input
                        type="text"
                        value={state.companyData.name}
                        onChange={(e) =>
                          updateCompanyData("name", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {kenyaStation ? "KRA PIN" : "Tax ID / VAT No"} *
                      </label>
                      <input
                        type="text"
                        value={state.companyData.kraPin}
                        onChange={(e) =>
                          updateCompanyData(
                            "kraPin",
                            e.target.value.toUpperCase(),
                          )
                        }
                        placeholder={
                          kenyaStation ? "P000000000X" : "EIN / VAT No"
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        VAT Reg. No.
                      </label>
                      <input
                        type="text"
                        value={state.companyData.vatRegNo}
                        onChange={(e) =>
                          updateCompanyData("vatRegNo", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Physical Address
                      </label>
                      <input
                        type="text"
                        value={state.companyData.physicalAddress}
                        onChange={(e) =>
                          updateCompanyData("physicalAddress", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Town
                      </label>
                      <input
                        type="text"
                        value={state.companyData.town}
                        onChange={(e) =>
                          updateCompanyData("town", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {kenyaStation ? "County" : "State / Province"}
                      </label>
                      <input
                        type="text"
                        value={state.companyData.county}
                        onChange={(e) =>
                          updateCompanyData("county", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    {kenyaStation && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            ETR Serial No.
                          </label>
                          <input
                            type="text"
                            value={state.companyData.etrSerialNo}
                            onChange={(e) =>
                              updateCompanyData("etrSerialNo", e.target.value)
                            }
                            placeholder="ETR-00000000"
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            CU Serial No.
                          </label>
                          <input
                            type="text"
                            value={state.companyData.cuSerialNo}
                            onChange={(e) =>
                              updateCompanyData("cuSerialNo", e.target.value)
                            }
                            placeholder="CU-00000000"
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            eTIMS Branch ID (bhfId)
                          </label>
                          <input
                            type="text"
                            value={state.companyData.etimsBhfId || ""}
                            onChange={(e) =>
                              updateCompanyData("etimsBhfId", e.target.value)
                            }
                            placeholder="00"
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            eTIMS CMC Key
                          </label>
                          <input
                            type="password"
                            value={state.companyData.etimsCmcKey || ""}
                            onChange={(e) =>
                              updateCompanyData("etimsCmcKey", e.target.value)
                            }
                            placeholder="From the KRA eTIMS portal"
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            eTIMS Environment
                          </label>
                          <select
                            value={
                              state.companyData.etimsEnvironment || "sandbox"
                            }
                            onChange={(e) =>
                              updateCompanyData(
                                "etimsEnvironment",
                                e.target.value as "sandbox" | "production",
                              )
                            }
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                          >
                            <option value="sandbox">Sandbox (KRA test)</option>
                            <option value="production">
                              Production (live KRA)
                            </option>
                          </select>
                        </div>
                        <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                          With a Branch ID + CMC Key configured, every POS sale
                          is ACTUALLY submitted to KRA eTIMS and the receipt
                          carries the real KRA control-unit signature. Get the
                          CMC key from the KRA eTIMS portal (device
                          registration).
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Invoice Prefix
                      </label>
                      <input
                        type="text"
                        value={state.companyData.etrInvoicePrefix}
                        onChange={(e) =>
                          updateCompanyData(
                            "etrInvoicePrefix",
                            e.target.value.toUpperCase(),
                          )
                        }
                        placeholder="INV"
                        maxLength={5}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={state.companyData.contacts}
                        onChange={(e) =>
                          updateCompanyData("contacts", e.target.value)
                        }
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-full btn btn-primary"
                  >
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Receipt Modal - KRA Compliant */}
          {showReceipt && currentTransaction && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
                  <h3 className="font-semibold">Tax Invoice / Receipt</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={printReceipt}
                      className="btn btn-primary btn-sm"
                    >
                      <Printer size={14} /> Print
                    </button>
                    <button
                      onClick={() => setShowReceipt(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800 rounded"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div
                  ref={receiptRef}
                  className="p-6 font-mono text-sm bg-white text-black"
                >
                  {/* Receipt Header */}
                  <div className="receipt-header text-center mb-4 pb-4 border-b border-dashed border-gray-400">
                    {state.companyData?.logo && (
                      <img
                        src={state.companyData.logo}
                        alt="Logo"
                        className="mx-auto mb-2 max-h-16 max-w-[120px] object-contain"
                        crossOrigin="anonymous"
                      />
                    )}
                    <h2 className="text-lg font-bold">
                      {etrConfig.businessName}
                    </h2>
                    {etrConfig.address && (
                      <p className="text-xs">{etrConfig.address}</p>
                    )}
                    {(etrConfig.town || etrConfig.county) && (
                      <p className="text-xs">
                        {[etrConfig.town, etrConfig.county]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                    {etrConfig.phone && (
                      <p className="text-xs">Tel: {etrConfig.phone}</p>
                    )}
                    {etrConfig.email && (
                      <p className="text-xs">{etrConfig.email}</p>
                    )}
                    <p className="text-xs mt-1">
                      <strong>{kenyaStation ? "PIN:" : "Tax ID:"}</strong>{" "}
                      {etrConfig.kraPin}
                    </p>
                    {etrConfig.vatRegNo && (
                      <p className="text-xs">
                        <strong>VAT:</strong> {etrConfig.vatRegNo}
                      </p>
                    )}
                  </div>

                  <div className="tax-invoice-title bg-black text-gray-900 dark:text-white text-center py-1 font-bold text-sm mb-3">
                    {kenyaStation ? "TAX INVOICE" : "RECEIPT"}
                  </div>

                  {/* Invoice Details */}
                  <div className="space-y-1 text-xs mb-3">
                    <div className="flex justify-between">
                      <span>
                        <strong>Invoice No:</strong>
                      </span>
                      <span>{currentTransaction.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        <strong>Date/Time:</strong>
                      </span>
                      <span>{formatDate(currentTransaction.timestamp)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        <strong>Cashier:</strong>
                      </span>
                      <span>{currentTransaction.cashier}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        <strong>Payment:</strong>
                      </span>
                      <span>
                        {currentTransaction.paymentMethod.toUpperCase()}
                      </span>
                    </div>
                    {currentTransaction.customerName && (
                      <div className="flex justify-between">
                        <span>
                          <strong>Customer:</strong>
                        </span>
                        <span>{currentTransaction.customerName}</span>
                      </div>
                    )}
                    {currentTransaction.customerPin && (
                      <div className="flex justify-between">
                        <span>
                          <strong>
                            {kenyaStation ? "Buyer PIN:" : "Customer Tax ID:"}
                          </strong>
                        </span>
                        <span>{currentTransaction.customerPin}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-gray-400 my-3"></div>

                  {/* Items Header */}
                  <div className="flex justify-between text-xs font-bold border-b border-gray-400 pb-1 mb-2">
                    <span>ITEM</span>
                    <span>AMOUNT</span>
                  </div>

                  {/* Items */}
                  <div className="space-y-2 mb-3">
                    {currentTransaction.items.map((item, idx) => (
                      <div key={idx}>
                        <div className="flex justify-between text-xs">
                          <span className="font-medium">{item.name}</span>
                          <span>
                            {currencySymbol} {formatNumber(item.total)}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-600 ml-2">
                          {item.litres
                            ? `${item.litres} L`
                            : `${item.quantity} x ${currencySymbol} ${formatNumber(item.unitPrice)}`}
                          {" | VAT-"}
                          {item.vatCategory}
                          {item.hsCode && ` | HS:${item.hsCode}`}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-dashed border-gray-400 my-3"></div>

                  {/* VAT Summary */}
                  <div className="vat-summary text-xs space-y-1 mb-3">
                    <div className="font-bold border-b pb-1">VAT SUMMARY</div>
                    <div className="flex justify-between">
                      <span>A-{vatPercent}%:</span>
                      <span>
                        Taxable:{" "}
                        {formatNumber(
                          currentTransaction.subtotal - currentTransaction.vatE,
                        )}{" "}
                        | VAT: {formatNumber(currentTransaction.vatA)}
                      </span>
                    </div>
                    {currentTransaction.vatB > 0 && (
                      <div className="flex justify-between">
                        <span>B-0.00%:</span>
                        <span>
                          Taxable: {formatNumber(currentTransaction.vatB)} |
                          VAT: 0.00
                        </span>
                      </div>
                    )}
                    {currentTransaction.vatE > 0 && (
                      <div className="flex justify-between">
                        <span>E-Exempt:</span>
                        <span>{formatNumber(currentTransaction.vatE)}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-400 my-3"></div>

                  {/* Totals */}
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Subtotal (Excl. VAT):</span>
                      <span>
                        {currencySymbol}{" "}
                        {formatNumber(
                          currentTransaction.subtotal -
                            currentTransaction.totalVat,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total VAT:</span>
                      <span>
                        {currencySymbol}{" "}
                        {formatNumber(currentTransaction.totalVat)}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between text-lg font-bold border-t-2 border-b-2 border-black py-2 my-3">
                    <span>TOTAL:</span>
                    <span>
                      {currencySymbol} {formatNumber(currentTransaction.total)}
                    </span>
                  </div>

                  {/* ETR/KRA Section */}
                  <div className="etr-section mt-4 pt-3 border-t border-dashed border-gray-400 text-center">
                    {kenyaStation ? (
                      <>
                        <p className="font-bold text-xs">
                          ELECTRONIC TAX REGISTER
                        </p>
                        <p className="text-[10px] mt-1">
                          ETR S/N: {etrConfig.etrSerialNo}
                        </p>
                        <p className="text-[10px]">
                          CU S/N: {etrConfig.cuSerialNo}
                        </p>
                        <p className="text-[10px]">
                          CU Invoice No: {currentTransaction.cuInvoiceNo}
                        </p>
                        <p className="text-[10px]">
                          Fiscal Counter: #{currentTransaction.fiscalCounter}
                        </p>
                        <div className="mt-2 text-[9px] font-mono break-all bg-gray-100 p-1 rounded">
                          <strong>Signature:</strong>{" "}
                          {currentTransaction.cuSignature}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="font-bold text-xs">RECEIPT</p>
                        <p className="text-[10px] mt-1">
                          Receipt No: {currentTransaction.invoiceNumber}
                        </p>
                        <p className="text-[10px]">
                          Transaction ID: #{currentTransaction.fiscalCounter}
                        </p>
                      </>
                    )}

                    {/* QR Code */}
                    {qrCodeUrl && (
                      <div className="qr-code mt-3">
                        <img
                          src={qrCodeUrl}
                          alt="Verification QR"
                          className="mx-auto"
                          style={{ width: "100px", height: "100px" }}
                        />
                        <p className="text-[8px] mt-1">
                          {kenyaStation
                            ? "Scan to verify at KRA iTax"
                            : "Scan to verify this invoice"}
                        </p>
                      </div>
                    )}

                    <p className="mt-2 text-[9px] font-bold">
                      {kenyaStation
                        ? "*KRA eTIMS COMPLIANT INVOICE*"
                        : "*TAX COMPLIANT INVOICE*"}
                    </p>
                    <p className="text-[8px]">
                      {kenyaStation ? "Powered by TIMS" : "Powered by FuelPro"}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="footer mt-4 text-center text-xs border-t border-dashed border-gray-400 pt-3">
                    <p className="font-semibold">
                      Thank you for your business!
                    </p>
                    <p className="text-[10px]">
                      Goods once sold are not returnable
                    </p>
                    <p className="text-[10px] mt-2 opacity-60">
                      {window.location.hostname}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Success celebration overlay (Peak-End rule, design spec file 7) */}
      <SuccessCelebration
        show={showCelebration}
        title="Sale Complete!"
        message={`${currencySymbol} ${formatNumber(total)} • ${currentTransaction?.invoiceNumber || "Receipt ready"}`}
        onDismiss={() => setShowCelebration(false)}
      />
    </div>
  );
}
