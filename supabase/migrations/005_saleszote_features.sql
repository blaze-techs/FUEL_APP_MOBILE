-- ============================================================
-- Migration 005: SalesZote-style POS & Inventory feature set
-- Idempotent. All tables RLS-scoped to station ownership.
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- PRODUCTS ----------
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

-- ---------- CUSTOMERS ----------
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

-- ---------- SUPPLIERS ----------
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

-- ---------- SALES (header) ----------
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
CREATE INDEX IF NOT EXISTS idx_sales_station ON sales_enhanced(station_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_enhanced(created_at);

-- ---------- SALE ITEMS ----------
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

-- ---------- INVENTORY TRANSACTIONS ----------
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

-- ---------- STOCK TRANSFERS ----------
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

-- ---------- PURCHASE ORDERS ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  order_number TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  order_date TIMESTAMPTZ DEFAULT NOW(),
  expected_date TIMESTAMPTZ,
  subtotal DECIMAL(12,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
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
CREATE INDEX IF NOT EXISTS idx_po_station ON purchase_orders(station_id);

-- ---------- PURCHASE ORDER ITEMS ----------
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  quantity_received DECIMAL(10,2) DEFAULT 0,
  is_received BOOLEAN DEFAULT false,
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

-- ---------- EXPENSES ----------
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

-- ---------- EXPENSE CATEGORIES ----------
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

-- ---------- TERMINAL SESSIONS ----------
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

-- ---------- INTEGRATIONS ----------
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

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sales_updated_at ON sales_enhanced;
CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales_enhanced FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stock_transfers_updated_at ON stock_transfers;
CREATE TRIGGER update_stock_transfers_updated_at BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_terminal_sessions_updated_at ON terminal_sessions;
CREATE TRIGGER update_terminal_sessions_updated_at BEFORE UPDATE ON terminal_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
