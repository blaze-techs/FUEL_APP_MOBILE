-- Record the live legacy authorities before any module is migrated.
-- These rows document current ownership; they do not copy or rewrite business data.
insert into public.data_authority_registry
  (entity_key, authoritative_store, read_model, cache_keys, notes, updated_at)
values
  (
    'quotation',
    'app_kv:quotations',
    'Quotations module',
    array['localStorage:quotations','FuelContext document caches'],
    'Current quotations are stored in station-scoped app_kv rows. Keep this source authoritative until a relational document adapter is dual-run and reconciled.',
    now()
  ),
  (
    'payroll_employee',
    'app_kv:payroll_employees',
    'Payroll employee register',
    array['localStorage payroll cache','payroll component state'],
    'Current payroll employee records use app_kv; the public team_members relational table is empty in the inspected live database and is not a safe substitute yet.',
    now()
  ),
  (
    'payroll_configuration',
    'app_kv:payroll_settings',
    'Payroll settings',
    array['localStorage payroll settings','payroll component state'],
    'Station-scoped payroll settings are the current source; do not infer payroll amounts from employee master data alone.',
    now()
  ),
  (
    'payslip_record',
    'app_kv:payroll_payslip_records',
    'Payslip history and portal',
    array['app_kv:payroll_payslip_log','app_kv:payslip_shortlink_*'],
    'Existing payslip records and logs must be preserved and reconciled before introducing a relational payroll ledger.',
    now()
  ),
  (
    'customer_credit_account',
    'app_kv:credit_accounts',
    'Credit Accounts and Customer Portal',
    array['app_kv:credit_transactions','app_kv:customer_portal_*'],
    'Current credit account/transaction records are stored in app_kv. Relational credit tables currently have no rows, so do not silently switch customer balances to them.',
    now()
  ),
  (
    'team_member',
    'app_kv:team_members',
    'Team Manager and task assignment',
    array['app_kv:team_invites','app_kv:shift_employees','public:team_members'],
    'Legacy team member records exist in app_kv while public.team_members is empty in the inspected database. Reconcile stable IDs and permissions before cutover.',
    now()
  ),
  (
    'communication_message',
    'app_kv:comm_messages',
    'Communication Hub',
    array['app_kv:comm_contacts','app_kv:comm_templates'],
    'Current message data is app_kv-backed; do not duplicate outbound messages when retrying sync or webhook delivery.',
    now()
  ),
  (
    'pos_transaction',
    'app_kv:pos_transactions',
    'POS transaction and receipt views',
    array['public:sales_enhanced','public:sales_ledger','public:payment_transactions'],
    'Legacy POS transaction data remains a separate feed. Reconcile it against sales_enhanced and confirmed payment records before merging reports.',
    now()
  )
on conflict (entity_key) do update set
  authoritative_store = excluded.authoritative_store,
  read_model = excluded.read_model,
  cache_keys = excluded.cache_keys,
  notes = excluded.notes,
  updated_at = excluded.updated_at;
