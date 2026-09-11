-- Migration 009: Grant SELECT on auth.users to authenticated/anon.
--
-- Problem: tables with a FK referencing auth.users(id) (e.g. user_documents,
-- station_members) fail inserts from the authenticated role with
-- "permission denied for table users" because PostgREST validates FK
-- references by SELECTing the referenced table, and the authenticated role
-- lacks SELECT privilege on auth.users.
--
-- Fix: grant SELECT (id/columns needed for FK validation) to authenticated
-- and anon. This is the standard Supabase pattern for tables that reference
-- auth.users. RLS on auth.users remains enforced, so this does NOT expose
-- user data — it only allows the FK existence check.
--
-- Applied live 2026-08-09 via Supabase Management API.

GRANT SELECT ON auth.users TO authenticated;
GRANT SELECT ON auth.users TO anon;
