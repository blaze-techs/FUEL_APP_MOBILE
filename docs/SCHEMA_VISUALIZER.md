# FuelPro Database Schema Visualizer

## Overview
This document shows the complete database schema for FuelPro with all table relationships visualized.

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    AUTHENTICATION LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│    ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────────────┐  │
│    │    auth.users    │────────▶│    profiles      │         │   founder_sessions       │  │
│    │──────────────────│         │──────────────────│         │──────────────────────────│  │
│    │ id (PK)          │         │ id (FK→auth)    │         │ id (PK)                  │  │
│    │ email            │         │ email            │         │ two_factor_enabled       │  │
│    │ created_at       │         │ name             │         │ two_factor_secret        │  │
│    │                  │         │ role             │         │ contact_email            │  │
│    │                  │         │ updated_at       │         │ contact_phone            │  │
│    │                  │         │                  │         │ password_hash            │  │
│    └──────────────────┘         └──────────────────┘         └──────────────────────────┘  │
│           │                            │                                                    │
│           │                            │                                                    │
│           ▼                            ▼                                                    │
│    ┌──────────────────────────────┐          ┌─────────────────────────────────────────┐ │
│    │   founder_audit_log          │          │          founder_access_policies         │ │
│    │─────────────────────────────│          │                                          │ │
│    │ id (PK)                      │          │  • is_founder(uid) → BOOLEAN            │ │
│    │ actor_id (FK→auth.users)     │          │  • write_founder_audit()                │ │
│    │ action                       │          │  • get_founder_session()                 │ │
│    │ entity_type                  │          │  • update_founder_session()               │ │
│    │ entity_id                    │          │                                          │ │
│    │ metadata (JSONB)             │          └─────────────────────────────────────────┘ │
│    │ created_at                   │                                                             │
│    └──────────────────────────────┘                                                             │
│                                                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CORE BUSINESS LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│         ┌──────────────────────────────────────────────────────────────────────────┐        │
│         │                           STATIONS (Root Entity)                           │        │
│         │───────────────────────────────────────────────────────────────────────────│        │
│         │ id (PK)              │ owner_id (FK→auth.users)  │ name (NOT NULL)       │        │
│         │ location             │ phone                     │ email                 │        │
│         │ kra_pin              │ etr_serial               │ tax_rate              │        │
│         │ theme                │ logo                      │ description           │        │
│         │ address              │ city                      │ country               │        │
│         │ region               │ currency                  │ currency_symbol       │        │
│         │ timezone             │ is_active                 │ created_at            │        │
│         │ updated_at           │                           │                       │        │
│         └──────────────────────────────────────────────────────────────────────────┘        │
│                                    │                                                      │
│           ┌────────────────────────┼────────────────────────────────────┐                     │
│           │                        │                                    │                      │
│           ▼                        ▼                                    ▼                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────────────┐       │
│  │   FUEL_TYPES    │    │     PUMPS       │    │           INVENTORY                 │       │
│  │─────────────────│    │─────────────────│    │─────────────────────────────────────│       │
│  │ id (PK)         │◀───│ station_id (FK) │    │ station_id (FK) ──────────────────┼───────┤
│  │ name            │    │ id (PK)         │    │ fuel_type_id (FK) ────────────────▶│       │
│  │ code            │    │ pump_number     │    │ id (PK)                              │       │
│  │ color           │    │ name            │    │ tank_capacity                        │       │
│  │ is_active       │    │ fuel_type_id(FK)│    │ current_level                        │       │
│  │ created_at      │    │ price_per_liter │    │ min_level_alert                      │       │
│  │ updated_at      │    │ is_active       │    │ created_at                           │       │
│  └─────────────────┘    │ created_at      │    │ updated_at                           │       │
│                          │ updated_at      │    └─────────────────────────────────────┘       │
│                          └─────────────────┘                                                        │
│                                 │                                                                    │
│                                 │         ┌─────────────────────────────────────┐                   │
│                                 └────────▶│            SALES                   │                   │
│                                          │─────────────────────────────────────│                   │
│                                          │ id (PK)                              │                   │
│                                          │ station_id (FK) ◀────────────────────┼───────────────────┤
│                                          │ pump_id (FK) ◀──────────────────────┘                   │
│                                          │ fuel_type_id (FK) ◀─────────────────┐                     │
│                                          │ quantity                              │                     │
│                                          │ price_per_liter                      │                     │
│                                          │ total_amount                         │                     │
│                                          │ payment_method                       │                     │
│                                          │ customer_name                        │                     │
│                                          │ customer_phone                       │                     │
│                                          │ vehicle_plate                        │                     │
│                                          │ nozzle_reading_start                 │                     │
│                                          │ nozzle_reading_end                   │                     │
│                                          │ attendant_name                        │                     │
│                                          │ notes                                 │                     │
│                                          │ created_at                            │                     │
│                                          └──────────────────────────────────────┘                    │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SALESZOTE MODULE LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐      │
│  │                              PRODUCTS                                                │      │
│  │─────────────────────────────────────────────────────────────────────────────────────│      │
│  │ id (PK)              │ station_id (FK) ◀──────────────────────────────┐             │      │
│  │ sku                  │ name (NOT NULL)                                │             │      │
│  │ description          │ category                                       │             │      │
│  │ unit                 │ barcode                                        │             │      │
│  │ cost_price           │ selling_price                                  │             │      │
│  │ reorder_level        │ stock_quantity                                 │             │      │
│  │ tax_rate             │ is_active │ is_taxable                        │             │      │
│  │ created_at           │ updated_at                                     │             │      │
│  │ owner_id (FK→auth)   │                                                    │             │      │
│  └────────────────────────────────────────────────────────────────────────────┘             │
│                                         ▲                                                    │
│                    ┌────────────────────┴────────────────────┐                               │
│                    │                                         │                                 │
│  ┌─────────────────┴──────────────────┐     ┌─────────────────┴──────────────────┐           │
│  │         SALE_ITEMS                │     │  PURCHASE_ORDER_ITEMS             │           │
│  │───────────────────────────────────│     │──────────────────────────────────│           │
│  │ id (PK)                           │     │ id (PK)                           │           │
│  │ sale_id (FK) ◀────────────────────┴─────│ purchase_order_id (FK) ◀─────────┘           │
│  │ product_id (FK) ◀───────────────────────┘  │ product_id (FK) ◀──────────────────────┐    │
│  │ product_name                           │  │ product_name                            │    │
│  │ quantity                               │  │ quantity_ordered                         │    │
│  │ unit_price                             │  │ quantity_received                       │    │
│  │ discount_percent                       │  │ unit_cost                               │    │
│  │ tax_amount                             │  │ total_amount                            │    │
│  │ total_amount                           │  │ created_at                              │    │
│  │ created_at                             │  │                                         │    │
│  └───────────────────────────────────────┘  └────────────────────────────────────────┘    │
│                                              ▲                                                 │
│                          ┌───────────────────┴───────────────────┐                              │
│                          │                                       │                              │
│  ┌───────────────────────┴───────────────────────┐    ┌────────┴───────────────────────┐    │
│  │              PURCHASE_ORDERS                  │    │           SUPPLIERS              │    │
│  │───────────────────────────────────────────────│    │─────────────────────────────────│    │
│  │ id (PK)                                      │    │ id (PK)                          │    │
│  │ station_id (FK) ◀─────────────────────────────┼────│ station_id (FK) ◀────────────────┘    │
│  │ supplier_id (FK) ◀───────────────────────────┘    │ name (NOT NULL)                     │    │
│  │ order_number                                  │    │ email │ phone │ address           │    │
│  │ status                                        │    │ city │ postal_code │ country       │    │
│  │ expected_date                                 │    │ tax_id │ contact_person       │    │
│  │ total_amount                                  │    │ payment_terms │ notes          │    │
│  │ notes                                         │    │ is_active                            │    │
│  │ created_by (FK→auth) │ approved_by (FK→auth) │    │ created_at │ updated_at          │    │
│  │ created_at │ updated_at                       │    │ owner_id (FK→auth)                  │    │
│  │ owner_id (FK→auth)                           │    └───────────────────────────────────┘    │
│  └───────────────────────────────────────────────┘                                             │
│                                                                                                │
│  ┌───────────────────────────────────────┐    ┌───────────────────────────────────────────┐  │
│  │          CUSTOMERS                     │    │           SALES_ENHANCED                  │  │
│  │───────────────────────────────────────│    │───────────────────────────────────────────│  │
│  │ id (PK)                               │    │ id (PK)                                   │  │
│  │ station_id (FK) ◀─────────────────────┼────│ station_id (FK) ◀─────────────────────────┘  │
│  │ name (NOT NULL)                       │    │ invoice_number                            │  │
│  │ email │ phone │ address              │    │ sale_date │ customer_id (FK) ◀────────────┘  │
│  │ city │ postal_code │ country │ tax_id │    │ subtotal │ tax_amount │ discount_amount   │  │
│  │ credit_limit │ opening_balance        │    │ total_amount (NOT NULL)                   │  │
│  │ notes │ is_active                     │    │ payment_method │ payment_reference        │  │
│  │ created_at │ updated_at               │    │ status │ cashier_id (FK→auth)              │  │
│  │ owner_id (FK→auth)                    │    │ terminal_session_id (FK)                 │  │
│  └───────────────────────────────────────┘    │ created_at │ updated_at                     │  │
│                                                │ owner_id (FK→auth)                        │  │
│                                                └───────────────────────────────────────────┘  │
│                                                                                                │
│  ┌───────────────────────────────────────┐    ┌───────────────────────────────────────────┐  │
│  │       INVENTORY_TRANSACTIONS          │    │         STOCK_TRANSFERS                    │  │
│  │───────────────────────────────────────│    │───────────────────────────────────────────│  │
│  │ id (PK)                               │    │ id (PK)                                   │  │
│  │ station_id (FK) ◀─────────────────────┼────│ from_station_id (FK) ◀────────────────────┤  │
│  │ product_id (FK) ◀─────────────────────┘    │ to_station_id (FK) ◀──────────────────────┤  │
│  │ transaction_type                        │    │ transfer_number                           │  │
│  │ quantity_change                          │    │ status                                    │  │
│  │ previous_quantity │ new_quantity        │    │ product_id (FK)                           │  │
│  │ unit_cost                               │    │ quantity                                  │  │
│  │ reference_id │ reference_type           │    │ notes                                     │  │
│  │ notes │ performed_by (FK→auth)          │    │ created_by (FK→auth) │ created_at         │  │
│  │ created_at │ owner_id (FK→auth)         │    │ updated_at │ owner_id (FK→auth)           │  │
│  └───────────────────────────────────────┘    └───────────────────────────────────────────┘  │
│                                                                                                │
│  ┌───────────────────────────────────────┐    ┌───────────────────────────────────────────┐  │
│  │         TERMINAL_SESSIONS               │    │           INTEGRATIONS                    │  │
│  │───────────────────────────────────────│    │───────────────────────────────────────────│  │
│  │ id (PK)                               │    │ id (PK)                                   │  │
│  │ station_id (FK) ◀─────────────────────┼────│ station_id (FK) ◀─────────────────────────┘  │
│  │ session_number                         │    │ integration_type (NOT NULL)               │  │
│  │ opening_cash │ expected_cash           │    │ name (NOT NULL)                           │  │
│  │ counted_cash │ variance                │    │ credentials (JSONB)                       │  │
│  │ cash_sales │ mpesa_sales │ card_sales  │    │ settings (JSONB)                          │  │
│  │ total_sales                             │    │ status                                    │  │
│  │ opening_time │ closing_time            │    │ last_sync                                 │  │
│  │ status                                │    │ created_at │ updated_at                   │  │
│  │ opened_by (FK→auth) │ closed_by (FK→auth)│  │ owner_id (FK→auth)                       │  │
│  │ created_at │ updated_at               │    └───────────────────────────────────────────┘  │
│  │ owner_id (FK→auth)                    │                                                       │
│  └───────────────────────────────────────┘                                                       │
│                                                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     SUPPORT LAYER                                              │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │     SHIFTS      │    │   EXPENSES      │    │ EXPENSE_CATEGORIES │  │  TEAM_MEMBERS  │   │
│  │─────────────────│    │─────────────────│    │─────────────────────│  │─────────────────│   │
│  │ id (PK)         │    │ id (PK)         │    │ id (PK)              │  │ id (PK)         │   │
│  │ station_id (FK) │    │ station_id (FK) │    │ station_id (FK)      │  │ station_id (FK) │   │
│  │ shift_date      │    │ category        │    │ name (NOT NULL)      │  │ user_id (FK)    │   │
│  │ shift_type      │    │ description     │    │ description          │  │ name            │   │
│  │ opening_cash    │    │ amount          │    │ icon │ color          │  │ email           │   │
│  │ closing_cash     │    │ expense_date    │    │ is_system            │  │ phone           │   │
│  │ attendant_name  │    │ payment_method  │    │ created_at           │  │ role            │   │
│  │ status          │    │ is_recurring     │    └─────────────────────-┘  │ pin             │   │
│  │ opened_at       │    │ created_by (FK) │                                   │ is_active       │   │
│  │ closed_at       │    │ owner_id (FK)   │                                   │ created_at      │   │
│  └─────────────────┘    └─────────────────┘                                   └─────────────────┘   │
│                                 │                                                              │
│                                 ▼                                                              │
│                         ┌───────────────────────────────────────┐                               │
│                         │              APP_KV                   │                               │
│                         │───────────────────────────────────────│                               │
│                         │ id (PK, TEXT)                         │                               │
│                         │ collection (NOT NULL)                  │                               │
│                         │ owner_id (FK→auth.users)              │                               │
│                         │ station_id (FK→stations)              │                               │
│                         │ data (JSONB)                           │                               │
│                         │ created_at │ updated_at                │                               │
│                         └───────────────────────────────────────┘                               │
│                                                                                                │
│  ┌───────────────────────────────────────┐                                                    │
│  │             AUDIT_LOG                  │                                                    │
│  │───────────────────────────────────────│                                                    │
│  │ id (PK)                               │                                                    │
│  │ station_id (FK→stations)             │                                                    │
│  │ user_id (FK→auth.users)              │                                                    │
│  │ action (NOT NULL)                     │                                                    │
│  │ entity_type │ entity_id               │                                                    │
│  │ old_values (JSONB)                    │                                                    │
│  │ new_values (JSONB)                    │                                                    │
│  │ ip_address │ user_agent              │                                                    │
│  │ created_at                           │                                                    │
│  └───────────────────────────────────────┘                                                    │
│                                                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Table Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| **stations** | Root business entity | owner_id → auth.users |
| **fuel_types** | Fuel product types | (independent) |
| **pumps** | Fuel dispensers | station_id → stations, fuel_type_id → fuel_types |
| **inventory** | Tank inventory levels | station_id → stations, fuel_type_id → fuel_types |
| **sales** | Legacy fuel sales | station_id → stations, pump_id → pumps, fuel_type_id → fuel_types |
| **shifts** | Work shift tracking | station_id → stations |
| **expenses** | Business expenses | station_id → stations, owner_id → auth.users |
| **expense_categories** | Expense classification | station_id → stations, owner_id → auth.users |
| **team_members** | Staff management | station_id → stations, user_id → auth.users |
| **customers** | Customer database | station_id → stations, owner_id → auth.users |
| **products** | POS product catalog | station_id → stations, owner_id → auth.users |
| **suppliers** | Vendor management | station_id → stations, owner_id → auth.users |
| **sales_enhanced** | Enhanced POS sales | station_id → stations, customer_id → customers, owner_id → auth.users |
| **sale_items** | POS line items | sale_id → sales_enhanced, product_id → products |
| **purchase_orders** | PO management | station_id → stations, supplier_id → suppliers, owner_id → auth.users |
| **purchase_order_items** | PO line items | purchase_order_id → purchase_orders, product_id → products |
| **inventory_transactions** | Stock movement log | station_id → stations, product_id → products, owner_id → auth.users |
| **stock_transfers** | Inter-station transfers | from_station_id → stations, to_station_id → stations, owner_id → auth.users |
| **terminal_sessions** | POS session tracking | station_id → stations, owner_id → auth.users |
| **integrations** | External integrations | station_id → stations, owner_id → auth.users |
| **app_kv** | Key-value store | owner_id → auth.users, station_id → stations |
| **audit_log** | System audit trail | station_id → stations, user_id → auth.users |
| **profiles** | User profiles | id → auth.users |
| **founder_audit_log** | Founder access audit | actor_id → auth.users |
| **founder_sessions** | Founder security | (independent) |

