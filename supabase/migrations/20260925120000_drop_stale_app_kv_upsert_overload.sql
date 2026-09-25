-- Drop the superseded TEXT overload of upsert_app_kv_versioned.
--
-- Why this exists: `app_kv.station_id` is UUID, but the function was first
-- created (020, re-applied by 20260920041339, then 041) with
-- `p_station_id text`. 043 correctly recreated it as `p_station_id uuid`, but
-- CREATE OR REPLACE only replaces a function with an IDENTICAL argument list —
-- a different type is a NEW function. Both then existed, and because they
-- differ only in one argument type, PostgREST could not pick a candidate:
--
--   PGRST203: Could not choose the best candidate function between
--   upsert_app_kv_versioned(... p_station_id => text ...) and
--   upsert_app_kv_versioned(... p_station_id => uuid ...)
--
-- The client sends p_station_id as a JSON string, so the call matched neither
-- overload unambiguously and EVERY app_kv write failed. Because
-- cloud_storage_service.set() treats an RPC error as a sync-safety failure and
-- queues rather than falling back, the whole cloud-sync path went dark while
-- the UI still looked healthy — writes simply never landed.
--
-- The UUID signature is the correct one; the TEXT signature is the leftover.
-- Dropping it is what makes the surviving function resolvable again. Applied
-- live on 2026-09-25; this migration makes a fresh provisioning converge.
drop function if exists public.upsert_app_kv_versioned(
  text, uuid, text, text, jsonb, bigint
);

-- The exact signature must be granted: `GRANT ... ON FUNCTION f()` resolves by
-- argument types, so an argument-less form would target a different (or
-- non-existent) overload and silently leave the RPC unexecutable.
revoke all on function public.upsert_app_kv_versioned(
  text, uuid, uuid, text, jsonb, bigint
) from public;
grant execute on function public.upsert_app_kv_versioned(
  text, uuid, uuid, text, jsonb, bigint
) to authenticated;
