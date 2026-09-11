-- ============================================================
-- FuelPro Database Schema for Supabase
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- STATIONS TABLE
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

CREATE POLICY "Users can view their own stations"
  ON stations FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own stations"
  ON stations FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own stations"
  ON stations FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own stations"
  ON stations FOR DELETE USING (auth.uid() = owner_id);

-- ============================================================
-- FUEL TYPES TABLE
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
-- PUMPS TABLE
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

CREATE POLICY "Users can manage pumps in their stations"
  ON pumps FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = pumps.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- INVENTORY TABLE
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

CREATE POLICY "Users can manage inventory in their stations"
  ON inventory FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = inventory.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- SALES TABLE
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

CREATE POLICY "Users can manage sales in their stations"
  ON sales FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = sales.station_id AND stations.owner_id = auth.uid())
  );

CREATE INDEX idx_sales_station ON sales(station_id);
CREATE INDEX idx_sales_date ON sales(created_at);

-- ============================================================
-- SHIFTS TABLE
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

CREATE POLICY "Users can manage shifts in their stations"
  ON shifts FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = shifts.station_id AND stations.owner_id = auth.uid())
  );

CREATE INDEX idx_shifts_station ON shifts(station_id);
CREATE INDEX idx_shifts_date ON shifts(shift_date);

-- ============================================================
-- EXPENSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  receipt_number TEXT,
  vendor TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage expenses in their stations"
  ON expenses FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = expenses.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- TEAM MEMBERS TABLE
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

CREATE POLICY "Users can manage team in their stations"
  ON team_members FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = team_members.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  current_balance DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage customers in their stations"
  ON customers FOR ALL USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = customers.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- AUDIT LOG TABLE
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

CREATE POLICY "Users can view audit in their stations"
  ON audit_log FOR SELECT USING (
    station_id IS NULL OR
    EXISTS (SELECT 1 FROM stations WHERE stations.id = audit_log.station_id AND stations.owner_id = auth.uid())
  );

CREATE POLICY "Authenticated users can insert audit logs"
  ON audit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- APP KV TABLE (generic store for secrets / feature_flags / config / sales_analytics)
-- Used by src/react-app/lib/restApiSync.ts for collections that don't
-- have a dedicated table of their own.
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

ALTER TABLE app_kv ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own app_kv rows"
  ON app_kv FOR ALL USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM stations WHERE stations.id = app_kv.station_id AND stations.owner_id = auth.uid())
  );

-- ============================================================
-- TRIGGER: Update timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stations_updated_at BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_fuel_types_updated_at BEFORE UPDATE ON fuel_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_pumps_updated_at BEFORE UPDATE ON pumps FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_app_kv_updated_at BEFORE UPDATE ON app_kv FOR EACH ROW EXECUTE FUNCTION update_updated_at();
