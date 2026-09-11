import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Search,
  FileText,
  Image,
  FileSpreadsheet,
  File as FileIcon,
  Download,
  Share2,
  Trash2,
  X,
  Loader2,
  FolderOpen,
  Camera,
  ChevronDown,
  Folder,
  Sparkles,
  ArrowLeft,
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useFuel } from "../context/FuelContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { getCurrencySymbol, getLocaleForCountry } from "../lib/currency";
import { getFuelLabel } from "@/react-app/config/pricing";
import { getSupabaseClient } from "@/supabase/client";
import {
  compressBlob,
  compressedFilePath,
  isCompressibleMimeType,
} from "@/react-app/lib/compression";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface DocumentFolder {
  id: number;
  name: string;
  icon: string;
  color: string;
  document_count: number;
  parent_id: number | null;
}

interface Document {
  id: number;
  name: string;
  original_name: string;
  file_type: string;
  file_size: number;
  r2_key: string;
  folder_id: number | null;
  ai_category: string | null;
  ai_description: string | null;
  created_at: string;
  /** Public URL of the file in Supabase Storage (fuelpro-files bucket).
   *  Files are stored as binary objects in Storage — NOT as base64 in the
   *  app_kv JSON blob — so they sync cross-device without bloating localStorage
   *  or hitting JSON size limits. */
  public_url?: string;
  /** Storage path within the fuelpro-files bucket: documents/<uid>/<file>. */
  file_path?: string;
  /** Stored file content as a data URL (base64). LEGACY only — documents
   *  saved before the Storage migration. New uploads use public_url. */
  file_data?: string;
}

// Cloud storage keys (Supabase app_kv). localStorage is used as a read-through
// cache by cloudStorageService, so no manual caching is needed here.
const DOCUMENTS_KEY = "documents_list";
const FOLDERS_KEY = "documents_folders";

// Default smart folders used until the cloud store provides an organizing
// pass. Mirrors the folder shape the backend previously returned.
const DEFAULT_FOLDERS: DocumentFolder[] = [
  {
    id: 1,
    name: "Clients",
    icon: "👥",
    color: "blue",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 2,
    name: "Invoices",
    icon: "🧾",
    color: "amber",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 3,
    name: "Fuel Records",
    icon: "⛽",
    color: "green",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 4,
    name: "Sales",
    icon: "📊",
    color: "purple",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 5,
    name: "M-PESA",
    icon: "📱",
    color: "emerald",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 6,
    name: "Payroll",
    icon: "💼",
    color: "indigo",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 7,
    name: "Reports",
    icon: "📄",
    color: "cyan",
    document_count: 0,
    parent_id: null,
  },
  {
    id: 8,
    name: "Other",
    icon: "📁",
    color: "gray",
    document_count: 0,
    parent_id: null,
  },
];

/** Next unique document id based on the current set. */
const nextDocId = (docs: Document[]): number =>
  docs.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0) + 1;

/** Categorize a file name into one of the default smart folder ids. */
const categorizeByName = (name: string): number => {
  const n = name.toLowerCase();
  if (n.includes("client")) return 1;
  if (n.includes("invoice")) return 2;
  if (n.includes("offload") || n.includes("fuel")) return 3;
  if (n.includes("sale")) return 4;
  if (n.includes("mpesa") || n.includes("m-pesa")) return 5;
  if (n.includes("payroll") || n.includes("employee")) return 6;
  if (n.includes("report")) return 7;
  return 8;
};

/** Persist the documents array to cloud storage (and localStorage cache). */
const persistDocuments = async (docs: Document[]): Promise<void> => {
  try {
    await cloudStorageService.set<Document[]>(DOCUMENTS_KEY, docs);
  } catch (err) {
    console.error("[Documents] failed to persist documents:", err);
    toastError(
      "Failed to save documents to cloud storage. Your changes may not be saved.",
    );
  }
};

/** Upload a file's BINARY content to Supabase Storage (fuelpro-files bucket)
 *  and return its public URL + storage path. Files are stored as binary
 *  objects — NOT base64 in JSON — so they sync cross-device without bloating
 *  the app_kv blob or hitting localStorage/JSON size limits. */
const uploadFileToStorage = async (
  file: File,
): Promise<{ publicUrl: string; filePath: string } | null> => {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const baseFilePath = `documents/${user.id}/${Date.now()}-${safeName}`;

  // Gzip text-based files to save Storage; binary formats stored as-is.
  const shouldCompress = isCompressibleMimeType(file.type || "", file.name);
  let uploadBlob: Blob = file;
  let filePath = baseFilePath;
  let storedContentType = file.type || undefined;
  if (shouldCompress) {
    try {
      uploadBlob = await compressBlob(file);
      filePath = compressedFilePath(baseFilePath);
      storedContentType = "application/gzip";
    } catch {
      uploadBlob = file;
    }
  }

  const { error } = await supabase.storage
    .from("fuelpro-files")
    .upload(filePath, uploadBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: storedContentType,
    });

  if (error) {
    console.error("[Documents] Storage upload error:", error.message);
    return null;
  }

  const { data } = supabase.storage
    .from("fuelpro-files")
    .getPublicUrl(filePath);

  return { publicUrl: data.publicUrl, filePath };
};

