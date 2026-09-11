/**
 * Document Service — cross-device file upload/access via Supabase Storage.
 *
 * Files are uploaded to the `fuelpro-files` bucket under `documents/<uid>/<filename>`.
 * Metadata is stored in the `user_documents` table (RLS-protected by owner_id).
 * Files are accessible from any device/browser signed into the same account.
 * localStorage is used only as a read-through cache — never the source of truth.
 */

import { getSupabaseClient } from "@/supabase/client";
import {
  compressBlob,
  compressedFilePath,
  isCompressibleMimeType,
  isCompressedPath,
  decompressBlob,
} from "@/react-app/lib/compression";

export interface UserDocument {
  id: string;
  owner_id: string;
  station_id: string | null;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  mime_type: string | null;
  category: string;
  description: string | null;
  storage_bucket: string;
  created_at: string;
  updated_at: string;
}

const CACHE_KEY = "fuelpro_user_documents_cache";
const BUCKET = "fuelpro-files";

function readCache(): UserDocument[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCache(docs: UserDocument[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(docs));
  } catch {
    // quota — ignore, cloud is source of truth
  }
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function categorizeFile(name: string, mimeType: string): string {
  const ext = getFileExtension(name);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv"].includes(ext) || mimeType.includes("spreadsheet"))
    return "spreadsheet";
  if (["doc", "docx"].includes(ext) || mimeType.includes("word"))
    return "document";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "general";
}

export async function uploadDocument(
  file: File,
  stationId?: string,
  description?: string,
): Promise<{ success: boolean; error?: string; document?: UserDocument }> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { success: false, error: "You must be logged in to upload files" };

  // Build a unique storage path: documents/<uid>/<timestamp>-<filename>
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const baseFilePath = `documents/${user.id}/${Date.now()}-${safeName}`;

  // Compress text-based files (JSON, CSV, XML, TXT, SVG, etc.) with gzip to
  // save Storage space. Already-compressed formats (images, PDF, video, audio,
  // archives) are stored as-is — gzipping them wastes CPU. The stored path
  // gets a `.gz` suffix so the download path can transparently decompress.
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
      // Compression failed — fall back to the original file (never block upload).
      uploadBlob = file;
    }
  }

  // Upload to Storage
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, uploadBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: storedContentType,
    });

  if (uploadErr) {
    return { success: false, error: uploadErr.message };
  }

  // Store metadata in user_documents table
  const { data, error: metaErr } = await supabase
    .from("user_documents")
    .insert({
      owner_id: user.id,
      station_id: stationId || null,
      file_name: file.name,
      file_path: filePath,
      file_type: getFileExtension(file.name),
      file_size: storedSize,
      mime_type: file.type || null,
      category: categorizeFile(file.name, file.type || ""),
      description: description || null,
      storage_bucket: BUCKET,
    })
    .select()
    .single();

  if (metaErr) {
    // Rollback: delete the uploaded file if metadata insert failed
    await supabase.storage.from(BUCKET).remove([filePath]);
    return { success: false, error: metaErr.message };
  }

  const doc = data as UserDocument;
  const cache = readCache().filter((d) => d.id !== doc.id);
  cache.push(doc);
  writeCache(cache);

  return { success: true, document: doc };
}

export async function getDocuments(
  stationId?: string,
): Promise<UserDocument[]> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return readCache();

  let query = supabase
    .from("user_documents")
    .select("*")
    .eq("owner_id", user.id);
  if (stationId) {
    query = query.eq("station_id", stationId);
  }
  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.warn("[docService] getDocuments error:", error.message);
    return readCache().filter((d) => !stationId || d.station_id === stationId);
  }

  const docs = (data || []) as UserDocument[];
  writeCache(docs);
  return docs;
}

export async function getDocumentUrl(
  doc: UserDocument,
): Promise<string | null> {
  const supabase = getSupabaseClient();
  // The fuelpro-files bucket is public, so a public URL works for reads from
  // any device without a signed token. This is simpler and avoids the
  // "signature verification failed" edge case with short-lived signed URLs.
  const { data } = supabase.storage
    .from(doc.storage_bucket || BUCKET)
    .getPublicUrl(doc.file_path);
  if (data?.publicUrl) return data.publicUrl;
  // Fallback to a signed URL if public URL is unavailable for some reason.
  const { data: signed, error } = await supabase.storage
    .from(doc.storage_bucket || BUCKET)
    .createSignedUrl(doc.file_path, 3600);
  if (error) {
    console.warn("[docService] getDocumentUrl error:", error.message);
    return null;
  }
  return signed?.signedUrl || null;
}

/**
 * Download a document and return an object URL ready for the browser. If the
 * stored file was gzip-compressed on upload (path ends with `.gz`), the bytes
 * are transparently decompressed first so the user receives the original file.
 * Falls back to the raw public URL when the file is not compressed (so the
 * browser can stream it directly without holding it in memory).
 */
export async function downloadDocument(
  doc: UserDocument,
): Promise<{ url: string; blob?: Blob } | null> {
  // Non-compressed files: a direct public URL is best (browser streams it).
  if (!isCompressedPath(doc.file_path)) {
    const url = await getDocumentUrl(doc);
    return url ? { url } : null;
  }

  // Compressed files: fetch the bytes and decompress in-browser.
  const supabase = getSupabaseClient();
  const bucket = doc.storage_bucket || BUCKET;
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(doc.file_path);
  if (error || !data) {
    // Fallback: try a signed URL fetch (e.g. if bucket isn't public).
    const signed = await getDocumentUrl(doc);
    if (!signed) return null;
    try {
      const res = await fetch(signed);
      if (!res.ok) return null;
      const blob = await res.blob();
      const decompressed = await decompressBlob(blob);
      return { url: URL.createObjectURL(decompressed), blob: decompressed };
    } catch {
      return null;
    }
  }
  const blob = data as Blob;
  const decompressed = await decompressBlob(blob);
  return { url: URL.createObjectURL(decompressed), blob: decompressed };
}

export async function deleteDocument(
  docId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  // Get the doc first to know the file path
  const { data: doc, error: findErr } = await supabase
    .from("user_documents")
    .select("*")
    .eq("id", docId)
    .single();

  if (findErr || !doc) {
    return { success: false, error: "Document not found" };
  }

  const userDoc = doc as UserDocument;

  // Delete from Storage
  const { error: storageErr } = await supabase.storage
    .from(userDoc.storage_bucket || BUCKET)
    .remove([userDoc.file_path]);

  if (storageErr) {
    console.warn("[docService] storage delete error:", storageErr.message);
  }

  // Delete metadata
  const { error: metaErr } = await supabase
    .from("user_documents")
    .delete()
    .eq("id", docId);

  if (metaErr) {
    return { success: false, error: metaErr.message };
  }

  const cache = readCache().filter((d) => d.id !== docId);
  writeCache(cache);
  return { success: true };
}

export { categorizeFile, getFileExtension };
