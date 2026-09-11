# Supabase Setup Guide for FuelPro

## Complete Setup Instructions

This guide provides step-by-step instructions for setting up Supabase as the backend for the FuelPro application.

---

## Step 1: Create Supabase Project

### 1.1 Sign Up for Supabase
1. Go to https://supabase.com
2. Click "Start your project"
3. Sign up with GitHub or email
4. Create a new organization (or use existing)

### 1.2 Create New Project
1. Click "New Project"
2. Enter project details:
   - **Name**: `fuel-pro`
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to your users (e.g., Singapore for Africa)
   - **Pricing**: Free tier is sufficient to start

### 1.3 Wait for Project Setup
- Takes about 2-3 minutes
- You'll receive email when ready

---

## Step 2: Get API Credentials

### 2.1 Navigate to Settings
1. In your project dashboard, click **Settings** (gear icon)
2. Click **API** in the sidebar

### 2.2 Copy Credentials
You'll see three important values:

```
Project URL: https://xxxxx.supabase.co
anon/public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**For Frontend (Vite/React):**
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon/public key

**For Backend/Admin:**
- Keep service_role key secret!
- Never expose in frontend code

---

## Step 3: Configure Environment Variables

### 3.1 Create .env.local
In the project root, create `.env.local`:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Remove Firebase variables (no longer needed)
# VITE_FIREBASE_API_KEY=
# VITE_FIREBASE_AUTH_DOMAIN=
# VITE_FIREBASE_DATABASE_URL=
```

### 3.2 Update Vercel Environment Variables
If deploying to Vercel:
1. Go to Vercel Dashboard
2. Select project → Settings → Environment Variables
3. Add:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key

---

## Step 4: Set Up Database Schema

### 4.1 Open SQL Editor
1. In Supabase dashboard, click **SQL Editor** in sidebar
2. Click **New Query**

### 4.2 Run Database Schema
Copy and paste the following SQL. This creates all necessary tables for FuelPro:

```sql
-- =====================================================
-- FuelPro Database Schema for Supabase
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- USERS TABLE (extends Supabase auth.users)
-- =====================================================
CREATE TABLE public.users (
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

-- Create policies for users
CREATE POLICY "Users can view own profile"
ON public.users FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.users FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Admins can view all users"
ON public.users FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    )
);

CREATE POLICY "Admins can update users"
ON public.users FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Trigger to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- STATIONS TABLE
-- =====================================================
CREATE TABLE public.stations (
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

-- Enable RLS
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

-- Create policies for stations
CREATE POLICY "Users can view accessible stations"
ON public.stations FOR SELECT
USING (
    created_by = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = public.stations.id
        AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can create stations"
ON public.stations FOR INSERT
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own stations"
ON public.stations FOR UPDATE
USING (created_by = auth.uid());

-- =====================================================
-- STATION_USERS TABLE
-- =====================================================
CREATE TABLE public.station_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'viewer' CHECK (role IN ('owner', 'manager', 'cashier', 'viewer')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(station_id, user_id)
);

-- Enable RLS
ALTER TABLE public.station_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view station users"
ON public.station_users FOR SELECT
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.stations
        WHERE id = station_id AND created_by = auth.uid()
    )
);

CREATE POLICY "Station owners can manage station users"
ON public.station_users FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.stations
        WHERE id = station_id AND created_by = auth.uid()
    )
);

-- =====================================================
-- INVENTORY TABLE
-- =====================================================
CREATE TABLE public.inventory (
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

-- Enable RLS
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Station users can view inventory"
ON public.inventory FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = inventory.station_id
        AND user_id = auth.uid()
        AND is_active = true
    )
);

CREATE POLICY "Station staff can update inventory"
ON public.inventory FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = inventory.station_id
        AND user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'manager', 'cashier')
    )
);

CREATE POLICY "Station managers can insert inventory"
ON public.inventory FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = inventory.station_id
        AND user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'manager')
    )
);

-- =====================================================
-- SALES TABLE
-- =====================================================
CREATE TABLE public.sales (
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

-- Enable RLS
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Station users can view sales"
ON public.sales FOR SELECT
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = sales.station_id
        AND user_id = auth.uid()
        AND is_active = true
    )
);

CREATE POLICY "Station staff can insert sales"
ON public.sales FOR INSERT
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.station_users
        WHERE station_id = sales.station_id
        AND user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'manager', 'cashier')
    )
);

-- =====================================================
-- AUDIT_LOGS TABLE
-- =====================================================
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id),
    station_id UUID REFERENCES public.stations(id),
    event TEXT NOT NULL,
    detail TEXT,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'danger')),
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
ON public.audit_logs FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    )
);

CREATE POLICY "System can insert audit logs"
ON public.audit_logs FOR INSERT
WITH CHECK (true);

-- =====================================================
-- HEALTH CHECK DOCUMENT (Required for cloud sync status)
-- =====================================================
CREATE TABLE public._health (
    id TEXT PRIMARY KEY DEFAULT '_check',
    status TEXT DEFAULT 'ok',
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial health check
INSERT INTO public._health (id, status) VALUES ('_check', 'ok');

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_station_users_station_id ON public.station_users(station_id);
CREATE INDEX idx_station_users_user_id ON public.station_users(user_id);
CREATE INDEX idx_inventory_station_id ON public.inventory(station_id);
CREATE INDEX idx_sales_station_id ON public.sales(station_id);
CREATE INDEX idx_sales_created_at ON public.sales(created_at);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at);

-- =====================================================
-- ENABLE REALTIME
-- =====================================================
-- Enable realtime for important tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.stations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================
SELECT '✅ FuelPro Database Schema Created Successfully!' as status;
```

