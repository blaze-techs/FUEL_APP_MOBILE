import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Upload,
  FolderUp,
  FileText,
  Image,
  FileSpreadsheet,
  Trash2,
  Download,
  Search,
  X,
  File,
  Archive,
  Music,
  Video,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  Edit2,
  Grid,
  List,
  Filter,
  SortAsc,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Layers,
  HardDrive,
  FileUp,
  Zap,
} from "lucide-react";
import {
  saveDocument,
  listDocuments,
  listFolders,
  deleteDocument,
  getDocument,
  countDocuments,
  getTotalStorageUsed,
  updateDocumentFolder,
  renameFolder,
  deleteFolder,
  CATEGORIES,
  type DocMetadata,
} from "@/react-app/lib/documentStore";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import SubTabBar from "@/react-app/components/SubTabBar";
import DocumentConverter from "@/react-app/components/DocumentConverter";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const CATEGORY_COLORS: Record<string, string> = {
  "M-PESA Receipt": "var(--blend-green)",
  Invoice: "var(--blend-blue)",
  "Delivery Note": "var(--blend-amber)",
  Payroll: "var(--blend-blue)",
  "Sales Report": "var(--blend-blue)",
  "Expense Claim": "var(--blend-red)",
  Compliance: "var(--blend-red)",
  Inventory: "var(--blend-green)",
  "Fuel Document": "var(--blend-amber)",
  Legal: "var(--blend-blue)",
  Report: "var(--blend-blue)",
  General: "var(--blend-text-secondary)",
};

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  "M-PESA Receipt": Zap,
  Invoice: FileText,
  "Delivery Note": FileText,
  Payroll: FileSpreadsheet,
  "Sales Report": FileSpreadsheet,
  "Expense Claim": FileText,
  Compliance: FileText,
  Inventory: FileSpreadsheet,
  "Fuel Document": File,
  Legal: FileText,
  Report: FileText,
  General: File,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
}

function getFileIcon(type: string, name: string) {
  if (type.startsWith("image/")) return Image;
  if (type.includes("pdf")) return FileText;
  if (
    type.includes("sheet") ||
    type.includes("excel") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv")
  )
    return FileSpreadsheet;
  if (
    type.includes("zip") ||
    type.includes("archive") ||
    name.endsWith(".zip") ||
    name.endsWith(".rar")
  )
    return Archive;
  if (type.startsWith("audio/")) return Music;
  if (type.startsWith("video/")) return Video;
  return File;
}

interface UploadItem {
  file: File;
  id: string;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  folderPath?: string;
}

type ViewMode = "grid" | "list";
type SortField = "date" | "name" | "size" | "category";
type SortDir = "asc" | "desc";

const UNFILED = "Unfiled";
const FILES_PER_PAGE = 10;

