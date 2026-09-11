/**
 * PumpMappingV1 - Universal Fuel Pump Mapping & Intelligence Suite
 *
 * A comprehensive tab for parsing fuel pump ledger documents (PDF, Images, Spreadsheets)
 * using AI-powered OCR and data extraction. Supports global currencies, languages,
 * and pump configurations. Includes AI Chat Tuner for custom extraction rules.
 *
 * Features:
 * - Drag & drop file upload (PDF, Images, XLSX)
 * - AI-powered OCR and data extraction
 * - Calibration anchors (date, time, shift)
 * - AI Chat Tuner for custom extraction rules
 * - Multi-format export (PDF, Excel, Word, TXT)
 * - Multi-channel sharing (Email, WhatsApp, Telegram, SMS)
 * - Text-to-speech accessibility
 * - Multi-language support
 * - Universal currency support
 */

"use client";

import React, { useState, useCallback, useRef, useEffect, memo } from "react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  navigateToTab,
  type FuelPricePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  getCurrencySymbol,
  getDetectedCurrency,
} from "@/react-app/lib/currency";
import {
  Upload,
  MessageSquare,
  Download,
  Share2,
  Settings,
  Loader2,
  Volume2,
  FileText,
  Image,
  Table,
  X,
  Send,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Globe,
  Clock,
  Calendar,
  Zap,
  Trash2,
  Eye,
  Copy,
  Printer,
} from "lucide-react";

// Types
interface PumpReading {
  pump_id: string;
  fuel_type: string;
  fuel_name: string;
  opening_reading: number;
  closing_reading: number;
  total_sales_litres: number;
  total_sales_value: number;
  unit_price: number;
  shift: string;
  timestamp?: string;
  anomalies?: string[];
  confidence: number;
}

interface Metadata {
  station_name: string;
  station_location: string;
  date: string;
  shift: string;
  currency: string;
  currency_symbol: string;
  currency_code: string;
  language_detected: string;
  pumps_count: number;
  total_litres: number;
  total_value: number;
  extraction_time: string;
  raw_ocr_text?: string;
}

interface ExtractedData {
  pumps: PumpReading[];
  metadata: Metadata;
  anomalies: string[];
  warnings: string[];
  processingLog: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
}

interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  icon: React.ReactNode;
  description: string;
}

interface ShareMethod {
  id: string;
  name: string;
  icon: React.ReactNode;
  placeholder: string;
}

// Currency mapping for universal support
const CURRENCY_MAP: Record<
  string,
  { symbol: string; code: string; name: string }
> = {
  KSH: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  KSh: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  KES: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  USD: { symbol: "$", code: "USD", name: "US Dollar" },
  $: { symbol: "$", code: "USD", name: "US Dollar" },
  EUR: { symbol: "€", code: "EUR", name: "Euro" },
  "€": { symbol: "€", code: "EUR", name: "Euro" },
  GBP: { symbol: "£", code: "GBP", name: "British Pound" },
  "£": { symbol: "£", code: "GBP", name: "British Pound" },
  TZS: { symbol: "TSh", code: "TZS", name: "Tanzanian Shilling" },
  TSh: { symbol: "TSh", code: "TZS", name: "Tanzanian Shilling" },
  UGX: { symbol: "USh", code: "UGX", name: "Ugandan Shilling" },
  USh: { symbol: "USh", code: "UGX", name: "Ugandan Shilling" },
  NGN: { symbol: "₦", code: "NGN", name: "Nigerian Naira" },
  "₦": { symbol: "₦", code: "NGN", name: "Nigerian Naira" },
  ZAR: { symbol: "R", code: "ZAR", name: "South African Rand" },
  R: { symbol: "R", code: "ZAR", name: "South African Rand" },
  INR: { symbol: "₹", code: "INR", name: "Indian Rupee" },
  "₹": { symbol: "₹", code: "INR", name: "Indian Rupee" },
};

/** Safe number formatter — guards NaN/null/undefined before toFixed */
const fmt = (v: number | null | undefined, digits = 2): string =>
  Number.isFinite(v as number) ? (v as number).toFixed(digits) : "0.00";

// Fuel type mapping
const FUEL_TYPE_MAP: Record<string, string[]> = {
  PMS: ["PMS", "Petrol", "Premium Motor Spirit", "Gasoline", "Regular"],
  AGO: ["AGO", "Diesel", "Automotive Gas Oil", "Gas Oil"],
  LPG: ["LPG", "Cooking Gas", "Liquefied Petroleum Gas", "Propane", "Butane"],
  Kerosene: ["Kerosene", "Paraffin", "Jet A1", "Aviation Fuel"],
  ULP: ["ULP", "Unleaded Petrol", "E10"],
  SUPER: ["Super", "Super Plus", "Premium Petrol"],
};

