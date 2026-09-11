import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  decimal,
  int,
  json,
  boolean,
} from "drizzle-orm/mysql-core";

// ═══════════════════════════════════════════════════════════
// AUTH & USERS
// ═══════════════════════════════════════════════════════════

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("userStatus", ["active", "suspended", "banned", "pending"]).default("active").notNull(),
  countryCode: varchar("countryCode", { length: 2 }),
  phone: varchar("phone", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ═══════════════════════════════════════════════════════════
// STATIONS & ACCESS CONTROL
// ═══════════════════════════════════════════════════════════

export const stations = mysqlTable("stations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  location: varchar("location", { length: 500 }),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  country: varchar("country", { length: 100 }),
  countryCode: varchar("countryCode", { length: 2 }),
  phone: varchar("phone", { length: 50 }),
  managerName: varchar("managerName", { length: 255 }),
  status: mysqlEnum("status", ["active", "inactive", "maintenance"]).default("active").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("0").notNull(),
  receiptFooter: text("receiptFooter"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Station = typeof stations.$inferSelect;

export const stationUsers = mysqlTable("station_users", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("stationRole", ["owner", "manager", "cashier", "viewer"]).default("viewer").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════
// INVENTORY & SALES
// ═══════════════════════════════════════════════════════════

export const inventory = mysqlTable("inventory", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }).notNull(),
  fuelType: mysqlEnum("fuelType", ["petrol", "diesel", "premium", "kerosene", "lpg"]).notNull(),
  currentStock: decimal("currentStock", { precision: 12, scale: 2 }).default("0").notNull(),
  capacity: decimal("capacity", { precision: 12, scale: 2 }).default("0").notNull(),
  pricePerLiter: decimal("pricePerLiter", { precision: 10, scale: 2 }).default("0").notNull(),
  costPerLiter: decimal("costPerLiter", { precision: 10, scale: 2 }).default("0").notNull(),
  supplierName: varchar("supplierName", { length: 255 }),
  lastRestockedAt: timestamp("lastRestockedAt"),
  alertThreshold: decimal("alertThreshold", { precision: 12, scale: 2 }).default("500").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sales = mysqlTable("sales", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  fuelType: mysqlEnum("fuelType", ["petrol", "diesel", "premium", "kerosene", "lpg"]).notNull(),
  quantityLiters: decimal("quantityLiters", { precision: 12, scale: 2 }).notNull(),
  pricePerLiter: decimal("pricePerLiter", { precision: 10, scale: 2 }).notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal("taxAmount", { precision: 12, scale: 2 }).default("0").notNull(),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("paymentMethod", { length: 100 }).notNull(),
  pumpNumber: varchar("pumpNumber", { length: 20 }),
  receiptNumber: varchar("receiptNumber", { length: 50 }),
  notes: text("notes"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════
// PAYMENT METHODS
// ═══════════════════════════════════════════════════════════

export const bankAccounts = mysqlTable("bank_accounts", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  bankName: varchar("bankName", { length: 255 }).notNull(),
  accountName: varchar("accountName", { length: 255 }).notNull(),
  accountNumber: varchar("accountNumber", { length: 100 }).notNull(),
  branch: varchar("branch", { length: 255 }),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  countryCode: varchar("countryCode", { length: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const mobileMoneyConfigs = mysqlTable("mobile_money_configs", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  provider: varchar("provider", { length: 255 }).notNull(),
  paybillNumber: varchar("paybillNumber", { length: 100 }),
  accountReference: varchar("accountReference", { length: 100 }),
  apiKey: varchar("apiKey", { length: 500 }),
  shortCode: varchar("shortCode", { length: 50 }),
  countryCode: varchar("countryCode", { length: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const additionalPaymentMethods = mysqlTable("additional_payment_methods", {
  id: serial("id").primaryKey(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  name: varchar("name", { length: 255 }).notNull(),
  config: text("config"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════
// AUDIT & FOUNDER SESSIONS
// ═══════════════════════════════════════════════════════════

export const auditLogs = mysqlTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  event: varchar("event", { length: 255 }).notNull(),
  detail: text("detail"),
  severity: mysqlEnum("severity", ["info", "success", "warning", "danger"]).default("info").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const founderSessions = mysqlTable("founder_sessions", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique(),
  lastLoginAt: timestamp("lastLoginAt").defaultNow().notNull(),
  twoFactorEnabled: boolean("twoFactorEnabled").default(false).notNull(),
  twoFactorSecret: varchar("twoFactorSecret", { length: 255 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  passwordHash: varchar("passwordHash", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — FEATURE FLAGS
// ═══════════════════════════════════════════════════════════

export const featureFlags = mysqlTable("feature_flags", {
  id: serial("id").primaryKey(),
  flagKey: varchar("flagKey", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  enabled: boolean("enabled").default(false).notNull(),
  scope: mysqlEnum("scope", ["global", "station", "user"]).default("global").notNull(),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — PRICING & SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════

export const pricingPlans = mysqlTable("pricing_plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  billingPeriod: mysqlEnum("billingPeriod", ["monthly", "quarterly", "yearly", "lifetime"]).default("monthly").notNull(),
  maxStations: int("maxStations").default(1).notNull(),
  maxUsers: int("maxUsers").default(5).notNull(),
  features: text("features"), // JSON array of feature strings
  isActive: boolean("isActive").default(true).notNull(),
  isPublic: boolean("isPublic").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type PricingPlan = typeof pricingPlans.$inferSelect;

export const subscriptions = mysqlTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  planId: bigint("planId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("subStatus", ["active", "trialing", "past_due", "canceled", "expired"]).default("active").notNull(),
  trialEndsAt: timestamp("trialEndsAt"),
  currentPeriodStart: timestamp("currentPeriodStart").defaultNow().notNull(),
  currentPeriodEnd: timestamp("currentPeriodEnd").notNull(),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  paymentMethod: varchar("paymentMethod", { length: 100 }),
  amountPaid: decimal("amountPaid", { precision: 10, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Subscription = typeof subscriptions.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — COUPONS
// ═══════════════════════════════════════════════════════════

export const coupons = mysqlTable("coupons", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  description: text("description"),
  discountType: mysqlEnum("discountType", ["percentage", "fixed_amount"]).default("percentage").notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).notNull(),
  maxUses: int("maxUses").default(0).notNull(), // 0 = unlimited
  timesUsed: int("timesUsed").default(0).notNull(),
  minOrderAmount: decimal("minOrderAmount", { precision: 10, scale: 2 }).default("0").notNull(),
  validFrom: timestamp("validFrom").defaultNow().notNull(),
  validUntil: timestamp("validUntil"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — SYSTEM CONFIGURATION
// ═══════════════════════════════════════════════════════════

export const systemConfig = mysqlTable("system_config", {
  id: serial("id").primaryKey(),
  configKey: varchar("configKey", { length: 200 }).notNull().unique(),
  configValue: text("configValue"),
  configGroup: varchar("configGroup", { length: 100 }).default("general").notNull(),
  description: text("description"),
  isPublic: boolean("isPublic").default(false).notNull(),
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type SystemConfig = typeof systemConfig.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — API KEYS & WEBHOOKS
// ═══════════════════════════════════════════════════════════

export const apiKeys = mysqlTable("api_keys", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("keyHash", { length: 500 }).notNull(),
  prefix: varchar("prefix", { length: 20 }).notNull(),
  permissions: text("permissions"), // JSON array of permission strings
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;

export const webhooks = mysqlTable("webhooks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url").notNull(),
  events: text("events"), // JSON array of event names
  secret: varchar("secret", { length: 500 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  lastStatus: int("lastStatus"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Webhook = typeof webhooks.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════

export const emailTemplates = mysqlTable("email_templates", {
  id: serial("id").primaryKey(),
  templateKey: varchar("templateKey", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: text("bodyHtml").notNull(),
  bodyText: text("bodyText"),
  variables: text("variables"), // JSON array of available variable names
  isActive: boolean("isActive").default(true).notNull(),
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type EmailTemplate = typeof emailTemplates.$inferSelect;

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — USER ACTIVITY LOG
// ═══════════════════════════════════════════════════════════

export const userActivityLog = mysqlTable("user_activity_log", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entityType", { length: 100 }), // 'station', 'sale', 'inventory', etc.
  entityId: bigint("entityId", { mode: "number", unsigned: true }),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════
// FOUNDER ACCESS — BACKUPS
// ═══════════════════════════════════════════════════════════

export const backups = mysqlTable("backups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("backupType", ["full", "schema", "data", "settings"]).default("full").notNull(),
  size: varchar("size", { length: 50 }),
  status: mysqlEnum("backupStatus", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  downloadUrl: text("downloadUrl"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type Backup = typeof backups.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// SOC-2 COMPLIANT AUDIT LOGGING (Enhanced)
// ═══════════════════════════════════════════════════════════════════════════

export const auditLogEntries = mysqlTable("audit_log_entries", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar("eventId", { length: 64 }).notNull().unique(),
  eventType: mysqlEnum("eventType", ["authentication", "authorization", "data_access", "data_modification", "configuration", "system"]).notNull(),
  actorType: mysqlEnum("actorType", ["user", "system", "api_key", "service"]).notNull(),
  actorId: varchar("actorId", { length: 255 }),
  actorName: varchar("actorName", { length: 255 }),
  actorEmail: varchar("actorEmail", { length: 320 }),
  sessionId: varchar("sessionId", { length: 255 }),
  resourceType: varchar("resourceType", { length: 100 }),
  resourceId: varchar("resourceId", { length: 255 }),
  resourceName: varchar("resourceName", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(),
  actionResult: mysqlEnum("actionResult", ["success", "failure", "denied", "partial"]).default("success").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  requestMethod: varchar("requestMethod", { length: 10 }),
  requestPath: varchar("requestPath", { length: 1000 }),
  requestQuery: text("requestQuery"),
  responseStatus: int("responseStatus"),
  responseTime: int("responseTime"),
  previousValue: text("previousValue"),
  newValue: text("newValue"),
  changedFields: text("changedFields"),
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("low").notNull(),
  riskFactors: text("riskFactors"),
  isComplianceRelevant: boolean("isComplianceRelevant").default(false).notNull(),
  retentionCategory: mysqlEnum("retentionCategory", ["standard", "extended", "regulatory", "permanent"]).default("standard").notNull(),
  previousHash: varchar("previousHash", { length: 64 }),
  entryHash: varchar("entryHash", { length: 64 }).notNull(),
  signature: text("signature"),
  eventTimestamp: timestamp("eventTimestamp").defaultNow().notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  tags: text("tags"),
  metadata: text("metadata"),
});

export type AuditLogEntry = typeof auditLogEntries.$inferSelect;

export const authEvents = mysqlTable("auth_events", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar("eventId", { length: 64 }).notNull().unique(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  unionId: varchar("unionId", { length: 255 }),
  email: varchar("email", { length: 320 }),
  authMethod: mysqlEnum("authMethod", ["password", "magic_link", "oauth", "mfa_totp", "mfa_sms", "mfa_email", "api_key", "session"]).notNull(),
  eventType: mysqlEnum("authEventType", ["login_success", "login_failure", "logout", "mfa_enabled", "mfa_disabled", "mfa_challenge", "mfa_failure", "password_changed", "password_reset_requested", "password_reset_completed", "session_created", "session_expired", "session_revoked", "api_key_created", "api_key_revoked", "account_locked", "account_unlocked"]).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  success: boolean("success").default(true).notNull(),
  failureReason: varchar("failureReason", { length: 255 }),
  sessionId: varchar("sessionId", { length: 255 }),
  expiresAt: timestamp("expiresAt"),
  riskScore: int("riskScore"),
  riskSignals: text("riskSignals"),
  blockedByMFA: boolean("blockedByMFA").default(false).notNull(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  retentionCategory: mysqlEnum("retentionCategory", ["standard", "extended", "regulatory"]).default("standard").notNull(),
  entryHash: varchar("entryHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuthEvent = typeof authEvents.$inferSelect;

export const dataAccessLog = mysqlTable("data_access_log", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  eventId: varchar("eventId", { length: 64 }).notNull().unique(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  userName: varchar("userName", { length: 255 }),
  userEmail: varchar("userEmail", { length: 320 }),
  resourceType: varchar("resourceType", { length: 100 }).notNull(),
  resourceId: varchar("resourceId", { length: 255 }),
  action: varchar("action", { length: 50 }).notNull(),
  accessType: mysqlEnum("accessType", ["view", "export", "print", "share", "download"]).notNull(),
  filters: text("filters"),
  fieldsAccessed: text("fieldsAccessed"),
  recordsAccessed: int("recordsAccessed").default(0).notNull(),
  responseSize: bigint("responseSize", { mode: "number", unsigned: true }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  sessionId: varchar("sessionId", { length: 255 }),
  teamId: bigint("teamId", { mode: "number", unsigned: true }),
  stationId: bigint("stationId", { mode: "number", unsigned: true }),
  isPII: boolean("isPII").default(false).notNull(),
  isSensitive: boolean("isSensitive").default(false).notNull(),
  retentionCategory: mysqlEnum("retentionCategory", ["standard", "extended", "regulatory"]).default("standard").notNull(),
  entryHash: varchar("entryHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataAccessLog = typeof dataAccessLog.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS CONTROL TABLES
// ═══════════════════════════════════════════════════════════════════════════

export const permissions = mysqlTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  resourceCategory: mysqlEnum("resourceCategory", ["dashboard", "sales", "inventory", "payments", "reports", "users", "stations", "settings", "audit"]).notNull(),
  actionType: mysqlEnum("actionType", ["create", "read", "update", "delete", "export", "manage"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Permission = typeof permissions.$inferSelect;

export const roles = mysqlTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  level: int("level").default(0).notNull(),
  type: mysqlEnum("roleType", ["system", "custom", "founder"]).default("custom").notNull(),
  isTeamScoped: boolean("isTeamScoped").default(false).notNull(),
  isDataTypeScoped: boolean("isDataTypeScoped").default(false).notNull(),
  isActionScoped: boolean("isActionScoped").default(false).notNull(),
  permissions: text("permissions"),
  canManageUsers: boolean("canManageUsers").default(false).notNull(),
  canManageRoles: boolean("canManageRoles").default(false).notNull(),
  canViewAuditLogs: boolean("canViewAuditLogs").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Role = typeof roles.$inferSelect;

export const teams = mysqlTable("teams", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  settings: text("settings"),
  maxMembers: int("maxMembers").default(10).notNull(),
  maxStations: int("maxStations").default(5).notNull(),
  features: text("features"),
  status: mysqlEnum("teamStatus", ["active", "suspended", "archived"]).default("active").notNull(),
  isolationKey: varchar("isolationKey", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Team = typeof teams.$inferSelect;

export const teamMembers = mysqlTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  customPermissions: text("customPermissions"),
  deniedPermissions: text("deniedPermissions"),
  status: mysqlEnum("memberStatus", ["active", "invited", "suspended", "removed"]).default("active").notNull(),
  invitedAt: timestamp("invitedAt"),
  joinedAt: timestamp("joinedAt"),
  invitedBy: bigint("invitedBy", { mode: "number", unsigned: true }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type TeamMember = typeof teamMembers.$inferSelect;

export const dataScopes = mysqlTable("data_scopes", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  resourceType: varchar("resourceType", { length: 50 }).notNull(),
  filterConfig: text("filterConfig").notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type DataScope = typeof dataScopes.$inferSelect;

export const actionScopes = mysqlTable("action_scopes", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  permissionCode: varchar("permissionCode", { length: 100 }).notNull(),
  limitations: text("limitations"),
  conditions: text("conditions"),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type ActionScope = typeof actionScopes.$inferSelect;

export const teamInvitations = mysqlTable("team_invitations", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  invitedBy: bigint("invitedBy", { mode: "number", unsigned: true }).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  status: mysqlEnum("invitationStatus", ["pending", "accepted", "declined", "expired"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  declinedAt: timestamp("declinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamInvitation = typeof teamInvitations.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// DATA ISOLATION TABLES
// ═══════════════════════════════════════════════════════════════════════════

export const tenants = mysqlTable("tenants", {
  id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 255 }),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  businessType: varchar("businessType", { length: 100 }),
  registrationNumber: varchar("registrationNumber", { length: 100 }),
  taxId: varchar("taxId", { length: 100 }),
  isolationStrategy: mysqlEnum("isolationStrategy", ["row_level", "schema", "database"]).default("row_level").notNull(),
  isolationKey: varchar("isolationKey", { length: 64 }).notNull().unique(),
  dataResidency: mysqlEnum("dataResidency", ["us", "eu", "uk", "ap", "au", "ca", "in", "jp", "sg", "custom"]).default("us").notNull(),
  dataRegion: varchar("dataRegion", { length: 100 }),
  dataCenterId: varchar("dataCenterId", { length: 100 }),
  maxUsers: int("maxUsers").default(10).notNull(),
  maxStations: int("maxStations").default(5).notNull(),
  maxStorageGB: int("maxStorageGB").default(50).notNull(),
  status: mysqlEnum("tenantStatus", ["active", "suspended", "terminated", "trial", "pending"]).default("active").notNull(),
  complianceTier: mysqlEnum("complianceTier", ["basic", "standard", "premium", "enterprise"]).default("standard").notNull(),
  features: text("features"),
  planId: bigint("planId", { mode: "number", unsigned: true }),
  billingEmail: varchar("billingEmail", { length: 320 }),
  billingAddress: text("billingAddress"),
  trialEndsAt: timestamp("trialEndsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  suspendedAt: timestamp("suspendedAt"),
});

export type Tenant = typeof tenants.$inferSelect;

export const tenantDomains = mysqlTable("tenant_domains", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  isPrimary: boolean("isPrimary").default(false).notNull(),
  isVerified: boolean("isVerified").default(false).notNull(),
  verificationToken: varchar("verificationToken", { length: 255 }),
  sslEnabled: boolean("sslEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TenantDomain = typeof tenantDomains.$inferSelect;

export const dataPartitions = mysqlTable("data_partitions", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  type: mysqlEnum("partitionType", ["station", "region", "department", "project", "custom"]).notNull(),
  parentId: bigint("parentId", { mode: "number", unsigned: true }),
  level: int("level").default(0).notNull(),
  isolationKey: varchar("isolationKey", { length: 64 }).notNull(),
  settings: text("settings"),
  metadata: text("metadata"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type DataPartition = typeof dataPartitions.$inferSelect;

export const crossTenantLinks = mysqlTable("cross_tenant_links", {
  id: serial("id").primaryKey(),
  sourceTenantId: bigint("sourceTenantId", { mode: "number", unsigned: true }).notNull(),
  sourceType: varchar("sourceType", { length: 50 }).notNull(),
  sourceId: bigint("sourceId", { mode: "number", unsigned: true }).notNull(),
  targetTenantId: bigint("targetTenantId", { mode: "number", unsigned: true }).notNull(),
  targetType: varchar("targetType", { length: 50 }).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }).notNull(),
  linkType: mysqlEnum("linkType", ["parent_child", "partnership", "franchise", "vendor", "customer"]).notNull(),
  permissions: text("permissions"),
  status: mysqlEnum("linkStatus", ["active", "suspended", "terminated"]).default("active").notNull(),
  approvedBy: bigint("approvedBy", { mode: "number", unsigned: true }),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type CrossTenantLink = typeof crossTenantLinks.$inferSelect;

export const tenantEncryptionKeys = mysqlTable("tenant_encryption_keys", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  keyId: varchar("keyId", { length: 100 }).notNull().unique(),
  keyVersion: int("keyVersion").notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  algorithm: varchar("algorithm", { length: 50 }).default("AES-256-GCM").notNull(),
  keyPurpose: mysqlEnum("keyPurpose", ["data_at_rest", "data_in_transit", "backups", "audit_logs"]).notNull(),
  status: mysqlEnum("keyStatus", ["active", "rotating", "retired", "compromised"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  rotatedAt: timestamp("rotatedAt"),
  expiresAt: timestamp("expiresAt"),
  rotatedBy: bigint("rotatedBy", { mode: "number", unsigned: true }),
});

export type TenantEncryptionKey = typeof tenantEncryptionKeys.$inferSelect;

export const tenantSettings = mysqlTable("tenant_settings", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  key: varchar("key", { length: 100 }).notNull(),
  value: text("value").notNull(),
  isEncrypted: boolean("isEncrypted").default(false).notNull(),
  description: text("description"),
  isPublic: boolean("isPublic").default(false).notNull(),
  isRequired: boolean("isRequired").default(false).notNull(),
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type TenantSetting = typeof tenantSettings.$inferSelect;

export const dataAccessPolicies = mysqlTable("data_access_policies", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  appliesTo: mysqlEnum("appliesTo", ["user", "role", "team", "all"]).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }),
  resourceType: varchar("resourceType", { length: 50 }).notNull(),
  resourceFilter: text("resourceFilter"),
  allowedFields: text("allowedFields"),
  deniedFields: text("deniedFields"),
  maskedFields: text("maskedFields"),
  allowedActions: text("allowedActions"),
  deniedActions: text("deniedActions"),
  conditions: text("conditions"),
  priority: int("priority").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type DataAccessPolicy = typeof dataAccessPolicies.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// SITE CONFIGURATION (Dynamic Settings)
// ═══════════════════════════════════════════════════════════════════════════

export const siteConfigs = mysqlTable("site_configs", {
  id: serial("id").primaryKey(),
  key: varchar("configKey", { length: 255 }).notNull().unique(),
  value: text("configValue").notNull(),
  type: mysqlEnum("configType", ["string", "number", "boolean", "json"]).default("string").notNull(),
  category: varchar("configCategory", { length: 100 }).default("general").notNull(),
  description: text("description"),
  isPublic: boolean("isPublic").default(false).notNull(),
  isEncrypted: boolean("isEncrypted").default(false).notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type SiteConfig = typeof siteConfigs.$inferSelect;

export const configVersions = mysqlTable("config_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  snapshot: text("snapshot").notNull(), // JSON snapshot of all configs
  status: mysqlEnum("versionStatus", ["draft", "published", "archived"]).default("draft").notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  publishedAt: timestamp("publishedAt"),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ConfigVersion = typeof configVersions.$inferSelect;
