// Supabase Storage + user_documents-backed document storage for FuelPro
// Document Center. Files are stored as binary objects in the fuelpro-files
// Storage bucket and metadata in the user_documents table — both sync
// cross-device (RLS by owner_id = auth.uid()). This replaces the previous
// IndexedDB implementation which was browser-local and did NOT sync.
import { getSupabaseClient } from "@/supabase/client";
import {
  compressBlob,
  compressedFilePath,
  isCompressibleMimeType,
  isCompressedPath,
  decompressBlob,
} from "@/react-app/lib/compression";

const BUCKET = "fuelpro-files";

interface DocMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  category: string;
  tags: string[];
  uploadedAt: string;
  updatedAt: string;
  folderPath?: string;
  content?: string;
  thumbnail?: string;
  stationId?: string | null;
}

/** Row shape in the user_documents table. */
interface DocRow {
  id: string;
  owner_id: string;
  station_id: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  mime_type: string | null;
  category: string | null;
  description: string | null;
  storage_bucket: string | null;
  created_at: string;
  updated_at: string;
  tags: string[] | null;
  folder_path: string | null;
  thumbnail: string | null;
}

function rowToMeta(r: DocRow): DocMetadata {
  return {
    id: r.id,
    name: r.file_name,
    size: r.file_size || 0,
    type: r.mime_type || r.file_type || "application/octet-stream",
    category: r.category || "General",
    tags: Array.isArray(r.tags) ? r.tags : [],
    uploadedAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
    folderPath: r.folder_path || "",
    thumbnail: r.thumbnail || undefined,
    stationId: r.station_id,
  };
}

/** Map a business category to a default folder name (used for auto-sorting). */
const CATEGORY_TO_FOLDER: Record<string, string> = {
  "M-PESA Receipt": "M-PESA Receipts",
  Invoice: "Invoices",
  "Delivery Note": "Delivery Notes",
  Payroll: "Payroll",
  "Sales Report": "Sales Reports",
  "Expense Claim": "Expense Claims",
  Compliance: "Compliance",
  Inventory: "Inventory",
  "Fuel Document": "Fuel Documents",
  Legal: "Legal",
  Report: "Reports",
  General: "General",
};

/**
 * Silently read a file's text content (best-effort) and classify it into a
 * business category. For text-like files we inspect the content; for binary
 * files (PDF/images/archives/media) we fall back to filename heuristics.
 */