## Indexes

All tables have appropriate indexes for performance:

### stations
- `idx_stations_owner` ON (owner_id)

### products
- `idx_products_station` ON (station_id)
- `idx_products_sku` ON (sku)
- `idx_products_category` ON (category)

### customers
- `idx_customers_station` ON (station_id)
- `idx_customers_phone` ON (phone)

### suppliers
- `idx_suppliers_station` ON (station_id)

### sales_enhanced
- `idx_sales_enhanced_station` ON (station_id)
- `idx_sales_enhanced_date` ON (created_at)
- `idx_sales_enhanced_customer` ON (customer_id)

### sale_items
- `idx_sale_items_sale` ON (sale_id)
- `idx_sale_items_product` ON (product_id)

### inventory_transactions
- `idx_inv_tx_station` ON (station_id)
- `idx_inv_tx_product` ON (product_id)
- `idx_inv_tx_type` ON (transaction_type)

### stock_transfers
- `idx_stock_transfers_from` ON (from_station_id)
- `idx_stock_transfers_to` ON (to_station_id)
- `idx_stock_transfers_status` ON (status)

### purchase_orders
- `idx_purchase_orders_station` ON (station_id)
- `idx_purchase_orders_supplier` ON (supplier_id)
- `idx_purchase_orders_status` ON (status)

