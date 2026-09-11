-- ============================================================
-- Migration 006 (APPLIED variant): Complete schema
-- Applied to live project ojsscjwatikixlpshmub on 2026-08-09.
--
-- This is 006_complete_schema.sql with two index statements removed
-- that referenced columns absent on the pre-existing live `inventory`
-- (fuel_type) and `sales` (pump_id) tables — the original FuelPro
-- schema differs from the SalesZote POS schema for those two tables.
-- CREATE TABLE IF NOT EXISTS is a no-op on the existing tables, so
-- only the index creation failed; removing those two lines lets the
-- rest of the migration (fuel_types, pumps, shifts, team_members,
-- audit_log, profiles, founder functions, triggers, etc.) apply.
--
-- Removed lines (do NOT re-add without reconciling column names):
--   CREATE INDEX IF NOT EXISTS idx_inventory_fuel_type ON inventory(fuel_type_id);
--   CREATE INDEX IF NOT EXISTS idx_sales_pump ON sales(pump_id);
-- ============================================================
-- ============================================================
-- FuelPro Complete Database Schema
-- Run this in Supabase Dashboard > SQL Editor
-- This combines all migrations into a single file
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SECTION 1: CORE STATIONS (Base Table)
-- ============================================================
CREATE TABLE IF NOT EXISTS stations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location TEXT,
  phone TEXT,
  email TEXT,
  kra_pin TEXT,
  etr_serial TEXT,
  tax_rate DECIMAL(5,2) DEFAULT 16.00,
  theme TEXT DEFAULT 'default',
  logo TEXT,
  description TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'Kenya',
  region TEXT,
  currency TEXT DEFAULT 'KES',
  currency_symbol TEXT DEFAULT 'KSh',
  timezone TEXT DEFAULT 'Africa/Nairobi',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true
);

ALTER TABLE stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own stations" ON stations;
CREATE POLICY "Users can view their own stations"
  ON stations FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert their own stations" ON stations;
CREATE POLICY "Users can insert their own stations"
  ON stations FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update their own stations" ON stations;
CREATE POLICY "Users can update their own stations"
  ON stations FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete their own stations" ON stations;
CREATE POLICY "Users can delete their own stations"
  ON stations FOR DELETE USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_stations_owner ON stations(owner_id);

-- ============================================================
-- SECTION 2: FUEL TYPES (Base Table)
-- ============================================================
CREATE TABLE IF NOT EXISTS fuel_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#374151',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

INSERT INTO fuel_types (name, code, color) VALUES
  ('Petrol', 'PETROL', '#EF4444'),
  ('Diesel', 'DIESEL', '#3B82F6'),
  ('Kerosene', 'KEROSENE', '#F59E0B'),
  ('Super', 'SUPER', '#10B981')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE fuel_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view fuel types"
  ON fuel_types FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- SECTION 3: PUMPS (references stations, fuel_types)
-- ============================================================
CREATE TABLE IF NOT EXISTS pumps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pump_number TEXT NOT NULL,
  name TEXT,
  fuel_type_id UUID REFERENCES fuel_types(id),
  price_per_liter DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(station_id, pump_number)
);