/** Build a Document record from a public URL + file metadata. */
const buildDocument = (
  docs: Document[],
  file: { name: string; type: string; size: number },
  publicUrl: string,
  filePath: string,
): Document => {
  const id = nextDocId(docs);
  const folderId = categorizeByName(file.name);
  const folder = DEFAULT_FOLDERS.find((f) => f.id === folderId);
  return {
    id,
    name: file.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
    original_name: file.name,
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
    r2_key: `documents/${id}/${file.name}`,
    folder_id: folderId,
    ai_category: folder?.name || null,
    ai_description: null,
    created_at: new Date().toISOString(),
    public_url: publicUrl,
    file_path: filePath,
  };
};

/**
 * Resolve a document's stored content to an object URL for preview/download.
 * New documents use the Supabase Storage public_url (binary file). Legacy
 * documents (saved before the Storage migration) fall back to inline file_data
 * (base64 data URL).
 */
const docToObjectUrl = async (doc: Document): Promise<string> => {
  if (doc.public_url) {
    // Fetch the binary from Storage and create a revocable object URL so
    // the preview/download flow is consistent with the legacy path.
    const res = await fetch(doc.public_url);
    if (!res.ok) throw new Error(`Failed to fetch file (HTTP ${res.status})`);
    const blob = await res.blob();
    return window.URL.createObjectURL(blob);
  }
  if (doc.file_data) {
    const res = await fetch(doc.file_data);
    const blob = await res.blob();
    return window.URL.createObjectURL(blob);
  }
  // Legacy fallback: no inline data and no Storage URL.
  throw new Error("Document content is unavailable (no stored file data).");
};

const folderColors: Record<string, string> = {
  blue: "from-blue-500 to-blue-600",
  green: "from-green-500 to-green-600",
  purple: "from-purple-500 to-purple-600",
  orange: "from-orange-500 to-orange-600",
  cyan: "from-cyan-500 to-cyan-600",
  amber: "from-amber-500 to-amber-600",
  indigo: "from-indigo-500 to-indigo-600",
  teal: "from-teal-500 to-teal-600",
  red: "from-red-500 to-red-600",
  emerald: "from-emerald-500 to-emerald-600",
  yellow: "from-yellow-500 to-yellow-600",
  gray: "from-gray-500 to-gray-600",
  pink: "from-pink-500 to-pink-600",
  rose: "from-rose-500 to-rose-600",
  lime: "from-lime-500 to-lime-600",
  sky: "from-sky-500 to-sky-600",
};

