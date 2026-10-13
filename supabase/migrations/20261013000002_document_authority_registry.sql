-- Manual invoices and POS receipts currently have distinct sources.
insert into public.data_authority_registry
  (entity_key, authoritative_store, read_model, cache_keys, notes, updated_at)
values
  (
    'manual_invoice',
    'app_kv:FuelContext_compact.invoices',
    'Invoice builder / Saved Invoices',
    array['FuelContext.state.invoices','localStorage read-through cache'],
    'Manually generated invoices are saved in the FuelContext compact payload. They are distinct from POS sales in sales_enhanced. Keep the compact payload authoritative until a relational invoice adapter is backfilled and reconciled.',
    now()
  ),
  (
    'pos_receipt_document',
    'public.sales_enhanced',
    'SalesInvoices receipt PDF',
    array['app_kv:pos_transactions'],
    'POS receipt PDFs are generated from sales_enhanced rows. app_kv pos_transactions is a separate legacy feed and must only be used under the existing documented read-failure policy, not merged when the relational query succeeds.',
    now()
  )
on conflict (entity_key) do update set
  authoritative_store = excluded.authoritative_store,
  read_model = excluded.read_model,
  cache_keys = excluded.cache_keys,
  notes = excluded.notes,
  updated_at = excluded.updated_at;
