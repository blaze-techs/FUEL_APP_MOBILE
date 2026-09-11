/**
 * Logo Storage Service — uploads station logos to Supabase Storage (the
 * `fuelpro-files` bucket) so they are real cross-device files referenced by a
 * public URL, NOT base64 blobs stuffed into localStorage/app_kv.
 *
 * Why a dedicated service:
 *  - localStorage is quota-limited (~5MB) and per-browser, so a base64 logo
 *    stored there vanishes on refresh once the quota is exceeded and is never
 *    visible on another device.
 *  - Embedding base64 in the app_kv JSONB blob re-uploads the whole image on
 *    every field save (slow, wasteful).
 *  - A Storage object is uploaded once; only its tiny public URL is persisted
 *    in app_kv (already the cross-device source of truth), so the logo renders
 *    on every device/browser signed into the same account.
 *
 * Bucket RLS: uploads are scoped to `logos/<uid>/...` per owner
 * (fuelpro_files_upload_owner / _update_owner / _delete_owner); reads are public
 * (fuelpro_files_public_read) so logos render without an authed session.
 */

import { getSupabaseClient } from "@/supabase/client";

const BUCKET = "fuelpro-files";
const FOLDER = "logos";

export interface LogoUploadResult {
  url: string;
  path: string;
}

/**
 * Upload a logo image file to Supabase Storage and return its public URL.
 * Throws on failure so the caller can surface the error to the user (the
 * previous base64 path swallowed errors silently).
 */
export async function uploadStationLogo(
  file: File,
  ownerId: string,
): Promise<LogoUploadResult> {
  const client = getSupabaseClient();

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${FOLDER}/${ownerId}/${timestamp}_${rand}.${ext}`;

  const { error: upErr } = await client.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/png",
    });

  if (upErr) {
    throw new Error(`Logo upload failed: ${upErr.message}`);
  }

  const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path);

  if (!urlData?.publicUrl) {
    throw new Error("Logo upload succeeded but no public URL was returned");
  }

  return { url: urlData.publicUrl, path };
}