ALTER TABLE pumps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage pumps in their stations" ON pumps;
CREATE POLICY "Users can manage pumps in their stations" ON pumps FOR ALL USING (
  EXISTS (SELECT 1 FROM stations WHERE stations.id = pumps.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_pumps_station ON pumps(station_id);
CREATE INDEX IF NOT EXISTS idx_pumps_fuel_type ON pumps(fuel_type_id);

-- ============================================================
-- SECTION 4: INVENTORY (references stations, fuel_types)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type_id UUID NOT NULL REFERENCES fuel_types(id),
  tank_capacity DECIMAL(10,2) DEFAULT 10000,
  current_level DECIMAL(10,2) DEFAULT 0,
  min_level_alert DECIMAL(10,2) DEFAULT 1000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(station_id, fuel_type_id)
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage inventory in their stations" ON inventory;
CREATE POLICY "Users can manage inventory in their stations" ON inventory FOR ALL USING (
  EXISTS (SELECT 1 FROM stations WHERE stations.id = inventory.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_inventory_station ON inventory(station_id);

-- ============================================================
-- SECTION 5: SALES (references stations, pumps, fuel_types)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pump_id UUID REFERENCES pumps(id),
  fuel_type_id UUID REFERENCES fuel_types(id),
  quantity DECIMAL(10,2) NOT NULL,
  price_per_liter DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  customer_name TEXT,
  customer_phone TEXT,
  vehicle_plate TEXT,
  nozzle_reading_start DECIMAL(10,2),
  nozzle_reading_end DECIMAL(10,2),
  attendant_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage sales in their stations" ON sales;
CREATE POLICY "Users can manage sales in their stations" ON sales FOR ALL USING (
  EXISTS (SELECT 1 FROM stations WHERE stations.id = sales.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_sales_station ON sales(station_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);

-- ============================================================
-- SECTION 6: SHIFTS (references stations)
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL,
  opening_cash DECIMAL(12,2) DEFAULT 0,
  closing_cash DECIMAL(12,2) DEFAULT 0,
  opening_reading DECIMAL(10,2),
  closing_reading DECIMAL(10,2),
  attendant_name TEXT,
  attendant_phone TEXT,
  notes TEXT,
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage shifts in their stations" ON shifts;
CREATE POLICY "Users can manage shifts in their stations" ON shifts FOR ALL USING (
  EXISTS (SELECT 1 FROM stations WHERE stations.id = shifts.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_shifts_station ON shifts(station_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);

-- ============================================================
-- SECTION 7: EXPENSES (references stations)
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  expense_date TIMESTAMPTZ DEFAULT NOW(),
  payment_method TEXT DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  is_recurring BOOLEAN DEFAULT false,
  recurrence_period TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage expenses" ON expenses;
CREATE POLICY "Users can manage expenses" ON expenses FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = expenses.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_expenses_station ON expenses(station_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ============================================================
-- SECTION 8: TEAM MEMBERS (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL,
  pin TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage team in their stations" ON team_members;
CREATE POLICY "Users can manage team in their stations" ON team_members FOR ALL USING (
  EXISTS (SELECT 1 FROM stations WHERE stations.id = team_members.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_team_station ON team_members(station_id);

-- ============================================================
-- SECTION 9: CUSTOMERS (references stations)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT,
  tax_id TEXT,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  opening_balance DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their customers" ON customers;
CREATE POLICY "Users can manage their customers" ON customers FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = customers.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_customers_station ON customers(station_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ============================================================
-- SECTION 10: AUDIT LOG (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view audit in their stations" ON audit_log;
CREATE POLICY "Users can view audit in their stations" ON audit_log FOR SELECT USING (
  station_id IS NULL OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = audit_log.station_id AND stations.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON audit_log;
CREATE POLICY "Authenticated users can insert audit logs" ON audit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_station ON audit_log(station_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ============================================================
-- SECTION 11: APP KV TABLE (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_kv (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_kv_collection_idx ON app_kv (collection);
CREATE INDEX IF NOT EXISTS app_kv_owner_idx ON app_kv (owner_id);
CREATE INDEX IF NOT EXISTS app_kv_station_idx ON app_kv (station_id);

ALTER TABLE app_kv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own app_kv rows" ON app_kv;
CREATE POLICY "Users can manage their own app_kv rows" ON app_kv FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = app_kv.station_id AND stations.owner_id = auth.uid())
);

-- ============================================================
-- SECTION 12: PROFILES (references auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============================================================
-- SECTION 13: FOUNDER AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founder_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.founder_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_founder_audit_created ON public.founder_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_founder_audit_action ON public.founder_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_founder_audit_actor ON public.founder_audit_log (actor_id);

-- ============================================================
-- SECTION 14: FOUNDER SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founder_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.founder_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 15: PRODUCTS (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit TEXT DEFAULT 'pcs',
  barcode TEXT,
  cost_price DECIMAL(12,2) DEFAULT 0,
  selling_price DECIMAL(12,2) DEFAULT 0,
  reorder_level DECIMAL(10,2) DEFAULT 10,
  stock_quantity DECIMAL(10,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 16.00,
  is_active BOOLEAN DEFAULT true,
  is_taxable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their products" ON products;
CREATE POLICY "Users can manage their products" ON products FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = products.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_products_station ON products(station_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================================
-- SECTION 16: SUPPLIERS (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT,
  tax_id TEXT,
  contact_person TEXT,
  payment_terms TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their suppliers" ON suppliers;
CREATE POLICY "Users can manage their suppliers" ON suppliers FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = suppliers.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_suppliers_station ON suppliers(station_id);

-- ============================================================
-- SECTION 17: SALES ENHANCED (references stations, customers, auth.users, terminal_sessions)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_enhanced (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  invoice_number TEXT,
  sale_date TIMESTAMPTZ DEFAULT NOW(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  payment_reference TEXT,
  status TEXT DEFAULT 'completed',
  notes TEXT,
  cashier_id UUID REFERENCES auth.users(id),
  terminal_session_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE sales_enhanced ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their sales" ON sales_enhanced;
CREATE POLICY "Users can manage their sales" ON sales_enhanced FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = sales_enhanced.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_sales_enhanced_station ON sales_enhanced(station_id);
CREATE INDEX IF NOT EXISTS idx_sales_enhanced_date ON sales_enhanced(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_enhanced_customer ON sales_enhanced(customer_id);

-- ============================================================
-- SECTION 18: SALE ITEMS (references sales_enhanced, products)
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales_enhanced(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage sale items" ON sale_items;
CREATE POLICY "Users can manage sale items" ON sale_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM sales_enhanced s
    WHERE s.id = sale_items.sale_id AND s.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- ============================================================
-- SECTION 19: INVENTORY TRANSACTIONS (references stations, products, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  quantity_change DECIMAL(10,2) NOT NULL,
  previous_quantity DECIMAL(10,2),
  new_quantity DECIMAL(10,2),
  unit_cost DECIMAL(12,2),
  reference_id UUID,
  reference_type TEXT,
  notes TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage inventory transactions" ON inventory_transactions;
CREATE POLICY "Users can manage inventory transactions" ON inventory_transactions FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = inventory_transactions.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_station ON inventory_transactions(station_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_product ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(transaction_type);

-- ============================================================
-- SECTION 20: STOCK TRANSFERS (references stations, products, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  to_station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  transfer_number TEXT,
  status TEXT DEFAULT 'pending',
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity DECIMAL(10,2) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage stock transfers" ON stock_transfers;
CREATE POLICY "Users can manage stock transfers" ON stock_transfers FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = stock_transfers.from_station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_station_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_station_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);

-- ============================================================
-- SECTION 21: PURCHASE ORDERS (references stations, suppliers, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  order_number TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft',
  expected_date TIMESTAMPTZ,
  total_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage purchase orders" ON purchase_orders;
CREATE POLICY "Users can manage purchase orders" ON purchase_orders FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = purchase_orders.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_station ON purchase_orders(station_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

-- ============================================================
-- SECTION 22: PURCHASE ORDER ITEMS (references purchase_orders, products)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity_ordered DECIMAL(10,2) NOT NULL,
  quantity_received DECIMAL(10,2) DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage purchase order items" ON purchase_order_items;
CREATE POLICY "Users can manage purchase order items" ON purchase_order_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.id = purchase_order_items.purchase_order_id AND po.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_po_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items(product_id);

-- ============================================================
-- SECTION 23: EXPENSE CATEGORIES (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage expense categories" ON expense_categories;
CREATE POLICY "Users can manage expense categories" ON expense_categories FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = expense_categories.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_station ON expense_categories(station_id);

-- Insert default expense categories
INSERT INTO expense_categories (station_id, name, description, icon, color, is_system, owner_id)
SELECT 
  s.id,
  cat.name,
  cat.description,
  cat.icon,
  cat.color,
  true,
  s.owner_id
FROM stations s
CROSS JOIN (VALUES
  ('Rent', 'Office and premises rent', 'home', '#3B82F6'),
  ('Utilities', 'Electricity, water, internet', 'zap', '#F59E0B'),
  ('Salaries', 'Employee wages and salaries', 'users', '#10B981'),
  ('Supplies', 'Office and operational supplies', 'package', '#8B5CF6'),
  ('Marketing', 'Advertising and promotion', 'megaphone', '#EC4899'),
  ('Transport', 'Travel and transportation costs', 'truck', '#06B6D4'),
  ('Maintenance', 'Equipment and premises maintenance', 'wrench', '#F97316'),
  ('Insurance', 'Business and asset insurance', 'shield', '#6366F1'),
  ('Taxes', 'Tax payments and filings', 'file-text', '#EF4444'),
  ('Other', 'Miscellaneous expenses', 'more-horizontal', '#6B7280')
) AS cat(name, description, icon, color)
WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE station_id = s.id AND is_system = true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECTION 24: TERMINAL SESSIONS (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  session_number TEXT,
  opening_cash DECIMAL(12,2) DEFAULT 0,
  expected_cash DECIMAL(12,2) DEFAULT 0,
  counted_cash DECIMAL(12,2),
  variance DECIMAL(12,2),
  cash_sales DECIMAL(12,2) DEFAULT 0,
  mpesa_sales DECIMAL(12,2) DEFAULT 0,
  card_sales DECIMAL(12,2) DEFAULT 0,
  total_sales DECIMAL(12,2) DEFAULT 0,
  opening_time TIMESTAMPTZ DEFAULT NOW(),
  closing_time TIMESTAMPTZ,
  status TEXT DEFAULT 'open',
  notes TEXT,
  opened_by UUID REFERENCES auth.users(id),
  closed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage terminal sessions" ON terminal_sessions;
CREATE POLICY "Users can manage terminal sessions" ON terminal_sessions FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = terminal_sessions.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_station ON terminal_sessions(station_id);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_status ON terminal_sessions(status);

-- ============================================================
-- SECTION 25: INTEGRATIONS (references stations, auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  status TEXT DEFAULT 'disabled',
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage integrations" ON integrations;
CREATE POLICY "Users can manage integrations" ON integrations FOR ALL USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM stations WHERE stations.id = integrations.station_id AND stations.owner_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_integrations_station ON integrations(station_id);
CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(integration_type);

-- ============================================================
-- SECTION 26: HELPER FUNCTIONS
-- ============================================================

-- Function to check if user is founder/admin
CREATE OR REPLACE FUNCTION public.is_founder(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = uid AND role IN ('founder', 'admin')
  )
  OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uid);
$$;

-- Founder audit log policies
DROP POLICY IF EXISTS "founder_read_audit_log" ON public.founder_audit_log;
CREATE POLICY "founder_read_audit_log" ON public.founder_audit_log FOR SELECT TO authenticated USING (public.is_founder(auth.uid()));

DROP POLICY IF EXISTS "founder_insert_audit_log" ON public.founder_audit_log;
CREATE POLICY "founder_insert_audit_log" ON public.founder_audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Founder sessions policies
DROP POLICY IF EXISTS "founder_read_session" ON public.founder_sessions;
CREATE POLICY "founder_read_session" ON public.founder_sessions FOR SELECT TO authenticated USING (public.is_founder(auth.uid()));

DROP POLICY IF EXISTS "founder_insert_session" ON public.founder_sessions;
CREATE POLICY "founder_insert_session" ON public.founder_sessions FOR INSERT TO authenticated WITH CHECK (public.is_founder(auth.uid()));

DROP POLICY IF EXISTS "founder_update_session" ON public.founder_sessions;
CREATE POLICY "founder_update_session" ON public.founder_sessions FOR UPDATE TO authenticated USING (public.is_founder(auth.uid()));

-- Function: Write founder audit log
CREATE OR REPLACE FUNCTION public.write_founder_audit(
  p_action TEXT, p_entity_type TEXT, p_entity_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.founder_audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Function: Get or create founder session
CREATE OR REPLACE FUNCTION public.get_founder_session()
RETURNS public.founder_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE session_record public.founder_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO session_record FROM public.founder_sessions LIMIT 1;
  IF session_record IS NULL THEN INSERT INTO public.founder_sessions DEFAULT VALUES RETURNING * INTO session_record; END IF;
  RETURN session_record;
END;
$$;

-- Function: Update founder session
CREATE OR REPLACE FUNCTION public.update_founder_session(
  p_two_factor_enabled BOOLEAN DEFAULT NULL, p_two_factor_secret TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL, p_contact_phone TEXT DEFAULT NULL, p_password_hash TEXT DEFAULT NULL
)
RETURNS public.founder_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE session_record public.founder_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO session_record FROM public.founder_sessions LIMIT 1;
  IF session_record IS NULL THEN INSERT INTO public.founder_sessions DEFAULT VALUES RETURNING * INTO session_record; END IF;
  UPDATE public.founder_sessions SET
    two_factor_enabled = COALESCE(p_two_factor_enabled, two_factor_enabled),
    two_factor_secret = COALESCE(p_two_factor_secret, two_factor_secret),
    contact_email = COALESCE(p_contact_email, contact_email),
    contact_phone = COALESCE(p_contact_phone, contact_phone),
    password_hash = COALESCE(p_password_hash, password_hash),
    updated_at = NOW()
  WHERE id = session_record.id RETURNING * INTO session_record;
  RETURN session_record;
END;
$$;

-- Function: Handle new user (creates profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SECTION 27: UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 28: TRIGGERS FOR UPDATED_AT
-- ============================================================
DROP TRIGGER IF EXISTS update_stations_updated_at ON stations;
CREATE TRIGGER update_stations_updated_at BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_fuel_types_updated_at ON fuel_types;
CREATE TRIGGER update_fuel_types_updated_at BEFORE UPDATE ON fuel_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_pumps_updated_at ON pumps;
CREATE TRIGGER update_pumps_updated_at BEFORE UPDATE ON pumps FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_inventory_updated_at ON inventory;
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_sales_updated_at ON sales;
CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_shifts_updated_at ON shifts;
CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;
CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_app_kv_updated_at ON app_kv;
CREATE TRIGGER update_app_kv_updated_at BEFORE UPDATE ON app_kv FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_founder_sessions_updated_at ON public.founder_sessions;
CREATE TRIGGER update_founder_sessions_updated_at BEFORE UPDATE ON public.founder_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_sales_enhanced_updated_at ON sales_enhanced;
CREATE TRIGGER update_sales_enhanced_updated_at BEFORE UPDATE ON sales_enhanced FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_stock_transfers_updated_at ON stock_transfers;
CREATE TRIGGER update_stock_transfers_updated_at BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_expense_categories_updated_at ON expense_categories;
CREATE TRIGGER update_expense_categories_updated_at BEFORE UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_terminal_sessions_updated_at ON terminal_sessions;
CREATE TRIGGER update_terminal_sessions_updated_at BEFORE UPDATE ON terminal_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- COMPLETE SCHEMA DEPLOYED SUCCESSFULLY
-- ============================================================
-- All tables are created with proper foreign key relationships:
-- 
-- STATIONS (root) ──┬── pumps ── sales
--                  ├── inventory
--                  ├── shifts
--                  ├── expenses ── expense_categories
--                  ├── team_members
--                  ├── customers ── sales_enhanced ── sale_items
--                  ├── audit_log
--                  ├── app_kv
--                  ├── products ── sale_items
--                  ├── suppliers ── purchase_orders ── purchase_order_items
--                  ├── inventory_transactions
--                  ├── stock_transfers
--                  ├── terminal_sessions
--                  └── integrations
--
-- AUTH TABLES:
-- auth.users ── profiles
--           ├── founder_sessions
--           ├── founder_audit_log
--           └── (via owner_id) all station-scoped tables
-- ============================================================
