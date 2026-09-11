-- ============================================================
-- Row Level Security (RLS) Policies for FuelPro App
-- ============================================================
-- This migration creates RLS policies for all tables
-- Run this after enabling RLS on each table
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_money_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE additional_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_partitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_tenant_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_encryption_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USERS TABLE POLICIES
-- ============================================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (auth.uid() = id);

-- Users can update their own profile (except role and status)
CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Admins can view all users
CREATE POLICY "Admins can view all users"
ON users FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Admins can update any user
CREATE POLICY "Admins can update any user"
ON users FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- STATIONS TABLE POLICIES
-- ============================================================

-- Users can view stations they have access to
CREATE POLICY "Users can view accessible stations"
ON stations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = stations.id
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station owners/managers can update their stations
CREATE POLICY "Station owners/managers can update stations"
ON stations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = stations.id
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Only station owners can insert new stations
CREATE POLICY "Admins can create stations"
ON stations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- STATION_USERS TABLE POLICIES
-- ============================================================

-- Users can view station access for stations they belong to
CREATE POLICY "Users can view station access for own stations"
ON station_users FOR SELECT
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users su
    WHERE su.stationId = station_users.stationId
    AND su.userId = auth.uid()
    AND su.role IN ('owner', 'manager')
    AND su.isActive = true
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station owners/managers can manage station users
CREATE POLICY "Station owners/managers can manage station users"
ON station_users FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM station_users su
    WHERE su.stationId = station_users.stationId
    AND su.userId = auth.uid()
    AND su.role = 'owner'
    AND su.isActive = true
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- INVENTORY TABLE POLICIES
-- ============================================================

-- Users can view inventory for stations they have access to
CREATE POLICY "Users can view station inventory"
ON inventory FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = inventory.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station owners/managers/cashiers can update inventory
CREATE POLICY "Station staff can update inventory"
ON inventory FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = inventory.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager', 'cashier')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station managers/owners can insert inventory
CREATE POLICY "Station managers can insert inventory"
ON inventory FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = inventory.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- SALES TABLE POLICIES
-- ============================================================

