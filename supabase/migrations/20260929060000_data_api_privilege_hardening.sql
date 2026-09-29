-- Harden Supabase Data API defaults and retire an unused privileged RPC.
-- Existing required client access is granted explicitly by prior migrations.

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;

revoke execute on function public.bump_fuel_query_count(text,text) from public, anon, authenticated;