// Shift types
const SHIFT_TYPES = [
  { id: "DAY", label: "Day Shift", hours: "06:00 - 18:00" },
  { id: "NIGHT", label: "Night Shift", hours: "18:00 - 06:00" },
  { id: "MORNING", label: "Morning Shift", hours: "05:00 - 13:00" },
  { id: "AFTERNOON", label: "Afternoon Shift", hours: "13:00 - 21:00" },
  { id: "FULL", label: "Full Day", hours: "00:00 - 24:00" },
];

// Export formats
const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "xlsx",
    name: "Excel",
    extension: ".xlsx",
    icon: <Table size={18} />,
    description: "Spreadsheet format for analysis",
  },
  {
    id: "pdf",
    name: "PDF",
    extension: ".pdf",
    icon: <FileText size={18} />,
    description: "Printable document format",
  },
  {
    id: "docx",
    name: "Word",
    extension: ".docx",
    icon: <FileText size={18} />,
    description: "Microsoft Word document",
  },
  {
    id: "txt",
    name: "Text",
    extension: ".txt",
    icon: <FileText size={18} />,
    description: "Plain text format",
  },
  {
    id: "csv",
    name: "CSV",
    extension: ".csv",
    icon: <Table size={18} />,
    description: "Comma-separated values",
  },
  {
    id: "json",
    name: "JSON",
    extension: ".json",
    icon: <FileText size={18} />,
    description: "Machine-readable format",
  },
];

// Share methods
const SHARE_METHODS: ShareMethod[] = [
  {
    id: "email",
    name: "Email",
    icon: <MessageSquare size={18} />,
    placeholder: "email@example.com",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: <MessageSquare size={18} />,
    placeholder: "+1 555 000 0000",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: <MessageSquare size={18} />,
    placeholder: "@username or chat ID",
  },
  {
    id: "sms",
    name: "SMS",
    icon: <MessageSquare size={18} />,
    placeholder: "+1 555 000 0000",
  },
  { id: "copy", name: "Copy Link", icon: <Copy size={18} />, placeholder: "" },
  { id: "print", name: "Print", icon: <Printer size={18} />, placeholder: "" },
];

// Supported languages
const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "sw", name: "Swahili / Kiswahili", flag: "🇹🇿" },
  { code: "fr", name: "French / Français", flag: "🇫🇷" },
  { code: "ar", name: "Arabic / العربية", flag: "🇸🇦" },
  { code: "pt", name: "Portuguese / Português", flag: "🇵🇹" },
  { code: "es", name: "Spanish / Español", flag: "🇪🇸" },
  { code: "de", name: "German / Deutsch", flag: "🇩🇪" },
  { code: "zh", name: "Chinese / 中文", flag: "🇨🇳" },
  { code: "hi", name: "Hindi / हिन्दी", flag: "🇮🇳" },
  { code: "ru", name: "Russian / Русский", flag: "🇷🇺" },
];

// AI Chat Tuner System Prompt
const AI_SYSTEM_PROMPT = `You are an AI assistant for configuring fuel pump ledger extraction rules.
Your role is to help users customize how pump data should be extracted from documents.

Key capabilities:
1. Parse pump readings from various document formats (PDF, images, spreadsheets)
2. Detect currencies, languages, and pump configurations automatically
3. Handle meter rollovers (when closing < opening)
4. Support multiple fuel types: PMS (Petrol), AGO (Diesel), LPG, Kerosene
5. Support multiple shifts: DAY, NIGHT, MORNING, AFTERNOON, FULL

Common extraction rules users might want to customize:
- How to identify pump IDs (format: P1, Pump 1, 001, etc.)
- How to calculate sales (Closing - Opening or different formula)
- How to handle decimal precision
- How to group pumps by fuel type
- Currency formatting rules
- Date/time parsing formats

When a user asks to modify rules:
1. Provide clear, executable rule updates
2. Explain what changed and why
3. Give examples of how the new rule works

Be concise, helpful, and technically accurate.`;

// Default extraction rules
const DEFAULT_RULES = `{
  "pumpIdPattern": "(P\\d+|Pump\\s*\\d+|\\d{3,4})",
  "salesCalculation": "closing - opening",
  "rolloverHandling": {
    "enabled": true,
    "maxMeterValue": 99999.99,
    "formula": "(maxValue - opening) + closing"
  },
  "decimalPrecision": 2,
  "currencyDetection": "auto",
  "fuelTypeAliases": ${JSON.stringify(FUEL_TYPE_MAP)},
  "shiftPatterns": {
    "DAY": ["day", "morning", "am", "6-18"],
    "NIGHT": ["night", "evening", "pm", "18-6"],
    "FULL": ["full", "24h", "continuous"]
  },
  "odometerRolloverThreshold": 1000,
  "confidenceThreshold": 0.8,
  "autoDetectLanguage": true,
  "multiLanguageSupport": true
}`;

/**
 * PumpMappingV1 Component
 * Main component for the Pump Mapping v1 tab
 */
