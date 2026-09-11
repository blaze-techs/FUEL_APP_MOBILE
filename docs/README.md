# Row Level Security (RLS) Implementation - FuelPro App

## Overview

This directory contains the Row Level Security (RLS) policies implementation for the FuelPro mobile application. RLS provides database-level access control, ensuring that users can only access data they're authorized to see.

## Files Created

### 1. SQL Migration (`db/migrations/002_rls_policies.sql`)
- **Purpose**: Main SQL file containing all RLS policy definitions
- **Content**: 45+ policies across 18 tables
- **Status**: Ready to apply to Supabase database

### 2. TypeScript Script (`scripts/apply-rls-policies.ts`)
- **Purpose**: Programmatic application of RLS policies
- **Features**: 
  - Supports both Service Role Key and Access Token methods
  - Validates policy application
  - Provides detailed reporting
- **Usage**: `npx ts-node scripts/apply-rls-policies.ts`

### 3. Documentation

#### `docs/RLS_POLICIES.md`
- Complete reference of all RLS policies
- Detailed policy descriptions for each table
- Access control matrix
- Security considerations

#### `docs/APPLY_RLS_POLICIES.md`
- Step-by-step guide to apply policies
- Three different methods:
  1. Supabase Dashboard (Recommended)
  2. Command Line (psql)
  3. Programmatic (Node.js script)
- Troubleshooting guide
- Rollback instructions

#### `docs/RLS_QUICK_REFERENCE.md`
- Quick lookup table for all policies
- Access control hierarchy
- Common operations
- Troubleshooting quick fixes
- Security checklist

## Database Tables Protected

### Core Business Logic
- `users` - User profiles and roles
- `stations` - Fuel station information
- `station_users` - Station access control
- `inventory` - Fuel inventory management
- `sales` - Sales transactions

### Payment Systems
- `bank_accounts` - Bank account details
- `mobile_money_configs` - Mobile payment configurations
- `additional_payment_methods` - Custom payment methods

### System & Audit
- `audit_logs` - System audit trail
- `founder_sessions` - Session management

### Multi-Tenancy
- `tenants` - Tenant organization management
- `tenant_domains` - Domain mapping
- `data_partitions` - Data isolation
- `cross_tenant_links` - Tenant relationships
- `tenant_encryption_keys` - Encryption key management
- `tenant_settings` - Tenant configuration
- `data_access_policies` - Access control rules

### Application Configuration
- `site_configs` - Site-wide settings
- `config_versions` - Configuration version history

## Access Control Matrix

### User Roles
1. **Admin**: Full system access
2. **User**: Access to own data and assigned stations

### Station Roles
1. **Owner**: Full control of station
2. **Manager**: Station operations management
3. **Cashier**: Sales and inventory updates
4. **Viewer**: Read-only station access

## Quick Start

### Option 1: Apply via Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Open your project
3. Navigate to **SQL Editor**
4. Copy and paste contents of `db/migrations/002_rls_policies.sql`
5. Click **Run**

### Option 2: Command Line

```bash
# Install postgresql-client if needed
sudo apt-get install postgresql-client

# Apply policies
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  -f db/migrations/002_rls_policies.sql
```

### Option 3: Programmatic

```bash
# Set environment
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-key"

# Run script
npx ts-node scripts/apply-rls-policies.ts
```

## Verification Steps

After applying policies, verify with these queries:

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Count policies
SELECT tablename, COUNT(*) as policy_count 
FROM pg_policies 
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY policy_count DESC;

