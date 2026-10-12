\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email)
VALUES ('10000000-0000-4000-8000-000000000001', 'record-link-test@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.stations (id, name, owner_id)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Record Link Test Station A', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Record Link Test Station B', '10000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
GRANT SELECT ON public.stations TO authenticated;
SET ROLE authenticated;

INSERT INTO public.record_relationships (
  station_id, source_station_id, target_station_id,
  source_record_type, source_record_id, target_record_type, target_record_id,
  relationship, idempotency_key, created_by, metadata
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'quotation', 'quote-test-1', 'invoice', 'invoice-test-1',
  'derived_from', 'quote-test-link-1',
  '10000000-0000-4000-8000-000000000001', '{}'::jsonb
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.record_relationships (
      station_id, source_station_id, target_station_id,
      source_record_type, source_record_id, target_record_type, target_record_id,
      relationship, idempotency_key, created_by
    ) VALUES (
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'quotation', 'cross-station-quote', 'invoice', 'cross-station-invoice',
      'derived_from', 'cross-station-link',
      '10000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-station relationship unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.record_relationships (
      station_id, source_station_id, target_station_id,
      source_record_type, source_record_id, target_record_type, target_record_id,
      relationship, idempotency_key, created_by
    ) VALUES (
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'quotation', 'quote-test-1', 'invoice', 'invoice-test-1',
      'derived_from', 'quote-test-link-1',
      '10000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'duplicate relationship unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.record_relationships
    SET metadata = '{"tampered":true}'::jsonb
    WHERE idempotency_key = 'quote-test-link-1';
    RAISE EXCEPTION 'relationship mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.record_relationships
    WHERE idempotency_key = 'quote-test-link-1';
    RAISE EXCEPTION 'relationship deletion unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END;
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'record_relationships'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'record_relationships RLS is not enabled';
  END IF;

  IF (SELECT count(*) FROM public.record_relationships
      WHERE idempotency_key = 'quote-test-link-1') <> 1 THEN
    RAISE EXCEPTION 'record relationship was duplicated or removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'record_relationships_one_invoice_per_quote'
  ) THEN
    RAISE EXCEPTION 'one-invoice-per-quotation guard is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'record_relationships'
      AND t.tgname = 'record_relationships_append_only'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only trigger is missing';
  END IF;
END;
$$;

SELECT 'record_relationships verification passed' AS result;