async function classifyFile(
  file: File,
): Promise<{ category: string; folder: string }> {
  const lowerName = file.name.toLowerCase();
  const mime = (file.type || "").toLowerCase();

  // Attempt to read text content for text-like files (txt, csv, json, md, plain).
  let text = "";
  const isTextish =
    mime.startsWith("text/") ||
    mime.includes("csv") ||
    mime.includes("json") ||
    /\.(txt|csv|json|md|rst|log|xml|html?)$/i.test(lowerName);
  if (isTextish) {
    try {
      text = (await file.text()).toLowerCase().slice(0, 20000);
    } catch {
      text = "";
    }
  }

  const haystack = `${lowerName}\n${text}`;
  const match = (re: RegExp) => re.test(haystack);

  // M-PESA / payment receipts — strong signals in content (M-PESA confirmation
  // codes, amounts, phone numbers) plus filename hints.
  if (
    match(
      /mpesa|m-pesa|lipa\s?na\s?mpesa|stk\s?push|confirmation\s?code|transaction\s?id|paid\s?(ksh|kes)|payment\s?received|receipt\s?no/i,
    )
  ) {
    return cat("M-PESA Receipt");
  }
  if (
    match(
      /invoice|proforma|bill\s?to|tax\s?invoice|vat|amount\s?due|balance\s?due|subtotal|total\s?due/i,
    )
  ) {
    return cat("Invoice");
  }
  if (
    match(
      /delivery\s?note|waybill|dispatch|consignment|goods\s?received|grn|received\s?from|delivered/i,
    )
  ) {
    return cat("Delivery Note");
  }
  if (
    match(
      /payroll|payslip|salary|gross\s?pay|net\s?pay|nhif|nssf|sha|paye|overtime|deductions/i,
    )
  ) {
    return cat("Payroll");
  }
  if (
    match(
      /sales\s?report|daily\s?sales|shift\s?report|pump\s?reading|revenue|closing\s?stock|closing\s?sales|litres\s?sold/i,
    )
  ) {
    return cat("Sales Report");
  }
  if (
    match(
      /expense|petty\s?cash|reimburse|voucher|claim|spent|paid\s?for|petrol\s?expense/i,
    )
  ) {
    return cat("Expense Claim");
  }
  if (
    match(
      /compliance|audit|kra|tax\s?pin|nema|epra|license|permit|regulation|certificate/i,
    )
  ) {
    return cat("Compliance");
  }
  if (
    match(
      /inventory|stock|dip\s?reading|tank|reconcil|opening\s?stock|closing\s?stock|stock\s?count/i,
    )
  ) {
    return cat("Inventory");
  }
  if (
    match(
      /fuel|diesel|petrol|gas\s?oil|lpg|kerosene|octane|litres?\s?delivered|fuel\s?delivery/i,
    )
  ) {
    return cat("Fuel Document");
  }
  if (
    match(
      /contract|agreement|legal|memo|clause|party\s?of|terms\s?and\s?conditions|non-?disclosure/i,
    )
  ) {
    return cat("Legal");
  }
  if (match(/report|monthly|annual|quarterly|summary|statement|performance/i)) {
    return cat("Report");
  }
  return cat("General");

  function cat(c: string): { category: string; folder: string } {
    return { category: c, folder: CATEGORY_TO_FOLDER[c] || "General" };
  }
}

export async function saveDocument(
  file: File,
  opts?: {
    folderPath?: string;
    content?: string;
    thumbnail?: string;
    stationId?: string | null;
    /** When true (default), auto-sort the file into a folder by content. */
    autoSort?: boolean;
  },
): Promise<DocMetadata> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated — cannot upload document.");

  const autoSort = opts?.autoSort !== false;
  // Classify by reading the file content (best-effort). This runs silently.
  let category = autoCategorize(file.name);
  let folder = opts?.folderPath || "";
  if (autoSort) {
    try {
      const classified = await classifyFile(file);
      category = classified.category;
      // An explicit folder wins over auto-sort; otherwise use the classified folder.
      if (!folder) folder = classified.folder;
    } catch {
      // Fall back to filename-based categorization + empty folder.
    }
  }
  const tags = getTags(file.name, category);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const baseFilePath = `documents/${user.id}/${Date.now()}-${safeName}`;

  // Gzip text-based files to save Storage space (see compression.ts). Binary
  // formats (images/PDF/video) are stored as-is. The .gz suffix lets the
  // download path transparently decompress.
  const shouldCompress = isCompressibleMimeType(file.type || "", file.name);
  let uploadBlob: Blob = file;
  let filePath = baseFilePath;
  let storedSize = file.size;
  let storedContentType = file.type || undefined;
  if (shouldCompress) {
    try {
      uploadBlob = await compressBlob(file);
      filePath = compressedFilePath(baseFilePath);
      storedSize = uploadBlob.size;
      storedContentType = "application/gzip";
    } catch {
      uploadBlob = file;
    }
  }

  // 1. Upload the file binary to Storage.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, uploadBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: storedContentType,
    });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // 2. Insert metadata into user_documents.
  const { data, error: dbErr } = await supabase
    .from("user_documents")
    .insert({
      owner_id: user.id,
      station_id: opts?.stationId || null,
      file_name: file.name,
      file_path: filePath,
      file_type: file.type || "application/octet-stream",
      file_size: storedSize,
      mime_type: file.type || null,
      category,
      storage_bucket: BUCKET,
      tags,
      folder_path: folder || "",
      thumbnail: opts?.thumbnail || null,
    })
    .select()
    .single();

  if (dbErr) {
    // Rollback the Storage upload so we don't leave orphaned files.
    await supabase.storage
      .from(BUCKET)
      .remove([filePath])
      .catch(() => {});
    throw new Error(`Metadata insert failed: ${dbErr.message}`);
  }

  return rowToMeta(data as DocRow);
}

