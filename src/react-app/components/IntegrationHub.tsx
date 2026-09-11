import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plug,
  Link2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Globe,
  Shield,
  CreditCard,
  Printer,
  Users,
  Receipt,
  Banknote,
  Landmark,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Play,
  Pause,
  Fuel,
  Lock,
  Save,
  TestTube,
  MapPin,
  Server,
  Wifi,
  Phone,
  QrCode,
  Barcode,
  Cpu,
  HardDrive,
  Zap,
  Settings,
  FileText,
  ArrowRight,
  Smartphone,
} from "lucide-react";
import { WORLD_PAYMENT_CONFIGS } from "@/react-app/config/worldPaymentConfigs";
import {
  ALL_COUNTRIES,
  getCountryGateways,
} from "@/react-app/lib/world-country-utils";
import SearchableCountryDropdown from "@/react-app/components/SearchableCountryDropdown";
import IntegrationsSettings from "@/react-app/components/IntegrationsSettings";
import ForecourtHardware from "@/react-app/components/ForecourtHardware";
import PumpControlBoard from "@/react-app/components/PumpControlBoard";
import HardwareFirmwareTracker from "@/react-app/components/HardwareFirmwareTracker";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";

// ============================================================
// COUNTRY-SPECIFIC CONNECTOR CONFIGURATIONS
// ============================================================
const COUNTRY_CONNECTORS: Record<string, CountryConnectorSet> = {
  kenya: {
    country: "Kenya",
    code: "KE",
    flag: "🇰🇪",
    connectors: [
      {
        id: "kra-etims",
        name: "KRA eTIMS Portal",
        cat: "Government",
        desc: "Kenya Revenue Authority eTIMS for electronic tax invoicing, VAT iTax returns, and compliance",
        icon: "Shield",
        config: {
          username: "",
          password: "",
          pin: "",
          apiEndpoint: "https://etims.kra.go.ke",
        },
        features: [
          "Auto eTIMS invoices",
          "Submit VAT iTax returns",
          "Sync tax payments",
          "Compliance dashboard",
          "Withholding tax",
        ],
      },
      {
        id: "kra-itax",
        name: "KRA iTax Portal",
        cat: "Government",
        desc: "Direct KRA iTax for filing, payment, and certificate download",
        icon: "Landmark",
        config: {
          kraPin: "",
          password: "",
          apiEndpoint: "https://itax.kra.go.ke",
        },
        features: [
          "File VAT returns",
          "Make tax payments",
          "Download tax certificates",
          "Track refund status",
          "Generate e-slip",
        ],
      },
      {
        id: "epra-portal",
        name: "EPRA Fuel Compliance",
        cat: "Government",
        desc: "Energy and Petroleum Regulatory Authority pump price compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://epra.go.ke" },
        features: [
          "Submit pump prices",
          "Compliance reports",
          "License renewal alerts",
          "Adulteration levy tracking",
          "RML levy",
        ],
      },
      {
        id: "mpesa-daraja",
        name: "M-PESA Daraja API",
        cat: "Payments",
        desc: "Safaricom M-PESA for STK Push, C2B, B2B payments",
        icon: "Banknote",
        config: {
          consumerKey: "",
          consumerSecret: "",
          shortcode: "578590",
          passkey: "",
          env: "production",
        },
        features: [
          "STK Push",
          "C2B validation",
          "Transaction reversal",
          "Balance inquiry",
          "B2B transfers",
        ],
      },
      {
        id: "kcb-bank",
        name: "KCB Bank Kenya API",
        cat: "Finance",
        desc: "KCB Bank Kenya for statements, transfers, reconciliation",
        icon: "Landmark",
        config: { accountNumber: "", branchCode: "", apiKey: "", clientId: "" },
        features: [
          "Import statements",
          "Auto-reconcile",
          "Balance inquiry",
          "Initiate transfers",
        ],
      },
      {
        id: "equity-jenga",
        name: "Equity Bank Jenga API",
        cat: "Finance",
        desc: "Equity Bank Jenga API for payments and transfers",
        icon: "Landmark",
        config: {
          consumerKey: "",
          consumerSecret: "",
          merchantCode: "",
          apiEndpoint: "https://jengaapi.equitybankgroup.com",
        },
        features: [
          "Account info",
          "Funds transfer",
          "Mobile wallet",
          "Statement download",
        ],
      },
      {
        id: "coop-bank",
        name: "Co-operative Bank API",
        cat: "Finance",
        desc: "Co-operative Bank Kenya API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Statements", "Transfers", "Reconciliation", "Balance"],
      },
      {
        id: "ncba-bank",
        name: "NCBA Bank Kenya",
        cat: "Finance",
        desc: "NCBA Loop API for banking operations",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: [
          "Statement import",
          "Transfers",
          "Balance",
          "Reconciliation",
        ],
      },
      {
        id: "absa-bank",
        name: "Absa Bank Kenya",
        cat: "Finance",
        desc: "Absa Banking API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Statements", "Payments", "Balance", "Reconciliation"],
      },
      {
        id: "ecitizen",
        name: "eCitizen Kenya",
        cat: "Government",
        desc: "eCitizen portal for business permits and licenses",
        icon: "Globe",
        config: { idNumber: "", password: "", businessReg: "" },
        features: [
          "Pay business permits",
          "Single business permit",
          "Liquor license",
          "Health permits",
        ],
      },
      {
        id: "airtel-money-ke",
        name: "Airtel Money Kenya",
        cat: "Payments",
        desc: "Airtel Money API for collections and disbursements",
        icon: "Phone",
        config: { clientId: "", clientSecret: "", env: "production" },
        features: [
          "Collect payments",
          "Send money",
          "Transaction history",
          "Balance",
        ],
      },
      {
        id: "etr-tims",
        name: "eTIMS ETR Device",
        cat: "Hardware",
        desc: "Electronic Tax Register integrated with eTIMS",
        icon: "Printer",
        config: {
          devicePort: "",
          serialNumber: "",
          model: "TIMS-Compact",
          autoPrint: "true",
        },
        features: [
          "Auto-print receipts",
          "Real-time upload",
          "Daily Z-report",
          "Device diagnostics",
        ],
      },
      {
        id: "safaricom-api",
        name: "Safaricom Business API",
        cat: "Payments",
        desc: "Safaricom APIs beyond M-PESA (SMS, USSD)",
        icon: "Wifi",
        config: { apiKey: "", apiSecret: "", shortcode: "" },
        features: [
          "Bulk SMS",
          "USSD integration",
          "Airtime API",
          "Data bundles",
        ],
      },
    ],
    webhooks: [
      {
        name: "KRA VAT Filing Deadline",
        url: "https://etims.kra.go.ke/api/webhook",
        events: [
          "tax.vat-due",
          "tax.monthly-return",
          "tax.penalty-warning",
          "tax.annual-return",
        ],
      },
      {
        name: "EPRA Price Update Alert",
        url: "https://epra.go.ke/api/webhook",
        events: [
          "fuel.price-change",
          "fuel.levy-update",
          "compliance.due",
          "license.renewal",
        ],
      },
      {
        name: "M-PESA Transaction Feed",
        url: "https://api.safaricom.co.ke/webhook",
        events: [
          "payment.mpesa-received",
          "payment.reversal",
          "payment.settlement",
          "payment.failed",
        ],
      },
      {
        name: "eTIMS Invoice Sync",
        url: "https://etims.kra.go.ke/webhook",
        events: [
          "invoice.created",
          "invoice.uploaded",
          "invoice.rejected",
          "invoice.cancelled",
        ],
      },
      {
        name: "Fuel Pump Alert",
        url: "https://fuelpro.io/webhook",
        events: [
          "fuel.low-stock",
          "fuel.dispensed",
          "pump.offline",
          "tank.leak",
        ],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "write:employees",
      "read:bank",
      "write:bank",
      "read:reports",
      "admin",
    ],
  },
  uganda: {
    country: "Uganda",
    code: "UG",
    flag: "🇺🇬",
    connectors: [
      {
        id: "ura-efris",
        name: "URA EFRIS Portal",
        cat: "Government",
        desc: "Uganda Revenue Authority Electronic Fiscal Receipting and Invoicing",
        icon: "Shield",
        config: {
          tin: "",
          password: "",
          apiEndpoint: "https://efris.ura.go.ug",
        },
        features: [
          "Generate EFRIS receipts",
          "File VAT returns",
          "Sync fiscal data",
          "Track tax credits",
        ],
      },
      {
        id: "ura-portal",
        name: "URA Tax Portal",
        cat: "Government",
        desc: "URA for tax filing, payments, and certificates",
        icon: "Landmark",
        config: {
          tin: "",
          password: "",
          apiEndpoint: "https://portal.ura.go.ug",
        },
        features: [
          "Monthly VAT filing",
          "Excise duty",
          "Withholding tax",
          "Tax clearance cert",
        ],
      },
      {
        id: "memd-portal",
        name: "MEMD Fuel Portal",
        cat: "Government",
        desc: "Ministry of Energy and Mineral Development fuel compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://memd.go.ug" },
        features: [
          "Submit pump prices",
          "License management",
          "Compliance reports",
          "Price ceiling alerts",
        ],
      },
      {
        id: "unbs-portal",
        name: "UNBS Standards",
        cat: "Government",
        desc: "Uganda National Bureau of Standards quality tracking",
        icon: "Shield",
        config: { certificateNo: "", apiEndpoint: "https://unbs.go.ug" },
        features: [
          "Quality mark tracking",
          "Standards compliance",
          "Certificate renewal",
          "Inspection reports",
        ],
      },
      {
        id: "mtn-momo-ug",
        name: "MTN Mobile Money Uganda",
        cat: "Payments",
        desc: "MTN MoMo API for collections and disbursements",
        icon: "Banknote",
        config: {
          apiUser: "",
          apiKey: "",
          subscriptionKey: "",
          env: "production",
        },
        features: [
          "Request payment",
          "Transfer funds",
          "Transaction status",
          "Account balance",
        ],
      },
      {
        id: "airtel-money-ug",
        name: "Airtel Money Uganda",
        cat: "Payments",
        desc: "Airtel Money API integration",
        icon: "Banknote",
        config: {
          clientId: "",
          clientSecret: "",
          apiEndpoint: "https://openapi.airtel.africa",
        },
        features: [
          "Collect payments",
          "Disburse funds",
          "Transaction history",
          "Balance inquiry",
        ],
      },
      {
        id: "stanbic-ug",
        name: "Stanbic Bank Uganda",
        cat: "Finance",
        desc: "Stanbic Bank Uganda API for banking",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: [
          "Statement import",
          "Auto-reconcile",
          "Transfer funds",
          "Balance check",
        ],
      },
      {
        id: "centenary-bank",
        name: "Centenary Bank Uganda",
        cat: "Finance",
        desc: "Centenary Bank Uganda API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "ura-efd",
        name: "URA EFD Device",
        cat: "Hardware",
        desc: "Electronic Fiscal Device for Uganda",
        icon: "Printer",
        config: {
          deviceId: "",
          serialNumber: "",
          model: "EFD-V2",
          autoSync: "true",
        },
        features: [
          "Fiscal receipt generation",
          "Auto-upload to URA",
          "Daily reports",
          "Device diagnostics",
        ],
      },
    ],
    webhooks: [
      {
        name: "URA VAT Filing Reminder",
        url: "https://efris.ura.go.ug/webhook",
        events: ["tax.vat-due", "tax.monthly-return", "tax.excise-duty"],
      },
      {
        name: "MEMD Price Compliance",
        url: "https://memd.go.ug/webhook",
        events: ["fuel.price-change", "compliance.due", "license.renewal"],
      },
      {
        name: "MTN MoMo Transaction Feed",
        url: "https://api.mtn.co.ug/webhook",
        events: ["payment.received", "payment.reversal", "payment.failed"],
      },
      {
        name: "EFRIS Invoice Sync",
        url: "https://efris.ura.go.ug/webhook",
        events: ["invoice.created", "invoice.uploaded", "invoice.rejected"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "write:employees",
      "read:reports",
      "admin",
    ],
  },
  tanzania: {
    country: "Tanzania",
    code: "TZ",
    flag: "🇹🇿",
    connectors: [
      {
        id: "tra-efd",
        name: "TRA EFD Integration",
        cat: "Government",
        desc: "Tanzania Revenue Authority Electronic Fiscal Device",
        icon: "Shield",
        config: {
          tin: "",
          password: "",
          apiEndpoint: "https://virtual.tra.go.tz",
          deviceId: "",
        },
        features: [
          "EFD receipt sync",
          "Monthly VAT filing",
          "Excise duty",
          "Compliance alerts",
        ],
      },
      {
        id: "ewura-portal",
        name: "EWURA Fuel Portal",
        cat: "Government",
        desc: "Energy and Water Utilities Regulatory Authority compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://ewura.go.tz" },
        features: [
          "Submit pump prices",
          "Compliance reports",
          "License tracking",
          "Price cap monitoring",
        ],
      },
      {
        id: "tbs-portal",
        name: "TBS Standards TZ",
        cat: "Government",
        desc: "Tanzania Bureau of Standards fuel quality",
        icon: "Shield",
        config: { certificateNo: "", apiEndpoint: "https://tbs.go.tz" },
        features: [
          "Quality standards",
          "Compliance tracking",
          "Certificate management",
          "Inspection reports",
        ],
      },
      {
        id: "crdb-bank",
        name: "CRDB Bank Tanzania",
        cat: "Finance",
        desc: "CRDB Bank API for banking operations",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "nmb-bank",
        name: "NMB Bank Tanzania",
        cat: "Finance",
        desc: "NMB Bank Tanzania API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: [
          "Statement import",
          "Transfers",
          "Balance",
          "Reconciliation",
        ],
      },
      {
        id: "mpesa-tz",
        name: "M-PESA Tanzania",
        cat: "Payments",
        desc: "Vodacom M-PESA API for payments",
        icon: "Banknote",
        config: { apiKey: "", apiSecret: "", shortcode: "", env: "production" },
        features: [
          "C2B payments",
          "B2C transfers",
          "Transaction query",
          "Balance check",
        ],
      },
      {
        id: "tigo-pesa",
        name: "Tigo Pesa Tanzania",
        cat: "Payments",
        desc: "Tigo Pesa mobile money API",
        icon: "Banknote",
        config: { clientId: "", clientSecret: "", env: "production" },
        features: [
          "Collect payments",
          "Transfer funds",
          "Transaction status",
          "Reports",
        ],
      },
      {
        id: "airtel-money-tz",
        name: "Airtel Money Tanzania",
        cat: "Payments",
        desc: "Airtel Money TZ API",
        icon: "Banknote",
        config: { clientId: "", clientSecret: "", env: "production" },
        features: ["Accept payments", "Send money", "Balance", "History"],
      },
    ],
    webhooks: [
      {
        name: "TRA VAT Filing",
        url: "https://virtual.tra.go.tz/webhook",
        events: ["tax.vat-due", "tax.monthly-return", "tax.excise"],
      },
      {
        name: "EWURA Price Update",
        url: "https://ewura.go.tz/webhook",
        events: ["fuel.price-change", "compliance.due", "license.renewal"],
      },
      {
        name: "M-PESA TZ Transaction",
        url: "https://api.vodacom.co.tz/webhook",
        events: ["payment.received", "payment.settled", "payment.reversal"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
  nigeria: {
    country: "Nigeria",
    code: "NG",
    flag: "🇳🇬",
    connectors: [
      {
        id: "firs-tax",
        name: "FIRS Tax Portal",
        cat: "Government",
        desc: "Federal Inland Revenue Service for VAT and tax compliance",
        icon: "Shield",
        config: { tin: "", password: "", apiEndpoint: "https://firs.gov.ng" },
        features: [
          "VAT filing",
          "Withholding tax",
          "Tax clearance",
          "Filing reminders",
          "Penalties",
        ],
      },
      {
        id: "pppra-portal",
        name: "PPPRA Fuel Pricing",
        cat: "Government",
        desc: "Petroleum Products Pricing Regulatory Agency",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://pppra.gov.ng" },
        features: [
          "Price template",
          "Compliance reporting",
          "Submissions",
          "Price monitoring",
        ],
      },
      {
        id: "dpr-portal",
        name: "DPR License Portal",
        cat: "Government",
        desc: "Department of Petroleum Resources licensing",
        icon: "Shield",
        config: { licenseNumber: "", apiEndpoint: "https://dpr.gov.ng" },
        features: [
          "License management",
          "Renewals",
          "Compliance",
          "Inspections",
        ],
      },
      {
        id: "cbn-portal",
        name: "CBN Nigeria",
        cat: "Government",
        desc: "Central Bank of Nigeria compliance and rates",
        icon: "Landmark",
        config: { apiEndpoint: "https://cbn.gov.ng" },
        features: [
          "Exchange rates",
          "Policy alerts",
          "Banking regulations",
          "Compliance notices",
        ],
      },
      {
        id: "gtbank-ng",
        name: "GTBank Nigeria",
        cat: "Finance",
        desc: "Guaranty Trust Bank API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Statements", "Transfers", "Reconciliation", "Balance"],
      },
      {
        id: "zenith-bank",
        name: "Zenith Bank Nigeria",
        cat: "Finance",
        desc: "Zenith Bank API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: [
          "Statement download",
          "Funds transfer",
          "Balance inquiry",
          "Auto-reconcile",
        ],
      },
      {
        id: "paystack",
        name: "Paystack Nigeria",
        cat: "Payments",
        desc: "Paystack payment gateway",
        icon: "CreditCard",
        config: {
          publicKey: "",
          secretKey: "",
          webhookSecret: "",
          env: "test",
        },
        features: [
          "Accept payments",
          "Transfer funds",
          "Subaccounts",
          "Transaction webhooks",
        ],
      },
      {
        id: "flutterwave",
        name: "Flutterwave",
        cat: "Payments",
        desc: "Flutterwave payment API",
        icon: "CreditCard",
        config: {
          publicKey: "",
          secretKey: "",
          encryptionKey: "",
          env: "staging",
        },
        features: [
          "Card payments",
          "Bank transfers",
          "Mobile money",
          "Payment links",
        ],
      },
      {
        id: "opay",
        name: "OPay Nigeria",
        cat: "Payments",
        desc: "OPay mobile payment platform",
        icon: "Banknote",
        config: { merchantId: "", apiKey: "", env: "production" },
        features: [
          "Accept payments",
          "Transfer funds",
          "POS integration",
          "Agent banking",
        ],
      },
    ],
    webhooks: [
      {
        name: "FIRS VAT Filing",
        url: "https://firs.gov.ng/webhook",
        events: [
          "tax.vat-due",
          "tax.monthly-return",
          "tax.penalty",
          "tax.withholding",
        ],
      },
      {
        name: "PPPRA Price Template",
        url: "https://pppra.gov.ng/webhook",
        events: ["fuel.price-change", "compliance.due", "license.renewal"],
      },
      {
        name: "Paystack Webhook",
        url: "https://api.paystack.co/webhook",
        events: [
          "payment.success",
          "payment.failed",
          "transfer.success",
          "transfer.failed",
        ],
      },
      {
        name: "Flutterwave Webhook",
        url: "https://api.flutterwave.com/webhook",
        events: ["payment.completed", "payment.pending", "transfer.completed"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
  southafrica: {
    country: "South Africa",
    code: "ZA",
    flag: "🇿🇦",
    connectors: [
      {
        id: "sars-efiling",
        name: "SARS eFiling",
        cat: "Government",
        desc: "South African Revenue Service VAT201 and PAYE",
        icon: "Shield",
        config: {
          taxNumber: "",
          password: "",
          apiEndpoint: "https://www.sarsefiling.co.za",
        },
        features: [
          "VAT201 filing",
          "Tax certificates",
          "PAYE submissions",
          "IT14 returns",
        ],
      },
      {
        id: "dmre-portal",
        name: "DMRE Fuel Portal",
        cat: "Government",
        desc: "Dept of Mineral Resources and Energy compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://dmre.gov.za" },
        features: [
          "License management",
          "Price compliance",
          "Monthly submissions",
          "RAF levy tracking",
        ],
      },
      {
        id: "fnb-sa",
        name: "FNB South Africa",
        cat: "Finance",
        desc: "First National Bank API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "standard-bank-sa",
        name: "Standard Bank SA",
        cat: "Finance",
        desc: "Standard Bank South Africa API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: [
          "Statement import",
          "Transfers",
          "Balance",
          "Auto-reconcile",
        ],
      },
      {
        id: "absa-sa",
        name: "Absa South Africa",
        cat: "Finance",
        desc: "Absa Bank API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", clientId: "" },
        features: ["Account info", "Payments", "Balance", "Statements"],
      },
      {
        id: "snapscan",
        name: "SnapScan",
        cat: "Payments",
        desc: "SnapScan mobile payments with QR",
        icon: "QrCode",
        config: { merchantId: "", apiKey: "", webhookSecret: "" },
        features: [
          "QR payments",
          "In-app payments",
          "Transaction history",
          "Settlement",
        ],
      },
      {
        id: "peach-payments",
        name: "Peach Payments",
        cat: "Payments",
        desc: "Peach Payments gateway for South Africa",
        icon: "CreditCard",
        config: { apiKey: "", webhookSecret: "", env: "test" },
        features: ["Card payments", "EFT", "Mobicred", "Store integration"],
      },
    ],
    webhooks: [
      {
        name: "SARS VAT Filing",
        url: "https://www.sarsefiling.co.za/webhook",
        events: ["tax.vat-due", "tax.bi-monthly", "tax.penalty", "tax.pay-due"],
      },
      {
        name: "DMRE Price Update",
        url: "https://dmre.gov.za/webhook",
        events: ["fuel.price-change", "compliance.due", "raf.levy-update"],
      },
      {
        name: "SnapScan Payments",
        url: "https://pos.snapscan.io/webhook",
        events: ["payment.success", "payment.failed", "settlement.ready"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
  ghana: {
    country: "Ghana",
    code: "GH",
    flag: "🇬🇭",
    connectors: [
      {
        id: "gra-tax",
        name: "GRA Tax Portal",
        cat: "Government",
        desc: "Ghana Revenue Authority for VAT and tax",
        icon: "Shield",
        config: { tin: "", password: "", apiEndpoint: "https://gra.gov.gh" },
        features: [
          "VAT filing",
          "Tax clearance",
          "Withholding tax",
          "Monthly returns",
          "Penalties",
        ],
      },
      {
        id: "npa-portal",
        name: "NPA Fuel Portal",
        cat: "Government",
        desc: "National Petroleum Authority compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://npa.gov.gh" },
        features: [
          "Price ceiling monitoring",
          "Compliance reports",
          "License renewal",
          "ESLA levy tracking",
        ],
      },
      {
        id: "epa-ghana",
        name: "EPA Ghana",
        cat: "Government",
        desc: "Environmental Protection Authority permits",
        icon: "Shield",
        config: { permitNumber: "", apiEndpoint: "https://epa.gov.gh" },
        features: [
          "Permit management",
          "Renewals",
          "Compliance reports",
          "Inspections",
        ],
      },
      {
        id: "ecobank-gh",
        name: "Ecobank Ghana",
        cat: "Finance",
        desc: "Ecobank Ghana API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "gcb-bank",
        name: "GCB Bank Ghana",
        cat: "Finance",
        desc: "Ghana Commercial Bank API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: [
          "Statement import",
          "Funds transfer",
          "Balance",
          "Auto-reconcile",
        ],
      },
      {
        id: "mtn-momo-gh",
        name: "MTN MoMo Ghana",
        cat: "Payments",
        desc: "MTN Mobile Money Ghana API",
        icon: "Banknote",
        config: {
          apiUser: "",
          apiKey: "",
          subscriptionKey: "",
          env: "production",
        },
        features: [
          "Request payment",
          "Transfer funds",
          "Transaction status",
          "Balance",
        ],
      },
      {
        id: "vodafone-cash",
        name: "Vodafone Cash Ghana",
        cat: "Payments",
        desc: "Vodafone Cash mobile money",
        icon: "Banknote",
        config: { apiKey: "", merchantId: "", env: "production" },
        features: [
          "Collect payments",
          "Send money",
          "Transaction history",
          "Balance",
        ],
      },
    ],
    webhooks: [
      {
        name: "GRA VAT Filing",
        url: "https://gra.gov.gh/webhook",
        events: ["tax.vat-due", "tax.monthly-return", "tax.withholding"],
      },
      {
        name: "NPA Price Ceiling",
        url: "https://npa.gov.gh/webhook",
        events: [
          "fuel.price-change",
          "compliance.due",
          "levy.update",
          "license.renewal",
        ],
      },
      {
        name: "MTN MoMo Ghana",
        url: "https://api.mtn.com.gh/webhook",
        events: ["payment.received", "payment.failed", "payment.reversed"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
  rwanda: {
    country: "Rwanda",
    code: "RW",
    flag: "🇷🇼",
    connectors: [
      {
        id: "rra-ebm",
        name: "RRA EBM",
        cat: "Government",
        desc: "Rwanda Revenue Authority Electronic Billing Machine",
        icon: "Shield",
        config: {
          tin: "",
          password: "",
          apiEndpoint: "https://rra.gov.rw",
          deviceId: "",
        },
        features: [
          "EBM receipt sync",
          "VAT filing",
          "Tax certificates",
          "Compliance alerts",
        ],
      },
      {
        id: "rura-portal",
        name: "RURA Fuel Portal",
        cat: "Government",
        desc: "Rwanda Utilities Regulatory Authority compliance",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://rura.rw" },
        features: [
          "Submit pump prices",
          "License management",
          "Compliance reports",
          "Price monitoring",
        ],
      },
      {
        id: "bk-bank",
        name: "Bank of Kigali",
        cat: "Finance",
        desc: "Bank of Kigali API integration",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "mtn-momo-rw",
        name: "MTN MoMo Rwanda",
        cat: "Payments",
        desc: "MTN Mobile Money Rwanda API",
        icon: "Banknote",
        config: { apiUser: "", apiKey: "", env: "production" },
        features: [
          "Request payment",
          "Transfer funds",
          "Transaction status",
          "Balance",
        ],
      },
      {
        id: "airtel-money-rw",
        name: "Airtel Money Rwanda",
        cat: "Payments",
        desc: "Airtel Money Rwanda API",
        icon: "Banknote",
        config: { clientId: "", clientSecret: "", env: "production" },
        features: ["Collect payments", "Send money", "Balance", "Reports"],
      },
    ],
    webhooks: [
      {
        name: "RRA VAT Filing",
        url: "https://rra.gov.rw/webhook",
        events: ["tax.vat-due", "tax.monthly-return"],
      },
      {
        name: "RURA Price Update",
        url: "https://rura.rw/webhook",
        events: ["fuel.price-change", "compliance.due"],
      },
      {
        name: "MTN MoMo Rwanda",
        url: "https://api.mtn.co.rw/webhook",
        events: ["payment.received", "payment.reversal"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
  ethiopia: {
    country: "Ethiopia",
    code: "ET",
    flag: "🇪🇹",
    connectors: [
      {
        id: "erca-tax",
        name: "ERCA Tax Portal",
        cat: "Government",
        desc: "Ethiopian Revenue and Customs Authority",
        icon: "Shield",
        config: { tin: "", password: "", apiEndpoint: "https://erca.gov.et" },
        features: [
          "VAT filing",
          "Tax clearance",
          "Excise duty",
          "Monthly returns",
        ],
      },
      {
        id: "epse-portal",
        name: "EPSE Fuel Portal",
        cat: "Government",
        desc: "Ethiopian Petroleum Supply Enterprise",
        icon: "Fuel",
        config: { licenseNumber: "", apiEndpoint: "https://epse.gov.et" },
        features: [
          "Government fuel pricing",
          "License management",
          "Distribution reports",
          "Compliance",
        ],
      },
      {
        id: "cbe-bank",
        name: "CBE Ethiopia",
        cat: "Finance",
        desc: "Commercial Bank of Ethiopia API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: ["Statements", "Payments", "Reconciliation", "Balance"],
      },
      {
        id: "telebirr",
        name: "Telebirr",
        cat: "Payments",
        desc: "Ethio Telecom Telebirr mobile money",
        icon: "Banknote",
        config: { apiKey: "", merchantId: "", env: "production" },
        features: [
          "Accept payments",
          "Transfer funds",
          "Transaction history",
          "Balance",
        ],
      },
      {
        id: "dashen-bank",
        name: "Dashen Bank Ethiopia",
        cat: "Finance",
        desc: "Dashen Bank Ethiopia API",
        icon: "Landmark",
        config: { accountNumber: "", apiKey: "", branchCode: "" },
        features: ["Statements", "Transfers", "Balance", "Reconciliation"],
      },
    ],
    webhooks: [
      {
        name: "ERCA VAT Filing",
        url: "https://erca.gov.et/webhook",
        events: ["tax.vat-due", "tax.monthly-return"],
      },
      {
        name: "EPSE Price Update",
        url: "https://epse.gov.et/webhook",
        events: ["fuel.price-change", "compliance.due"],
      },
      {
        name: "Telebirr Transaction",
        url: "https://api.telebirr.et/webhook",
        events: ["payment.received", "payment.failed"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  },
};

// Dynamic connector generator for ALL countries
function generateConnectorsForCountry(
  countryCode: string,
  countryName: string,
) {
  const gateways = getCountryGateways(countryCode);
  const walletProviders = gateways.filter(
    (g) =>
      !g.includes("Card") && !g.includes("PayPal") && !g.includes("Stripe"),
  );
  const connectors: any[] = [];

  // Government connector (generic)
  connectors.push({
    id: `${countryCode.toLowerCase()}-tax`,
    name: `${countryName} Tax Authority`,
    cat: "Government",
    desc: `Tax compliance portal for ${countryName}`,
    icon: "Shield",
    config: { tin: "", password: "", apiEndpoint: "", licenseNumber: "" },
    features: [
      "VAT filing",
      "Tax clearance",
      "Monthly returns",
      "Compliance alerts",
    ],
  });

  // Fuel regulatory connector
  connectors.push({
    id: `${countryCode.toLowerCase()}-fuel-reg`,
    name: `${countryName} Fuel Regulator`,
    cat: "Government",
    desc: `Energy/fuel regulatory compliance for ${countryName}`,
    icon: "Fuel",
    config: { licenseNumber: "", apiEndpoint: "" },
    features: [
      "Submit pump prices",
      "License management",
      "Compliance reports",
      "Price monitoring",
    ],
  });

  // Bank connectors (up to 3 based on country config)
  const bankNames = WORLD_PAYMENT_CONFIGS[countryCode]?.paymentMethods
    .filter((m) => m.type === "bank")
    .slice(0, 3)
    .map((m) => m.name) || [`${countryName} National Bank`];

  bankNames.forEach((bankName, i) => {
    connectors.push({
      id: `${countryCode.toLowerCase()}-bank-${i}`,
      name: bankName,
      cat: "Finance",
      desc: `${bankName} API integration`,
      icon: "Landmark",
      config: { accountNumber: "", apiKey: "", branchCode: "" },
      features: ["Statements", "Payments", "Reconciliation", "Balance"],
    });
  });

  // Payment gateway connectors
  walletProviders.slice(0, 3).forEach((provider, i) => {
    connectors.push({
      id: `${countryCode.toLowerCase()}-pay-${i}`,
      name: provider,
      cat: "Payments",
      desc: `${provider} payment integration`,
      icon: "Banknote",
      config: { clientId: "", clientSecret: "", env: "production" },
      features: [
        "Accept payments",
        "Transfer funds",
        "Transaction history",
        "Balance",
      ],
    });
  });

  // Card processors
  if (gateways.some((g) => g.includes("Stripe"))) {
    connectors.push({
      id: `${countryCode.toLowerCase()}-stripe`,
      name: "Stripe",
      cat: "Payments",
      desc: "Stripe payment processing",
      icon: "CreditCard",
      config: { publicKey: "", secretKey: "", webhookSecret: "", env: "test" },
      features: [
        "Card payments",
        "Bank transfers",
        "Payment links",
        "Webhooks",
      ],
    });
  }

  if (gateways.some((g) => g.includes("PayPal"))) {
    connectors.push({
      id: `${countryCode.toLowerCase()}-paypal`,
      name: "PayPal",
      cat: "Payments",
      desc: "PayPal payment integration",
      icon: "CreditCard",
      config: { clientId: "", clientSecret: "", env: "production" },
      features: ["Accept payments", "Send payouts", "Transaction history"],
    });
  }

  // EFD/Fiscal device (generic)
  connectors.push({
    id: `${countryCode.toLowerCase()}-fiscal`,
    name: `${countryName} Fiscal Device`,
    cat: "Hardware",
    desc: `Electronic fiscal receipting device for ${countryName}`,
    icon: "Printer",
    config: { deviceId: "", serialNumber: "", model: "", autoSync: "true" },
    features: [
      "Fiscal receipt generation",
      "Auto-upload to tax authority",
      "Daily reports",
      "Device diagnostics",
    ],
  });

  return {
    country: countryName,
    code: countryCode,
    flag: getFlagEmoji(countryCode),
    connectors,
    webhooks: [
      {
        name: `${countryName} Tax Filing`,
        url: `https://tax.${countryCode.toLowerCase()}.gov/webhook`,
        events: ["tax.vat-due", "tax.monthly-return", "tax.penalty"],
      },
      {
        name: `${countryName} Fuel Price`,
        url: `https://fuel.${countryCode.toLowerCase()}.gov/webhook`,
        events: ["fuel.price-change", "compliance.due", "license.renewal"],
      },
      {
        name: "Payment Transaction",
        url: `https://api.payments.${countryCode.toLowerCase()}/webhook`,
        events: ["payment.received", "payment.failed", "payment.reversal"],
      },
    ],
    scopes: [
      "read:sales",
      "write:sales",
      "read:inventory",
      "write:inventory",
      "read:tax",
      "write:tax",
      "read:employees",
      "read:reports",
      "admin",
    ],
  };
}

function getFlagEmoji(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return "🏳️";
  const cp1 = code.charCodeAt(0);
  const cp2 = code.charCodeAt(1);
  if (cp1 < 0x41 || cp1 > 0x5a || cp2 < 0x41 || cp2 > 0x5a) return "🏳️";
  const OFFSET = 0x1f1e6;
  return String.fromCodePoint(OFFSET + (cp1 - 0x41), OFFSET + (cp2 - 0x41));
}

// Icon mapping
const ICON_MAP: Record<string, any> = {
  Shield,
  Landmark,
  Fuel,
  Banknote,
  CreditCard,
  Printer,
  Users,
  Receipt,
  Cpu,
  HardDrive,
  Zap,
  Globe,
  Lock,
  Wifi,
  Phone,
  QrCode,
  Barcode,
  Server,
  MapPin,
};

/**
 * Normalize a raw connector (from COUNTRY_CONNECTORS, generateConnectorsForCountry,
 * or cloud-saved JSON) into the IntegrationConnector shape the render expects.
 *
 * This is the single place that:
 *  - maps the `icon` STRING ("Shield", "Landmark"…) to the actual lucide
 *    component via ICON_MAP (a raw string would crash React with error #130
 *    "Element type is invalid: got string" when rendered as <Icon />).
 *  - renames the legacy `cat`→`category` / `desc`→`description` fields used by
 *    COUNTRY_CONNECTORS + generateConnectorsForCountry so the render's
 *    `conn.category` / `conn.description` accesses work.
 *  - guarantees `config`, `features`, `status` are always present so the
 *    render's `.map()` calls never crash on undefined.
 *
 * Cloud-saved connectors may have `icon` as a string (functions are dropped by
 * JSON.stringify, but strings survive), or as undefined, or even as an already-
 * mapped component (if saved by a newer build). This handles ALL cases.
 */
function normalizeConnector(raw: any): IntegrationConnector {
  const iconResolved =
    typeof raw.icon === "string"
      ? ICON_MAP[raw.icon] || Plug
      : typeof raw.icon === "function"
        ? raw.icon
        : Plug;
  return {
    id:
      raw.id || `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: raw.name || "Unnamed Connector",
    category: raw.category || raw.cat || "Other",
    description: raw.description || raw.desc || "",
    icon: iconResolved,
    status: raw.status || "disconnected",
    config:
      raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
        ? raw.config
        : {},
    lastSync: raw.lastSync,
    features: Array.isArray(raw.features) ? raw.features : [],
  };
}

function normalizeConnectors(raw: any): IntegrationConnector[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeConnector);
}

// Reverse map: lucide component → icon NAME string, so we can serialize the
// icon to cloud/localStorage as a plain string (functions are dropped by
// JSON.stringify) and re-map it back to a component on load via ICON_MAP.
const COMPONENT_TO_ICON_NAME = new Map<any, string>();
for (const [name, comp] of Object.entries(ICON_MAP)) {
  if (comp && typeof comp === "function")
    COMPONENT_TO_ICON_NAME.set(comp, name);
}
// Plug is the fallback icon; ensure it's in the reverse map too.
if (!COMPONENT_TO_ICON_NAME.has(Plug)) COMPONENT_TO_ICON_NAME.set(Plug, "Plug");

function serializeConnectorsForStorage(
  conns: IntegrationConnector[],
): IntegrationConnector[] {
  return conns.map((c) => ({
    ...c,
    // Store the icon NAME (string) instead of the component function so it
    // survives JSON.stringify and can be re-mapped via ICON_MAP on load.
    icon: COMPONENT_TO_ICON_NAME.get(c.icon) || "Plug",
  }));
}

interface CountryConnectorSet {
  country: string;
  code: string;
  flag: string;
  connectors: any[];
  webhooks: any[];
  scopes: string[];
}

interface IntegrationConnector {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: any;
  status: "connected" | "disconnected" | "error" | "configuring";
  config: Record<string, string>;
  lastSync?: string;
  features: string[];
}
interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  lastTriggered?: string;
}
interface APIKey {
  id: string;
  name: string;
  key: string;
  scopes: string[];
  created: string;
  lastUsed?: string;
}

const STORAGE_KEY = "fuelpro_integrations_v2";
const WEBHOOKS_KEY = "fuelpro_webhooks_v2";
const APIKEYS_KEY = "fuelpro_apikeys_v2";
// Cloud (app_kv) keys — the SOURCE OF TRUTH for cross-device sync.
// localStorage keys above are kept ONLY as a read-through cache.
const CLOUD_CONNECTORS_KEY = "integration_connectors";
const CLOUD_WEBHOOKS_KEY = "integration_webhooks";
const CLOUD_APIKEYS_KEY = "integration_apikeys";
const CLOUD_LOGS_KEY = "integration_logs";

// Check if a country has detailed hardcoded connectors (8 core countries)
const DETAILED_COUNTRY_CODES = ["KE", "UG", "TZ", "NG", "ZA", "GH", "RW", "ET"];
const COUNTRY_KEY_MAP: Record<string, string> = {
  KE: "kenya",
  UG: "uganda",
  TZ: "tanzania",
  NG: "nigeria",
  ZA: "southafrica",
  GH: "ghana",
  RW: "rwanda",
  ET: "ethiopia",
};

function detectCountryCode(): string {
  // 1. Try localStorage (highest priority)
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const parsed = JSON.parse(saved);
      const cc = (parsed.currentCountry || parsed.country || "").toUpperCase();
      if (cc && WORLD_PAYMENT_CONFIGS[cc]) return cc;
    }
  } catch {
    /* */
  }

  // 2. Try station data (check the current _v3 key + the user-scoped variant)
  try {
    const stationsJson =
      localStorage.getItem("fuelpro_stations_v3") ||
      localStorage.getItem("fuelpro_current_stations_v3");
    const currentId =
      localStorage.getItem("fuelpro_current_station_v3") ||
      localStorage.getItem("fuelpro_current_station");
    if (stationsJson && currentId) {
      const stations = JSON.parse(stationsJson);
      const arr = Array.isArray(stations) ? stations : [];
      const current = arr.find((s: any) => s.id === currentId);
      if (
        current?.country &&
        WORLD_PAYMENT_CONFIGS[current.country.toUpperCase()]
      ) {
        return current.country.toUpperCase();
      }
    }
  } catch {
    /* */
  }

  // 3. Try timezone detection
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const TZ_MAP: Record<string, string> = {
    Nairobi: "KE",
    Kampala: "UG",
    Dar_es_Salaam: "TZ",
    Lagos: "NG",
    Johannesburg: "ZA",
    Accra: "GH",
    Kigali: "RW",
    Addis_Ababa: "ET",
    New_York: "US",
    Los_Angeles: "US",
    Chicago: "US",
    London: "GB",
    Paris: "FR",
    Berlin: "DE",
    Rome: "IT",
    Madrid: "ES",
    Moscow: "RU",
    Dubai: "AE",
    Mumbai: "IN",
    Kolkata: "IN",
    Shanghai: "CN",
    Tokyo: "JP",
    Seoul: "KR",
    Singapore: "SG",
    Sydney: "AU",
    Sao_Paulo: "BR",
    Mexico_City: "MX",
    Toronto: "CA",
    Lusaka: "ZM",
    Harare: "ZW",
    Gaborone: "BW",
    Windhoek: "NA",
    Maputo: "MZ",
    Lilongwe: "MW",
    Mbabane: "SZ",
    Maseru: "LS",
    Bujumbura: "BI",
    Djibouti: "DJ",
    Asmara: "ER",
    Mogadishu: "SO",
    Khartoum: "SD",
    Juba: "SS",
    Bangui: "CF",
    Ndjamena: "TD",
    Kinshasa: "CD",
    Brazzaville: "CG",
    Libreville: "GA",
    Malabo: "GQ",
    Yaounde: "CM",
    Abuja: "NG",
    Ouagadougou: "BF",
    Bamako: "ML",
    Niamey: "NE",
    Lome: "TG",
    "Porto-Novo": "BJ",
    Monrovia: "LR",
    Freetown: "SL",
    Conakry: "GN",
    Bissau: "GW",
    Banjul: "GM",
    Dakar: "SN",
    Praia: "CV",
    Nouakchott: "MR",
    Rabat: "MA",
    Algiers: "DZ",
    Tunis: "TN",
    Tripoli: "LY",
    Cairo: "EG",
  };
  for (const [key, code] of Object.entries(TZ_MAP)) {
    if (tz.includes(key)) return code;
  }

  // 4. Fallback to US (most generic) rather than Kenya
  return "US";
}

function resolveCountryConnectorSet(): CountryConnectorSet {
  const countryCode = detectCountryCode();

  // Use hardcoded detailed connectors for 8 core countries
  if (DETAILED_COUNTRY_CODES.includes(countryCode)) {
    const key = COUNTRY_KEY_MAP[countryCode];
    if (key && COUNTRY_CONNECTORS[key as keyof typeof COUNTRY_CONNECTORS]) {
      return COUNTRY_CONNECTORS[
        key as keyof typeof COUNTRY_CONNECTORS
      ] as CountryConnectorSet;
    }
  }

  // Generate dynamic connectors for ALL other 240+ countries
  const config = WORLD_PAYMENT_CONFIGS[countryCode];
  return generateConnectorsForCountry(
    countryCode,
    config?.countryName || countryCode,
  );
}

export default function IntegrationHub() {
  const countryConfig = resolveCountryConnectorSet();
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  // Cloud keys are station-scoped so each station keeps its own connector set.
  const cKey = `${CLOUD_CONNECTORS_KEY}_${stationId || "default"}`;
  const wKey = `${CLOUD_WEBHOOKS_KEY}_${stationId || "default"}`;
  const kKey = `${CLOUD_APIKEYS_KEY}_${stationId || "default"}`;
  const lKey = `${CLOUD_LOGS_KEY}_${stationId || "default"}`;

  // Build the base (default/disconnected) connector set for the selected country.
  const buildBaseConnectors = useCallback((selector: string) => {
    let baseConnectors: any[] = [];
    if (COUNTRY_CONNECTORS[selector]) {
      baseConnectors = COUNTRY_CONNECTORS[selector].connectors;
    } else {
      const upperCode = selector.toUpperCase();
      const country = ALL_COUNTRIES.find((c) => c.code === upperCode);
      if (country) {
        const dynamic = generateConnectorsForCountry(
          country.code,
          country.name,
        );
        baseConnectors = dynamic.connectors;
      }
    }
    // normalizeConnector maps the icon STRING → lucide component (a raw string
    // would crash React error #130 when rendered as <Icon />) and renames
    // cat→category / desc→description.
    return baseConnectors.map((c: any) =>
      normalizeConnector({ ...c, status: "disconnected", lastSync: undefined }),
    );
  }, []);

  // INSTANT first render: seed from the synchronous in-memory cache (or localStorage
  // cache) so the user never sees a blank flash; the mount effect below refreshes
  // from the authoritative cloud source.
  const [connectors, setConnectors] = useState<IntegrationConnector[]>(() => {
    const cached = cloudStorageService.getCached<IntegrationConnector[]>(
      cKey,
      stationId,
    );
    if (cached && Array.isArray(cached)) return normalizeConnectors(cached);
    try {
      const sel = (() => {
        const cc = detectCountryCode();
        return COUNTRY_KEY_MAP[cc] || cc.toLowerCase();
      })();
      const saved = localStorage.getItem(`${STORAGE_KEY}_${sel}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return normalizeConnectors(parsed);
      }
      return buildBaseConnectors(sel);
    } catch {
      return [];
    }
  });
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>(() => {
    const cached = cloudStorageService.getCached<WebhookEndpoint[]>(
      wKey,
      stationId,
    );
    if (cached && Array.isArray(cached)) return cached;
    try {
      const sel = (() => {
        const cc = detectCountryCode();
        return COUNTRY_KEY_MAP[cc] || cc.toLowerCase();
      })();
      const saved = localStorage.getItem(`${WEBHOOKS_KEY}_${sel}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [apiKeys, setApiKeys] = useState<APIKey[]>(() => {
    const cached = cloudStorageService.getCached<APIKey[]>(kKey, stationId);
    if (cached && Array.isArray(cached)) return cached;
    try {
      const sel = (() => {
        const cc = detectCountryCode();
        return COUNTRY_KEY_MAP[cc] || cc.toLowerCase();
      })();
      const saved = localStorage.getItem(`${APIKEYS_KEY}_${sel}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeTab, setActiveTab] = useState<
    | "connectors"
    | "webhooks"
    | "apikeys"
    | "logs"
    | "payment-setup"
    | "hardware"
  >("connectors");
  const [expandedConnector, setExpandedConnector] = useState<string | null>(
    null,
  );
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>(
    {},
  );
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [showAddApiKey, setShowAddApiKey] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [testResult, setTestResult] = useState("");
  const [logs, setLogs] = useState<string[]>(() => {
    const cached = cloudStorageService.getCached<string[]>(lKey, stationId);
    if (cached && Array.isArray(cached)) return cached;
    return [];
  });
  // Initialize with detected country
  const [countrySelector, setCountrySelector] = useState(() => {
    const cc = detectCountryCode();
    const key = COUNTRY_KEY_MAP[cc];
    if (key) return key;
    return cc.toLowerCase();
  });

  // Echo guard for real-time: when WE write to cloud, the realtime event echoes
  // back; skip re-applying our own write to avoid a loop. Each subscription
  // type gets its OWN flag so a connectors echo doesn't consume the webhooks
  // skip (which would cause the webhooks echo to overwrite a just-added hook).
  const skipRemoteConnRef = useRef(false);
  const skipRemoteWhRef = useRef(false);
  const skipRemoteKeyRef = useRef(false);

  // Cloud-load-complete guard: prevents save effects from firing with default
  // state BEFORE the initial cloud load returns — which would overwrite real
  // cloud data with empty defaults (the same race fixed in PayrollSystem /
  // Communication). Reset on every user/station change; set true after the
  // initial load completes (success, no-data, or failure).
  const cloudLoadCompleteRef = useRef(false);
  useEffect(() => {
    cloudLoadCompleteRef.current = false;
  }, [user, stationId]);

  // Load from CLOUD (source of truth) on mount / user / station change.
  // Cloud is authoritative — localStorage is only a read-through cache.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [cloudConn, cloudWh, cloudKeys, cloudLogs] = await Promise.all([
          cloudStorageService.get<IntegrationConnector[]>(cKey, stationId),
          cloudStorageService.get<WebhookEndpoint[]>(wKey, stationId),
          cloudStorageService.get<APIKey[]>(kKey, stationId),
          cloudStorageService.get<string[]>(lKey, stationId),
        ]);
        if (cancelled) return;
        // Connectors: if cloud has saved connectors use them (normalized so icon
        // strings → components + legacy field names are mapped); otherwise seed
        // the country default set (disconnected) so the user sees the catalog.
        if (cloudConn && Array.isArray(cloudConn) && cloudConn.length > 0) {
          setConnectors(normalizeConnectors(cloudConn));
        } else {
          setConnectors(buildBaseConnectors(countrySelector));
        }
        if (cloudWh && Array.isArray(cloudWh)) setWebhooks(cloudWh);
        if (cloudKeys && Array.isArray(cloudKeys)) setApiKeys(cloudKeys);
        if (cloudLogs && Array.isArray(cloudLogs)) setLogs(cloudLogs);
      } catch {
        // Cloud load failed — unblock saves so local edits still persist.
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user,
    stationId,
    cKey,
    wKey,
    kKey,
    lKey,
    countrySelector,
    buildBaseConnectors,
  ]);

  // Real-time cross-device sync: another device's write shows up here instantly.
  useEffect(() => {
    if (!user) return;
    const unsubC = cloudStorageService.subscribe<IntegrationConnector[]>(
      cKey,
      stationId,
      (val) => {
        if (skipRemoteConnRef.current) {
          skipRemoteConnRef.current = false;
          return;
        }
        if (val && Array.isArray(val)) setConnectors(normalizeConnectors(val));
      },
    );
    const unsubW = cloudStorageService.subscribe<WebhookEndpoint[]>(
      wKey,
      stationId,
      (val) => {
        if (skipRemoteWhRef.current) {
          skipRemoteWhRef.current = false;
          return;
        }
        if (val && Array.isArray(val)) setWebhooks(val);
      },
    );
    const unsubK = cloudStorageService.subscribe<APIKey[]>(
      kKey,
      stationId,
      (val) => {
        if (skipRemoteKeyRef.current) {
          skipRemoteKeyRef.current = false;
          return;
        }
        if (val && Array.isArray(val)) setApiKeys(val);
      },
    );
    return () => {
      unsubC?.();
      unsubW?.();
      unsubK?.();
    };
  }, [user, stationId, cKey, wKey, kKey]);

  // Save — cloud is source of truth; localStorage is a read-through cache only.
  // Wrapped in try/catch so a quota error never blocks the save to cloud.
  // Guarded by cloudLoadCompleteRef so we never overwrite real cloud data with
  // default/empty state before the initial cloud load returns.
  useEffect(() => {
    if (!user || !cloudLoadCompleteRef.current) return;
    skipRemoteConnRef.current = true;
    const serializable = serializeConnectorsForStorage(connectors);
    cloudStorageService.set(cKey, serializable, stationId).catch(() => {});
    try {
      localStorage.setItem(
        `${STORAGE_KEY}_${countrySelector}`,
        JSON.stringify(serializable),
      );
    } catch {
      /* localStorage quota — non-fatal, cloud is source of truth */
    }
  }, [connectors, countrySelector, user, stationId, cKey]);
  useEffect(() => {
    if (!user || !cloudLoadCompleteRef.current) return;
    skipRemoteWhRef.current = true;
    cloudStorageService.set(wKey, webhooks, stationId).catch(() => {});
    try {
      localStorage.setItem(
        `${WEBHOOKS_KEY}_${countrySelector}`,
        JSON.stringify(webhooks),
      );
    } catch {
      /* non-fatal */
    }
  }, [webhooks, countrySelector, user, stationId, wKey]);
  useEffect(() => {
    if (!user || !cloudLoadCompleteRef.current) return;
    skipRemoteKeyRef.current = true;
    cloudStorageService.set(kKey, apiKeys, stationId).catch(() => {});
    try {
      localStorage.setItem(
        `${APIKEYS_KEY}_${countrySelector}`,
        JSON.stringify(apiKeys),
      );
    } catch {
      /* non-fatal */
    }
  }, [apiKeys, countrySelector, user, stationId, kKey]);
  // Persist logs to cloud (capped) so the audit trail is cross-device.
  useEffect(() => {
    if (!user || !cloudLoadCompleteRef.current) return;
    cloudStorageService.set(lKey, logs, stationId).catch(() => {});
  }, [logs, user, stationId, lKey]);

  const addLog = (msg: string) =>
    setLogs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 200),
    );

  const updateConnectorStatus = (
    id: string,
    status: IntegrationConnector["status"],
  ) => {
    setConnectors((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              status,
              lastSync:
                status === "connected" ? new Date().toISOString() : c.lastSync,
            }
          : c,
      ),
    );
  };

  const saveConnectorConfig = (id: string) => {
    setConnectors((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, config: { ...c.config, ...tempConfig } } : c,
      ),
    );
    setEditingConfig(null);
    addLog(`Config saved`);
  };

  const testConnection = (connector: IntegrationConnector) => {
    setTestResult(`Testing ${connector.name}...`);
    addLog(`Testing ${connector.name}...`);
    setTimeout(() => {
      // Validate that the required credential fields are filled. A real
      // connector call requires keys/secrets/credentials — an empty or
      // placeholder-length value cannot authenticate. This is a client-side
      // validation gate, NOT a fake "always succeeds" stub.
      const configEntries = Object.entries(connector.config || {});
      const totalFields = configEntries.length;
      const filledFields = configEntries.filter(
        ([, v]) => v && String(v).trim().length >= 4,
      );
      // Require at least half of the credential fields to be meaningfully filled.
      const requiredMin = Math.max(1, Math.ceil(totalFields / 2));
      if (filledFields.length >= requiredMin) {
        setTestResult(
          `✓ Configuration valid — ${connector.name} is ready to connect (${filledFields.length}/${totalFields} fields configured). Click "Connect" to activate.`,
        );
        addLog(
          `${connector.name} config validated (${filledFields.length}/${totalFields} fields)`,
        );
      } else {
        setTestResult(
          `Cannot test ${connector.name}: only ${filledFields.length}/${totalFields} fields are configured. Please fill in the credential fields first.`,
        );
        addLog(`${connector.name} test failed — incomplete config`);
      }
    }, 600);
  };

  const toCsv = (rows: (string | number)[][]): string =>
    rows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            // Quote cells containing commas, quotes, or newlines.
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n");

  const exportData = (format: "csv" | "json") => {
    const data = {
      country: countrySelector,
      connectors: connectors.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
      webhooks: webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
      })),
      apiKeys: apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        scopes: k.scopes,
      })),
      exportedAt: new Date().toISOString(),
    };
    let content: string;
    if (format === "json") {
      content = JSON.stringify(data, null, 2);
    } else {
      // Proper multi-section CSV (was broken: Object.values().join("\n")
      // produced "[object Object]" garbage). Each entity type gets a header
      // row + data rows so the file is parseable by Excel/Sheets.
      const rows: (string | number)[][] = [];
      rows.push(["FuelPro Integration Export"]);
      rows.push(["Country", countrySelector]);
      rows.push(["Exported At", data.exportedAt]);
      rows.push([]);
      rows.push(["CONNECTORS"]);
      rows.push(["ID", "Name", "Status"]);
      data.connectors.forEach((c) => rows.push([c.id, c.name, c.status]));
      rows.push([]);
      rows.push(["WEBHOOKS"]);
      rows.push(["ID", "Name", "Active"]);
      data.webhooks.forEach((w) => rows.push([w.id, w.name, String(w.active)]));
      rows.push([]);
      rows.push(["API KEYS"]);
      rows.push(["ID", "Name", "Scopes"]);
      data.apiKeys.forEach((k) =>
        rows.push([k.id, k.name, (k.scopes || []).join("; ")]),
      );
      content = toCsv(rows);
    }
    const blob = new Blob([content], {
      type: format === "json" ? "application/json" : "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro_integrations_${countrySelector}_${new Date().toISOString().split("T")[0]}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`Exported as ${format.toUpperCase()}`);
  };

  const filteredConnectors =
    categoryFilter === "all"
      ? connectors
      : connectors.filter(
          (c) => c.category.toLowerCase() === categoryFilter.toLowerCase(),
        );
  const categories = [
    "all",
    ...Array.from(new Set(connectors.map((c) => c.category))),
  ];
  const connectedCount = connectors.filter(
    (c) => c.status === "connected",
  ).length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
          <Plug size={24} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            Integration Hub
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
            Country-specific integrations for {countryConfig.country}
          </p>
        </div>
      </div>

      {/* Country Selector — Searchable dropdown for all 250+ Countries */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Select Country
          </label>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {ALL_COUNTRIES.length} countries supported
          </span>
        </div>
        <div className="w-full">
          <SearchableCountryDropdown
            value={(() => {
              // Convert countrySelector (lowercase key like 'kenya' or 'us') to uppercase code
              const entry = Object.entries(COUNTRY_CONNECTORS).find(
                ([k]) => k === countrySelector,
              );
              if (entry) return entry[1].code;
              return countrySelector.toUpperCase();
            })()}
            onChange={(code) => {
              const selected = code.toLowerCase();
              setCountrySelector(selected);
              // If the selected country is not in the 8 detailed countries, generate dynamic connectors
              if (!Object.keys(COUNTRY_CONNECTORS).includes(selected)) {
                const country = ALL_COUNTRIES.find(
                  (c) =>
                    c.code.toLowerCase() === selected ||
                    c.name.toLowerCase().replace(/\s+/g, "") === selected,
                );
                if (country) {
                  const dynamic = generateConnectorsForCountry(
                    country.code,
                    country.name,
                  );
                  setConnectors(
                    normalizeConnectors(
                      dynamic.connectors.map((c) => ({
                        ...c,
                        status: "disconnected",
                      })),
                    ),
                  );
                  setWebhooks(
                    dynamic.webhooks.map((w) => ({
                      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                      ...w,
                      active: false,
                      headers: [
                        { key: "Content-Type", value: "application/json" },
                      ],
                      retryCount: 3,
                    })),
                  );
                }
              } else {
                // Use detailed hardcoded connectors
                const cc = COUNTRY_CONNECTORS[
                  selected as keyof typeof COUNTRY_CONNECTORS
                ] as CountryConnectorSet;
                setConnectors(
                  normalizeConnectors(
                    cc.connectors.map((c) => ({
                      ...c,
                      status: "disconnected",
                    })),
                  ),
                );
                setWebhooks(
                  cc.webhooks.map((w) => ({
                    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    ...w,
                    active: false,
                    headers: [
                      { key: "Content-Type", value: "application/json" },
                    ],
                    retryCount: 3,
                  })),
                );
              }
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {connectors.length}
          </p>
          <p className="text-[10px] text-gray-500">Connectors</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {connectedCount}
          </p>
          <p className="text-[10px] text-gray-500">Connected</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {webhooks.length}
          </p>
          <p className="text-[10px] text-gray-500">Webhooks</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {apiKeys.length}
          </p>
          <p className="text-[10px] text-gray-500">API Keys</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: "connectors" as const, label: "Connectors", icon: Plug },
          { id: "webhooks" as const, label: "Webhooks", icon: Globe },
          { id: "apikeys" as const, label: "API Keys", icon: Lock },
          { id: "hardware" as const, label: "Hardware", icon: Cpu },
          { id: "logs" as const, label: "Logs", icon: FileText },
          {
            id: "payment-setup" as const,
            label: "Payment Setup",
            icon: Smartphone,
          },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-all ${activeTab === t.id ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600" : "text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== CONNECTORS TAB ===== */}
      {activeTab === "connectors" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${categoryFilter === cat ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-900 dark:text-white shadow" : "text-gray-500 dark:text-gray-500 dark:text-gray-400"}`}
                >
                  {cat === "all" ? "All" : cat}
                </button>
              ))}
            </div>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => exportData("csv")}
                className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-600 flex items-center gap-1.5"
              >
                <Download size={14} /> CSV
              </button>
              <button
                onClick={() => exportData("json")}
                className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-600 flex items-center gap-1.5"
              >
                <Download size={14} /> JSON
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded-xl p-3 text-xs flex items-center gap-2 ${testResult.startsWith("✓") ? "bg-green-50 dark:bg-green-900/20 border border-green-200 text-green-700" : testResult.includes("Testing") ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 text-blue-700" : "bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700"}`}
            >
              {testResult.startsWith("✓") ? (
                <CheckCircle2 size={14} />
              ) : testResult.includes("Testing") ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <AlertCircle size={14} />
              )}
              {testResult}
              <button onClick={() => setTestResult("")} className="ml-auto">
                <X size={12} />
              </button>
            </div>
          )}

          <div className="space-y-3">
            {filteredConnectors.map((conn) => {
              const Icon = conn.icon || Plug;
              const isExpanded = expandedConnector === conn.id;
              const isEditing = editingConfig === conn.id;
              return (
                <div
                  key={conn.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    onClick={() =>
                      setExpandedConnector(isExpanded ? null : conn.id)
                    }
                  >
                    <div
                      className={`p-2.5 rounded-lg ${conn.status === "connected" ? "bg-green-100 dark:bg-green-900/30" : conn.status === "error" ? "bg-red-100 dark:bg-red-900/30" : "bg-gray-100 dark:bg-gray-700"}`}
                    >
                      <Icon
                        size={20}
                        className={
                          conn.status === "connected"
                            ? "text-green-600"
                            : conn.status === "error"
                              ? "text-red-600"
                              : "text-gray-500"
                        }
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                          {conn.name}
                        </h3>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${conn.status === "connected" ? "bg-green-100 text-green-700" : conn.status === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}
                        >
                          {conn.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 truncate">
                        {conn.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {conn.lastSync && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                          Synced {new Date(conn.lastSync).toLocaleTimeString()}
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronUp
                          size={18}
                          className="text-gray-500 dark:text-gray-400"
                        />
                      ) : (
                        <ChevronDown
                          size={18}
                          className="text-gray-500 dark:text-gray-400"
                        />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                      <div>
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
                          Features
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {conn.features.map((f) => (
                            <span
                              key={f}
                              className="text-[11px] px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-full border border-indigo-100 dark:border-indigo-800"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                            Configuration
                          </p>
                          {!isEditing && (
                            <button
                              onClick={() => {
                                setEditingConfig(conn.id);
                                setTempConfig({ ...conn.config });
                              }}
                              className="text-xs text-indigo-600 flex items-center gap-1"
                            >
                              <Settings size={12} /> Edit
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="space-y-3">
                            {Object.entries(conn.config).map(([key, value]) => (
                              <div key={key}>
                                <label className="block text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-1 capitalize">
                                  {key.replace(/([A-Z])/g, " $1").trim()}
                                </label>
                                <div className="relative">
                                  <input
                                    type={
                                      key.toLowerCase().includes("password") ||
                                      key.toLowerCase().includes("secret") ||
                                      key.toLowerCase().includes("pin") ||
                                      key.toLowerCase().includes("key")
                                        ? showPasswords[`${conn.id}-${key}`]
                                          ? "text"
                                          : "password"
                                        : "text"
                                    }
                                    value={
                                      tempConfig[key] !== undefined
                                        ? tempConfig[key]
                                        : value
                                    }
                                    onChange={(e) =>
                                      setTempConfig((p) => ({
                                        ...p,
                                        [key]: e.target.value,
                                      }))
                                    }
                                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                  />
                                  {(key.toLowerCase().includes("password") ||
                                    key.toLowerCase().includes("secret") ||
                                    key.toLowerCase().includes("pin") ||
                                    key.toLowerCase().includes("key")) && (
                                    <button
                                      onClick={() =>
                                        setShowPasswords((p) => ({
                                          ...p,
                                          [`${conn.id}-${key}`]:
                                            !p[`${conn.id}-${key}`],
                                        }))
                                      }
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                                    >
                                      {showPasswords[`${conn.id}-${key}`] ? (
                                        <EyeOff size={14} />
                                      ) : (
                                        <Eye size={14} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveConnectorConfig(conn.id)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                              >
                                <Save size={14} /> Save
                              </button>
                              <button
                                onClick={() => setEditingConfig(null)}
                                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(conn.config).map(([key, value]) => (
                              <div
                                key={key}
                                className="p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
                              >
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">
                                  {key.replace(/([A-Z])/g, " $1").trim()}
                                </p>
                                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">
                                  {value ? (
                                    key.toLowerCase().includes("password") ||
                                    key.toLowerCase().includes("secret") ? (
                                      "••••••••"
                                    ) : (
                                      value
                                    )
                                  ) : (
                                    <span className="text-gray-500 dark:text-gray-400 italic">
                                      Not set
                                    </span>
                                  )}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => testConnection(conn)}
                          className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-lg flex items-center gap-1.5"
                        >
                          <TestTube size={14} /> Test
                        </button>
                        {conn.status === "disconnected" ||
                        conn.status === "error" ? (
                          <button
                            onClick={() => {
                              updateConnectorStatus(conn.id, "connected");
                              addLog(`${conn.name} connected`);
                            }}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                          >
                            <Link2 size={14} /> Connect
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              updateConnectorStatus(conn.id, "disconnected");
                              addLog(`${conn.name} disconnected`);
                            }}
                            className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg flex items-center gap-1.5"
                          >
                            <X size={14} /> Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== WEBHOOKS TAB ===== */}
      {activeTab === "hardware" && (
        <div className="space-y-4">
          <PumpControlBoard />
          <ForecourtHardware />
          <HardwareFirmwareTracker />
        </div>
      )}

      {activeTab === "webhooks" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Webhooks for {countryConfig.country} —{" "}
              {countryConfig.webhooks.length} preset templates available
            </p>
            <button
              onClick={() => setShowAddWebhook(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
            >
              <Plus size={14} /> Add Webhook
            </button>
          </div>

          {/* Country preset webhooks */}
          {countryConfig.webhooks.length > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4">
              <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-3">
                Preset Webhooks for {countryConfig.country}
              </p>
              <div className="space-y-2">
                {countryConfig.webhooks.map((preset, i) => {
                  const existing = webhooks.find((w) => w.name === preset.name);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg"
                    >
                      <div>
                        <p className="text-xs font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                          {preset.name}
                        </p>
                        <p className="text-[10px] text-gray-500 font-mono">
                          {preset.url}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {preset.events.map((e) => (
                            <span
                              key={e}
                              className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 rounded-full"
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                      {existing ? (
                        <span className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full">
                          Added
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setWebhooks((p) => [
                              ...p,
                              {
                                id: `wh_${Date.now()}_${i}`,
                                name: preset.name,
                                url: preset.url,
                                events: preset.events,
                                active: true,
                              },
                            ]);
                            addLog(`Added preset webhook: ${preset.name}`);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-[11px] font-medium rounded-lg"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showAddWebhook && (
            <AddWebhookForm
              onSave={(wh) => {
                setWebhooks((p) => [...p, wh]);
                setShowAddWebhook(false);
                addLog(`Webhook added: ${wh.name}`);
              }}
              onCancel={() => setShowAddWebhook(false)}
              countryEvents={countryConfig.webhooks.flatMap((w) => w.events)}
            />
          )}

          <div className="space-y-3">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${wh.active ? "bg-green-500" : "bg-gray-400"}`}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                        {wh.name}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">
                        {wh.url}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        // REAL webhook test — actually POSTs a signed test
                        // event to the endpoint via the integrations
                        // dispatcher and reports the true HTTP result.
                        addLog(`Testing webhook: ${wh.name}...`);
                        setTestResult(`Testing webhook ${wh.name}...`);
                        try {
                          const { fireWebhook } =
                            await import("@/react-app/lib/integrations-client");
                          const res = await fireWebhook(
                            wh.url,
                            "webhook:test",
                            { webhook_id: wh.id, name: wh.name, test: true },
                            wh.secret,
                          );
                          if (res.success) {
                            setTestResult(
                              `✓ Webhook ${wh.name} delivered — endpoint returned HTTP ${res.status}.`,
                            );
                            addLog(
                              `Webhook ${wh.name} test delivered (HTTP ${res.status})`,
                            );
                            setWebhooks((p) =>
                              p.map((w) =>
                                w.id === wh.id
                                  ? {
                                      ...w,
                                      lastTriggered: new Date().toISOString(),
                                    }
                                  : w,
                              ),
                            );
                          } else {
                            setTestResult(
                              `Webhook ${wh.name} delivery failed: ${res.error || `HTTP ${res.status}`}`,
                            );
                            addLog(
                              `Webhook ${wh.name} test failed: ${res.error || res.status}`,
                            );
                          }
                        } catch (e) {
                          setTestResult(
                            `Webhook ${wh.name} test error: ${(e as Error).message}`,
                          );
                          addLog(`Webhook ${wh.name} test error`);
                        }
                      }}
                      className="p-2 rounded-lg bg-blue-50 text-blue-700"
                      title="Send a real signed test event to this endpoint"
                    >
                      <TestTube size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setWebhooks((p) =>
                          p.map((w) =>
                            w.id === wh.id ? { ...w, active: !w.active } : w,
                          ),
                        );
                        addLog(
                          `${wh.name} ${wh.active ? "paused" : "activated"}`,
                        );
                      }}
                      className={`p-2 rounded-lg ${wh.active ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}
                    >
                      {wh.active ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                      onClick={() => {
                        setWebhooks((p) => p.filter((w) => w.id !== wh.id));
                        addLog(`Deleted: ${wh.name}`);
                      }}
                      className="p-2 rounded-lg bg-red-50 text-red-700"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {wh.events.map((e) => (
                    <span
                      key={e}
                      className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full"
                    >
                      {e}
                    </span>
                  ))}
                  {wh.lastTriggered && (
                    <span className="text-[10px] px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                      Last delivered:{" "}
                      {new Date(wh.lastTriggered).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {webhooks.length === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                No webhooks configured yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ===== API KEYS TAB ===== */}
      {activeTab === "apikeys" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
              API Keys for {countryConfig.country} access
            </p>
            <button
              onClick={() => setShowAddApiKey(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
            >
              <Plus size={14} /> Generate Key
            </button>
          </div>

          {/* Country-specific scopes */}
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4">
            <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-2">
              Available Scopes for {countryConfig.country}
            </p>
            <div className="flex flex-wrap gap-1">
              {countryConfig.scopes.map((s) => (
                <span
                  key={s}
                  className="text-[10px] px-2 py-0.5 bg-white dark:bg-gray-800 rounded-full border border-purple-200 text-purple-600"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {showAddApiKey && (
            <AddApiKeyForm
              onSave={(k) => {
                setApiKeys((p) => [...p, k]);
                setShowAddApiKey(false);
                addLog(`API Key created: ${k.name}`);
              }}
              onCancel={() => setShowAddApiKey(false)}
              countryScopes={countryConfig.scopes}
            />
          )}

          <div className="space-y-3">
            {apiKeys.map((k) => (
              <div
                key={k.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                      {k.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs text-gray-500 font-mono bg-gray-100 dark:bg-white dark:bg-gray-900 px-2 py-1 rounded">
                        {k.key.slice(0, 12)}...{k.key.slice(-4)}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(k.key)}
                        className="text-gray-500 dark:text-gray-400 hover:text-indigo-600"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setApiKeys((p) => p.filter((a) => a.id !== k.id));
                      addLog(`Revoked: ${k.name}`);
                    }}
                    className="p-2 rounded-lg bg-red-50 text-red-700"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  Created {new Date(k.created).toLocaleDateString()}
                </p>
              </div>
            ))}
            {apiKeys.length === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                No API keys generated yet.
              </p>
            )}
          </div>

          <div className="bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <ArrowRight size={16} className="text-indigo-500" /> API Endpoints
            </h4>
            <div className="space-y-2 text-xs font-mono">
              {[
                "GET /api/v1/sales",
                "POST /api/v1/sales",
                "GET /api/v1/inventory",
                "GET /api/v1/employees",
                "GET /api/v1/reports/daily",
                "WS /ws/realtime",
              ].map((ep) => (
                <div
                  key={ep}
                  className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded"
                >
                  <span
                    className={`font-bold ${ep.startsWith("GET") ? "text-green-600" : ep.startsWith("POST") ? "text-blue-600" : "text-purple-600"}`}
                  >
                    {ep.split(" ")[0]}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {ep.split(" ")[1]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== LOGS TAB ===== */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Integration activity for {countryConfig.country}
            </p>
            <button
              onClick={() => setLogs([])}
              className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg"
            >
              Clear Logs
            </button>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 font-mono text-xs max-h-[500px] overflow-y-auto">
            {logs.length === 0 && (
              <p className="text-gray-500 italic">No activity yet.</p>
            )}
            {logs.map((log, i) => (
              <p
                key={i}
                className={`${log.includes("failed") || log.includes("Error") ? "text-red-400" : log.includes("connected") || log.includes("passed") ? "text-green-400" : log.includes("Testing") ? "text-blue-400" : "text-gray-300"}`}
              >
                {log}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ===== PAYMENT SETUP TAB ===== */}
      {/* Hosts the M-PESA (Daraja) and Kopo Kopo integration configuration that
          was previously a standalone top-level "Integrations" tab. Keeping it
          inside the Integration Hub makes all payment-processor setup reachable
          from one place. */}
      {activeTab === "payment-setup" && (
        <div className="space-y-4">
          <IntegrationsSettings />
        </div>
      )}
    </div>
  );
}

// ===== Add Webhook Form =====
function AddWebhookForm({
  onSave,
  onCancel,
  countryEvents,
}: {
  onSave: (w: WebhookEndpoint) => void;
  onCancel: () => void;
  countryEvents?: string[];
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState("");

  const EVENT_TYPES =
    countryEvents && countryEvents.length > 0
      ? [
          ...new Set([
            ...countryEvents,
            "sale.completed",
            "payment.received",
            "inventory.updated",
            "fuel.dispensed",
            "invoice.generated",
            "report.daily",
          ]),
        ]
      : [
          "sale.completed",
          "payment.received",
          "inventory.updated",
          "employee.clock-in",
          "fuel.dispensed",
          "tank.level-low",
          "invoice.generated",
          "report.daily",
        ];

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
        Add Webhook Endpoint
      </h4>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white"
          placeholder="e.g. Invoice Sync"
        />
      </div>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
          URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white"
          placeholder="https://your-system.com/webhook"
        />
      </div>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
          Secret (optional)
        </label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white"
          placeholder="HMAC signature validation"
        />
      </div>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-1 block">
          Events
        </label>
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPES.map((e) => (
            <button
              key={e}
              onClick={() =>
                setSelectedEvents((p) =>
                  p.includes(e) ? p.filter((x) => x !== e) : [...p, e],
                )
              }
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${selectedEvents.includes(e) ? "bg-indigo-600 text-gray-900 dark:text-white border-indigo-600" : "bg-white dark:bg-gray-800 text-gray-600 border-gray-200"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!name || !url) return;
            onSave({
              id: `wh_${Date.now()}`,
              name,
              url,
              events: selectedEvents.length
                ? selectedEvents
                : ["sale.completed"],
              active: true,
              secret: secret || undefined,
            });
          }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg"
        >
          Save Webhook
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ===== Add API Key Form =====
function AddApiKeyForm({
  onSave,
  onCancel,
  countryScopes,
}: {
  onSave: (k: APIKey) => void;
  onCancel: () => void;
  countryScopes: string[];
}) {
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);

  const SCOPES =
    countryScopes.length > 0
      ? countryScopes
      : [
          "read:sales",
          "write:sales",
          "read:inventory",
          "write:inventory",
          "read:employees",
          "admin",
        ];

  return (
    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-300">
        Generate API Key
      </h4>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400">
          Key Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white"
          placeholder="e.g. POS System Integration"
        />
      </div>
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-1 block">
          Scopes
        </label>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() =>
                setSelectedScopes((p) =>
                  p.includes(s) ? p.filter((x) => x !== s) : [...p, s],
                )
              }
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${selectedScopes.includes(s) ? "bg-purple-600 text-gray-900 dark:text-white border-purple-600" : "bg-white dark:bg-gray-800 text-gray-600 border-gray-200"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!name) return;
            const key =
              "fp_" +
              Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            onSave({
              id: `key_${Date.now()}`,
              name,
              key,
              scopes: selectedScopes,
              created: new Date().toISOString(),
            });
          }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg"
        >
          Generate Key
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
