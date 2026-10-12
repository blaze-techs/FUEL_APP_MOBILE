-- Unified cross-module record relationships. Additive migration: does not rewrite
-- existing operational records or redirect reports to currently-empty ledgers.
create table if not exists public.record_relationships (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete restrict,
  source_station_id uuid not null references public.stations(id) on delete restrict,
  target_station_id uuid not null references public.stations(id) on delete restrict,
  source_record_type text not null check (source_record_type in (
    'station','customer','supplier','employee','task','attendance','payroll','payslip',
    'quotation','invoice','receipt','payment','customer_statement','sale','expense',
    'purchase_order','delivery','inventory_movement','shift','meter_reading',
    'accounting_entry','document','message'
  )),
  source_record_id text not null check (length(trim(source_record_id)) > 0),
  target_record_type text not null check (target_record_type in (
    'station','customer','supplier','employee','task','attendance','payroll','payslip',
    'quotation','invoice','receipt','payment','customer_statement','sale','expense',
    'purchase_order','delivery','inventory_movement','shift','meter_reading',
    'accounting_entry','document','message'
  )),
  target_record_id text not null check (length(trim(target_record_id)) > 0),
  relationship text not null check (relationship in (
    'derived_from','references','settles','issued_to','assigned_to','supports','reverses','supersedes'
  )),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint record_relationships_same_station check (
    station_id = source_station_id and station_id = target_station_id
  ),
  constraint record_relationships_not_self check (
    not (source_record_type = target_record_type and source_record_id = target_record_id)
  ),
  constraint record_relationships_idempotency unique (station_id, idempotency_key),
  constraint record_relationships_natural_unique unique (
    station_id, source_record_type, source_record_id,
    target_record_type, target_record_id, relationship
  )
);

create index if not exists record_relationships_source_idx
  on public.record_relationships(station_id, source_record_type, source_record_id, created_at desc);
create index if not exists record_relationships_target_idx
  on public.record_relationships(station_id, target_record_type, target_record_id, created_at desc);

alter table public.record_relationships enable row level security;

drop policy if exists record_relationships_read on public.record_relationships;
create policy record_relationships_read on public.record_relationships
  for select to authenticated
  using (public.fuelpro_user_role(station_id) is not null);

drop policy if exists record_relationships_insert on public.record_relationships;
create policy record_relationships_insert on public.record_relationships
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.fuelpro_has_permission(station_id, 'station.write')
  );

-- Relationship rows are append-only. Corrections are represented as new
-- 'reverses' or 'supersedes' relationships, preserving the audit trail.
revoke update, delete on public.record_relationships from anon, authenticated;
grant select, insert on public.record_relationships to authenticated;

comment on table public.record_relationships is
  'Append-only, station-scoped links between existing FuelPro records; not a replacement source of truth for linked entities.';

-- Enforce append-only history even if a future grant is accidentally widened.
create or replace function public.reject_record_relationship_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'record_relationships is append-only; create a reversal or superseding relationship instead'
    using errcode = '55000';
end;
$$;

drop trigger if exists record_relationships_append_only on public.record_relationships;
create trigger record_relationships_append_only
  before update or delete on public.record_relationships
  for each row execute function public.reject_record_relationship_mutation();

revoke all on function public.reject_record_relationship_mutation() from public, anon, authenticated;