export async function getDocument(
  id: string,
): Promise<{ meta: DocMetadata; data: ArrayBuffer } | null> {
  const supabase = getSupabaseClient();
  const { data: row, error } = await supabase
    .from("user_documents")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !row) return null;

  const r = row as DocRow;
  const meta = rowToMeta(r);
  // Fetch the file binary from the Storage public URL.
  const { data: pubUrlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(r.file_path);
  const res = await fetch(pubUrlData.publicUrl);
  if (!res.ok) return { meta, data: new ArrayBuffer(0) };
  // Transparently decompress gzip-compressed uploads (.gz path suffix).
  if (isCompressedPath(r.file_path)) {
    try {
      const blob = await res.blob();
      const decompressed = await decompressBlob(blob);
      const buf = await decompressed.arrayBuffer();
      return { meta, data: buf };
    } catch {
      // decompression failed — return raw bytes as a last resort
    }
  }
  const data = await res.arrayBuffer();
  return { meta, data };
}

export async function listDocuments(opts?: {
  category?: string;
  search?: string;
  folderPath?: string;
  stationId?: string | null;
}): Promise<DocMetadata[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("user_documents")
    .select("*")
    .order("created_at", { ascending: false });
  // Station scoping (sub-user isolation). null stationId => user-level docs only.
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  if (opts?.category && opts.category !== "All") {
    query = query.eq("category", opts.category);
  }
  if (opts?.search) {
    query = query.ilike("file_name", `%${opts.search}%`);
  }
  if (opts?.folderPath !== undefined) {
    query = query.eq("folder_path", opts.folderPath);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as DocRow[]).map(rowToMeta);
}

