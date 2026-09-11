/**
 * Data Isolation Schema - Architecture-Level Multi-Tenant Isolation
 * 
 * Isolation Strategies:
 * 1. Row-Level Security (RLS) - Data filtered by tenant_id
 * 2. Schema Separation - Separate schemas per tenant (for high-security)
 * 3. Database Separation - Separate databases (for regulatory compliance)
 * 
 * This implementation focuses on Row-Level Security with:
 * - Tenant ID enforcement at database level
 * - Automatic filtering in queries
 * - Cross-tenant access prevention
 * - Data residency support
 */

import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  int,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ═══════════════════════════════════════════════════════════════════════════
// TENANT CONFIGURATION (Master tenant registry)
// ═══════════════════════════════════════════════════════════════════════════

export const tenants = mysqlTable("tenants", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  
  // Identification
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 255 }),
  
  // Contact
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  
  // Business info
  businessType: varchar("businessType", { length: 100 }),
  registrationNumber: varchar("registrationNumber", { length: 100 }),
  taxId: varchar("taxId", { length: 100 }),
  
  // Isolation configuration
  isolationStrategy: mysqlEnum("isolationStrategy", [
    "row_level",      // Default: Row-level security
    "schema",         // Separate database schemas
    "database"        // Separate databases
  ]).default("row_level").notNull(),
  
  isolationKey: varchar("isolationKey", { length: 64 }).notNull().unique(), // For row-level security
  
  // Data residency
  dataResidency: mysqlEnum("dataResidency", [
    "us", "eu", "uk", "ap", "au", "ca", "in", "jp", "sg", "custom"
  ]).default("us").notNull(),
  dataRegion: varchar("dataRegion", { length: 100 }), // Specific region within residency
  dataCenterId: varchar("dataCenterId", { length: 100 }), // Specific data center
  
  // Subscription limits
  maxUsers: int("maxUsers").default(10).notNull(),
  maxStations: int("maxStations").default(5).notNull(),
  maxStorageGB: int("maxStorageGB").default(50).notNull(),
  
  // Status
  status: mysqlEnum("tenantStatus", [
    "active", "suspended", "terminated", "trial", "pending"
  ]).default("active").notNull(),
  
  // Compliance
  complianceTier: mysqlEnum("complianceTier", [
    "basic", "standard", "premium", "enterprise"
  ]).default("standard").notNull(),
  
  // Feature flags
  features: text("features"), // JSON: { auditLogs: true, sso: false, ... }
  
  // Subscription
  planId: bigint("planId", { mode: "number", unsigned: true }),
  
  // Billing
  billingEmail: varchar("billingEmail", { length: 320 }),
  billingAddress: text("billingAddress"),
  
  // Timestamps
  trialEndsAt: timestamp("trialEndsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  suspendedAt: timestamp("suspendedAt"),
}, (table) => ({
  slugIdx: uniqueIndex("idx_tenant_slug").on(table.slug),
  emailIdx: index("idx_tenant_email").on(table.email),
  statusIdx: index("idx_tenant_status").on(table.status),
  isolationIdx: uniqueIndex("idx_tenant_isolation").on(table.isolationKey),
}));

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// TENANT DOMAINS (Custom domains per tenant)
// ═══════════════════════════════════════════════════════════════════════════

export const tenantDomains = mysqlTable("tenant_domains", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  isPrimary: boolean("isPrimary").default(false).notNull(),
  isVerified: boolean("isVerified").default(false).notNull(),
  verificationToken: varchar("verificationToken", { length: 255 }),
  sslEnabled: boolean("sslEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("idx_tenant_domain_tenant").on(table.tenantId),
  domainIdx: uniqueIndex("idx_tenant_domain").on(table.domain),
}));

export type TenantDomain = typeof tenantDomains.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// DATA PARTITIONS (Logical data isolation)
// ═══════════════════════════════════════════════════════════════════════════

export const dataPartitions = mysqlTable("data_partitions", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  
  // Partition identification
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  
  // Partition type
  type: mysqlEnum("partitionType", [
    "station",      // Per-station data
    "region",       // Geographic region
    "department",   // Organizational department
    "project",      // Project-based
    "custom"        // User-defined
  ]).notNull(),
  
  // Hierarchy
  parentId: bigint("parentId", { mode: "number", unsigned: true }),
  level: int("level").default(0).notNull(),
  
  // Isolation
  isolationKey: varchar("isolationKey", { length: 64 }).notNull(),
  
  // Settings
  settings: text("settings"), // JSON
  metadata: text("metadata"), // JSON
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  tenantIdx: index("idx_partition_tenant").on(table.tenantId),
  isolationIdx: index("idx_partition_isolation").on(table.isolationKey),
  parentIdx: index("idx_partition_parent").on(table.parentId),
}));

export type DataPartition = typeof dataPartitions.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-TENANT RELATIONSHIPS (For shared data scenarios)
// ═══════════════════════════════════════════════════════════════════════════