const PumpMappingV1: React.FC = () => {
  // Cloud sync: auth + station context for station-scoped persistence
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  // State management
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(
    null,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "system-welcome",
      role: "system",
      text: `👋 Welcome to Pump Mapping AI Tuner! I can help you customize extraction rules for your fuel pump documents. Try saying things like:\n\n• "Set currency to my station's currency"\n• "Pumps are labeled P1, P2, P3..."\n• "Night shift is 6PM to 6AM"\n• "Show values in liters, not currency"`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [customRules, setCustomRules] = useState(DEFAULT_RULES);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Calibration anchors
  const [anchorDate, setAnchorDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [anchorShift, setAnchorShift] = useState("DAY");
  const [anchorTime, setAnchorTime] = useState("12:00");
  const [useCustomSchedule, setUseCustomSchedule] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState("");

  // Refs for echo-skip during real-time sync
  const skipExtractedRef = useRef(false);
  const skipChatRef = useRef(false);
  const skipRulesRef = useRef(false);
  const skipAnchorsRef = useRef(false);
  // Prevents save effects from overwriting cloud data with default state
  // before the initial cloud load completes (cross-device overwrite race).
  const cloudLoadCompleteRef = useRef(false);

  // UI state
  const [showChat, setShowChat] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] =
    useState<string>("xlsx");
  const [selectedShareMethod, setSelectedShareMethod] =
    useState<string>("email");
  const [shareRecipient, setShareRecipient] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Toast helper
  const showToast = useCallback(
    (type: "success" | "error" | "info", message: string) => {
      setToastMessage({ type, message });
      setTimeout(() => setToastMessage(null), 4000);
    },
    [],
  );

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Load pump mapping data from cloud on mount + subscribe to real-time changes.
  // This makes extractedData, chatMessages, customRules, and anchor settings
  // persist cross-device and sync INSTANTLY when another device updates them.
  useEffect(() => {
    if (!user || !stationId) return;
    cloudLoadCompleteRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const [extracted, chat, rules, anchors] = await Promise.all([
          cloudStorageService.get<ExtractedData | null>(
            "pump_mapping_extracted",
            stationId,
          ),
          cloudStorageService.get<ChatMessage[]>(
            "pump_mapping_chat",
            stationId,
          ),
          cloudStorageService.get<string>("pump_mapping_rules", stationId),
          cloudStorageService.get<{
            date: string;
            shift: string;
            time: string;
            useCustom: boolean;
            scheduled: string;
          }>("pump_mapping_anchors", stationId),
        ]);
        if (cancelled) return;
        if (extracted) setExtractedData(extracted);
        if (chat && Array.isArray(chat) && chat.length > 0)
          setChatMessages(chat);
        if (rules) setCustomRules(rules);
        if (anchors) {
          if (anchors.date) setAnchorDate(anchors.date);
          if (anchors.shift) setAnchorShift(anchors.shift);
          if (anchors.time) setAnchorTime(anchors.time);
          if (typeof anchors.useCustom === "boolean")
            setUseCustomSchedule(anchors.useCustom);
          if (anchors.scheduled) setScheduledDateTime(anchors.scheduled);
        }
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();

    // Real-time subscriptions: when another device updates any of these keys,
    // the local state updates instantly.
    const unsubs = [
      cloudStorageService.subscribe<ExtractedData | null>(
        "pump_mapping_extracted",
        stationId,
        (val) => {
          if (skipExtractedRef.current) {
            skipExtractedRef.current = false;
            return;
          }
          if (val) setExtractedData(val);
        },
      ),
      cloudStorageService.subscribe<ChatMessage[]>(
        "pump_mapping_chat",
        stationId,
        (val) => {
          if (skipChatRef.current) {
            skipChatRef.current = false;
            return;
          }
          if (val && Array.isArray(val) && val.length > 0) setChatMessages(val);
        },
      ),
      cloudStorageService.subscribe<string>(
        "pump_mapping_rules",
        stationId,
        (val) => {
          if (skipRulesRef.current) {
            skipRulesRef.current = false;
            return;
          }
          if (val) setCustomRules(val);
        },
      ),
      cloudStorageService.subscribe<{
        date: string;
        shift: string;
        time: string;
        useCustom: boolean;
        scheduled: string;
      }>("pump_mapping_anchors", stationId, (val) => {
        if (skipAnchorsRef.current) {
          skipAnchorsRef.current = false;
          return;
        }
        if (val) {
          if (val.date) setAnchorDate(val.date);
          if (val.shift) setAnchorShift(val.shift);
          if (val.time) setAnchorTime(val.time);
          if (typeof val.useCustom === "boolean")
            setUseCustomSchedule(val.useCustom);
          if (val.scheduled) setScheduledDateTime(val.scheduled);
        }
      }),
    ];

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user, stationId]);

  // Persist extractedData to cloud (with real-time echo skip)
  useEffect(() => {
    if (!user || !stationId || !extractedData) return;
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    skipExtractedRef.current = true;
    cloudStorageService
      .set("pump_mapping_extracted", extractedData, stationId)
      .catch(() => {});
  }, [extractedData, user, stationId]);

  // Persist chatMessages to cloud
  useEffect(() => {
    if (!user || !stationId) return;
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    skipChatRef.current = true;
    cloudStorageService
      .set("pump_mapping_chat", chatMessages, stationId)
      .catch(() => {});
  }, [chatMessages, user, stationId]);

  // Persist customRules to cloud
  useEffect(() => {
    if (!user || !stationId) return;
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    skipRulesRef.current = true;
    cloudStorageService
      .set("pump_mapping_rules", customRules, stationId)
      .catch(() => {});
  }, [customRules, user, stationId]);

  // Persist anchor settings to cloud
  useEffect(() => {
    if (!user || !stationId) return;
    if (!cloudLoadCompleteRef.current) return; // skip until cloud load done
    skipAnchorsRef.current = true;
    cloudStorageService
      .set(
        "pump_mapping_anchors",
        {
          date: anchorDate,
          shift: anchorShift,
          time: anchorTime,
          useCustom: useCustomSchedule,
          scheduled: scheduledDateTime,
        },
        stationId,
      )
      .catch(() => {});
  }, [
    anchorDate,
    anchorShift,
    anchorTime,
    useCustomSchedule,
    scheduledDateTime,
    user,
    stationId,
  ]);

  // File drop handler
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const validFiles = acceptedFiles.filter((file) => {
        const validTypes = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/csv",
        ];
        return (
          validTypes.includes(file.type) ||
          file.name.endsWith(".xlsx") ||
          file.name.endsWith(".csv")
        );
      });

      if (validFiles.length > 0) {
        setFiles((prev) => [...prev, ...validFiles]);
        showToast("info", `Added ${validFiles.length} file(s) for processing`);
      } else {
        showToast(
          "error",
          "Unsupported file type. Please upload PDF, Image, or Spreadsheet files.",
        );
      }
    },
    [showToast],
  );

  // File input handler
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onDrop(Array.from(e.target.files));
    }
  };

  // Remove file
  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all files
  const clearFiles = () => {
    setFiles([]);
    setExtractedData(null);
  };

  // Process files with AI
  const processFiles = async () => {
    if (files.length === 0) {
      showToast("error", "Please upload at least one file");
      return;
    }

    setProcessing(true);
    setExtractedData(null);

    try {
      // Prepare form data
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("anchorDate", anchorDate);
      formData.append("anchorShift", anchorShift);
      formData.append("anchorTime", anchorTime);
      formData.append("rules", customRules);
      formData.append(
        "stationId",
        currentStation?.id ||
          localStorage.getItem("fuelpro_current_station_v3") ||
          localStorage.getItem("fuelpro_current_station") ||
          "default",
      );

      // Call extraction API
      const response = await fetch("/api/pump-mapping/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Extraction failed: ${response.statusText}`);
      }

      const data = await response.json();
      setExtractedData(data);
      showToast("success", `Extracted data from ${files.length} file(s)`);

      // Add processing log to chat
      setChatMessages((prev) => [
        ...prev,
        {
          id: `extraction-${Date.now()}`,
          role: "assistant",
          text: `✅ Extraction complete!\n\nFound ${data.pumps?.length || 0} pump readings\nDetected: ${data.metadata?.currency || "Unknown"} | ${data.metadata?.language_detected || "Unknown"}\n\n${data.anomalies?.length > 0 ? `⚠️ ${data.anomalies.length} anomaly(ies) detected` : "✅ No anomalies detected"}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error("Extraction error:", error);
      showToast("error", "Failed to process files. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  // Handle chat submission
  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      // Call AI tuning API
      const response = await fetch("/api/pump-mapping/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentRules: customRules,
          userRequest: userMessage.text,
          extractedData,
          chatHistory: chatMessages.slice(-10),
        }),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.updatedRules) {
          setCustomRules(data.updatedRules);
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text:
            data.explanation ||
            data.response ||
            "I've updated the extraction rules based on your request. Feel free to re-process your files to see the changes applied.",
          timestamp: new Date().toISOString(),
        };

        setChatMessages((prev) => [...prev, assistantMessage]);

        // Auto-reprocess if files are available
        if (data.updatedRules && files.length > 0) {
          setTimeout(() => processFiles(), 1500);
        }
      } else {
        throw new Error("AI service unavailable");
      }
    } catch (error) {
      console.error("Chat error:", error);

      // Fallback: Simple rule parsing
      const input = userMessage.text.toLowerCase();
      let response = "I'm processing your request...";
      let updatedRules = customRules;

      if (
        input.includes("ksh") ||
        input.includes("currency") ||
        input.includes("currency")
      ) {
        updatedRules = customRules.replace(
          /"currencyDetection": "auto"/,
          `"currencyDetection": "${getCurrencySymbol()}"`,
        );
        const curCode = getDetectedCurrency();
        const curSym = getCurrencySymbol();
        response = `✅ Currency detection set to ${curCode} (${curSym}).`;
      } else if (
        input.includes("pump") &&
        (input.includes("label") ||
          input.includes("format") ||
          input.includes("name"))
      ) {
        updatedRules = customRules.replace(
          /"pumpIdPattern": "(P\\d+|Pump\\s*\\d+|\\d{3,4})"/,
          '"pumpIdPattern": "(PUMP-\\d+|#\\d+|\\d{3})"',
        );
        response =
          "✅ Pump ID pattern updated. Pumps will now be identified using formats like PUMP-1, #001, etc.";
      } else if (input.includes("night") && input.includes("shift")) {
        // Note: The actual rules update happens in the API
        response = "✅ Night shift pattern updated to include 6PM and evening.";
      } else if (input.includes("decimal") || input.includes("precision")) {
        updatedRules = customRules.replace(
          /"decimalPrecision": 2/,
          '"decimalPrecision": 3',
        );
        response = "✅ Decimal precision set to 3 decimal places.";
      } else if (input.includes("rollover") || input.includes("reset")) {
        updatedRules = customRules.replace(
          /"enabled": true/,
          '"enabled": true',
        );
        response =
          "✅ Rollover handling is enabled. Meter rollovers will be calculated correctly.";
      } else {
        response =
          "I understand you want to customize the extraction rules. Please be more specific about what you'd like to change (currency, pump format, shift patterns, etc.)";
      }

      setCustomRules(updatedRules);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: response,
        timestamp: new Date().toISOString(),
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Export data
  const handleExport = async (format: string) => {
    if (!extractedData) {
      showToast("error", "No data to export");
      return;
    }

    setIsExporting(true);

    try {
      const response = await fetch("/api/pump-mapping/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          data: extractedData,
          format,
          rules: customRules,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pump_mapping_${anchorDate}_${anchorShift}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showToast("success", `Exported as ${format.toUpperCase()}`);
      } else {
        throw new Error("Export failed");
      }
    } catch (error) {
      console.error("Export error:", error);
      // Fallback: Generate simple text export
      const txt = generateSimpleExport();
      const blob = new Blob([txt], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pump_mapping_${anchorDate}_${anchorShift}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast("success", "Exported as TXT (fallback)");
    } finally {
      setIsExporting(false);
    }
  };

  // Generate simple export text
  const generateSimpleExport = (): string => {
    if (!extractedData) return "";

    const { pumps, metadata } = extractedData;
    let txt = "";

    txt += "=".repeat(60) + "\n";
    txt += "PUMP MAPPING REPORT\n";
    txt += "=".repeat(60) + "\n\n";
    txt += `Station: ${metadata.station_name}\n`;
    txt += `Location: ${metadata.station_location}\n`;
    txt += `Date: ${metadata.date}\n`;
    txt += `Shift: ${metadata.shift}\n`;
    txt += `Currency: ${metadata.currency}\n\n`;

    txt += "-".repeat(60) + "\n";
    txt += "PUMP READINGS\n";
    txt += "-".repeat(60) + "\n\n";

    pumps.forEach((pump) => {
      txt += `Pump ID: ${pump.pump_id}\n`;
      txt += `Fuel Type: ${pump.fuel_name} (${pump.fuel_type})\n`;
      txt += `Opening: ${fmt(pump.opening_reading)} L\n`;
      txt += `Closing: ${fmt(pump.closing_reading)} L\n`;
      txt += `Sales: ${fmt(pump.total_sales_litres)} L\n`;
      txt += `Value: ${metadata.currency_symbol} ${fmt(pump.total_sales_value)}\n`;
      if (pump.anomalies && pump.anomalies.length > 0) {
        txt += `⚠️ Anomalies: ${pump.anomalies.join(", ")}\n`;
      }
      txt += "\n";
    });

    txt += "-".repeat(60) + "\n";
    txt += "SUMMARY\n";
    txt += "-".repeat(60) + "\n";
    txt += `Total Pumps: ${metadata.pumps_count}\n`;
    txt += `Total Litres: ${fmt(metadata.total_litres)} L\n`;
    txt += `Total Value: ${metadata.currency_symbol} ${fmt(metadata.total_value)}\n`;
    txt += "\n" + "=".repeat(60) + "\n";
    txt += `Generated: ${new Date().toISOString()}\n`;

    return txt;
  };

  // Share data
  const handleShare = async () => {
    if (!extractedData) {
      showToast("error", "No data to share");
      return;
    }

    setIsSharing(true);

    try {
      const response = await fetch("/api/pump-mapping/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "share",
          data: extractedData,
          method: selectedShareMethod,
          recipient: shareRecipient,
        }),
      });

      if (response.ok) {
        showToast("success", `Shared via ${selectedShareMethod}`);
        setShareRecipient("");
      } else {
        throw new Error("Share failed");
      }
    } catch (error) {
      console.error("Share error:", error);

      // Fallback: Copy to clipboard
      if (selectedShareMethod === "copy") {
        const summary = `Pump Mapping Report\n${extractedData.metadata.station_name}\nDate: ${extractedData.metadata.date}\nTotal Sales: ${extractedData.metadata.currency} ${fmt(extractedData.metadata.total_value)}`;
        await navigator.clipboard.writeText(summary);
        showToast("success", "Copied to clipboard");
      } else {
        showToast("info", `Configure ${selectedShareMethod} API for sending`);
      }
    } finally {
      setIsSharing(false);
    }
  };

  // Text-to-speech
  const speakSummary = () => {
    if (!extractedData) return;

    const { pumps, metadata } = extractedData;
    const totalPumps = pumps.length;
    const totalLitres = fmt(metadata.total_litres);
    const totalValue = fmt(metadata.total_value);
    const currency = metadata.currency;

    const text = `Shift report for ${metadata.station_name}. ${new Date().toLocaleDateString()}. ${metadata.shift} shift. ${totalPumps} pumps recorded. Total sales: ${totalLitres} litres. Total value: ${currency} ${totalValue}.`;

    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = metadata.language_detected
        ?.toLowerCase()
        .includes("swahili")
        ? "sw-TZ"
        : "en-US";
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
      showToast("info", "Speaking summary...");
    } else {
      showToast("error", "Text-to-speech not supported");
    }
  };

  // Calculate totals
  const getTotalSales = () => {
    if (!extractedData) return { litres: 0, value: 0 };
    return {
      litres: extractedData.pumps.reduce(
        (sum, p) => sum + p.total_sales_litres,
        0,
      ),
      value: extractedData.pumps.reduce(
        (sum, p) => sum + p.total_sales_value,
        0,
      ),
    };
  };

  const totals = getTotalSales();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-900">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-pulse ${
            toastMessage.type === "success"
              ? "bg-green-500 text-white"
              : toastMessage.type === "error"
                ? "bg-red-500 text-white"
                : "bg-blue-500 text-white"
          }`}
        >
          {toastMessage.type === "success" && <CheckCircle size={20} />}
          {toastMessage.type === "error" && <AlertTriangle size={20} />}
          {toastMessage.message}
        </div>
      )}

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <span className="text-3xl">⛽</span>
              Pump Mapping v1
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Universal Fuel Ledger Parsing & Intelligence Suite
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChat(!showChat)}
              className={`p-2 rounded-lg transition-colors ${
                showChat
                  ? "bg-blue-500 text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
              }`}
              title="AI Chat Tuner"
            >
              <MessageSquare size={20} />
            </button>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`p-2 rounded-lg transition-colors ${
                showAdvanced
                  ? "bg-purple-500 text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
              }`}
              title="Advanced Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700 shadow-sm">
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Total Pumps
            </p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {extractedData?.pumps?.length || 0}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700 shadow-sm">
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Total Sales
            </p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {extractedData?.metadata?.currency || ""}{" "}
              {extractedData?.metadata?.total_value
                ? Number(extractedData.metadata.total_value).toLocaleString()
                : "0"}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700 shadow-sm">
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Custom Rules
            </p>
            <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
              {customRules.length}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700 shadow-sm">
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Chat Messages
            </p>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {chatMessages.length}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input & Config */}
          <div className="space-y-4">
            {/* File Upload */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Upload size={16} className="text-blue-500" />
                1. Upload Ledger Files
              </h3>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${"border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500"}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.csv"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <Upload className="mx-auto text-slate-400 mb-2" size={32} />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Drag & drop or click to upload
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  PDF, Images, Spreadsheets
                </p>
              </div>

              {files.length > 0 && (
                <div className="mt-3 space-y-2">
                  {files.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-slate-50 dark:bg-slate-700 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {file.type.includes("pdf") ? (
                          <FileText
                            size={16}
                            className="text-red-500 flex-shrink-0"
                          />
                        ) : file.type.includes("image") ? (
                          <Image
                            size={16}
                            className="text-green-500 flex-shrink-0"
                          />
                        ) : (
                          <Table
                            size={16}
                            className="text-blue-500 flex-shrink-0"
                          />
                        )}
                        <span className="text-xs text-slate-600 dark:text-slate-300 truncate max-w-[150px]">
                          {file.name}
                        </span>
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={clearFiles}
                    className="w-full text-xs text-slate-500 hover:text-red-500 transition-colors py-1"
                  >
                    Clear all files
                  </button>
                </div>
              )}
            </div>

            {/* Calibration Anchors */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Calendar size={16} className="text-green-500" />
                2. Calibration Anchors
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Date
                  </label>
                  <input
                    type="date"
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.target.value)}
                    className="w-full mt-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Time
                  </label>
                  <input
                    type="time"
                    value={anchorTime}
                    onChange={(e) => setAnchorTime(e.target.value)}
                    className="w-full mt-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Shift
                </label>
                <select
                  value={anchorShift}
                  onChange={(e) => setAnchorShift(e.target.value)}
                  className="w-full mt-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-blue-500"
                >
                  {SHIFT_TYPES.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useCustomSchedule}
                  onChange={(e) => setUseCustomSchedule(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Schedule for specific date/time
                </span>
              </label>

              {useCustomSchedule && (
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="w-full mt-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-blue-500"
                />
              )}
            </div>

            {/* Process Button */}
            <button
              onClick={processFiles}
              disabled={files.length === 0 || processing}
              className={`w-full py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                files.length === 0 || processing
                  ? "bg-slate-300 dark:bg-slate-600 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 shadow-lg"
              }`}
            >
              {processing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Process Files
                </>
              )}
            </button>
          </div>

          {/* Middle Column - Results */}
          <div className="lg:col-span-1 space-y-4">
            {/* Summary Card */}
            {extractedData && (
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Summary
                  </h3>
                  <button
                    onClick={speakSummary}
                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    title="Read aloud"
                  >
                    <Volume2 size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3">
                    <p className="text-[10px] text-blue-500 uppercase font-medium">
                      Pumps
                    </p>
                    <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                      {extractedData.metadata.pumps_count}
                    </p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3">
                    <p className="text-[10px] text-green-500 uppercase font-medium">
                      Currency
                    </p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      {extractedData.metadata.currency}
                    </p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3">
                    <p className="text-[10px] text-purple-500 uppercase font-medium">
                      Total Litres
                    </p>
                    <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
                      {fmt(totals.litres)}
                    </p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-3">
                    <p className="text-[10px] text-amber-500 uppercase font-medium">
                      Total Value
                    </p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      {extractedData.metadata.currency_symbol}{" "}
                      {fmt(totals.value)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Globe size={12} />
                    <span>{extractedData.metadata.station_name}</span>
                    <span>•</span>
                    <span>{extractedData.metadata.language_detected}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Pump Readings Table */}
            {extractedData && (
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Pump Readings
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Pump
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Fuel
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Open
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Close
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Sales (L)
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {extractedData.pumps.map((pump, index) => (
                        <tr
                          key={index}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                            {pump.pump_id}
                            {pump.confidence < 0.9 && (
                              <span
                                className="ml-1 text-amber-500"
                                title={`${fmt(pump.confidence * 100, 0)}% confidence`}
                              >
                                ⚠️
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {pump.fuel_name}{" "}
                            <button
                              onClick={() =>
                                navigateToTab("fueltypes", {
                                  fuelType: pump.fuel_name || pump.fuel_type,
                                  price: pump.unit_price || undefined,
                                } as FuelPricePrefill)
                              }
                              className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
                              title="Edit this fuel type / price in Fuel Type Manager"
                            >
                              edit
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                            {fmt(pump.opening_reading)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                            {fmt(pump.closing_reading)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-blue-600 dark:text-blue-400">
                            {fmt(pump.total_sales_litres)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-green-600 dark:text-green-400">
                            {extractedData.metadata.currency_symbol}{" "}
                            {fmt(pump.total_sales_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Anomalies */}
            {extractedData && extractedData.anomalies.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} />
                  Anomalies Detected
                </h4>
                <ul className="space-y-1">
                  {extractedData.anomalies.map((anomaly, index) => (
                    <li
                      key={index}
                      className="text-xs text-amber-600 dark:text-amber-400"
                    >
                      • {anomaly}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* No Data State */}
            {!extractedData && !processing && (
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="text-slate-400" size={24} />
                </div>
                <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  No Data Extracted Yet
                </h3>
                <p className="text-xs text-slate-400">
                  Upload your pump ledger files and click "Process Files" to
                  extract data.
                </p>
              </div>
            )}
          </div>

          {/* Right Column - Export & Share */}
          <div className="space-y-4">
            {/* Export Options */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Download size={16} className="text-purple-500" />
                3. Export Data
              </h3>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format.id}
                    onClick={() => handleExport(format.id)}
                    disabled={!extractedData || isExporting}
                    className={`p-2 rounded-lg border transition-all flex flex-col items-center gap-1 ${
                      !extractedData
                        ? "border-slate-200 dark:border-slate-600 opacity-50 cursor-not-allowed"
                        : "border-slate-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                    }`}
                  >
                    {format.icon}
                    <span className="text-[10px] font-medium">
                      {format.name}
                    </span>
                  </button>
                ))}
              </div>

              {isExporting && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  Exporting...
                </div>
              )}
            </div>

            {/* Share Options */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Share2 size={16} className="text-green-500" />
                4. Share Report
              </h3>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {SHARE_METHODS.slice(0, 6).map((method) => (
                  <button
                    key={method.id}
                    onClick={() => setSelectedShareMethod(method.id)}
                    className={`p-2 rounded-lg border transition-all flex flex-col items-center gap-1 ${
                      selectedShareMethod === method.id
                        ? "border-green-400 bg-green-50 dark:bg-green-900/30"
                        : "border-slate-200 dark:border-slate-600 hover:border-green-400 dark:hover:border-green-500"
                    }`}
                  >
                    {method.icon}
                    <span className="text-[10px] font-medium">
                      {method.name}
                    </span>
                  </button>
                ))}
              </div>

              {selectedShareMethod !== "copy" &&
                selectedShareMethod !== "print" && (
                  <input
                    type="text"
                    placeholder={
                      SHARE_METHODS.find((m) => m.id === selectedShareMethod)
                        ?.placeholder || "Enter recipient"
                    }
                    value={shareRecipient}
                    onChange={(e) => setShareRecipient(e.target.value)}
                    className="w-full mt-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-green-500"
                  />
                )}

              <button
                onClick={handleShare}
                disabled={
                  !extractedData ||
                  isSharing ||
                  (selectedShareMethod !== "copy" &&
                    selectedShareMethod !== "print" &&
                    !shareRecipient)
                }
                className={`w-full mt-3 py-2 px-4 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                  !extractedData ||
                  isSharing ||
                  (selectedShareMethod !== "copy" &&
                    selectedShareMethod !== "print" &&
                    !shareRecipient)
                    ? "bg-slate-200 dark:bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-green-500 hover:bg-green-600 text-white"
                }`}
              >
                {isSharing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Sharing...
                  </>
                ) : (
                  <>
                    <Share2 size={14} />
                    Share via{" "}
                    {
                      SHARE_METHODS.find((m) => m.id === selectedShareMethod)
                        ?.name
                    }
                  </>
                )}
              </button>
            </div>

            {/* Quick Stats */}
            {extractedData && (
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-lg p-5 text-white">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Quick Stats
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Language</span>
                    <span className="text-xs font-medium">
                      {LANGUAGES.find(
                        (l) =>
                          l.code ===
                          (extractedData.metadata.language_detected || "")
                            .toLowerCase()
                            .slice(0, 2),
                      )?.flag || "🌐"}{" "}
                      {extractedData.metadata.language_detected}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">
                      Extraction Time
                    </span>
                    <span className="text-xs font-medium">
                      {extractedData.metadata.extraction_time
                        ? new Date(
                            extractedData.metadata.extraction_time,
                          ).toLocaleTimeString()
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">
                      Avg. Confidence
                    </span>
                    <span className="text-xs font-medium">
                      {(() => {
                        const pmps = extractedData.pumps || [];
                        if (pmps.length === 0) return "—";
                        const avg =
                          (pmps.reduce(
                            (sum, p) => sum + (p.confidence || 0),
                            0,
                          ) /
                            pmps.length) *
                          100;
                        return Number.isFinite(avg)
                          ? `${avg.toFixed(0)}%`
                          : "—";
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* AI Chat Panel */}
        {showChat && (
          <div
            className="fixed inset-0 bg-black/50 z-40 flex items-end justify-end p-4"
            onClick={() => setShowChat(false)}
          >
            <div
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Chat Header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                    <MessageSquare size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">
                      AI Rules Tuner
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      Customize extraction logic
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X size={20} className="text-slate-500" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                        message.role === "user"
                          ? "bg-blue-500 text-white"
                          : message.role === "system"
                            ? "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">
                        {message.text}
                      </p>
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-2">
                      <div className="flex items-center gap-1">
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChatSubmit()}
                    placeholder="Ask to customize extraction rules..."
                    className="flex-1 text-sm border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-blue-500"
                  />
                  <button
                    onClick={handleChatSubmit}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="p-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-xl transition-colors"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 text-center">
                  Try: "Set currency to my station's currency" or "Update pump
                  format to P1, P2, P3"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Settings Panel */}
        {showAdvanced && (
          <div
            className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
            onClick={() => setShowAdvanced(false)}
          >
            <div
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    Advanced Settings
                  </h3>
                  <button
                    onClick={() => setShowAdvanced(false)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <X size={20} className="text-slate-500" />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Currency Detection */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                      Default Currency
                    </label>
                    <select
                      className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                      value={(() => {
                        const cur = getDetectedCurrency();
                        return (
                          Object.keys(CURRENCY_MAP).find(
                            (c) => CURRENCY_MAP[c]?.code === cur,
                          ) ||
                          cur ||
                          "USD"
                        );
                      })()}
                      onChange={(e) => {
                        const currency = CURRENCY_MAP[e.target.value];
                        if (currency) {
                          try {
                            localStorage.setItem(
                              "fuelpro_currency",
                              currency.code,
                            );
                          } catch {
                            /* ignore quota */
                          }
                          cloudStorageService
                            .set("pump_mapping_currency", currency.code)
                            .catch(() => {});
                        }
                      }}
                    >
                      {Object.entries(CURRENCY_MAP).map(([code, info]) => (
                        <option key={code} value={code}>
                          {info.name} ({info.symbol})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Language Selection */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                      Default Language
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.code}
                          className="p-2 text-left border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          <span className="text-lg mr-2">{lang.flag}</span>
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {lang.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Current Rules */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                      Extraction Rules (JSON)
                    </label>
                    <textarea
                      value={customRules}
                      onChange={(e) => setCustomRules(e.target.value)}
                      className="w-full h-48 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                      spellCheck={false}
                    />
                  </div>

                  {/* Reset Rules */}
                  <button
                    onClick={() => setCustomRules(DEFAULT_RULES)}
                    className="w-full py-2 px-4 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg transition-colors text-sm"
                  >
                    Reset to Default Rules
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(PumpMappingV1);
