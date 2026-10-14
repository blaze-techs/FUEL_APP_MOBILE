-- 20261014000000_fix_lookup_station_column.sql
-- Fix the public station lookup RPC.
--
-- PROBLEM: `lookup_station(p_query)` (migration 026) selected a
-- `station_name` column that does not exist — the `stations` table's column is
-- `name`. Postgres raised 42703 on EVERY call, the client swallowed the error,
-- and the member login search always reported "No stations found by search."
-- so a team member could never find their station by name or code.
--
-- This replaces the function with the corrected column reference. It is
-- CREATE OR REPLACE, so it is idempotent and safe to replay (the preview and
-- production both re-run the migration history).
--
-- `stations` is owner-scoped by RLS, so the function stays SECURITY DEFINER
-- with a pinned search_path and returns ONLY the four non-PII fields the
-- login flow needs: stationId, ownerId, stationName, code.

create or replace function lookup_station(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text;
begin
  v_q := lower(trim(coalesce(p_query, '')));
  if v_q = '' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'stationId',   s.id,
      'ownerId',     s.owner_id,
      'stationName', s.name,
      'code',        s.code
    ) order by
      -- Exact code match first, then exact name match, then partial.
      case when lower(s.code) = v_q then 0
           when lower(s.name) = v_q then 1
           else 2 end,
      s.name
    )
    from stations s
    where lower(s.code) = v_q
       or lower(s.name) = v_q
       or lower(s.code) like '%' || v_q || '%'
       or lower(s.name) like '%' || v_q || '%'
    limit 10
  ), '[]'::jsonb);
end;
$$;

-- Anon (unauthenticated members) + authenticated users can call the lookup.
grant execute on function lookup_station(text) to anon, authenticated;
