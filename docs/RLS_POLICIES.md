# Row Level Security (RLS) Policies

This document describes the Row Level Security (RLS) policies implemented for the FuelPro application to ensure data isolation and security at the database level.

## Overview

Row Level Security (RLS) is a PostgreSQL feature that allows you to restrict access to rows based on the user's session variables. With RLS enabled, each query executed in the database is automatically filtered according to the policies defined for the tables.

## Tables with RLS Policies

### 1. Users (`users`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view own profile | SELECT | Users can view their own profile |
| Users can update own profile | UPDATE | Users can update their own profile |
| Admins can view all users | SELECT | Admin users can view all user profiles |
| Admins can update any user | UPDATE | Admin users can update any user profile |

### 2. Stations (`stations`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view accessible stations | SELECT | Users can view stations they have access to |
| Station owners/managers can update stations | UPDATE | Station owners and managers can update station details |
| Admins can create stations | INSERT | Only admins can create new stations |

### 3. Station Users (`station_users`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view station access for own stations | SELECT | Users can view who has access to stations they belong to |
| Station owners/managers can manage station users | ALL | Station owners can add/remove users from their stations |

### 4. Inventory (`inventory`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view station inventory | SELECT | Users can view inventory for stations they have access to |
| Station staff can update inventory | UPDATE | Station owners, managers, and cashiers can update inventory |
| Station managers can insert inventory | INSERT | Only station owners and managers can add new inventory |

### 5. Sales (`sales`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view station sales | SELECT | Users can view sales for stations they have access to |
| Station staff can create sales | INSERT | Station staff can record new sales |

### 6. Bank Accounts (`bank_accounts`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view own bank accounts | SELECT | Users can view their own bank accounts |
| Users can manage own bank accounts | ALL | Users can manage their own bank accounts |

### 7. Mobile Money Configs (`mobile_money_configs`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view mobile money configs | SELECT | Users can view mobile money configurations for their stations |
| Station owners/managers can manage mobile money configs | ALL | Station owners and managers can update mobile money settings |

### 8. Additional Payment Methods (`additional_payment_methods`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view additional payment methods | SELECT | Users can view payment methods for their stations |
| Station owners/managers can manage additional payment methods | ALL | Station owners and managers can manage payment methods |

### 9. Audit Logs (`audit_logs`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Admins can view audit logs | SELECT | Only admins can view audit logs |
| System can insert audit logs | INSERT | System can insert audit log entries (no updates or deletes) |

### 10. Founder Sessions (`founder_sessions`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view own sessions | SELECT | Users can view their own sessions |
| Users can create own sessions | INSERT | Users can create their own sessions |
| Users can update own sessions | UPDATE | Users can update their own sessions |

### 11. Tenants (`tenants`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view accessible tenants | SELECT | Users can view tenants they belong to |
| Tenant owners can manage tenants | ALL | Tenant owners and admins can manage tenants |

### 12. Tenant Domains (`tenant_domains`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view tenant domains | SELECT | Users can view domains for their tenants |
| Tenant owners can manage tenant domains | ALL | Tenant owners can manage domain settings |

### 13. Data Partitions (`data_partitions`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view data partitions | SELECT | Users can view partitions for their tenants |
| Tenant owners can manage data partitions | ALL | Tenant owners can manage data partitions |

### 14. Cross Tenant Links (`cross_tenant_links`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view cross-tenant links | SELECT | Users can view cross-tenant relationships |
| Tenant owners can manage cross-tenant links | ALL | Tenant owners can manage cross-tenant links |

### 15. Tenant Encryption Keys (`tenant_encryption_keys`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Tenant owners can view encryption keys | SELECT | Tenant owners can view encryption keys |
| Tenant owners can manage encryption keys | ALL | Tenant owners can manage encryption keys |

### 16. Tenant Settings (`tenant_settings`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Users can view tenant settings | SELECT | Users can view public settings or their tenant's settings |
| Tenant owners can manage tenant settings | ALL | Tenant owners can manage all tenant settings |

### 17. Site Configs (`site_configs`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Public configs can be viewed by everyone | SELECT | Public configurations are accessible to all |
| Admins can view all site configs | SELECT | Admins can view all site configurations |
| Admins can manage site configs | ALL | Only admins can manage site configurations |

### 18. Config Versions (`config_versions`)

| Policy Name | Action | Description |
|-------------|--------|-------------|
| Admins can view config versions | SELECT | Only admins can view configuration versions |
| Admins can manage config versions | ALL | Only admins can manage configuration versions |

## Access Control Matrix

### User Roles

1. **User**: Standard user with access to their own data and assigned stations
2. **Admin**: Full access to all data and administrative functions

### Station Roles

1. **Owner**: Full control over the station, can manage users and all station data
2. **Manager**: Can manage station operations, inventory, and view reports
3. **Cashier**: Can record sales and update inventory
4. **Viewer**: Read-only access to station data

## Implementation

### SQL Migration

The RLS policies are defined in `/db/migrations/002_rls_policies.sql`. To apply:

1. Connect to your Supabase database
2. Execute the migration file:
   ```bash
   psql -h your-host -U postgres -d postgres -f db/migrations/002_rls_policies.sql
   ```

### Programmatic Application

You can also apply policies using the Node.js script:

```bash
# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key"

# Run the script
npx ts-node scripts/apply-rls-policies.ts
```

## Verification

To verify RLS policies are applied correctly:

```sql
-- Check if RLS is enabled on a table
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- List all policies for a table
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'users';
```

## Testing

After applying RLS policies:

1. **Test as regular user**: Create a test user and verify they can only access their own data
2. **Test as station manager**: Verify managers can access station data but not other stations
3. **Test as admin**: Ensure admins have full access to all data
4. **Test data isolation**: Ensure users cannot access data from other stations

## Troubleshooting

### Policy Not Working

1. Check if RLS is enabled: `SELECT relrowsecurity FROM pg_class WHERE relname = 'tablename';`
2. Verify policy definition matches your requirements
3. Check if the user has the necessary role assigned
4. Test the policy logic manually with `EXPLAIN` or `EXPLAIN ANALYZE`

### Performance Issues

RLS policies can impact query performance, especially with complex conditions. Consider:

1. Indexing frequently filtered columns
2. Simplifying policy conditions
3. Using stored functions for complex checks

### Common Issues

1. **"permission denied" errors**: Check if the policy allows the user's role
2. **Empty results**: Verify the policy conditions match the expected data
3. **Slow queries**: Analyze query plans and optimize policy conditions

## Security Considerations

1. **Principle of Least Privilege**: Each role should only have access to what they need
2. **Defense in Depth**: RLS is an additional layer, not a replacement for application-level checks
3. **Regular Audits**: Review policies periodically to ensure they still meet requirements
4. **Secure Keys**: Never expose service role keys in client-side code

## Updates and Maintenance

When updating RLS policies:

1. Test in a development environment first
2. Document all changes
3. Monitor for performance impact
4. Update this documentation accordingly

## Support

For issues or questions about RLS policies, contact the development team.
