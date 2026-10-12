import { getSupabaseClient } from "@/supabase/client";
import { emit } from "@/react-app/lib/automation-engine";
import {
  normalizeRecordLink,
  validateRecordLink,
  type LinkDraft,
  type RecordLink,
  type FuelProRecordType,
  type RecordRelationship,
} from "@/react-app/lib/record-interlink";

interface StoredRecordLink {
  id: string;
  station_id: string;
  source_station_id: string;
  target_station_id: string;
  source_record_type: FuelProRecordType;
  source_record_id: string;
  target_record_type: FuelProRecordType;
  target_record_id: string;
  relationship: RecordRelationship;
  idempotency_key: string;
  created_by: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
}

function fromStored(row: StoredRecordLink): RecordLink {
  return {
    id: row.id,
    stationId: row.station_id,
    from: {
      type: row.source_record_type,
      id: row.source_record_id,
      stationId: row.source_station_id,
    },
    to: {
      type: row.target_record_type,
      id: row.target_record_id,
      stationId: row.target_station_id,
    },
    relationship: row.relationship,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

/**
 * Persist a cross-module relationship after the authoritative source write
 * succeeds. DB uniqueness makes network retries safe. A conflicting reuse of
 * an idempotency key is returned as an error rather than silently relinked.
 */
export async function createRecordRelationship(draft: LinkDraft): Promise<RecordLink> {
  validateRecordLink(draft);
  const normalized = normalizeRecordLink(draft);
  const supabase = getSupabaseClient();
  const payload = {
    station_id: normalized.stationId,
    source_station_id: normalized.from.stationId,
    target_station_id: normalized.to.stationId,
    source_record_type: normalized.from.type,
    source_record_id: normalized.from.id,
    target_record_type: normalized.to.type,
    target_record_id: normalized.to.id,
    relationship: normalized.relationship,
    idempotency_key: normalized.idempotencyKey,
    created_by: normalized.createdBy,
    metadata: normalized.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("record_relationships")
    .upsert(payload, { onConflict: "station_id,idempotency_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    const created = fromStored(data as StoredRecordLink);
    emit({
      type: "record:linked",
      stationId: created.stationId,
      fromType: created.from.type,
      fromId: created.from.id,
      toType: created.to.type,
      toId: created.to.id,
      relationship: created.relationship,
      idempotencyKey: created.idempotencyKey,
    });
    return created;
  }

  const { data: existing, error: readError } = await supabase
    .from("record_relationships")
    .select("*")
    .eq("station_id", normalized.stationId)
    .eq("idempotency_key", normalized.idempotencyKey)
    .maybeSingle();

  if (readError) throw readError;
  if (!existing) throw new Error("Relationship write was not confirmed by the database.");
  const link = fromStored(existing as StoredRecordLink);
  if (
    link.from.type !== normalized.from.type ||
    link.from.id !== normalized.from.id ||
    link.to.type !== normalized.to.type ||
    link.to.id !== normalized.to.id ||
    link.relationship !== normalized.relationship
  ) {
    throw new Error("Idempotency key already belongs to a different record relationship.");
  }
  return link;
}

export async function listRecordRelationships(
  stationId: string,
  record: { type: FuelProRecordType; id: string },
): Promise<RecordLink[]> {
  if (!stationId.trim() || !record.id.trim()) {
    throw new Error("Station and record ID are required.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("record_relationships")
    .select("*")
    .eq("station_id", stationId)
    .or(
      `and(source_record_type.eq.${record.type},source_record_id.eq.${record.id}),and(target_record_type.eq.${record.type},target_record_id.eq.${record.id})`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => fromStored(row as StoredRecordLink));
}
