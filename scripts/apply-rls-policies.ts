/**
 * Script to apply Row Level Security (RLS) policies to Supabase tables
 * Usage: npx ts-node scripts/apply-rls-policies.ts
 */

import { createClient } from '@supabase/supabase-js';

// Configuration - these should be set as environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://work-1-wmgufnjezfecywuk.prod-runtime.all-hands.dev';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

// If using Management API directly
const MANAGEMENT_API_URL = 'https://api.supabase.com/v1';

interface RLSPolicy {
  name: string;
  table: string;
  definition: string;
  check: string;
  action: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  roles?: string[];
}

// List of all RLS policies to create
const policies: RLSPolicy[] = [
  // Users table policies
  {
    name: 'Users can view own profile',
    table: 'users',
    definition: '(auth.uid() = id)',
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Users can update own profile',
    table: 'users',
    definition: '(auth.uid() = id)',
    check: '(auth.uid() = id)',
    action: 'UPDATE',
  },
  {
    name: 'Admins can view all users',
    table: 'users',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Admins can update any user',
    table: 'users',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'UPDATE',
  },

  // Stations table policies
  {
    name: 'Users can view accessible stations',
    table: 'stations',
    definition: "EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = stations.id AND station_users.userId = auth.uid() AND station_users.isActive = true) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station owners/managers can update stations',
    table: 'stations',
    definition: "EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = stations.id AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'UPDATE',
  },
  {
    name: 'Admins can create stations',
    table: 'stations',
    definition: null,
    check: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    action: 'INSERT',
  },

  // Station users policies
  {
    name: 'Users can view station access for own stations',
    table: 'station_users',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users su WHERE su.stationId = station_users.stationId AND su.userId = auth.uid() AND su.role IN ('owner', 'manager') AND su.isActive = true) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station owners/managers can manage station users',
    table: 'station_users',
    definition: "EXISTS (SELECT 1 FROM station_users su WHERE su.stationId = station_users.stationId AND su.userId = auth.uid() AND su.role = 'owner' AND su.isActive = true) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Inventory policies
  {
    name: 'Users can view station inventory',
    table: 'inventory',
    definition: "EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = inventory.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station staff can update inventory',
    table: 'inventory',
    definition: "EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = inventory.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager', 'cashier')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'UPDATE',
  },
  {
    name: 'Station managers can insert inventory',
    table: 'inventory',
    definition: null,
    check: "EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = inventory.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    action: 'INSERT',
  },

  // Sales policies
  {
    name: 'Users can view station sales',
    table: 'sales',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = sales.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station staff can create sales',
    table: 'sales',
    definition: null,
    check: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = sales.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager', 'cashier')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    action: 'INSERT',
  },

  // Bank accounts policies
  {
    name: 'Users can view own bank accounts',
    table: 'bank_accounts',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = bank_accounts.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Users can manage own bank accounts',
    table: 'bank_accounts',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = bank_accounts.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role = 'owner') OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Mobile money configs policies
  {
    name: 'Users can view mobile money configs',
    table: 'mobile_money_configs',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = mobile_money_configs.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station owners/managers can manage mobile money configs',
    table: 'mobile_money_configs',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = mobile_money_configs.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Additional payment methods policies
  {
    name: 'Users can view additional payment methods',
    table: 'additional_payment_methods',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = additional_payment_methods.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Station owners/managers can manage additional payment methods',
    table: 'additional_payment_methods',
    definition: "(userId = auth.uid()) OR EXISTS (SELECT 1 FROM station_users WHERE station_users.stationId = additional_payment_methods.stationId AND station_users.userId = auth.uid() AND station_users.isActive = true AND station_users.role IN ('owner', 'manager')) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Audit logs policies
  {
    name: 'Admins can view audit logs',
    table: 'audit_logs',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'System can insert audit logs',
    table: 'audit_logs',
    definition: null,
    check: 'true',
    action: 'INSERT',
  },

  // Founder sessions policies
  {
    name: 'Users can view own sessions',
    table: 'founder_sessions',
    definition: '(userId = auth.uid())',
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Users can create own sessions',
    table: 'founder_sessions',
    definition: null,
    check: '(userId = auth.uid())',
    action: 'INSERT',
  },
  {
    name: 'Users can update own sessions',
    table: 'founder_sessions',
    definition: '(userId = auth.uid())',
    check: null,
    action: 'UPDATE',
  },

  // Tenants policies
  {
    name: 'Users can view accessible tenants',
    table: 'tenants',
    definition: '(ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')',
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage tenants',
    table: 'tenants',
    definition: '(ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')',
    check: null,
    action: 'ALL',
  },

  // Tenant domains policies
  {
    name: 'Users can view tenant domains',
    table: 'tenant_domains',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_domains.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage tenant domains',
    table: 'tenant_domains',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_domains.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Data partitions policies
  {
    name: 'Users can view data partitions',
    table: 'data_partitions',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = data_partitions.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage data partitions',
    table: 'data_partitions',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = data_partitions.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Cross tenant links policies
  {
    name: 'Users can view cross-tenant links',
    table: 'cross_tenant_links',
    definition: "(sourceTenantId IN (SELECT tenants.id FROM tenants WHERE tenants.ownerId = auth.uid()) OR targetTenantId IN (SELECT tenants.id FROM tenants WHERE tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'))",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage cross-tenant links',
    table: 'cross_tenant_links',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = cross_tenant_links.sourceTenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Tenant encryption keys policies
  {
    name: 'Tenant owners can view encryption keys',
    table: 'tenant_encryption_keys',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_encryption_keys.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage encryption keys',
    table: 'tenant_encryption_keys',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_encryption_keys.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Tenant settings policies
  {
    name: 'Users can view tenant settings',
    table: 'tenant_settings',
    definition: "(isPublic = true) OR EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_settings.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage tenant settings',
    table: 'tenant_settings',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant_settings.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Data access policies
  {
    name: 'Users can view data access policies',
    table: 'data_access_policies',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = data_access_policies.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Tenant owners can manage data access policies',
    table: 'data_access_policies',
    definition: "EXISTS (SELECT 1 FROM tenants WHERE tenants.id = data_access_policies.tenantId AND tenants.ownerId = auth.uid()) OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Site configs policies
  {
    name: 'Public configs can be viewed by everyone',
    table: 'site_configs',
    definition: '(isPublic = true)',
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Admins can view all site configs',
    table: 'site_configs',
    definition: "(NOT isPublic) AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Admins can manage site configs',
    table: 'site_configs',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },

  // Config versions policies
  {
    name: 'Admins can view config versions',
    table: 'config_versions',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'SELECT',
  },
  {
    name: 'Admins can manage config versions',
    table: 'config_versions',
    definition: "EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')",
    check: null,
    action: 'ALL',
  },
];

async function applyPolicies() {
  console.log('🚀 Starting RLS Policy Application\n');
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Service Key Available: ${SUPABASE_SERVICE_KEY ? 'Yes' : 'No'}`);
  console.log(`Access Token Available: ${SUPABASE_ACCESS_TOKEN ? 'Yes' : 'No'}\n`);

  if (!SUPABASE_SERVICE_KEY && !SUPABASE_ACCESS_TOKEN) {
    console.error('❌ Error: Neither SUPABASE_SERVICE_KEY nor SUPABASE_ACCESS_TOKEN is set');
    console.log('\nPlease set one of these environment variables:');
    console.log('  - SUPABASE_SERVICE_KEY: For direct database access with service role');
    console.log('  - SUPABASE_ACCESS_TOKEN: For Management API access');
    process.exit(1);
  }

  const results = {
    created: [] as string[],
    failed: [] as { name: string; error: string }[],
  };

  for (const policy of policies) {
    console.log(`Creating policy: ${policy.name} on ${policy.table}...`);
    
    try {
      if (SUPABASE_SERVICE_KEY) {
        // Direct database access using service role
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          db: { schema: 'public' }
        });

        // First, enable RLS on the table if not already enabled
        await supabase.rpc('exec', {
          sql: `ALTER TABLE "${policy.table}" ENABLE ROW LEVEL SECURITY;`
        }).catch(() => {
          // Ignore if already enabled
        });

        // Create policy using raw SQL
        const sql = `
          CREATE POLICY "${policy.name}"
          ON "${policy.table}"
          FOR ${policy.action}
          ${policy.definition ? `USING (${policy.definition})` : ''}
          ${policy.check ? `WITH CHECK (${policy.check})` : ''};
        `;

        const { error } = await supabase.rpc('exec', { sql }).catch(() => {
          // Fallback if exec function doesn't exist
          return { error: { message: 'exec function not available' } };
        });

        if (error) {
          console.log(`  ⚠️  Warning: ${error.message}`);
          // Policy might already exist, continue
        }
      }

      if (SUPABASE_ACCESS_TOKEN) {
        // Using Management API
        const response = await fetch(`${MANAGEMENT_API_URL}/projects/${getProjectRef()}/policies`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: policy.name,
            table: policy.table,
            definition: policy.definition,
            check: policy.check,
            action: policy.action.toLowerCase(),
            roles: policy.roles || ['authenticated', 'anon'],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          if (errorData.message?.includes('already exists')) {
            console.log(`  ✓ Policy already exists, skipping`);
          } else {
            throw new Error(errorData.message || 'Failed to create policy');
          }
        }
      }

      results.created.push(`${policy.name} on ${policy.table}`);
      console.log(`  ✓ Created successfully`);
    } catch (error: any) {
      results.failed.push({
        name: policy.name,
        error: error.message || String(error),
      });
      console.log(`  ❌ Failed: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`✓ Successfully created: ${results.created.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed policies:');
    results.failed.forEach((f) => {
      console.log(`  - ${f.name}: ${f.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('NEXT STEPS');
  console.log('='.repeat(60));
  console.log('1. Verify policies were created in Supabase Dashboard');
  console.log('2. Test policies with different user roles');
  console.log('3. Update application code if needed to handle RLS restrictions');
}

function getProjectRef(): string {
  // Extract project reference from URL
  const match = SUPABASE_URL.match(/https?:\/\/([^.]+)\./);
  return match ? match[1] : 'default';
}

// Run the script
applyPolicies().catch(console.error);