export default function DocumentCenter() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id ?? null;

  const [documents, setDocuments] = useState<DocMetadata[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocMetadata | null>(null);
  const [stats, setStats] = useState({ count: 0, storage: 0 });
  const [showFilters, setShowFilters] = useState(false);

  // Folder UI state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [folderPages, setFolderPages] = useState<Record<string, number>>({});
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [folderActionMsg, setFolderActionMsg] = useState<string | null>(null);
  // Upload target folder (optional; empty = auto-sort)
  const [uploadTargetFolder, setUploadTargetFolder] = useState("");
  // Inner sub-tab: "Documents" (this manager) vs "Converter" (the formerly-
  // standalone DocumentConverter, now hosted here).
  const [activeView, setActiveView] = useState<"documents" | "converter">(
    "documents",
  );
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("documents", setActiveView);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueRef = useRef<UploadItem[]>([]);
  const processingRef = useRef(false);

  // Load documents + folders (station-scoped). Reload when user/station/filters change.
  const loadDocs = useCallback(async () => {
    const opts: {
      category?: string;
      search?: string;
      stationId?: string | null;
    } = {
      stationId,
    };
    if (activeCategory !== "All") opts.category = activeCategory;
    if (searchQuery.trim()) opts.search = searchQuery.trim();
    const [docs, flds, cnt, storage] = await Promise.all([
      listDocuments(opts),
      listFolders({ stationId }),
      countDocuments({ stationId }),
      getTotalStorageUsed({ stationId }),
    ]);
    setDocuments(docs);
    setFolders(flds);
    setStats({ count: cnt, storage });
  }, [activeCategory, searchQuery, stationId]);

  useEffect(() => {
    if (user) loadDocs();
  }, [loadDocs, user]);

  // Process upload queue
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (uploadQueueRef.current.length > 0) {
      const item = uploadQueueRef.current[0];
      if (!item || item.status !== "queued") {
        uploadQueueRef.current.shift();
        continue;
      }

      // Mark as uploading
      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "uploading" } : u)),
      );
      uploadQueueRef.current[0] = { ...item, status: "uploading" };

      try {
        await saveDocument(item.file, {
          folderPath: item.folderPath || uploadTargetFolder || "",
          stationId,
          autoSort: !item.folderPath && !uploadTargetFolder,
        });
        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: "done", progress: 100 } : u,
          ),
        );
        uploadQueueRef.current[0] = {
          ...uploadQueueRef.current[0],
          status: "done",
          progress: 100,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: "error", error: msg } : u,
          ),
        );
        uploadQueueRef.current[0] = {
          ...uploadQueueRef.current[0],
          status: "error",
          error: msg,
        };
      }

      uploadQueueRef.current.shift();
      await loadDocs();
    }

    processingRef.current = false;
  }, [loadDocs, stationId, uploadTargetFolder]);

  // Add files to queue
  const addFilesToQueue = useCallback(
    (files: FileList | null, folderPath?: string) => {
      if (!files || files.length === 0) return;
      const newItems: UploadItem[] = Array.from(files).map((file) => ({
        file,
        id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: "queued" as const,
        progress: 0,
        folderPath,
      }));
      uploadQueueRef.current = [...uploadQueueRef.current, ...newItems];
      setUploads((prev) => [...prev, ...newItems]);
      processQueue();
    },
    [processQueue],
  );

  // Handlers
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFilesToQueue(e.target.files);
      e.target.value = "";
    },
    [addFilesToQueue],
  );

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      // Extract folder path from webkitRelativePath
      const fileList = Array.from(files);
      if (fileList.length > 0) {
        const folderName =
          fileList[0].webkitRelativePath.split("/")[0] || "Folder";
        addFilesToQueue(files, folderName);
      }
      e.target.value = "";
    },
    [addFilesToQueue],
  );

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const items = e.dataTransfer.items;
      if (!items) {
        addFilesToQueue(e.dataTransfer.files);
        return;
      }
      const allFiles: File[] = [];
      const traverseEntry = (entry: FileSystemEntry, path: string = "") => {
        if (entry.isFile) {
          (entry as FileSystemFileEntry).file((file) => {
            allFiles.push(file);
            if (allFiles.length >= 1000) return; // safety limit
          });
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          dirReader.readEntries((entries) => {
            entries.forEach((e) => traverseEntry(e, path + entry.name + "/"));
          });
        }
      };

      for (let i = 0; i < Math.min(items.length, 50); i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) traverseEntry(entry);
      }

      // Fallback: use dataTransfer.files if webkitGetAsEntry not available
      if (allFiles.length === 0 && e.dataTransfer.files.length > 0) {
        addFilesToQueue(e.dataTransfer.files);
      } else if (allFiles.length > 0) {
        const dt = new DataTransfer();
        allFiles.forEach((f) => dt.items.add(f));
        addFilesToQueue(dt.files);
      }
    },
    [addFilesToQueue],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      setSelectedDoc(null);
      await loadDocs();
    },
    [loadDocs],
  );

  const handleDownload = useCallback(async (doc: DocMetadata) => {
    const result = await getDocument(doc.id);
    if (!result) return;
    const blob = new Blob([result.data], {
      type: doc.type || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads((prev) =>
      prev.filter((u) => u.status === "queued" || u.status === "uploading"),
    );
  }, []);

  // ---- Folder management ----
  const flash = useCallback((msg: string) => {
    setFolderActionMsg(msg);
    window.setTimeout(() => setFolderActionMsg(null), 3000);
  }, []);

  // Create a new (empty) folder. It materializes as soon as a file is moved
  // into it, but we track it client-side immediately for UX.
  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      flash("Enter a folder name");
      return;
    }
    if (folders.includes(name) || name === UNFILED) {
      flash("A folder with that name already exists");
      return;
    }
    setFolders((prev) => [...prev, name].sort((a, b) => a.localeCompare(b)));
    setExpandedFolders((prev) => new Set(prev).add(name));
    setNewFolderName("");
    setShowNewFolder(false);
    flash(`Folder "${name}" created — upload or move files into it.`);
  }, [flash, folders, newFolderName]);

  const handleRenameFolder = useCallback(
    async (oldName: string) => {
      const name = renameValue.trim();
      if (!name || name === oldName) {
        setRenamingFolder(null);
        return;
      }
      if (folders.includes(name) || name === UNFILED) {
        flash("A folder with that name already exists");
        return;
      }
      try {
        const moved = await renameFolder(oldName, name, { stationId });
        flash(`Renamed "${oldName}" → "${name}" (${moved} files moved).`);
        setRenamingFolder(null);
        setRenameValue("");
        await loadDocs();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [flash, folders, loadDocs, renameValue, stationId],
  );

  const handleDeleteFolder = useCallback(
    async (folderName: string) => {
      try {
        const moved = await deleteFolder(folderName, { stationId });
        flash(
          `Deleted folder "${folderName}" — ${moved} files moved to Unfiled.`,
        );
        setDeletingFolder(null);
        // Drop expanded/page state for the removed folder.
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderName);
          return next;
        });
        setFolderPages((prev) => {
          const { [folderName]: _omit, ...rest } = prev;
          return rest;
        });
        await loadDocs();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Delete folder failed");
      }
    },
    [flash, loadDocs, stationId],
  );

  const handleMoveDoc = useCallback(
    async (doc: DocMetadata, targetFolder: string) => {
      try {
        await updateDocumentFolder(doc.id, targetFolder || "");
        await loadDocs();
        flash(
          targetFolder
            ? `Moved "${doc.name}" to "${targetFolder}".`
            : `Moved "${doc.name}" to Unfiled.`,
        );
      } catch (err) {
        flash(err instanceof Error ? err.message : "Move failed");
      }
    },
    [flash, loadDocs],
  );

  const toggleFolder = useCallback((folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
    setFolderPages((prev) =>
      prev[folder] === undefined ? { ...prev, [folder]: 0 } : prev,
    );
  }, []);

  const setFolderPage = useCallback((folder: string, page: number) => {
    setFolderPages((prev) => ({ ...prev, [folder]: Math.max(0, page) }));
  }, []);

  // Sorted & filtered documents
  const sortedDocs = useMemo(() => {
    const sorted = [...documents];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "category":
          cmp = a.category.localeCompare(b.category);
          break;
        case "date":
        default:
          cmp =
            new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [documents, sortField, sortDir]);

  // Group sorted docs by folder. Folders with no docs are still listed (from
  // `folders`) so empty user-created folders remain visible. Unfiled docs
  // (folder_path === "") are grouped under the UNFILED bucket.
  const grouped = useMemo(() => {
    const byFolder: Record<string, DocMetadata[]> = {};
    folders.forEach((f) => {
      byFolder[f] = [];
    });
    byFolder[UNFILED] = [];
    sortedDocs.forEach((d) => {
      const key = d.folderPath || UNFILED;
      if (!byFolder[key]) byFolder[key] = [];
      byFolder[key].push(d);
    });
    // Order: real folders first (alpha), then Unfiled last.
    const ordered = Object.keys(byFolder)
      .filter((k) => k !== UNFILED)
      .sort((a, b) => a.localeCompare(b));
    ordered.push(UNFILED);
    return { byFolder, ordered };
  }, [folders, sortedDocs]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((d) => {
      counts[d.category] = (counts[d.category] || 0) + 1;
    });
    return counts;
  }, [documents]);

  const activeUploads = uploads.filter(
    (u) => u.status === "queued" || u.status === "uploading",
  ).length;
  const doneUploads = uploads.filter((u) => u.status === "done").length;
  const errorUploads = uploads.filter((u) => u.status === "error").length;

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        color: "var(--blend-border)",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 700,
            color: "var(--blend-text-primary)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Layers size={22} style={{ color: "var(--blend-amber)" }} /> Document
          Center
        </h2>
        <p
          style={{ margin: 0, fontSize: 12, color: "var(--blend-text-muted)" }}
        >
          Upload, organize, and manage your fuel station documents
        </p>
      </div>

      {/* Sub-tab switcher: Documents vs Document Converter */}
      <div style={{ marginBottom: 20 }}>
        <SubTabBar
          tabs={[
            { id: "documents", label: "Documents", icon: FolderOpen },
            { id: "converter", label: "Document Converter", icon: FileText },
          ]}
          active={activeView}
          onChange={(id) => setActiveView(id as "documents" | "converter")}
        />
      </div>

      {activeView === "converter" ? (
        <DocumentConverter />
      ) : (
        <>
          {/* Stats bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <StatCard
              icon={<FileText size={16} />}
              label="Documents"
              value={String(stats.count)}
              color="var(--blend-blue)"
            />
            <StatCard
              icon={<HardDrive size={16} />}
              label="Storage Used"
              value={formatSize(stats.storage)}
              color="var(--blend-green)"
            />
            <StatCard
              icon={<CheckCircle2 size={16} />}
              label="Uploaded"
              value={String(doneUploads)}
              color="var(--blend-blue)"
            />
            {errorUploads > 0 && (
              <StatCard
                icon={<AlertTriangle size={16} />}
                label="Errors"
                value={String(errorUploads)}
                color="var(--blend-red)"
              />
            )}
          </div>

          {/* Upload zone — premium animated dropzone (design spec file 10) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0)
                addFilesToQueue(files as unknown as FileList);
            }}
            tabIndex={0}
            style={{
              border: `2px dashed ${isDragOver ? "var(--blend-amber)" : "var(--blend-text-secondary)"}`,
              borderRadius: 12,
              padding: "28px 20px",
              textAlign: "center",
              background: isDragOver
                ? "rgba(245,158,11,0.08)"
                : "rgba(30,30,35,0.6)",
              transition: "all 0.2s",
              marginBottom: 16,
              transform: isDragOver ? "scale(1.01)" : "scale(1)",
              cursor: "pointer",
            }}
            className={isDragOver ? "fp-dropzone-active" : ""}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            aria-label="Upload files dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp,.zip,.mp3,.mp4,.mov,.avi"
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error - webkitdirectory/directory are not in React DOM TS types but work in browsers
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderSelect}
              style={{ display: "none" }}
            />
            <FileUp
              size={32}
              style={{
                color: isDragOver
                  ? "var(--blend-amber)"
                  : "var(--blend-text-secondary)",
                marginBottom: 8,
              }}
            />
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 14,
                color: "var(--blend-text-secondary)",
              }}
            >
              {isDragOver
                ? "Drop files or folders here"
                : "Drag & drop files or folders here — you can paste too"}
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "10px 18px",
                  background: "var(--blend-amber)",
                  color: "var(--blend-surface-dark)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Upload size={15} /> Select Files
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                style={{
                  padding: "10px 18px",
                  background: "transparent",
                  color: "var(--blend-amber)",
                  border: "1px solid var(--blend-amber)",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <FolderUp size={15} /> Select Folder
              </button>
            </div>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11,
                color: "var(--blend-text-secondary)",
              }}
            >
              Supports PDF, Word, Excel, Images, CSV, Text, ZIP — Max 100MB per
              file
            </p>
          </div>

          {/* Upload queue */}
          {uploads.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                background: "rgba(30,30,35,0.6)",
                borderRadius: 10,
                padding: 12,
                border: "1px solid var(--blend-text-secondary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--blend-border)",
                  }}
                >
                  Upload Queue{" "}
                  {activeUploads > 0 && (
                    <span style={{ color: "var(--blend-amber)" }}>
                      ({activeUploads} active)
                    </span>
                  )}
                </span>
                <button
                  onClick={clearCompleted}
                  style={{
                    fontSize: 11,
                    color: "var(--blend-text-muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Clear completed
                </button>
              </div>
              <div
                style={{
                  maxHeight: 160,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {uploads.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "rgba(20,20,25,0.5)",
                      fontSize: 12,
                      animation: "fp-fade-in 0.2s ease",
                    }}
                  >
                    {item.status === "queued" && (
                      <span
                        style={{
                          color: "var(--blend-text-muted)",
                          flexShrink: 0,
                        }}
                      >
                        <Loader2 size={12} />
                      </span>
                    )}
                    {item.status === "uploading" && (
                      <span
                        style={{ color: "var(--blend-amber)", flexShrink: 0 }}
                      >
                        <Loader2 size={12} className="spin" />
                      </span>
                    )}
                    {item.status === "done" && (
                      <span
                        style={{ color: "var(--blend-green)", flexShrink: 0 }}
                      >
                        <CheckCircle2 size={12} />
                      </span>
                    )}
                    {item.status === "error" && (
                      <span
                        style={{ color: "var(--blend-red)", flexShrink: 0 }}
                      >
                        <AlertTriangle size={12} />
                      </span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--blend-text-muted)",
                      }}
                    >
                      {item.file.name}
                    </span>
                    {/* Progress bar (design spec file 10) */}
                    {item.status === "uploading" && (
                      <div
                        style={{
                          width: 60,
                          height: 4,
                          borderRadius: 2,
                          background: "#1e293b",
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${item.progress}%`,
                            background: "var(--blend-blue)",
                            borderRadius: 2,
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    )}
                    <span
                      style={{
                        color: "var(--blend-text-secondary)",
                        flexShrink: 0,
                      }}
                    >
                      {formatSize(item.file.size)}
                    </span>
                    {item.folderPath && (
                      <span
                        style={{
                          color: "var(--blend-text-muted)",
                          fontSize: 10,
                          background: "#1e293b",
                          padding: "2px 6px",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      >
                        {item.folderPath}
                      </span>
                    )}
                    {item.status === "error" && (
                      <span
                        style={{
                          color: "var(--blend-red)",
                          fontSize: 10,
                          flexShrink: 0,
                        }}
                      >
                        {item.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--blend-text-secondary)",
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents..."
                style={{
                  width: "100%",
                  padding: "8px 10px 8px 32px",
                  background: "#1a1a1f",
                  border: "1px solid var(--blend-text-secondary)",
                  borderRadius: 8,
                  color: "var(--blend-border)",
                  fontSize: 13,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--blend-text-secondary)",
                    cursor: "pointer",
                    padding: 2,
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                padding: 8,
                background: "#1a1a1f",
                border: "1px solid var(--blend-text-secondary)",
                borderRadius: 8,
                color: "var(--blend-text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Filter size={14} />
            </button>
            <button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              style={{
                padding: 8,
                background: "#1a1a1f",
                border: "1px solid var(--blend-text-secondary)",
                borderRadius: 8,
                color: "var(--blend-text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              {viewMode === "grid" ? <List size={14} /> : <Grid size={14} />}
            </button>
            <div style={{ position: "relative" }}>
              <button
                onClick={() =>
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                }
                style={{
                  padding: "8px 12px",
                  background: "#1a1a1f",
                  border: "1px solid var(--blend-text-secondary)",
                  borderRadius: 8,
                  color: "var(--blend-text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <SortAsc
                  size={14}
                  style={{
                    transform: sortDir === "desc" ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                  }}
                />
                {sortField}
              </button>
            </div>
          </div>

          {/* Category pills */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 12,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat;
              const count =
                cat === "All" ? stats.count : categoryCounts[cat] || 0;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    border: "none",
                    flexShrink: 0,
                    background: isActive ? "var(--blend-amber)" : "#1e293b",
                    color: isActive
                      ? "var(--blend-surface-dark)"
                      : "var(--blend-text-secondary)",
                  }}
                >
                  {cat}{" "}
                  {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                </button>
              );
            })}
          </div>

          {/* Folder management bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "var(--blend-text-muted)",
                fontWeight: 600,
              }}
            >
              Folders:
            </span>
            <button
              onClick={() => setShowNewFolder((v) => !v)}
              style={{
                padding: "5px 10px",
                background: "#1e293b",
                border: "1px solid var(--blend-text-secondary)",
                borderRadius: 6,
                color: "var(--blend-amber)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <FolderPlus size={12} /> New Folder
            </button>
            {/* Upload target folder selector */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--blend-text-muted)",
              }}
            >
              Upload to:
              <select
                value={uploadTargetFolder}
                onChange={(e) => setUploadTargetFolder(e.target.value)}
                style={{
                  padding: "4px 6px",
                  background: "#1a1a1f",
                  border: "1px solid var(--blend-text-secondary)",
                  borderRadius: 6,
                  color: "var(--blend-border)",
                  fontSize: 11,
                  outline: "none",
                }}
              >
                <option value="">Auto-sort by content</option>
                <option value={UNFILED}>Unfiled</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            {showNewFolder && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="text"
                  value={newFolderName}
                  autoFocus
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") setShowNewFolder(false);
                  }}
                  placeholder="Folder name"
                  style={{
                    padding: "5px 8px",
                    background: "#1a1a1f",
                    border: "1px solid var(--blend-text-secondary)",
                    borderRadius: 6,
                    color: "var(--blend-border)",
                    fontSize: 11,
                    outline: "none",
                    width: 150,
                  }}
                />
                <button
                  onClick={handleCreateFolder}
                  style={{
                    padding: "5px 10px",
                    background: "var(--blend-amber)",
                    border: "none",
                    borderRadius: 6,
                    color: "var(--blend-surface-dark)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Create
                </button>
              </div>
            )}
          </div>

          {folderActionMsg && (
            <div
              style={{
                marginBottom: 10,
                padding: "6px 10px",
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.3)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--blend-green)",
              }}
            >
              {folderActionMsg}
            </div>
          )}

          {/* Document list — grouped by folder, collapsible, paginated 10/page */}
          {sortedDocs.length === 0 && folders.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--blend-text-secondary)",
              }}
            >
              <File size={40} style={{ marginBottom: 10, opacity: 0.3 }} />
              <p style={{ fontSize: 14, margin: 0 }}>No documents found</p>
              <p style={{ fontSize: 12, margin: "4px 0 0" }}>
                Upload files to get started — they are auto-sorted into folders
                by content, or pick a folder above.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {grouped.ordered.map((folderName) => {
                const docsInFolder = grouped.byFolder[folderName] || [];
                const count = docsInFolder.length;
                const expanded = expandedFolders.has(folderName);
                // Only show a folder row if it has files OR is a user-created folder
                // (folders list). Unfiled only shows if it has files.
                if (
                  count === 0 &&
                  folderName !== UNFILED &&
                  !folders.includes(folderName)
                )
                  return null;
                if (count === 0 && folderName === UNFILED) return null;

                const page = folderPages[folderName] || 0;
                const totalPages = Math.max(
                  1,
                  Math.ceil(count / FILES_PER_PAGE),
                );
                const pageDocs = expanded
                  ? docsInFolder.slice(
                      page * FILES_PER_PAGE,
                      page * FILES_PER_PAGE + FILES_PER_PAGE,
                    )
                  : [];
                return (
                  <FolderGroup
                    key={folderName}
                    folderName={folderName}
                    count={count}
                    expanded={expanded}
                    onToggle={() => toggleFolder(folderName)}
                    isUnfiled={folderName === UNFILED}
                    renaming={renamingFolder === folderName}
                    renameValue={renameValue}
                    onStartRename={() => {
                      setRenamingFolder(folderName);
                      setRenameValue(folderName);
                    }}
                    onCancelRename={() => setRenamingFolder(null)}
                    onSubmitRename={() => handleRenameFolder(folderName)}
                    onRenameChange={setRenameValue}
                    deleting={deletingFolder === folderName}
                    onDelete={() => setDeletingFolder(folderName)}
                    onCancelDelete={() => setDeletingFolder(null)}
                    onConfirmDelete={() => {
                      void handleDeleteFolder(folderName);
                    }}
                    viewMode={viewMode}
                    pageDocs={pageDocs}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={(p) => setFolderPage(folderName, p)}
                    onSelect={setSelectedDoc}
                    onDeleteDoc={handleDelete}
                    onDownload={handleDownload}
                    allFolders={grouped.ordered.filter((f) => f !== UNFILED)}
                    onMoveDoc={handleMoveDoc}
                  />
                );
              })}
            </div>
          )}

          {/* Detail panel */}
          {selectedDoc && (
            <DocDetailPanel
              doc={selectedDoc}
              onClose={() => setSelectedDoc(null)}
              onDelete={handleDelete}
              onDownload={handleDownload}
            />
          )}

          <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
        </>
      )}
    </div>
  );
}

// Sub-components
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "rgba(30,30,35,0.6)",
        borderRadius: 10,
        padding: 12,
        border: "1px solid var(--blend-text-secondary)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${color}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--blend-text-primary)",
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--blend-text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

// A collapsible folder row with paginated (10/page) file listing.
function FolderGroup({
  folderName,
  count,
  expanded,
  onToggle,
  isUnfiled,
  renaming,
  renameValue,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onRenameChange,
  deleting,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
  viewMode,
  pageDocs,
  page,
  totalPages,
  onPageChange,
  onSelect,
  onDeleteDoc,
  onDownload,
  allFolders,
  onMoveDoc,
}: {
  folderName: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  isUnfiled: boolean;
  renaming: boolean;
  renameValue: string;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onRenameChange: (v: string) => void;
  deleting: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  viewMode: ViewMode;
  pageDocs: DocMetadata[];
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onSelect: (d: DocMetadata) => void;
  onDeleteDoc: (id: string) => void;
  onDownload: (d: DocMetadata) => void;
  allFolders: string[];
  onMoveDoc: (d: DocMetadata, folder: string) => void;
}) {
  const FolderIcon = isUnfiled ? FolderOpen : Folder;
  return (
    <div
      style={{
        background: "rgba(30,30,35,0.6)",
        border: "1px solid var(--blend-text-secondary)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Folder header (click to expand/collapse) */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          cursor: "pointer",
          userSelect: "none",
          background: expanded ? "rgba(245,158,11,0.06)" : "transparent",
        }}
      >
        {expanded ? (
          <ChevronDown
            size={14}
            style={{ color: "var(--blend-text-secondary)", flexShrink: 0 }}
          />
        ) : (
          <ChevronRight
            size={14}
            style={{ color: "var(--blend-text-secondary)", flexShrink: 0 }}
          />
        )}
        <FolderIcon
          size={16}
          style={{ color: "var(--blend-amber)", flexShrink: 0 }}
        />
        {renaming && !isUnfiled ? (
          <div
            style={{ display: "flex", alignItems: "center", gap: 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={renameValue}
              autoFocus
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmitRename();
                if (e.key === "Escape") onCancelRename();
              }}
              style={{
                padding: "3px 6px",
                background: "#1a1a1f",
                border: "1px solid var(--blend-amber)",
                borderRadius: 4,
                color: "var(--blend-border)",
                fontSize: 12,
                outline: "none",
                width: 160,
              }}
            />
            <button
              onClick={onSubmitRename}
              style={{
                padding: "3px 8px",
                background: "var(--blend-amber)",
                border: "none",
                borderRadius: 4,
                color: "var(--blend-surface-dark)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--blend-border)",
            }}
          >
            {folderName}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            color: "var(--blend-text-muted)",
            background: "#1e293b",
            padding: "1px 7px",
            borderRadius: 10,
          }}
        >
          {count} {count === 1 ? "file" : "files"}
        </span>
        {/* Folder actions (not for Unfiled) */}
        {!isUnfiled && !renaming && !deleting && (
          <div
            style={{ marginLeft: "auto", display: "flex", gap: 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onStartRename}
              title="Rename folder"
              style={{
                background: "none",
                border: "none",
                color: "var(--blend-text-secondary)",
                cursor: "pointer",
                padding: 2,
                display: "flex",
              }}
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={onDelete}
              title="Delete folder (move files to Unfiled)"
              style={{
                background: "none",
                border: "none",
                color: "var(--blend-text-secondary)",
                cursor: "pointer",
                padding: 2,
                display: "flex",
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
        {deleting && !isUnfiled && (
          <div
            style={{ marginLeft: "auto", display: "flex", gap: 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              style={{ fontSize: 10, color: "var(--blend-text-secondary)" }}
            >
              Move all files to Unfiled?
            </span>
            <button
              onClick={onConfirmDelete}
              style={{
                padding: "2px 7px",
                background: "var(--blend-red)",
                border: "none",
                borderRadius: 4,
                color: "var(--blend-text-primary)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
            <button
              onClick={onCancelDelete}
              style={{
                padding: "2px 7px",
                background: "#1e293b",
                border: "1px solid var(--blend-text-secondary)",
                borderRadius: 4,
                color: "var(--blend-text-secondary)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Expanded file listing — paginated 10 at a time */}
      {expanded && (
        <div
          style={{ padding: "4px 12px 10px", borderTop: "1px solid #1e293b" }}
        >
          {pageDocs.length === 0 ? (
            <p
              style={{
                fontSize: 11,
                color: "var(--blend-text-secondary)",
                padding: "8px 0",
              }}
            >
              This folder is empty — upload or move files into it.
            </p>
          ) : viewMode === "grid" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 8,
                paddingTop: 6,
              }}
            >
              {pageDocs.map((doc) => (
                <DocGridCard
                  key={doc.id}
                  doc={doc}
                  onSelect={onSelect}
                  onDelete={onDeleteDoc}
                  onDownload={onDownload}
                  allFolders={allFolders}
                  currentFolder={isUnfiled ? "" : folderName}
                  onMoveDoc={onMoveDoc}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingTop: 6,
              }}
            >
              {pageDocs.map((doc) => (
                <DocListRow
                  key={doc.id}
                  doc={doc}
                  onSelect={onSelect}
                  onDelete={onDeleteDoc}
                  onDownload={onDownload}
                  allFolders={allFolders}
                  currentFolder={isUnfiled ? "" : folderName}
                  onMoveDoc={onMoveDoc}
                />
              ))}
            </div>
          )}
          {/* Pagination — max 10 files per page */}
          {count > FILES_PER_PAGE && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                paddingTop: 10,
                fontSize: 11,
                color: "var(--blend-text-muted)",
              }}
            >
              <button
                onClick={() => onPageChange(Math.max(0, page - 1))}
                disabled={page === 0}
                style={{
                  padding: "3px 9px",
                  background: "#1e293b",
                  border: "1px solid var(--blend-text-secondary)",
                  borderRadius: 5,
                  color:
                    page === 0
                      ? "var(--blend-text-secondary)"
                      : "var(--blend-border)",
                  cursor: page === 0 ? "default" : "pointer",
                  fontSize: 11,
                }}
              >
                Prev
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: "3px 9px",
                  background: "#1e293b",
                  border: "1px solid var(--blend-text-secondary)",
                  borderRadius: 5,
                  color:
                    page >= totalPages - 1
                      ? "var(--blend-text-secondary)"
                      : "var(--blend-border)",
                  cursor: page >= totalPages - 1 ? "default" : "pointer",
                  fontSize: 11,
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocGridCard({
  doc,
  onSelect,
  onDelete,
  onDownload,
  allFolders,
  currentFolder,
  onMoveDoc,
}: {
  doc: DocMetadata;
  onSelect: (d: DocMetadata) => void;
  onDelete: (id: string) => void;
  onDownload: (d: DocMetadata) => void;
  allFolders?: string[];
  currentFolder?: string;
  onMoveDoc?: (d: DocMetadata, folder: string) => void;
}) {
  const Icon = getFileIcon(doc.type, doc.name);
  const color = CATEGORY_COLORS[doc.category] || "var(--blend-text-secondary)";
  const CatIcon = CATEGORY_ICONS[doc.category] || FileText;
  return (
    <div
      onClick={() => onSelect(doc)}
      style={{
        background: "rgba(30,30,35,0.6)",
        borderRadius: 10,
        padding: 12,
        border: "1px solid var(--blend-text-secondary)",
        cursor: "pointer",
        transition: "border-color 0.2s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "var(--blend-text-secondary)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "var(--blend-text-secondary)")
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Icon size={20} style={{ color }} />
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(doc);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--blend-text-secondary)",
              cursor: "pointer",
              padding: 2,
            }}
          >
            <Download size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(doc.id);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--blend-text-secondary)",
              cursor: "pointer",
              padding: 2,
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--blend-border)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {doc.name}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "var(--blend-text-secondary)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <CatIcon size={10} style={{ color }} /> {doc.category}
        </span>
        <span>{formatSize(doc.size)}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--blend-text-secondary)" }}>
        {new Date(doc.uploadedAt).toLocaleDateString()}
      </div>
      {allFolders && onMoveDoc && (
        <select
          value={currentFolder || ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMoveDoc(doc, e.target.value)}
          style={{
            padding: "3px 4px",
            background: "#1a1a1f",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 5,
            color: "var(--blend-text-secondary)",
            fontSize: 10,
            outline: "none",
            cursor: "pointer",
          }}
          title="Move to folder"
        >
          <option value="">Unfiled</option>
          {allFolders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function DocListRow({
  doc,
  onSelect,
  onDelete,
  onDownload,
  allFolders,
  currentFolder,
  onMoveDoc,
}: {
  doc: DocMetadata;
  onSelect: (d: DocMetadata) => void;
  onDelete: (id: string) => void;
  onDownload: (d: DocMetadata) => void;
  allFolders?: string[];
  currentFolder?: string;
  onMoveDoc?: (d: DocMetadata, folder: string) => void;
}) {
  const Icon = getFileIcon(doc.type, doc.name);
  const color = CATEGORY_COLORS[doc.category] || "var(--blend-text-secondary)";
  return (
    <div
      onClick={() => onSelect(doc)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(30,30,35,0.6)",
        borderRadius: 8,
        border: "1px solid var(--blend-text-secondary)",
        cursor: "pointer",
        fontSize: 12,
        transition: "border-color 0.2s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "var(--blend-text-secondary)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "var(--blend-text-secondary)")
      }
    >
      <Icon size={16} style={{ color, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
          color: "var(--blend-border)",
        }}
      >
        {doc.name}
      </span>
      <span
        style={{
          color,
          fontSize: 10,
          fontWeight: 600,
          background: `${color}15`,
          padding: "2px 8px",
          borderRadius: 10,
          whiteSpace: "nowrap",
        }}
      >
        {doc.category}
      </span>
      <span
        style={{
          color: "var(--blend-text-secondary)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {formatSize(doc.size)}
      </span>
      <span
        style={{
          color: "var(--blend-text-secondary)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {new Date(doc.uploadedAt).toLocaleDateString()}
      </span>
      {allFolders && onMoveDoc && (
        <select
          value={currentFolder || ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMoveDoc(doc, e.target.value)}
          style={{
            padding: "3px 4px",
            background: "#1a1a1f",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 5,
            color: "var(--blend-text-secondary)",
            fontSize: 10,
            outline: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Move to folder"
        >
          <option value="">Unfiled</option>
          {allFolders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload(doc);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--blend-text-secondary)",
            cursor: "pointer",
            padding: 3,
          }}
        >
          <Download size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(doc.id);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--blend-text-secondary)",
            cursor: "pointer",
            padding: 3,
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function DocDetailPanel({
  doc,
  onClose,
  onDelete,
  onDownload,
}: {
  doc: DocMetadata;
  onClose: () => void;
  onDelete: (id: string) => void;
  onDownload: (d: DocMetadata) => void;
}) {
  const Icon = getFileIcon(doc.type, doc.name);
  const color = CATEGORY_COLORS[doc.category] || "var(--blend-text-secondary)";
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 380,
        maxWidth: "100%",
        height: "100vh",
        background: "rgba(15,15,20,0.98)",
        backdropFilter: "blur(12px)",
        borderLeft: "1px solid var(--blend-text-secondary)",
        zIndex: 1000,
        padding: 20,
        overflowY: "auto",
        boxSizing: "border-box",
        animation: "slideInRight 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 15,
            color: "var(--blend-text-primary)",
          }}
        >
          Document Details
        </h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--blend-text-secondary)",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 12,
            background: `${color}15`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 12px",
          }}
        >
          <Icon size={32} style={{ color }} />
        </div>
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--blend-text-primary)",
            margin: "0 0 4px",
            wordBreak: "break-all",
          }}
        >
          {doc.name}
        </p>
        <span
          style={{
            fontSize: 11,
            color,
            fontWeight: 600,
            background: `${color}15`,
            padding: "3px 10px",
            borderRadius: 10,
          }}
        >
          {doc.category}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <DetailRow label="Size" value={formatSize(doc.size)} />
        <DetailRow label="Type" value={doc.type || "Unknown"} />
        <DetailRow
          label="Uploaded"
          value={new Date(doc.uploadedAt).toLocaleString()}
        />
        <DetailRow label="Category" value={doc.category} />
        {doc.folderPath && <DetailRow label="Folder" value={doc.folderPath} />}
        <DetailRow label="Tags" value={doc.tags.join(", ")} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onDownload(doc)}
          style={{
            flex: 1,
            padding: 10,
            background: "var(--blend-amber)",
            color: "var(--blend-surface-dark)",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Download size={14} /> Download
        </button>
        <button
          onClick={() => {
            onDelete(doc.id);
            onClose();
          }}
          style={{
            padding: 10,
            background: "transparent",
            color: "var(--blend-red)",
            border: "1px solid var(--blend-red)",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        padding: "6px 0",
        borderBottom: "1px solid #1e293b",
      }}
    >
      <span style={{ color: "var(--blend-text-secondary)" }}>{label}</span>
      <span
        style={{
          color: "var(--blend-border)",
          fontWeight: 500,
          maxWidth: "60%",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
