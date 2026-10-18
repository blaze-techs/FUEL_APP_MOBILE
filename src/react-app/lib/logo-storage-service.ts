/**
 * Company logo storage uses a dedicated public bucket. Do not make the general
 * fuelpro-files bucket public: it also stores private invoices and documents.
 */
import { getSupabaseClient } from "@/supabase/client";

const BUCKET = "fuelpro-logos";
const LEGACY_BUCKET = "fuelpro-files";
const FOLDER = "logos";
const LEGACY_PUBLIC_MARKER = `/storage/v1/object/public/${LEGACY_BUCKET}/`;

export interface LogoUploadResult {
  url: string;
  path: string;
}

/** Upload a logo image to the dedicated public logo bucket. */
export async function uploadStationLogo(
  file: File,
  ownerId: string,
): Promise<LogoUploadResult> {
  const client = getSupabaseClient();
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${FOLDER}/${ownerId}/${timestamp}_${rand}.${ext}`;

  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/png",
  });
  if (error) throw new Error(`Logo upload failed: ${error.message}`);

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error("Logo uploaded but no public URL was returned");
  }
  return { url: data.publicUrl, path };
}

/**
 * Copy an older logo out of the private shared-files bucket into the dedicated
 * public logo bucket. The source is read through the authenticated Storage API;
 * only a path under logos/<current-user-id>/ is eligible for migration.
 */
export async function migrateLegacyStationLogo(
  logoUrl: string,
  ownerId: string,
): Promise<string> {
  if (!logoUrl || !ownerId) return logoUrl;
  let pathname: string;
  try {
    pathname = new URL(logoUrl).pathname;
  } catch {
    return logoUrl;
  }

  const markerIndex = pathname.indexOf(LEGACY_PUBLIC_MARKER);
  if (markerIndex < 0) return logoUrl;

  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(markerIndex + LEGACY_PUBLIC_MARKER.length));
  } catch {
    throw new Error("Saved logo URL contains an invalid encoded path");
  }
  const segments = path.split("/");
  if (segments.length < 3 || segments[0] !== FOLDER || segments[1] !== ownerId) {
    // Never copy another user's private object into public storage.
    return logoUrl;
  }

  const client = getSupabaseClient();
  const { data: file, error: downloadError } = await client.storage
    .from(LEGACY_BUCKET)
    .download(path);
  if (downloadError || !file) {
    throw new Error(
      `Could not recover the saved logo from private storage: ${downloadError?.message || "file not found"}`,
    );
  }

  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (uploadError) {
    throw new Error(`Could not migrate saved logo to public logo storage: ${uploadError.message}`);
  }

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Migrated logo has no public URL");
  return data.publicUrl;
}
