/**
 * SOC-2 Compliant Audit Logging Schema
 * 
 * Requirements:
 * - Immutable: No updates or deletes allowed
 * - Queryable: Indexed for fast searches
 * - Separate from app data: Different database/tablespace
 * - Tamper-evident: Hash chains for integrity verification
 * - Comprehensive: All access attempts logged
 * 
 * Events captured:
 * - Authentication (login, logout, MFA, password changes)
 * - Authorization (access granted/denied)
 * - Data access (reads with filters)
 * - Data modifications (creates, updates, deletes)
 * - Configuration changes
 * - System events
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
// AUDIT LOG ENTRIES (Main immutable log)
// ═══════════════════════════════════════════════════════════════════════════

export const auditLogEntries = mysqlTable("audit_log_entries", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  
  // Event identification
  eventId: varchar("eventId", { length: 64 }).notNull().unique(), // UUID for deduplication
  eventType: mysqlEnum("eventType", [
    "authentication",     // Login, logout, MFA, password changes
    "authorization",      // Access granted/denied
    "data_access",        // Read operations
    "data_modification",  // Create, update, delete
    "configuration",      // Settings changes
    "system"             // Infrastructure events
  ]).notNull(),
  
  // Actor (who performed the action)
  actorType: mysqlEnum("actorType", ["user", "system", "api_key", "service"]).notNull(),
  actorId: varchar("actorId", { length: 255 }),
  actorName: varchar("actorName", { length: 255 }),
  actorEmail: varchar("actorEmail", { length: 320 }),
  
  // Session context
  sessionId: varchar("sessionId", { length: 255 }),
  
  // Resource accessed
  resourceType: varchar("resourceType", { length: 100 }), // e.g., "sale", "user", "station"
  resourceId: varchar("resourceId", { length: 255 }),
  resourceName: varchar("resourceName", { length: 255 }),
  
  // Action details
  action: varchar("action", { length: 100 }).notNull(), // "create", "read", "update", "delete", "login", etc.
  actionResult: mysqlEnum("actionResult", ["success", "failure", "denied", "partial"]).default("success").notNull(),
  
  // Request context
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv6 compatible
  userAgent: text("userAgent"),
  requestMethod: varchar("requestMethod", { length: 10 }),
  requestPath: varchar("requestPath", { length: 1000 }),
  requestQuery: text("requestQuery"),
  
  // Response details
  responseStatus: int("responseStatus"),
  responseTime: int("responseTime"), // milliseconds
  
  // Change details (before/after for modifications)
  previousValue: text("previousValue"), // JSON of old state
  newValue: text("newValue"), // JSON of new state
  changedFields: text("changedFields"), // JSON array of field names
  
  // Data scope (for multi-tenant)
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  
  // Location information
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  
  // Risk assessment
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("low").notNull(),
  riskFactors: text("riskFactors"), // JSON: ["new_device", "unusual_time", "new_location"]
  
  // Compliance flags
  isComplianceRelevant: boolean("isComplianceRelevant").default(false).notNull(),
  retentionCategory: mysqlEnum("retentionCategory", [
    "standard",      // 90 days
    "extended",      // 1 year
    "regulatory",    // 7 years (SOC-2, GDPR)
    "permanent"     // Never deleted
  ]).default("standard").notNull(),
  
  // Integrity verification
  previousHash: varchar("previousHash", { length: 64 }), // Hash of previous entry
  entryHash: varchar("entryHash", { length: 64 }).notNull(), // SHA-256 of this entry
  signature: text("signature"), // Optional HMAC signature
  
  // Timestamps
  eventTimestamp: timestamp("eventTimestamp").defaultNow().notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  
  // Tags for categorization
  tags: text("tags"), // JSON array of strings
  
  // Metadata
  metadata: text("metadata"), // JSON for extensible data
}, (table) => ({
  // Indexes for common queries
  eventIdIdx: uniqueIndex("idx_audit_event_id").on(table.eventId),
  eventTypeIdx: index("idx_audit_event_type").on(table.eventType),
  actorIdx: index("idx_audit_actor").on(table.actorType, table.actorId),
  actorEmailIdx: index("idx_audit_actor_email").on(table.actorEmail),
  resourceIdx: index("idx_audit_resource").on(table.resourceType, table.resourceId),
  teamIdx: index("idx_audit_team").on(table.teamId),
  stationIdx: index("idx_audit_station").on(table.stationId),
  timestampIdx: index("idx_audit_timestamp").on(table.eventTimestamp),
  riskIdx: index("idx_audit_risk").on(table.riskLevel),
  actionResultIdx: index("idx_audit_result").on(table.actionResult),
  retentionIdx: index("idx_audit_retention").on(table.retentionCategory),
  ipIdx: index("idx_audit_ip").on(table.ipAddress),
  entryHashIdx: index("idx_audit_hash").on(table.entryHash),
}));

export type AuditLogEntry = typeof auditLogEntries.$inferSelect;
export type InsertAuditLogEntry = typeof auditLogEntries.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION EVENTS (Detailed auth logging)
// ═══════════════════════════════════════════════════════════════════════════

export const authEvents = mysqlTable("auth_events", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar("eventId", { length: 64 }).notNull().unique(),
  
  // User info
  userId: bigint("userId", { mode: "number", unsigned: true }),
  unionId: varchar("unionId", { length: 255 }),
  email: varchar("email", { length: 320 }),
  
  // Auth method
  authMethod: mysqlEnum("authMethod", [
    "password", "magic_link", "oauth", "mfa_totp", 
    "mfa_sms", "mfa_email", "api_key", "session"
  ]).notNull(),
  
  // Event type
  eventType: mysqlEnum("authEventType", [
    "login_success", "login_failure", "logout", 
    "mfa_enabled", "mfa_disabled", "mfa_challenge", "mfa_failure",
    "password_changed", "password_reset_requested", "password_reset_completed",
    "session_created", "session_expired", "session_revoked",
    "api_key_created", "api_key_revoked",
    "account_locked", "account_unlocked"
  ]).notNull(),
  
  // Context
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  
  // Result
  success: boolean("success").default(true).notNull(),
  failureReason: varchar("failureReason", { length: 255 }),
  
  // Session info
  sessionId: varchar("sessionId", { length: 255 }),
  expiresAt: timestamp("expiresAt"),
  
  // Risk signals
  riskScore: int("riskScore"), // 0-100
  riskSignals: text("riskSignals"), // JSON: ["new_device", "unusual_location"]
  blockedByMFA: boolean("blockedByMFA").default(false).notNull(),
  
  // Compliance
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  retentionCategory: mysqlEnum("retentionCategory", ["standard", "extended", "regulatory"]).default("standard").notNull(),
  
  // Integrity
  entryHash: varchar("entryHash", { length: 64 }).notNull(),
  
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  eventIdIdx: uniqueIndex("idx_auth_event_id").on(table.eventId),
  userIdx: index("idx_auth_event_user").on(table.userId),
  emailIdx: index("idx_auth_event_email").on(table.email),
  timestampIdx: index("idx_auth_event_timestamp").on(table.createdAt),
  teamIdx: index("idx_auth_event_team").on(table.teamId),
}));

export type AuthEvent = typeof authEvents.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// DATA ACCESS LOG (Who accessed what data)
// ═══════════════════════════════════════════════════════════════════════════

export const dataAccessLog = mysqlTable("data_access_log", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar("eventId", { length: 64 }).notNull().unique(),
  
  // Actor
  userId: bigint("userId", { mode: "number", unsigned: true }),
  userName: varchar("userName", { length: 255 }),
  userEmail: varchar("userEmail", { length: 320 }),
  
  // Resource
  resourceType: varchar("resourceType", { length: 100 }).notNull(),
  resourceId: varchar("resourceId", { length: 255 }),
  
  // Access details
  action: varchar("action", { length: 50 }).notNull(), // read, export, print
  accessType: mysqlEnum("accessType", ["view", "export", "print", "share", "download"]).notNull(),
  
  // Query filters used (what data was accessed)
  filters: text("filters"), // JSON of applied filters
  fieldsAccessed: text("fieldsAccessed"), // JSON array of field names
  
  // Response
  recordsAccessed: int("recordsAccessed").default(0).notNull(),
  responseSize: bigint("responseSize", { mode: "number", unsigned: true }), // bytes
  
  // Context
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  sessionId: varchar("sessionId", { length: 255 }),
  
  // Data isolation
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  
  // Compliance
  isPII: boolean("isPII").default(false).notNull(),
  isSensitive: boolean("isSensitive").default(false).notNull(),
  retentionCategory: mysqlEnum("retentionCategory", ["standard", "extended", "regulatory"]).default("standard").notNull(),
  
  // Integrity
  entryHash: varchar("entryHash", { length: 64 }).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  eventIdIdx: uniqueIndex("idx_data_access_event_id").on(table.eventId),
  userIdx: index("idx_data_access_user").on(table.userId),
  resourceIdx: index("idx_data_access_resource").on(table.resourceType, table.resourceId),
  timestampIdx: index("idx_data_access_timestamp").on(table.createdAt),
  teamIdx: index("idx_data_access_team").on(table.teamId),
}));

export type DataAccessLog = typeof dataAccessLog.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRITY LOG (Hash chain for tamper detection)
// ═══════════════════════════════════════════════════════════════════════════

export const integrityLog = mysqlTable("integrity_log", {
  id: serial("id").primaryKey(),
  
  // Log type
  logType: mysqlEnum("logType", ["daily_summary", "weekly_summary", "integrity_check"]).notNull(),
  
  // Period covered
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  
  // Hash information
  firstEntryHash: varchar("firstEntryHash", { length: 64 }).notNull(),
  lastEntryHash: varchar("lastEntryHash", { length: 64 }).notNull(),
  entriesCount: bigint("entriesCount", { mode: "number", unsigned: true }).notNull(),
  
  // Verification
  computedHash: varchar("computedHash", { length: 64 }).notNull(),
  isVerified: boolean("isVerified").default(true).notNull(),
  verificationDetails: text("verificationDetails"),
  
  // Signature
  signedBy: varchar("signedBy", { length: 255 }),
  signature: text("signature"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  periodIdx: index("idx_integrity_period").on(table.periodStart, table.periodEnd),
  verifiedIdx: index("idx_integrity_verified").on(table.isVerified),
}));

export type IntegrityLog = typeof integrityLog.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// RETENTION POLICY
// ═══════════════════════════════════════════════════════════════════════════

export const retentionPolicies = mysqlTable("retention_policies", {
  id: serial("id").primaryKey(),
  
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  
  // Retention periods (in days)
  standardRetention: int("standardRetention").default(90).notNull(),
  extendedRetention: int("extendedRetention").default(365).notNull(),
  regulatoryRetention: int("regulatoryRetention").default(2555).notNull(), // ~7 years
  
  // What to retain
  eventTypes: text("eventTypes"), // JSON array of event types to retain
  requireEncryption: boolean("requireEncryption").default(true).notNull(),
  requireWORM: boolean("requireWORM").default(true).notNull(), // Write Once Read Many
  
  // Compliance standards
  complianceStandards: text("complianceStandards"), // JSON: ["SOC2", "GDPR", "HIPAA"]
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type RetentionPolicy = typeof retentionPolicies.$inferSelect;