export default function Documents() {
  const { user } = useAuth();
  const { state } = useFuel();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<DocumentFolder | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [organizingStatus, setOrganizingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(
    new Set(),
  );
  const [quickPreviewDoc, setQuickPreviewDoc] = useState<Document | null>(null);
  const [quickPreviewUrl, setQuickPreviewUrl] = useState<string | null>(null);
  const [quickPreviewLoading, setQuickPreviewLoading] = useState(false);
  const [showAllDocuments, setShowAllDocuments] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    await Promise.all([fetchDocuments(), fetchFolders()]);
    setIsLoading(false);
  };

  const fetchDocuments = async () => {
    try {
      const data = await cloudStorageService.get<Document[]>(DOCUMENTS_KEY);
      setDocuments(data || []);
    } catch (err) {
      console.error("[Documents] failed to load documents:", err);
      setError("Failed to load documents");
    }
  };

  const fetchFolders = async () => {
    try {
      const data = await cloudStorageService.get<DocumentFolder[]>(FOLDERS_KEY);
      // document_count is recomputed live in render via getFolderDocCount,
      // so we only need the folder definitions here.
      setFolders(data && data.length > 0 ? data : DEFAULT_FOLDERS);
    } catch (err) {
      console.error("[Documents] failed to load folders:", err);
      setFolders(DEFAULT_FOLDERS);
    }
  };

  // Organize only NEW unorganized documents (default behavior).
  // With no backend, "organizing" means assigning unfiled documents
  // (folder_id === null) to a smart folder based on their file name.
  const organizeNewDocuments = async () => {
    try {
      const current = await cloudStorageService.get<Document[]>(DOCUMENTS_KEY);
      const docs = current || [];
      let changed = false;
      const organized = docs.map((doc) => {
        if (doc.folder_id == null) {
          changed = true;
          const folderId = categorizeByName(doc.original_name || doc.name);
          const folder = DEFAULT_FOLDERS.find((f) => f.id === folderId);
          return {
            ...doc,
            folder_id: folderId,
            ai_category: doc.ai_category || folder?.name || null,
          };
        }
        return doc;
      });

      if (changed) {
        await persistDocuments(organized);
        setDocuments(organized);
      }

      // Ensure folders exist in cloud storage.
      const storedFolders =
        await cloudStorageService.get<DocumentFolder[]>(FOLDERS_KEY);
      if (!storedFolders || storedFolders.length === 0) {
        await cloudStorageService.set<DocumentFolder[]>(
          FOLDERS_KEY,
          DEFAULT_FOLDERS,
        );
        setFolders(DEFAULT_FOLDERS);
      }
    } catch (err) {
      console.error("[Documents] failed to organize documents:", err);
      toastError("Failed to organize documents. Please try again.");
    }
  };

  // Force reorganize ALL documents (manual action only).
  // Re-derives the folder for every document from its file name.
  const forceReorganizeAll = async () => {
    setOrganizingStatus("Reorganizing all documents...");
    try {
      const current = await cloudStorageService.get<Document[]>(DOCUMENTS_KEY);
      const docs = current || [];
      const organized = docs.map((doc) => {
        const folderId = categorizeByName(doc.original_name || doc.name);
        const folder = DEFAULT_FOLDERS.find((f) => f.id === folderId);
        return {
          ...doc,
          folder_id: folderId,
          ai_category: folder?.name || doc.ai_category || null,
        };
      });

      await persistDocuments(organized);
      await cloudStorageService.set<DocumentFolder[]>(
        FOLDERS_KEY,
        DEFAULT_FOLDERS,
      );
      setDocuments(organized);
      setFolders(DEFAULT_FOLDERS);
    } catch (err) {
      console.error("[Documents] failed to reorganize documents:", err);
      toastError("Failed to reorganize documents. Please try again.");
    } finally {
      setOrganizingStatus(null);
    }
  };

  // Auto-organize ONLY on initial load - organize new/unorganized documents
  useEffect(() => {
    if (documents.length > 0 && !isLoading) {
      organizeNewDocuments();
    }
  }, [isLoading]); // Only run once when loading completes

  // Generate HTML document for business data
  const generateHTMLDocument = (
    title: string,
    data: any,
    type: string,
  ): string => {
    const formatDate = (d: string | Date) =>
      new Date(d).toLocaleDateString(getLocaleForCountry());
    const formatCurrency = (n: number) =>
      `${getCurrencySymbol()} ${(n || 0).toLocaleString()}`;

    let content = "";

    if (type === "clients" && Array.isArray(data)) {
      content = data
        .map(
          (c: any) => `
        <div class="card">
          <h3>${c.name || "Unknown"}</h3>
          <p><strong>Phone:</strong> ${c.phone || "-"}</p>
          <p><strong>Vehicle:</strong> ${c.vehicleRegistration || "-"}</p>
          <p><strong>Balance:</strong> ${formatCurrency(c.balance || 0)}</p>
          ${c.notes ? `<p><strong>Notes:</strong> ${c.notes}</p>` : ""}
        </div>
      `,
        )
        .join("");
    } else if (type === "offloading" && Array.isArray(data)) {
      content = data
        .map(
          (r: any) => `
        <div class="card">
          <h3>${formatDate(r.date)}</h3>
          <p><strong>Driver:</strong> ${r.driverName || "-"}</p>
          <p><strong>Vehicle:</strong> ${r.vehicleReg || "-"}</p>
          <p><strong>Product:</strong> ${r.product || "-"}</p>
          <p><strong>Quantity:</strong> ${r.quantity || 0} L</p>
          <p><strong>Total:</strong> ${formatCurrency(r.totalCost || 0)}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "invoices") {
      const invoices = data.invoices || [];
      content = invoices
        .map(
          (inv: any) => `
        <div class="card">
          <h3>Invoice #${inv.invoiceNumber || "-"}</h3>
          <p><strong>Date:</strong> ${formatDate(inv.date)}</p>
          <p><strong>Client:</strong> ${inv.clientName || "-"}</p>
          <p><strong>Total:</strong> ${formatCurrency(inv.total || 0)}</p>
          <p><strong>Status:</strong> ${inv.status || "Pending"}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "debtHistory" && Array.isArray(data)) {
      content = data
        .map(
          (h: any) => `
        <div class="card">
          <h3>${h.clientName || "Unknown"}</h3>
          <p><strong>Date:</strong> ${formatDate(h.date)}</p>
          <p><strong>Type:</strong> ${h.type || "-"}</p>
          <p><strong>Amount:</strong> ${formatCurrency(h.amount || 0)}</p>
          <p><strong>Balance:</strong> ${formatCurrency(h.balance || 0)}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "sales") {
      const sales = data.salesHistory || [];
      content = sales
        .map((s: any) => {
          // DYNAMIC: render ALL fuel types, not just PMS/AGO. Legacy
          // entries have pmsPumps/agoPumps; newer entries have
          // fuelPumpsByType with any canonical fuel type.
          const fuelLines: string[] = [];
          const addFuelLine = (label: string, revenue: number) => {
            if (revenue > 0)
              fuelLines.push(
                `<p><strong>${label}:</strong> ${formatCurrency(revenue)}</p>`,
              );
          };
          // Legacy PMS/AGO
          const pmsRev = (s.pmsPumps || []).reduce(
            (sum: number, p: any) => sum + (p.salesKsh || 0),
            0,
          );
          const agoRev = (s.agoPumps || []).reduce(
            (sum: number, p: any) => sum + (p.salesKsh || 0),
            0,
          );
          addFuelLine(getFuelLabel("PMS"), pmsRev);
          addFuelLine(getFuelLabel("AGO"), agoRev);
          // Dynamic fuel types
          if (s.fuelPumpsByType && typeof s.fuelPumpsByType === "object") {
            for (const [ft, pumps] of Object.entries(s.fuelPumpsByType)) {
              if (ft === "petrol" || ft === "diesel") continue;
              const rev = (pumps as any[]).reduce(
                (sum: number, p: any) => sum + (p.salesKsh || 0),
                0,
              );
              addFuelLine(
                getFuelLabel(ft) || ft.charAt(0).toUpperCase() + ft.slice(1),
                rev,
              );
            }
          }
          // Fallback: if no per-type lines, show the grand total
          const fuelHtml =
            fuelLines.length > 0
              ? fuelLines.join("")
              : `<p><strong>Total:</strong> ${formatCurrency(s.grandTotalKsh || 0)}</p>`;
          return `
        <div class="card">
          <h3>${formatDate(s.date)} - ${s.shift || "Day"}</h3>
          ${fuelHtml}
          <p><strong>Grand Total:</strong> ${formatCurrency(s.grandTotalKsh || 0)}</p>
          <p><strong>Cash:</strong> ${formatCurrency(s.cashPayments || 0)}</p>
          <p><strong>M-Pesa:</strong> ${formatCurrency(s.mpesaPayments || 0)}</p>
        </div>
      `;
        })
        .join("");
    } else if (type === "mpesa" && Array.isArray(data)) {
      content = data
        .slice(0, 100)
        .map(
          (t: any) => `
        <div class="card">
          <p><strong>Receipt:</strong> ${t.receiptNo || "-"}</p>
          <p><strong>Date:</strong> ${t.date || "-"}</p>
          <p><strong>Details:</strong> ${t.details || "-"}</p>
          <p><strong>Amount:</strong> ${formatCurrency(t.paidIn || t.amount || 0)}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "employees" && Array.isArray(data)) {
      content = data
        .map(
          (e: any) => `
        <div class="card">
          <h3>${e.name || "Unknown"}</h3>
          <p><strong>ID:</strong> ${e.idNumber || "-"}</p>
          <p><strong>Phone:</strong> ${e.phone || "-"}</p>
          <p><strong>Position:</strong> ${e.position || "-"}</p>
          <p><strong>Salary:</strong> ${formatCurrency(e.basicSalary || 0)}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "payroll" && Array.isArray(data)) {
      content = data
        .map(
          (p: any) => `
        <div class="card">
          <h3>${p.month || "Unknown Month"}</h3>
          <p><strong>Employee:</strong> ${p.employeeName || "-"}</p>
          <p><strong>Gross:</strong> ${formatCurrency(p.grossPay || 0)}</p>
          <p><strong>Deductions:</strong> ${formatCurrency(p.totalDeductions || 0)}</p>
          <p><strong>Net:</strong> ${formatCurrency(p.netPay || 0)}</p>
        </div>
      `,
        )
        .join("");
    } else if (type === "messages" && Array.isArray(data)) {
      content = data
        .slice(-50)
        .map(
          (m: any) => `
        <div class="card ${m.role === "user" ? "user" : "assistant"}">
          <p><strong>${m.role === "user" ? "You" : "AI Assistant"}:</strong></p>
          <p>${m.content || "-"}</p>
        </div>
      `,
        )
        .join("");
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f5f5f5; margin: 0; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #22c55e; padding-bottom: 10px; }
    h2 { color: #333; margin-top: 20px; }
    .card { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card h3 { margin: 0 0 10px 0; color: #22c55e; }
    .card p { margin: 5px 0; color: #555; }
    .card.user { border-left: 4px solid #c5a059; }
    .card.assistant { border-left: 4px solid #22c55e; }
    strong { color: #333; }
    .meta { color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">Generated: ${new Date().toLocaleString(getLocaleForCountry())}</p>
  ${content || "<p>No data available</p>"}
</body>
</html>`;
  };

  // Auto-save business data from all tabs as HTML documents
  const autoSaveBusinessData = async () => {
    const dateStr = new Date().toISOString().split("T")[0];

    const documentsToSave = [
      {
        name: `Saved_Clients_${dateStr}.html`,
        title: "Saved Clients",
        data: state.clients,
        type: "clients",
        check: state.clients?.length,
      },
      {
        name: `Offloading_Records_${dateStr}.html`,
        title: "Fuel Offloading Records",
        data: state.offloadingRecords,
        type: "offloading",
        check: state.offloadingRecords?.length,
      },
      {
        name: `Invoices_${dateStr}.html`,
        title: "Invoices",
        data: {
          items: state.invoiceItems,
          settings: state.invoiceSettings,
          invoices: state.invoices,
        },
        type: "invoices",
        check: state.invoices?.length,
      },
      {
        name: `Client_History_${dateStr}.html`,
        title: "Client Debt History",
        data: state.debtHistory,
        type: "debtHistory",
        check: state.debtHistory?.length,
      },
      {
        name: `Sales_Tracking_${dateStr}.html`,
        title: "Sales Tracking",
        data: {
          salesHistory: state.salesHistory,
          pumps: {
            pms: state.pmsPumps,
            ago: state.agoPumps,
            fuelPumpsByType: state.fuelPumpsByType,
          },
          expenses: state.expenses,
        },
        type: "sales",
        check: state.salesHistory?.length,
      },
      {
        name: `Fuel_Sales_Report_${dateStr}.html`,
        title: "Fuel Sales Report",
        data: { salesHistory: state.salesHistory },
        type: "sales",
        check: state.salesHistory?.length,
      },
      {
        name: `MPESA_Inflows_${dateStr}.html`,
        title: "M-PESA Inflows",
        data: state.mpesaTransactions,
        type: "mpesa",
        check: state.mpesaTransactions?.length,
      },
      {
        name: `Payroll_Employees_${dateStr}.html`,
        title: "Payroll - Employees",
        data: state.employees,
        type: "employees",
        check: state.employees?.length,
      },
      {
        name: `Payroll_Records_${dateStr}.html`,
        title: "Payroll Records",
        data: state.payrollRecords,
        type: "payroll",
        check: state.payrollRecords?.length,
      },
      {
        name: `AI_Chat_History_${dateStr}.html`,
        title: "AI Assistant Chat History",
        data: state.chatHistory,
        type: "messages",
        check: state.chatHistory?.length,
      },
    ];

    // Load the latest documents from cloud storage so we don't clobber
    // concurrent writes from other tabs/devices.
    let currentDocs =
      (await cloudStorageService.get<Document[]>(DOCUMENTS_KEY)) || [];
    let modified = false;

    for (const doc of documentsToSave) {
      if (doc.check) {
        // Check if document already exists today
        const existingDoc = currentDocs.find(
          (d) => d.name === doc.name || d.original_name === doc.name,
        );
        if (!existingDoc) {
          const htmlContent = generateHTMLDocument(
            doc.title,
            doc.data,
            doc.type,
          );
          const blob = new Blob([htmlContent], { type: "text/html" });
          const fileObj = new File([blob], doc.name, { type: "text/html" });

          try {
            // Upload the generated HTML to Storage (consistent with manual uploads).
            const uploaded = await uploadFileToStorage(fileObj);
            if (!uploaded) {
              throw new Error("Storage upload failed");
            }
            const newDoc = buildDocument(
              currentDocs,
              { name: doc.name, type: "text/html", size: blob.size },
              uploaded.publicUrl,
              uploaded.filePath,
            );
            currentDocs = [newDoc, ...currentDocs];
            modified = true;
          } catch (err) {
            console.error(`[Documents] failed to save ${doc.name}:`, err);
            toastError(`Failed to save document "${doc.name}".`);
          }
        }
      }
    }

    if (modified) {
      await persistDocuments(currentDocs);
    }

    await fetchData();
  };

  // Auto-save on component mount and when state changes significantly
  useEffect(() => {
    const timeout = setTimeout(() => {
      autoSaveBusinessData();
    }, 5000); // Wait 5 seconds after load
    return () => clearTimeout(timeout);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    // Load the latest documents from cloud storage so new uploads append to
    // the current set rather than overwriting it.
    let currentDocs =
      (await cloudStorageService.get<Document[]>(DOCUMENTS_KEY)) || [];
    const uploadedIds: number[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Upload the file BINARY to Supabase Storage — NOT base64 in JSON.
        const uploaded = await uploadFileToStorage(file);
        if (!uploaded) {
          throw new Error("Storage upload failed");
        }
        const newDoc = buildDocument(
          currentDocs,
          { name: file.name, type: file.type, size: file.size },
          uploaded.publicUrl,
          uploaded.filePath,
        );
        currentDocs = [newDoc, ...currentDocs];
        uploadedIds.push(newDoc.id);

        setUploadProgress(((i + 1) / files.length) * 100);
      } catch (err) {
        console.error(`[Documents] failed to upload ${file.name}:`, err);
        setError(`Error uploading ${file.name}`);
        toastError(
          `Failed to upload "${file.name}": ${err instanceof Error ? err.message : "unknown error"}.`,
        );
      }
    }

    if (uploadedIds.length > 0) {
      try {
        await cloudStorageService.set<Document[]>(DOCUMENTS_KEY, currentDocs);
      } catch (err) {
        console.error("[Documents] failed to persist uploaded documents:", err);
        toastError("Failed to save uploaded documents to cloud storage.");
      }
    }

    setIsUploading(false);
    setUploadProgress(0);

    // Trigger smart organization for new documents only
    if (uploadedIds.length > 0) {
      await organizeNewDocuments();
    }

    await fetchData();

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const handlePreview = async (doc: Document) => {
    setSelectedDoc(doc);
    setPreviewMode(true);
    setPreviewLoading(true);
    setImageZoom(1);
    setImageRotation(0);

    try {
      const url = await docToObjectUrl(doc);
      setPreviewUrl(url);
    } catch (err) {
      console.error("[Documents] preview failed:", err);
      setError("Failed to load preview");
      setPreviewMode(false);
      toastError(
        "Failed to load preview. The document content may be missing.",
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewMode(false);
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setImageZoom(1);
    setImageRotation(0);
  };

  const handleQuickPreview = async (doc: Document) => {
    // If same doc, close it
    if (quickPreviewDoc?.id === doc.id) {
      closeQuickPreview();
      return;
    }

    // Close existing preview URL
    if (quickPreviewUrl) {
      window.URL.revokeObjectURL(quickPreviewUrl);
    }

    setQuickPreviewDoc(doc);
    setQuickPreviewLoading(true);
    setQuickPreviewUrl(null);

    try {
      const url = await docToObjectUrl(doc);
      setQuickPreviewUrl(url);
    } catch (err) {
      console.error("[Documents] quick preview failed:", err);
      setError("Failed to load preview");
      setQuickPreviewDoc(null);
      toastError(
        "Failed to load preview. The document content may be missing.",
      );
    } finally {
      setQuickPreviewLoading(false);
    }
  };

  const closeQuickPreview = () => {
    if (quickPreviewUrl) {
      window.URL.revokeObjectURL(quickPreviewUrl);
    }
    setQuickPreviewDoc(null);
    setQuickPreviewUrl(null);
  };

  const handleDownload = async (doc: Document) => {
    try {
      const url = await docToObjectUrl(doc);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("[Documents] download failed:", err);
      setError("Failed to download document");
      toastError(
        "Failed to download document. The file content may be missing.",
      );
    }
  };

  const handleShare = async (doc: Document) => {
    try {
      // Prefer the Storage public URL for sharing (works cross-device).
      const shareUrl = doc.public_url || doc.file_data;
      if (shareUrl && navigator.share) {
        // For image/file types, try sharing as a File object when supported.
        const canShareFiles =
          navigator.canShare && typeof navigator.canShare === "function";
        if (canShareFiles && doc.public_url) {
          const res = await fetch(doc.public_url);
          const blob = await res.blob();
          const file = new File([blob], doc.original_name, { type: blob.type });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: doc.original_name,
              text: `Check out this document: ${doc.original_name}`,
              files: [file],
            });
            return;
          }
        }
        await navigator.share({
          title: doc.original_name,
          text: `Check out this document: ${doc.original_name}`,
          url: shareUrl,
        });
      } else if (shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
        import("@/react-app/lib/toast").then(({ toastSuccess }) =>
          toastSuccess("Document link copied to clipboard!"),
        );
      } else {
        const message = `Document: ${doc.original_name}`;
        await navigator.clipboard.writeText(message);
        import("@/react-app/lib/toast").then(({ toastSuccess }) =>
          toastSuccess("Document name copied to clipboard!"),
        );
      }
    } catch {
      // User cancelled or share failed
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.original_name}"?`)) return;

    try {
      // Delete the binary from Supabase Storage (if it exists there).
      if (doc.file_path) {
        try {
          const supabase = getSupabaseClient();
          await supabase.storage.from("fuelpro-files").remove([doc.file_path]);
        } catch (storageErr) {
          console.warn(
            "[Documents] storage delete failed (non-fatal):",
            storageErr,
          );
        }
      }
      const current =
        (await cloudStorageService.get<Document[]>(DOCUMENTS_KEY)) || [];
      const updated = current.filter((d) => d.id !== doc.id);
      await persistDocuments(updated);
      setDocuments(updated);
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(null);
        closePreview();
      }
    } catch (err) {
      console.error("[Documents] delete failed:", err);
      setError("Failed to delete document");
      toastError("Failed to delete document. Please try again.");
    }
  };

  const getFileIcon = (fileType: string, size: "sm" | "lg" = "lg") => {
    const sizeClass = size === "sm" ? "w-5 h-5" : "w-8 h-8";
    if (fileType.includes("image"))
      return <Image className={`${sizeClass} text-green-500`} />;
    if (fileType.includes("pdf"))
      return <FileText className={`${sizeClass} text-red-500`} />;
    if (
      fileType.includes("sheet") ||
      fileType.includes("excel") ||
      fileType.includes("csv")
    )
      return <FileSpreadsheet className={`${sizeClass} text-emerald-500`} />;
    if (fileType.includes("word") || fileType.includes("document"))
      return <FileText className={`${sizeClass} text-blue-500`} />;
    return <FileIcon className={`${sizeClass} text-gray-500`} />;
  };

  const canPreview = (fileType: string) => {
    return (
      fileType.includes("image") ||
      fileType.includes("pdf") ||
      fileType.includes("html")
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(getLocaleForCountry(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.original_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.ai_description || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

    if (selectedFolder) {
      // Use Number() conversion to ensure type-safe comparison (SQLite may return integers as strings)
      return (
        Number(doc.folder_id) === Number(selectedFolder.id) && matchesSearch
      );
    }
    return matchesSearch;
  });

  // Calculate actual document counts per folder from loaded documents
  const getFolderDocCount = (folderId: number): number => {
    return documents.filter((doc) => Number(doc.folder_id) === Number(folderId))
      .length;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Quick Preview Panel - Floating Side Panel */}
      {quickPreviewDoc && (
        <div className="fixed right-0 top-0 h-full w-full md:w-[450px] lg:w-[550px] bg-white dark:bg-gray-800 shadow-2xl z-40 flex flex-col border-l border-gray-200 dark:border-gray-700 animate-in slide-in-from-right duration-300">
          {/* Quick Preview Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-gray-800 dark:to-gray-750">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {getFileIcon(quickPreviewDoc.file_type, "sm")}
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                  {quickPreviewDoc.original_name}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatFileSize(quickPreviewDoc.file_size)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => handlePreview(quickPreviewDoc)}
                className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                title="Full screen"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDownload(quickPreviewDoc)}
                className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={closeQuickPreview}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Preview Content */}
          <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900">
            {quickPreviewLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
              </div>
            ) : quickPreviewUrl ? (
              quickPreviewDoc.file_type.includes("image") ? (
                <div className="flex items-center justify-center h-full p-4">
                  <img
                    src={quickPreviewUrl}
                    alt={quickPreviewDoc.original_name}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                    draggable={false}
                  />
                </div>
              ) : quickPreviewDoc.file_type.includes("pdf") ||
                quickPreviewDoc.file_type.includes("html") ? (
                <iframe
                  src={quickPreviewUrl}
                  className="w-full h-full bg-white"
                  title={quickPreviewDoc.original_name}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
                  <FileIcon className="w-16 h-16 mb-4 opacity-50" />
                  <p className="font-medium">Preview not available</p>
                  <button
                    onClick={() => handleDownload(quickPreviewDoc)}
                    className="mt-4 px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors"
                  >
                    Download to view
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Failed to load preview</p>
              </div>
            )}
          </div>

          {/* Quick Preview Footer Actions */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex gap-2">
            <button
              onClick={() => handlePreview(quickPreviewDoc)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
              Full Screen
            </button>
            <button
              onClick={() => handleDownload(quickPreviewDoc)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-medium hover:from-amber-600 hover:to-orange-600 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
        </div>
      )}

      {/* Backdrop for mobile when quick preview is open */}
      {quickPreviewDoc && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={closeQuickPreview}
        />
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {selectedFolder ? (
            <button
              onClick={() => setSelectedFolder(null)}
              className="flex items-center gap-2 text-amber-600 dark:text-amber-400 hover:underline mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to all folders
            </button>
          ) : null}
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {selectedFolder ? (
              <>
                <span className="text-2xl">{selectedFolder.icon}</span>
                {selectedFolder.name}
              </>
            ) : (
              <>
                <FolderOpen className="w-7 h-7 text-amber-500" />
                Documents
              </>
            )}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {organizingStatus ||
              (selectedFolder
                ? `${filteredDocuments.length} document${filteredDocuments.length !== 1 ? "s" : ""} in this folder`
                : "Auto-organized by AI into smart folders")}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {/* Reorganize All Button - manual action to force reorganize everything */}
          <button
            onClick={() => forceReorganizeAll()}
            disabled={!!organizingStatus || documents.length === 0}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all ${
              organizingStatus
                ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                : "bg-purple-500 hover:bg-purple-600 text-white shadow-lg"
            }`}
            title="Reorganize all documents into smart folders"
          >
            <Sparkles
              className={`w-5 h-5 ${organizingStatus ? "animate-pulse" : ""}`}
            />
            {organizingStatus ? "Organizing..." : "Reorganize All"}
          </button>

          {/* Upload Button */}
          <div className="relative inline-block">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept="*/*"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />

            {isUploading ? (
              <button
                disabled
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold shadow-lg opacity-50"
              >
                <Loader2 className="w-5 h-5 animate-spin" />
                Uploading... {Math.round(uploadProgress)}%
              </button>
            ) : (
              <>
                <button
                  onClick={() => setShowUploadMenu(!showUploadMenu)}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl font-semibold shadow-lg transition-all"
                >
                  <Upload className="w-5 h-5" />
                  Add Document
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showUploadMenu ? "rotate-180" : ""}`}
                  />
                </button>

                {showUploadMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUploadMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 min-w-[200px]">
                      <button
                        onClick={() => {
                          cameraInputRef.current?.click();
                          setShowUploadMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left"
                      >
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                          <Camera className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            Capture Document
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Use device camera to capture
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          fileInputRef.current?.click();
                          setShowUploadMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                      >
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                          <Upload className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            Upload File
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            PDF, Word, Excel, images...
                          </p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Folders Grid */}
      {!selectedFolder && folders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Smart Folders
          </h3>
          <div className="space-y-2">
            {folders
              .filter((f) => f.parent_id === null)
              .map((mainFolder) => {
                const subFolders = folders.filter(
                  (f) => f.parent_id === mainFolder.id,
                );
                const isExpanded = expandedFolders.has(mainFolder.id);
                // Calculate actual document counts from loaded documents
                const mainFolderDocs = getFolderDocCount(mainFolder.id);
                const subFolderDocs = subFolders.reduce(
                  (sum, sf) => sum + getFolderDocCount(sf.id),
                  0,
                );
                const totalDocs = mainFolderDocs + subFolderDocs;

                return (
                  <div
                    key={mainFolder.id}
                    className="bg-white dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden"
                  >
                    {/* Main Folder Header */}
                    <button
                      onClick={() => {
                        if (subFolders.length > 0) {
                          setExpandedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(mainFolder.id))
                              next.delete(mainFolder.id);
                            else next.add(mainFolder.id);
                            return next;
                          });
                        } else {
                          setSelectedFolder(mainFolder);
                        }
                      }}
                      className="w-full p-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div
                        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${folderColors[mainFolder.color] || folderColors.gray} flex items-center justify-center text-2xl shadow-lg`}
                      >
                        {mainFolder.icon}
                      </div>
                      <div className="flex-1 text-left">
                        <h4 className="font-semibold text-gray-900 dark:text-white">
                          {mainFolder.name}
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {subFolders.length > 0
                            ? `${subFolders.length} sub-folders • `
                            : ""}
                          {totalDocs} file{totalDocs !== 1 ? "s" : ""}
                        </p>
                      </div>
                      {subFolders.length > 0 && (
                        <ChevronDown
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      )}
                    </button>

                    {/* Sub-Folders */}
                    {isExpanded && subFolders.length > 0 && (
                      <div className="border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 p-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {subFolders.map((subFolder) => {
                            const subFolderDocCount = getFolderDocCount(
                              subFolder.id,
                            );
                            return (
                              <button
                                key={subFolder.id}
                                onClick={() => setSelectedFolder(subFolder)}
                                className="group p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 hover:shadow-md hover:border-amber-300 dark:hover:border-amber-500 transition-all text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">
                                    {subFolder.icon}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <h5 className="font-medium text-gray-800 dark:text-gray-200 truncate text-sm">
                                      {subFolder.name}
                                    </h5>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {subFolderDocCount} file
                                      {subFolderDocCount !== 1 ? "s" : ""}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search documents by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all text-gray-900 dark:text-white"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Documents Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
          <Folder className="w-16 h-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">
            {searchQuery
              ? "No documents match your search"
              : selectedFolder
                ? "No documents in this folder"
                : "No documents uploaded yet"}
          </p>
          <p className="text-sm mt-1">
            {searchQuery
              ? "Try a different search term"
              : "Upload documents and they'll be auto-organized"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {!selectedFolder && (
            <button
              onClick={() => setShowAllDocuments(!showAllDocuments)}
              className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-300 transition-colors py-2 px-1"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                {searchQuery
                  ? "Search Results"
                  : `All Documents (${documents.length})`}
              </span>
              <ChevronDown
                className={`w-5 h-5 transition-transform duration-200 ${showAllDocuments ? "rotate-180" : ""}`}
              />
            </button>
          )}
          {(showAllDocuments || selectedFolder) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="group bg-white dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 p-4 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500 transition-all cursor-pointer relative"
                  onClick={() =>
                    canPreview(doc.file_type)
                      ? handlePreview(doc)
                      : setSelectedDoc(doc)
                  }
                >
                  <div className="flex items-start gap-3">
                    {getFileIcon(doc.file_type)}
                    <div className="flex-1 min-w-0">
                      <h3
                        className="font-medium text-gray-900 dark:text-white truncate"
                        title={doc.original_name}
                      >
                        {doc.original_name}
                      </h3>
                      {doc.ai_description && (
                        <p
                          className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 truncate"
                          title={doc.ai_description}
                        >
                          {doc.ai_description}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatFileSize(doc.file_size)}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {formatDate(doc.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Category badge */}
                  {doc.ai_category && !selectedFolder && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-600">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300">
                        <Folder className="w-3 h-3" />
                        {doc.ai_category}
                      </span>
                    </div>
                  )}

                  {/* Quick Actions - Always visible */}
                  <div className="flex items-center gap-2 mt-3">
                    {canPreview(doc.file_type) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickPreview(doc);
                        }}
                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          quickPreviewDoc?.id === doc.id
                            ? "bg-amber-500 text-white"
                            : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                        {quickPreviewDoc?.id === doc.id ? "Viewing" : "Preview"}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(doc);
                      }}
                      className={`${canPreview(doc.file_type) ? "" : "flex-1"} flex items-center justify-center gap-1 px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors`}
                    >
                      <Download className="w-4 h-4" />
                      {!canPreview(doc.file_type) && "Download"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShare(doc);
                      }}
                      className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                      className="p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {previewMode && selectedDoc && (
        <div
          className="fixed inset-0 bg-black/90 flex flex-col z-50"
          onClick={closePreview}
        >
          {/* Preview Header */}
          <div
            className="flex items-center justify-between p-4 bg-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-white">
              {getFileIcon(selectedDoc.file_type, "sm")}
              <div>
                <h3 className="font-semibold">{selectedDoc.original_name}</h3>
                <p className="text-xs text-gray-400">
                  {formatFileSize(selectedDoc.file_size)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedDoc.file_type.includes("image") && (
                <>
                  <button
                    onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <span className="text-white/60 text-sm min-w-[3rem] text-center">
                    {Math.round(imageZoom * 100)}%
                  </span>
                  <button
                    onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setImageRotation((r) => r + 90)}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Rotate"
                  >
                    <RotateCw className="w-5 h-5" />
                  </button>
                  <div className="w-px h-6 bg-white/20 mx-2" />
                </>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(selectedDoc);
                }}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleShare(selectedDoc);
                }}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Share"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <button
                onClick={closePreview}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-2"
                title="Close"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Preview Content */}
          <div
            className="flex-1 flex items-center justify-center overflow-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {previewLoading ? (
              <Loader2 className="w-12 h-12 animate-spin text-white" />
            ) : previewUrl ? (
              selectedDoc.file_type.includes("image") ? (
                <img
                  src={previewUrl}
                  alt={selectedDoc.original_name}
                  className="max-w-full max-h-full object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                  }}
                  draggable={false}
                />
              ) : selectedDoc.file_type.includes("pdf") ||
                selectedDoc.file_type.includes("html") ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-full bg-white rounded-lg"
                  title={selectedDoc.original_name}
                />
              ) : (
                <div className="text-white text-center">
                  <FileIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Preview not available for this file type</p>
                  <button
                    onClick={() => handleDownload(selectedDoc)}
                    className="mt-4 px-6 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg font-medium transition-colors"
                  >
                    Download to view
                  </button>
                </div>
              )
            ) : (
              <div className="text-white text-center">
                <p>Failed to load preview</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Document Info Modal (for non-previewable files) */}
      {selectedDoc && !previewMode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedDoc(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {getFileIcon(selectedDoc.file_type)}
                <div>
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                    {selectedDoc.original_name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatFileSize(selectedDoc.file_size)} •{" "}
                    {selectedDoc.file_type}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDoc(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
              <p>
                <strong>Uploaded:</strong> {formatDate(selectedDoc.created_at)}
              </p>
              <p>
                <strong>Type:</strong> {selectedDoc.file_type}
              </p>
              {selectedDoc.ai_category && (
                <p className="flex items-center gap-2">
                  <strong>Folder:</strong>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 rounded-full text-amber-700 dark:text-amber-400">
                    <Sparkles className="w-3 h-3" />
                    {selectedDoc.ai_category}
                  </span>
                </p>
              )}
              {selectedDoc.ai_description && (
                <p>
                  <strong>Description:</strong> {selectedDoc.ai_description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              {canPreview(selectedDoc.file_type) && (
                <button
                  onClick={() => handlePreview(selectedDoc)}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-all"
                >
                  <Eye className="w-5 h-5" />
                  Preview
                </button>
              )}
              <button
                onClick={() => handleDownload(selectedDoc)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all"
              >
                <Download className="w-5 h-5" />
                Download
              </button>
              <button
                onClick={() => handleShare(selectedDoc)}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-all"
              >
                <Share2 className="w-5 h-5" />
                Share
              </button>
              <button
                onClick={() => {
                  handleDelete(selectedDoc);
                  setSelectedDoc(null);
                }}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition-all"
              >
                <Trash2 className="w-5 h-5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
