-- 20260922131000_company_qr_max_uses_default.sql
alter table public.company_grants
  alter column max_uses set default 1;