### 4.3 Click "Run" to Execute

---

## Step 5: Configure Authentication

### 5.1 Enable Email Authentication
1. Go to **Authentication** → **Settings**
2. Scroll to **Auth Providers**
3. Ensure **Email** is enabled
4. Configure settings:
   - Allow new user registrations: ✓
   - Allow manual linking: ✓
   - Confirm email: Optional (recommended for production)

### 5.2 Configure Email Templates (Optional)
1. Go to **Authentication** → **Email Templates**
2. Customize templates if needed
3. Set sender email and name

### 5.3 Set Up Redirect URLs
1. Go to **Authentication** → **Settings** → **URL Configuration**
2. Add site URL: `https://fuel-app-mobile.vercel.app`
3. Add redirect URLs:
   - `https://fuel-app-mobile.vercel.app/*`
   - `http://localhost:3000/*`

---

## Step 6: Configure Row Level Security (RLS)

RLS policies are already included in the schema above. To verify:

1. Go to **Database** → **Replication**
2. Check that RLS is enabled on all tables
3. Verify policies exist for each table

---

## Step 7: Test the Connection

### 7.1 Test Locally
```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit .env.local with your credentials
nano .env.local

# Start development server
npm run dev
```

### 7.2 Test Authentication
1. Register a new user
2. Login with email/password
3. Verify session persists

### 7.3 Test Database Operations
1. Create a station
2. Add inventory
3. Record a sale
4. Verify data appears in Supabase dashboard

---

## Step 8: Monitor and Debug

### 8.1 Check Supabase Dashboard
- **Table Editor**: View all data
- **SQL Editor**: Run queries
- **Authentication**: View user sessions
- **Logs**: Check for errors

### 8.2 Common Issues

#### Issue: "Supabase not configured"
**Solution**: Ensure environment variables are set correctly

#### Issue: "Permission denied"
**Solution**: Check RLS policies are applied

#### Issue: "Invalid credentials"
**Solution**: Verify anon key is correct

---

## Step 9: Production Checklist

Before going to production:

- [ ] All environment variables set in Vercel
- [ ] RLS policies verified
- [ ] Email authentication tested
- [ ] Database indexes created
- [ ] Realtime enabled for needed tables
- [ ] Error monitoring set up
- [ ] Performance tested

---

## Support Resources

- **Supabase Documentation**: https://supabase.com/docs
- **Supabase Discord**: https://discord.gg/supabase
- **FuelPro Issues**: Create GitHub issue

---

## Estimated Costs

### Free Tier Includes:
- 500 MB database
- 1 GB file storage
- 50 MB file uploads
- 2 GB transfer
- 100K monthly active users
- Realtime enabled

### For Production:
- Estimated cost: $25-50/month for typical use
- Scales with usage

---

## Next Steps

1. ✅ Set up Supabase project
2. ✅ Configure database schema
3. ✅ Set up authentication
4. ✅ Configure RLS
5. 🔄 Update application code
6. 🔄 Test all features
7. 🔄 Deploy to production

For detailed code updates, see `SUPABASE_MIGRATION.md`