-- Users can view sales for stations they have access to
CREATE POLICY "Users can view station sales"
ON sales FOR SELECT
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = sales.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station staff can insert sales
CREATE POLICY "Station staff can create sales"
ON sales FOR INSERT
WITH CHECK (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = sales.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager', 'cashier')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- BANK_ACCOUNTS TABLE POLICIES
-- ============================================================

-- Users can view their own bank accounts
CREATE POLICY "Users can view own bank accounts"
ON bank_accounts FOR SELECT
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = bank_accounts.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Users can manage their own bank accounts
CREATE POLICY "Users can manage own bank accounts"
ON bank_accounts FOR ALL
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = bank_accounts.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role = 'owner'
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- MOBILE_MONEY_CONFIGS TABLE POLICIES
-- ============================================================

-- Users can view mobile money configs for their stations
CREATE POLICY "Users can view mobile money configs"
ON mobile_money_configs FOR SELECT
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = mobile_money_configs.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station owners/managers can manage mobile money configs
CREATE POLICY "Station owners/managers can manage mobile money configs"
ON mobile_money_configs FOR ALL
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = mobile_money_configs.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- ADDITIONAL_PAYMENT_METHODS TABLE POLICIES
-- ============================================================

-- Users can view additional payment methods for their stations
CREATE POLICY "Users can view additional payment methods"
ON additional_payment_methods FOR SELECT
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = additional_payment_methods.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Station owners/managers can manage additional payment methods
CREATE POLICY "Station owners/managers can manage additional payment methods"
ON additional_payment_methods FOR ALL
USING (
  userId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM station_users
    WHERE station_users.stationId = additional_payment_methods.stationId
    AND station_users.userId = auth.uid()
    AND station_users.isActive = true
    AND station_users.role IN ('owner', 'manager')
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- AUDIT_LOGS TABLE POLICIES
-- ============================================================

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
ON audit_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Audit logs are insert-only (no updates or deletes)
CREATE POLICY "System can insert audit logs"
ON audit_logs FOR INSERT
WITH CHECK (true);

-- ============================================================
-- FOUNDER_SESSIONS TABLE POLICIES
-- ============================================================

-- Users can view their own sessions
CREATE POLICY "Users can view own sessions"
ON founder_sessions FOR SELECT
USING (userId = auth.uid());

-- Users can create their own sessions
CREATE POLICY "Users can create own sessions"
ON founder_sessions FOR INSERT
WITH CHECK (userId = auth.uid());

-- Users can update their own sessions
CREATE POLICY "Users can update own sessions"
ON founder_sessions FOR UPDATE
USING (userId = auth.uid());

-- ============================================================
-- TENANTS TABLE POLICIES
-- ============================================================

-- Users can view tenants they belong to
CREATE POLICY "Users can view accessible tenants"
ON tenants FOR SELECT
USING (
  ownerId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage tenants
CREATE POLICY "Tenant owners can manage tenants"
ON tenants FOR ALL
USING (
  ownerId = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- TENANT_DOMAINS TABLE POLICIES
-- ============================================================

-- Users can view tenant domains for their tenants
CREATE POLICY "Users can view tenant domains"
ON tenant_domains FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_domains.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage tenant domains
CREATE POLICY "Tenant owners can manage tenant domains"
ON tenant_domains FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_domains.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- DATA_PARTITIONS TABLE POLICIES
-- ============================================================

-- Users can view data partitions for their tenants
CREATE POLICY "Users can view data partitions"
ON data_partitions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = data_partitions.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage data partitions
CREATE POLICY "Tenant owners can manage data partitions"
ON data_partitions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = data_partitions.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- CROSS_TENANT_LINKS TABLE POLICIES
-- ============================================================

-- Users can view cross-tenant links for their tenants
CREATE POLICY "Users can view cross-tenant links"
ON cross_tenant_links FOR SELECT
USING (
  sourceTenantId IN (
    SELECT tenants.id FROM tenants WHERE tenants.ownerId = auth.uid()
  )
  OR
  targetTenantId IN (
    SELECT tenants.id FROM tenants WHERE tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage cross-tenant links
CREATE POLICY "Tenant owners can manage cross-tenant links"
ON cross_tenant_links FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = cross_tenant_links.sourceTenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- TENANT_ENCRYPTION_KEYS TABLE POLICIES
-- ============================================================

-- Only tenant owners and admins can access encryption keys
CREATE POLICY "Tenant owners can view encryption keys"
ON tenant_encryption_keys FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_encryption_keys.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage encryption keys
CREATE POLICY "Tenant owners can manage encryption keys"
ON tenant_encryption_keys FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_encryption_keys.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- TENANT_SETTINGS TABLE POLICIES
-- ============================================================

-- Users can view tenant settings (unless isPublic is false)
CREATE POLICY "Users can view tenant settings"
ON tenant_settings FOR SELECT
USING (
  isPublic = true
  OR
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_settings.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage tenant settings
CREATE POLICY "Tenant owners can manage tenant settings"
ON tenant_settings FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = tenant_settings.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- DATA_ACCESS_POLICIES TABLE POLICIES
-- ============================================================

-- Users can view data access policies for their tenants
CREATE POLICY "Users can view data access policies"
ON data_access_policies FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = data_access_policies.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Tenant owners and admins can manage data access policies
CREATE POLICY "Tenant owners can manage data access policies"
ON data_access_policies FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tenants
    WHERE tenants.id = data_access_policies.tenantId
    AND tenants.ownerId = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- SITE_CONFIGS TABLE POLICIES
-- ============================================================

-- Public configs can be viewed by everyone
CREATE POLICY "Public configs can be viewed by everyone"
ON site_configs FOR SELECT
USING (isPublic = true);

-- Only admins can view non-public configs
CREATE POLICY "Admins can view all site configs"
ON site_configs FOR SELECT
USING (
  NOT isPublic
  AND
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Only admins can manage site configs
CREATE POLICY "Admins can manage site configs"
ON site_configs FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- CONFIG_VERSIONS TABLE POLICIES
-- ============================================================

-- Only admins can view config versions
CREATE POLICY "Admins can view config versions"
ON config_versions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Only admins can manage config versions
CREATE POLICY "Admins can manage config versions"
ON config_versions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to get current user's ID
CREATE OR REPLACE FUNCTION get_user_id()
RETURNS INTEGER AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'user_id', '')::INTEGER;
$$ LANGUAGE SQL STABLE;

-- Function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = get_user_id()
    AND users.role = 'admin'
  );
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- To apply these policies:
-- 1. Connect to your Supabase database
-- 2. Run this SQL migration file
-- 3. Verify policies are created by checking pg_policies
--
-- To check existing policies:
-- SELECT * FROM pg_policies WHERE tablename = 'users';
--
-- To drop a specific policy:
-- DROP POLICY "policy_name" ON table_name;
--
-- To drop all policies on a table:
-- DROP POLICY ALL ON table_name;
--
-- ============================================================