export const crossTenantLinks = mysqlTable("cross_tenant_links", {
  id: serial("id").primaryKey(),
  
  // Source
  sourceTenantId: bigint("sourceTenantId", { mode: "number", unsigned: true }).notNull(),
  sourceType: varchar("sourceType", { length: 50 }).notNull(),
  sourceId: bigint("sourceId", { mode: "number", unsigned: true }).notNull(),
  
  // Target
  targetTenantId: bigint("targetTenantId", { mode: "number", unsigned: true }).notNull(),
  targetType: varchar("targetType", { length: 50 }).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }).notNull(),
  
  // Link type
  linkType: mysqlEnum("linkType", [
    "parent_child",     // Hierarchical relationship
    "partnership",      // Business partnership
    "franchise",        // Franchise relationship
    "vendor",           // Vendor relationship
    "customer"          // Customer relationship
  ]).notNull(),
  
  // Permissions
  permissions: text("permissions"), // JSON: what the target tenant can access
  
  // Status
  status: mysqlEnum("linkStatus", ["active", "suspended", "terminated"]).default("active").notNull(),
  
  // Approval
  approvedBy: bigint("approvedBy", { mode: "number", unsigned: true }),
  approvedAt: timestamp("approvedAt"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  sourceIdx: index("idx_cross_tenant_source").on(table.sourceTenantId, table.sourceType, table.sourceId),
  targetIdx: index("idx_cross_tenant_target").on(table.targetTenantId, table.targetType, table.targetId),
}));

export type CrossTenantLink = typeof crossTenantLinks.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// DATA ENCRYPTION KEYS (Per-tenant encryption)
// ═══════════════════════════════════════════════════════════════════════════

export const tenantEncryptionKeys = mysqlTable("tenant_encryption_keys", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  
  // Key identification
  keyId: varchar("keyId", { length: 100 }).notNull().unique(),
  keyVersion: int("keyVersion").notNull(),
  
  // Key material (encrypted)
  encryptedKey: text("encryptedKey").notNull(),
  
  // Key metadata
  algorithm: varchar("algorithm", { length: 50 }).default("AES-256-GCM").notNull(),
  keyPurpose: mysqlEnum("keyPurpose", [
    "data_at_rest", "data_in_transit", "backups", "audit_logs"
  ]).notNull(),
  
  // Status
  status: mysqlEnum("keyStatus", ["active", "rotating", "retired", "compromised"]).default("active").notNull(),
  
  // Rotation
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  rotatedAt: timestamp("rotatedAt"),
  expiresAt: timestamp("expiresAt"),
  rotatedBy: bigint("rotatedBy", { mode: "number", unsigned: true }),
}, (table) => ({
  tenantIdx: index("idx_encryption_tenant").on(table.tenantId),
  keyIdIdx: uniqueIndex("idx_encryption_key_id").on(table.keyId),
}));

export type TenantEncryptionKey = typeof tenantEncryptionKeys.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// TENANT SETTINGS (Per-tenant configuration)
// ═══════════════════════════════════════════════════════════════════════════

export const tenantSettings = mysqlTable("tenant_settings", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  
  // Setting identification
  category: varchar("category", { length: 50 }).notNull(), // security, general, notifications, etc.
  key: varchar("key", { length: 100 }).notNull(),
  
  // Value (encrypted if sensitive)
  value: text("value").notNull(),
  isEncrypted: boolean("isEncrypted").default(false).notNull(),
  
  // Metadata
  description: text("description"),
  isPublic: boolean("isPublic").default(false).notNull(), // Visible to users
  isRequired: boolean("isRequired").default(false).notNull(),
  
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  tenantIdx: index("idx_tenant_settings_tenant").on(table.tenantId),
  categoryIdx: index("idx_tenant_settings_category").on(table.category),
  uniqueSetting: uniqueIndex("idx_tenant_settings_unique").on(table.tenantId, table.category, table.key),
}));

export type TenantSetting = typeof tenantSettings.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// DATA ACCESS POLICIES (Fine-grained data access control)
// ═══════════════════════════════════════════════════════════════════════════

export const dataAccessPolicies = mysqlTable("data_access_policies", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  
  // Policy identification
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  
  // Applies to
  appliesTo: mysqlEnum("appliesTo", ["user", "role", "team", "all"]).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }), // user/role/team ID
  
  // Resource constraints
  resourceType: varchar("resourceType", { length: 50 }).notNull(), // sales, inventory, users
  resourceFilter: text("resourceFilter"), // JSON: { stationIds: [...], dateRange: ... }
  
  // Field-level access
  allowedFields: text("allowedFields"), // JSON: fields that can be accessed
  deniedFields: text("deniedFields"), // JSON: fields that are hidden
  maskedFields: text("maskedFields"), // JSON: fields with masked values
  
  // Actions
  allowedActions: text("allowedActions"), // JSON: ["read", "create", "update"]
  deniedActions: text("deniedActions"), // JSON: ["delete", "export"]
  
  // Conditions
  conditions: text("conditions"), // JSON: { timeOfDay: "9-5", requireMFA: true }
  
  // Priority (higher = more important)
  priority: int("priority").default(0).notNull(),
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  tenantIdx: index("idx_access_policy_tenant").on(table.tenantId),
  resourceIdx: index("idx_access_policy_resource").on(table.resourceType),
  appliesIdx: index("idx_access_policy_applies").on(table.appliesTo, table.targetId),
}));

export type DataAccessPolicy = typeof dataAccessPolicies.$inferSelect;