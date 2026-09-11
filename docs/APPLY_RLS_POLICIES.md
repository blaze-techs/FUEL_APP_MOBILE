# How to Apply RLS Policies

This guide explains how to apply the Row Level Security (RLS) policies created for the FuelPro application.

## Option 1: Apply via Supabase Dashboard (Recommended)

### Step 1: Access Your Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar

### Step 2: Create and Execute Migration

1. Click **New Query**
2. Copy the contents of `/db/migrations/002_rls_policies.sql`
3. Paste into the SQL Editor
4. Click **Run** (or press `Ctrl+Enter`)

### Step 3: Verify Installation

After running the migration, verify that RLS is enabled:

```sql
-- Check if RLS is enabled on all tables
SELECT 
  schemaname,
  tablename, 
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- List all created policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## Option 2: Apply via Command Line

### Prerequisites

- PostgreSQL client installed (`psql`)
- Connection to your Supabase database

### Steps

1. **Download the migration file**:
   ```bash
   curl -O https://raw.githubusercontent.com/your-repo/main/db/migrations/002_rls_policies.sql
   ```

2. **Apply the migration**:
   ```bash
   # Using connection string
   psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres" \
     -f db/migrations/002_rls_policies.sql
   
   # Or using individual parameters
   psql \
     --host=db.[YOUR-PROJECT-REF].supabase.co \
     --port=5432 \
     --username=postgres \
     --password \
     --dbname=postgres \
     -f db/migrations/002_rls_policies.sql
   ```

3. **Verify the policies**:
   ```bash
   psql "postgresql://..." -c "
     SELECT tablename, policyname 
     FROM pg_policies 
     WHERE schemaname = 'public';
   "
   ```

## Option 3: Programmatic Application

### Using the Node.js Script

1. **Install dependencies**:
   ```bash
   npm install @supabase/supabase-js
   ```

2. **Set environment variables**:
   ```bash
   # Option A: Using Service Role Key (direct database access)
   export SUPABASE_URL="https://your-project-ref.supabase.co"
   export SUPABASE_SERVICE_KEY="your-service-role-key"
   
   # Option B: Using Access Token (Management API)
   export SUPABASE_ACCESS_TOKEN="your-personal-access-token"
   ```

3. **Run the script**:
   ```bash
   npx ts-node scripts/apply-rls-policies.ts
   ```

## Verifying RLS Policies

### Check Individual Table

```sql
-- Check if RLS is enabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname IN ('users', 'stations', 'inventory', 'sales');

-- Check policies for a specific table
SELECT 
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'users';
```

### Test Policy Functionality

```sql
-- Set a user's context (if using service role)
SET request.jwt.claims = '{"user_id": 123}';

-- Test if a policy allows access
SELECT * FROM users WHERE id = 123;

-- Check what data is visible to current user
SELECT current_setting('request.jwt.claims', true);
```

## Common Issues and Solutions

### Issue 1: Policies Not Applied

**Symptom**: RLS doesn't seem to be filtering data

**Solution**:
1. Check if RLS is enabled:
   ```sql
   SELECT relname, relrowsecurity FROM pg_class 
   WHERE relname = 'your-table';
   ```
2. Ensure you're using an authenticated client
3. Check the policy definitions match expected logic

### Issue 2: Performance Problems

**Symptom**: Queries are slow after enabling RLS

**Solution**:
1. Add indexes on commonly filtered columns:
   ```sql
   CREATE INDEX idx_station_users_station_id 
   ON station_users(stationId);
   
   CREATE INDEX idx_station_users_user_id 
   ON station_users(userId);
   ```
2. Simplify policy conditions
3. Use `EXPLAIN ANALYZE` to identify bottlenecks

### Issue 3: "Permission Denied" Errors

**Symptom**: Users can't access data they should have access to

**Solution**:
1. Check the user's role in the database
2. Verify the user is properly authenticated
3. Test the policy logic manually
4. Check if service role is bypassing RLS accidentally

## Rollback Instructions

If you need to remove all RLS policies:

```sql
-- Disable RLS on all tables
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE stations DISABLE ROW LEVEL SECURITY;
ALTER TABLE station_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_money_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE additional_payment_methods DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE founder_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains DISABLE ROW LEVEL SECURITY;
ALTER TABLE data_partitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE cross_tenant_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_encryption_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_policies DISABLE ROW LEVEL SECURITY;
ALTER TABLE site_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE config_versions DISABLE ROW LEVEL SECURITY;

-- Drop all policies (careful!)
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;
```

## Testing Checklist

After applying RLS policies, test the following scenarios:

- [ ] Regular user can view their own profile
- [ ] Regular user cannot view other users' profiles
- [ ] Admin can view all users
- [ ] Admin can update any user
- [ ] User can view stations they have access to
- [ ] User cannot view stations they don't have access to
- [ ] Station owner can add/remove users from their station
- [ ] Cashier can record sales
- [ ] Cashier cannot access other stations' sales
- [ ] Public configs are viewable by everyone
- [ ] Non-public configs are only viewable by admins

## Additional Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Best Practices for RLS](https://supabase.com/blog/row-level-security)

## Support

If you encounter issues:

1. Check the [Troubleshooting Guide](#common-issues-and-solutions)
2. Review the policy definitions in `db/migrations/002_rls_policies.sql`
3. Verify your Supabase project configuration
4. Contact the development team for assistance