### purchase_order_items
- `idx_po_items_order` ON (purchase_order_id)
- `idx_po_items_product` ON (product_id)

### expenses
- `idx_expenses_station` ON (station_id)
- `idx_expenses_category` ON (category)
- `idx_expenses_date` ON (expense_date)

### expense_categories
- `idx_expense_categories_station` ON (station_id)

### terminal_sessions
- `idx_terminal_sessions_station` ON (station_id)
- `idx_terminal_sessions_status` ON (status)

### integrations
- `idx_integrations_station` ON (station_id)
- `idx_integrations_type` ON (integration_type)

### app_kv
- `app_kv_collection_idx` ON (collection)
- `app_kv_owner_idx` ON (owner_id)
- `app_kv_station_idx` ON (station_id)

### audit_log
- `idx_audit_station` ON (station_id)
- `idx_audit_user` ON (user_id)
- `idx_audit_created` ON (created_at)

### founder_audit_log
- `idx_founder_audit_created` ON (created_at DESC)
- `idx_founder_audit_action` ON (action)
- `idx_founder_audit_actor` ON (actor_id)

## Row Level Security (RLS)

All tables have RLS enabled with the following patterns:

### Station-scoped tables
Access is granted when:
```sql
owner_id = auth.uid() 
OR EXISTS (
  SELECT 1 FROM stations 
  WHERE stations.id = table.station_id 
  AND stations.owner_id = auth.uid()
)
```

### Public tables (profiles, founder_audit_log)
Access based on role:
```sql
public.is_founder(auth.uid()) = true
```

### Insert policies
Most tables allow INSERT when:
```sql
auth.uid() IS NOT NULL
```

## Triggers

All tables have `updated_at` triggers that automatically set the timestamp on UPDATE operations.

## Functions

### public.is_founder(uid UUID)
Returns TRUE if user has founder or admin role.

### public.write_founder_audit()
Writes an entry to the founder_audit_log.

### public.get_founder_session()
Gets or creates a founder session record.

### public.update_founder_session()
Updates founder session with provided values.

### public.handle_new_user()
Automatically creates a profile when a new auth user is created.

### update_updated_at()
Generic trigger function for updated_at columns.

## Running the Schema

To deploy this schema to your Supabase project:

1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `supabase/migrations/006_complete_schema.sql`
3. Click "Run" to execute

The schema is idempotent - all tables use `IF NOT EXISTS` and policies use `DROP POLICY IF EXISTS` to ensure safe re-runs.