/** List every distinct folder (folder_path) for the current user/station. */
export async function listFolders(opts?: {
  stationId?: string | null;
}): Promise<string[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("user_documents")
    .select("folder_path")
    .order("folder_path", { ascending: true });
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  const set = new Set<string>();
  (data as { folder_path: string | null }[]).forEach((d) => {
    if (d.folder_path) set.add(d.folder_path);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Move a single document to a different folder. */
export async function updateDocumentFolder(
  id: string,
  folderPath: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("user_documents")
    .update({
      folder_path: folderPath || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Move failed: ${error.message}`);
}

/** Rename a document (file_name only; the stored object keeps its path). */
export async function renameDocument(
  id: string,
  newName: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("user_documents")
    .update({ file_name: newName, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Rename failed: ${error.message}`);
}

/**
 * Rename a folder: update folder_path on every document currently in that
 * folder to the new name (within the same station scope).
 */
export async function renameFolder(
  oldName: string,
  newName: string,
  opts?: { stationId?: string | null },
): Promise<number> {
  if (!oldName || oldName === newName) return 0;
  const supabase = getSupabaseClient();
  let query = supabase
    .from("user_documents")
    .update({ folder_path: newName, updated_at: new Date().toISOString() })
    .eq("folder_path", oldName);
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(`Rename folder failed: ${error.message}`);
  return data?.length || 0;
}

/**
 * Delete a folder by moving all its documents to a target folder (or to the
 * unfiled/root bucket if none provided). Returns the number of moved docs.
 */
export async function deleteFolder(
  folderName: string,
  opts?: { stationId?: string | null; moveTo?: string },
): Promise<number> {
  const supabase = getSupabaseClient();
  const target = opts?.moveTo ?? "";
  let query = supabase
    .from("user_documents")
    .update({ folder_path: target, updated_at: new Date().toISOString() })
    .eq("folder_path", folderName);
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(`Delete folder failed: ${error.message}`);
  return data?.length || 0;
}

/** Re-sort an already-uploaded document into the best folder by re-classifying. */
export async function autoSortDocument(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from("user_documents")
    .select("*")
    .eq("id", id)
    .single();
  if (!row) return;
  const r = row as DocRow;
  const category = autoCategorize(r.file_name);
  const folder = CATEGORY_TO_FOLDER[category] || "General";
  await updateDocumentFolder(id, folder);
}

export async function deleteDocument(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  // 1. Fetch the row to get the file_path (for Storage cleanup).
  const { data: row } = await supabase
    .from("user_documents")
    .select("file_path")
    .eq("id", id)
    .single();
  // 2. Delete the metadata row.
  const { error } = await supabase.from("user_documents").delete().eq("id", id);
  if (error) throw new Error(`Delete failed: ${error.message}`);
  // 3. Delete the file from Storage (best-effort).
  if (row?.file_path) {
    await supabase.storage
      .from(BUCKET)
      .remove([row.file_path])
      .catch(() => {});
  }
}

export async function countDocuments(opts?: {
  stationId?: string | null;
}): Promise<number> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("user_documents")
    .select("*", { count: "exact", head: true });
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  const { count, error } = await query;
  if (error) return 0;
  return count || 0;
}

export async function getTotalStorageUsed(opts?: {
  stationId?: string | null;
}): Promise<number> {
  const supabase = getSupabaseClient();
  let query = supabase.from("user_documents").select("file_size");
  if (opts?.stationId !== undefined && opts.stationId !== null) {
    query = query.eq("station_id", opts.stationId);
  } else {
    query = query.is("station_id", null);
  }
  const { data, error } = await query;
  if (error || !data) return 0;
  return (data as { file_size: number }[]).reduce(
    (sum, d) => sum + (d.file_size || 0),
    0,
  );
}

// Auto-categorization engine
function autoCategorize(filename: string): string {
  const name = filename.toLowerCase();
  if (/receipt|mpesa|payment|transaction|lipa|stk/i.test(name))
    return "M-PESA Receipt";
  if (/invoice|bill|quote|proforma/i.test(name)) return "Invoice";
  if (/delivery|waybill|dispatch|consignment|grn/i.test(name))
    return "Delivery Note";
  if (/payroll|salary|staff|wage|payslip|nhif|nssf|sha/i.test(name))
    return "Payroll";
  if (/sales|daily|shift|pump|revenue|closing/i.test(name))
    return "Sales Report";
  if (/expense|petty|reimburs|voucher|claim/i.test(name))
    return "Expense Claim";
  if (/audit|compliance|kra|tax|nema|epra|license/i.test(name))
    return "Compliance";
  if (/stock|inventory|dip|tank|reconcil/i.test(name)) return "Inventory";
  if (/fuel|diesel|petrol|gas|oil|lpg/i.test(name)) return "Fuel Document";
  if (/contract|agreement|legal|memo/i.test(name)) return "Legal";
  if (/report|monthly|annual|quarterly/i.test(name)) return "Report";
  return "General";
}

function getTags(filename: string, category: string): string[] {
  const name = filename.toLowerCase();
  const tags: string[] = [category];
  if (/\.pdf$/i.test(name)) tags.push("pdf");
  if (/\.docx?$/i.test(name)) tags.push("word");
  if (/\.xlsx?$/i.test(name)) tags.push("excel");
  if (/\.csv$/i.test(name)) tags.push("csv");
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(name)) tags.push("image");
  if (/\.(txt|md|rst)$/i.test(name)) tags.push("text");
  if (/\.zip$/i.test(name)) tags.push("archive");
  if (/202\d/.test(name)) tags.push(name.match(/202\d/)?.[0] || "2025");
  return tags;
}

export const CATEGORIES = [
  "All",
  "M-PESA Receipt",
  "Invoice",
  "Delivery Note",
  "Payroll",
  "Sales Report",
  "Expense Claim",
  "Compliance",
  "Inventory",
  "Fuel Document",
  "Legal",
  "Report",
  "General",
] as const;

export type { DocMetadata };
