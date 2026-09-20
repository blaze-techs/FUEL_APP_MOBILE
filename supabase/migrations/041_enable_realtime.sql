-- Migration 011: Enable Supabase Realtime on app_kv and stations tables.
--
-- This enables postgres_changes events (INSERT/UPDATE/DELETE) to be broadcast
-- via Supabase's real-time websocket layer. The client subscribes via
-- `supabase.channel().on('postgres_changes', ...)` and receives changes
-- INSTANTLY when any device writes to these tables — no polling, no delay.
--
-- Applied live 2026-08-09 via Management API. This migration documents it.
-- The app_kv table already has: station_id column, owner_id, updated_at trigger.
-- The stations table already has: owner_id, updated_at trigger.

-- Add both tables to the supabase_realtime publication.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='app_kv') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.app_kv';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='stations') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.stations';
  END IF;
END $$;
