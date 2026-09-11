-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    union_id TEXT UNIQUE,
    name TEXT,
    email TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    user_status TEXT DEFAULT 'active' CHECK (user_status IN ('active', 'suspended', 'banned', 'pending')),
    country_code VARCHAR(2),
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_sign_in_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Trigger for new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Stations table
CREATE TABLE IF NOT EXISTS public.stations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    location TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    country TEXT,
    country_code VARCHAR(2),
    phone VARCHAR(50),
    manager_name TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    receipt_footer TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stations" ON public.stations FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "Users can create stations" ON public.stations FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "Users can update own stations" ON public.stations FOR UPDATE USING (created_by = auth.uid());

-- Station users table
CREATE TABLE IF NOT EXISTS public.station_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'viewer' CHECK (role IN ('owner', 'manager', 'cashier', 'viewer')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(station_id, user_id)
);

ALTER TABLE public.station_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view station users" ON public.station_users FOR SELECT USING (user_id = auth.uid());

-- Inventory table
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
    fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'premium', 'kerosene', 'lpg')),
    current_stock DECIMAL(12, 2) DEFAULT 0,
    capacity DECIMAL(12, 2) DEFAULT 0,
    price_per_liter DECIMAL(10, 2) DEFAULT 0,
    cost_per_liter DECIMAL(10, 2) DEFAULT 0,
    supplier_name TEXT,
    last_restocked_at TIMESTAMP WITH TIME ZONE,
    alert_threshold DECIMAL(12, 2) DEFAULT 500,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inventory" ON public.inventory FOR SELECT USING (EXISTS (SELECT 1 FROM public.station_users WHERE station_id = inventory.station_id AND user_id = auth.uid() AND is_active = true));

-- Sales table
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id),
    fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'premium', 'kerosene', 'lpg')),
    quantity_liters DECIMAL(12, 2) NOT NULL,
    price_per_liter DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL,
    tax_amount DECIMAL(12, 2) DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(100) NOT NULL,
    pump_number VARCHAR(20),
    receipt_number VARCHAR(50),
    notes TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sales" ON public.sales FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.station_users WHERE station_id = sales.station_id AND user_id = auth.uid() AND is_active = true));
CREATE POLICY "Users can insert sales" ON public.sales FOR INSERT WITH CHECK (user_id = auth.uid());

-- Audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id),
    station_id UUID REFERENCES public.stations(id),
    event TEXT NOT NULL,
    detail TEXT,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'danger')),
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- Health check table
CREATE TABLE IF NOT EXISTS public._health (
    id TEXT PRIMARY KEY DEFAULT '_check',
    status TEXT DEFAULT 'ok',
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public._health (id, status) VALUES ('_check', 'ok') ON CONFLICT DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_station_users_station_id ON public.station_users(station_id);
CREATE INDEX IF NOT EXISTS idx_station_users_user_id ON public.station_users(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_station_id ON public.inventory(station_id);
CREATE INDEX IF NOT EXISTS idx_sales_station_id ON public.sales(station_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at);

SELECT '✅ FuelPro Database Schema Created Successfully!' as status;
