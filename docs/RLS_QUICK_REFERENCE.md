# RLS Policies Quick Reference

## Policy Summary by Table

### Core Tables

| Table | SELECT | INSERT | UPDATE | DELETE | ALL |
|-------|--------|--------|--------|--------|-----|
| users | ✓ (own/admin) | ✗ | ✓ (own/admin) | ✗ | - |
| stations | ✓ (accessible) | ✓ (admin) | ✓ (owner/manager/admin) | ✗ | - |
| station_users | ✓ (own station) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| inventory | ✓ (accessible) | ✓ (manager/owner/admin) | ✓ (staff/admin) | ✗ | - |
| sales | ✓ (own/accessible) | ✓ (staff/admin) | ✗ | ✗ | - |

### Payment Tables

| Table | SELECT | INSERT | UPDATE | DELETE | ALL |
|-------|--------|--------|--------|--------|-----|
| bank_accounts | ✓ (own/accessible) | ✓ (own/owner/admin) | ✓ (own/owner/admin) | ✓ (own/owner/admin) | ✓ (own/owner/admin) |
| mobile_money_configs | ✓ (accessible) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) |
| additional_payment_methods | ✓ (accessible) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) | ✓ (owner/manager/admin) |

### System Tables

| Table | SELECT | INSERT | UPDATE | DELETE | ALL |
|-------|--------|--------|--------|--------|-----|
| audit_logs | ✓ (admin) | ✓ (system) | ✗ | ✗ | - |
| founder_sessions | ✓ (own) | ✓ (own) | ✓ (own) | ✗ | - |

### Multi-Tenancy Tables

| Table | SELECT | INSERT | UPDATE | DELETE | ALL |
|-------|--------|--------|--------|--------|-----|
| tenants | ✓ (own/admin) | ✗ | ✓ (owner/admin) | ✗ | ✓ (owner/admin) |
| tenant_domains | ✓ (accessible) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| data_partitions | ✓ (accessible) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| cross_tenant_links | ✓ (accessible) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| tenant_encryption_keys | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| tenant_settings | ✓ (public/accessible) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |
| data_access_policies | ✓ (accessible) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) | ✓ (owner/admin) |

### Configuration Tables

| Table | SELECT | INSERT | UPDATE | DELETE | ALL |
|-------|--------|--------|--------|--------|-----|
| site_configs | ✓ (public/admin) | ✗ | ✓ (admin) | ✗ | ✓ (admin) |
| config_versions | ✓ (admin) | ✗ | ✓ (admin) | ✗ | ✓ (admin) |

## Access Control Quick Guide

### User Roles

```
Role Hierarchy:
  Admin (system-wide access)
    └── User (personal data + assigned stations)
         └── Station Roles:
              ├── Owner (full station control)
              ├── Manager (station management)
              ├── Cashier (sales + inventory)
              └── Viewer (read-only)
```

### What Each Role Can Do

#### Admin
- ✓ View/manage all users
- ✓ View/manage all stations
- ✓ View all audit logs
- ✓ Manage all configurations
- ✓ Access all tenant data

#### Station Owner
- ✓ Manage station settings
- ✓ Add/remove station users
- ✓ Configure payment methods
- ✓ View all station data
- ✓ Update station inventory
- ✓ Access all station sales

#### Station Manager
- ✓ View station data
- ✓ Update station settings
- ✓ Configure payment methods
- ✓ Update station inventory
- ✗ Cannot add/remove users
- ✗ Cannot delete station

#### Station Cashier
- ✓ Record sales
- ✓ Update inventory
- ✓ View station data
- ✗ Cannot modify settings
- ✗ Cannot manage users
- ✗ Cannot configure payments

#### Regular User
- ✓ View own profile
- ✓ Access assigned stations
- ✓ View assigned station data
- ✗ Cannot modify other users
- ✗ Cannot access other stations

## Common Operations

### Check User Access
```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Count policies per table
SELECT tablename, COUNT(*) as policy_count 
FROM pg_policies 
WHERE schemaname = 'public' 
GROUP BY tablename 
ORDER BY policy_count DESC;
```

### Test Policy (as different user)
```sql
-- Simulate user access
SET request.jwt.claims = '{"user_id": 123, "role": "user"}';
SET request.jwt.claims = '{"user_id": 1, "role": "admin"}';
```

### Disable/Enable Policy
```sql
-- Disable for testing
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Enable after testing
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

### Drop Specific Policy
```sql
DROP POLICY "policy_name" ON table_name;
```

### Create Single Policy
```sql
CREATE POLICY "policy_name"
ON table_name
FOR SELECT
USING (condition);
```

## Security Checklist

- [ ] RLS enabled on all tables
- [ ] Service role not exposed to clients
- [ ] Policies follow least privilege
- [ ] Audit logs capture all access
- [ ] Public data explicitly marked
- [ ] No hardcoded user IDs in policies
- [ ] Station isolation working
- [ ] Admin access properly restricted
- [ ] Payment data properly protected
- [ ] Tenant data properly isolated

## Performance Tips

1. **Index Filtered Columns**
   ```sql
   CREATE INDEX idx_station_users_composite 
   ON station_users(stationId, userId, isActive);
   ```

2. **Use Simple Policy Conditions**
   - Avoid subqueries when possible
   - Use EXISTS over IN for better performance

3. **Cache Frequently Accessed Data**
   - User roles
   - Station assignments
   - Tenant ownership

## Policy Naming Convention

Format: `[Who] can [action] [what]`

Examples:
- `Users can view own profile`
- `Station owners can update stations`
- `Admins can manage site configs`
- `Public configs can be viewed by everyone`

## Troubleshooting Quick Fixes

| Problem | Quick Fix |
|---------|-----------|
| User can't access their data | Check `auth.uid() = userId` in policy |
| Admin can't see everything | Verify admin role in users table |
| Station data visible to wrong user | Check station_users table relationships |
| Performance issues | Add indexes, simplify policies |
| Policies not working | Verify RLS is enabled (`ALTER TABLE... ENABLE ROW LEVEL SECURITY`) |

## Documentation Links

- Full Policy Documentation: `/docs/RLS_POLICIES.md`
- Application Guide: `/docs/APPLY_RLS_POLICIES.md`
- Migration File: `/db/migrations/002_rls_policies.sql`
- Application Script: `/scripts/apply-rls-policies.ts`