-- Sample policy check
SELECT * FROM pg_policies 
WHERE tablename = 'users' 
AND policyname = 'Users can view own profile';
```

## Testing Checklist

After applying RLS:

- [ ] Regular users can only see their own profile
- [ ] Users can only access assigned stations
- [ ] Station owners can manage their stations
- [ ] Cashiers can record sales
- [ ] Admins have full access
- [ ] Public configs are visible to everyone
- [ ] Private configs are only visible to admins
- [ ] Audit logs are only viewable by admins
- [ ] Payment methods are protected appropriately
- [ ] Tenant data is properly isolated

## Security Features

### Data Isolation
- Station-level data separation
- Tenant-level data isolation
- User-specific data protection

### Access Control
- Role-based access control (RBAC)
- Multi-level permissions
- Principle of least privilege

### Audit & Compliance
- Comprehensive audit logging
- Data access tracking
- Security event logging

### Defense in Depth
- Database-level security (RLS)
- Application-level authorization
- API-level authentication

## Performance Considerations

### Indexes Created
For optimal RLS performance, these indexes are recommended:

```sql
CREATE INDEX idx_station_users_composite 
ON station_users(stationId, userId, isActive);

CREATE INDEX idx_inventory_station 
ON inventory(stationId);

CREATE INDEX idx_sales_station 
ON sales(stationId, createdAt);

CREATE INDEX idx_users_role 
ON users(role);
```

### Query Optimization
- Use EXISTS instead of IN
- Keep policy conditions simple
- Index frequently filtered columns
- Monitor query performance

## Troubleshooting

### Policy Not Working
1. Check if RLS is enabled: `SELECT relrowsecurity FROM pg_class WHERE relname = 'table_name';`
2. Verify policy exists: `SELECT * FROM pg_policies WHERE policyname = 'policy_name';`
3. Test as different user roles

### Performance Issues
1. Analyze query plans: `EXPLAIN ANALYZE SELECT * FROM table_name;`
2. Add indexes on filtered columns
3. Simplify policy conditions
4. Consider caching

### Access Problems
1. Verify user authentication
2. Check user roles in database
3. Confirm station_user relationships
4. Review policy definitions

## Rollback Procedure

If you need to remove all RLS policies:

```sql
-- Disable RLS on all tables
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
-- (repeat for all tables)

-- Drop all policies
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;
```

## Maintenance

### Regular Tasks
- Review audit logs for suspicious activity
- Update policies as requirements change
- Monitor performance impact
- Test policies after schema changes
- Document all policy modifications

### Updates
When updating RLS policies:

1. Test in development environment
2. Create backup of current policies
3. Apply changes using migration
4. Verify all tests pass
5. Update documentation
6. Monitor in production

## Support & Resources

### Documentation
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Security Best Practices](https://supabase.com/blog/row-level-security)

### Internal Resources
- Full Policy Reference: `docs/RLS_POLICIES.md`
- Application Guide: `docs/APPLY_RLS_POLICIES.md`
- Quick Reference: `docs/RLS_QUICK_REFERENCE.md`
- Migration Script: `db/migrations/002_rls_policies.sql`
- Application Script: `scripts/apply-rls-policies.ts`

## Best Practices

1. **Always Test First**
   - Use development environment
   - Test all user roles
   - Verify data isolation

2. **Follow Principle of Least Privilege**
   - Grant minimum necessary access
   - Prefer specific policies over broad ones
   - Regular access reviews

3. **Monitor & Audit**
   - Review audit logs regularly
   - Monitor for suspicious access patterns
   - Track policy changes

4. **Document Everything**
   - Policy purpose and rationale
   - Changes and updates
   - Known limitations

5. **Performance Testing**
   - Test with realistic data volumes
   - Monitor query performance
   - Optimize as needed

## Future Enhancements

Potential improvements for future iterations:

- [ ] Automated policy testing framework
- [ ] Policy generation from schema annotations
- [ ] Real-time policy monitoring dashboard
- [ ] Advanced audit logging with alerts
- [ ] Policy version control system
- [ ] Performance monitoring integration
- [ ] API documentation for policies
- [ ] Migration tooling improvements

## Contact & Support

For questions or issues with RLS implementation:

1. Review documentation in `/docs/`
2. Check troubleshooting sections
3. Contact development team
4. Create issue in repository

## License

This RLS implementation is part of the FuelPro application and follows the same license terms.
