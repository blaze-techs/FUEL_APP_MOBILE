BEGIN;
DROP FUNCTION IF EXISTS public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, bigint);
COMMIT;
