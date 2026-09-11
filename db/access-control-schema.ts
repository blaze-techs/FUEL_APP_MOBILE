/**
 * Access Control Schema - SOC-2 Compliant Role-Based Access Control (RBAC)
 * Supports: Team scoping, Data type scoping, Action scoping
 * 
 * Architecture:
 * - Roles are templates that define permission sets
 * - Users are assigned roles within team contexts
 * - Permissions are granular: resource:type:action
 * - Data isolation enforced at query level
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
} from "drizzle-orm/mysql-core";

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSION DEFINITIONS (Reference Table)
// ═══════════════════════════════════════════════════════════════════════════

export const permissions = mysqlTable("permissions", {
  id: serial("id").primaryKey(),
  // Format: resource:action (e.g., "sales:create", "inventory:read", "users:delete")
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Resource categories for UI grouping
  resourceCategory: mysqlEnum("resourceCategory", [
    "dashboard", "sales", "inventory", "payments", 
    "reports", "users", "stations", "settings", "audit"
  ]).notNull(),
  // Action types
  actionType: mysqlEnum("actionType", ["create", "read", "update", "delete", "export", "manage"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  codeIdx: index("idx_permission_code").on(table.code),
  categoryIdx: index("idx_permission_category").on(table.resourceCategory),
}));

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = typeof permissions.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// ROLE DEFINITIONS (Templates)
// ═══════════════════════════════════════════════════════════════════════════

export const roles = mysqlTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  // Role hierarchy for permission inheritance
  level: int("level").default(0).notNull(), // Higher = more powerful
  // Role types
  type: mysqlEnum("roleType", [
    "system",    // Built-in system roles (admin, viewer)
    "custom",    // User-created roles
    "founder"    // Founder access roles
  ]).default("custom").notNull(),
  // Scope limitations
  isTeamScoped: boolean("isTeamScoped").default(false).notNull(),
  isDataTypeScoped: boolean("isDataTypeScoped").default(false).notNull(),
  isActionScoped: boolean("isActionScoped").default(false).notNull(),
  // Permissions JSON array of permission codes
  permissions: text("permissions"), // JSON: ["sales:create", "sales:read", ...]
  // Can manage other users
  canManageUsers: boolean("canManageUsers").default(false).notNull(),
  canManageRoles: boolean("canManageRoles").default(false).notNull(),
  canViewAuditLogs: boolean("canViewAuditLogs").default(false).notNull(),
  // System flags
  isActive: boolean("isActive").default(true).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(), // Default role for new users
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  codeIdx: index("idx_role_code").on(table.code),
  levelIdx: index("idx_role_level").on(table.level),
}));

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// TEAMS (Organization Units)
// ═══════════════════════════════════════════════════════════════════════════

export const teams = mysqlTable("teams", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  // Owner who created the team
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  // Team settings
  settings: text("settings"), // JSON: { allowGuestUsers, maxMembers, etc. }
  // Subscription/plan limits
  maxMembers: int("maxMembers").default(10).notNull(),
  maxStations: int("maxStations").default(5).notNull(),
  // Features enabled for this team
  features: text("features"), // JSON: { auditRetention, customRoles, etc. }
  // Status
  status: mysqlEnum("teamStatus", ["active", "suspended", "archived"]).default("active").notNull(),
  // Data isolation key (for multi-tenant architecture)
  isolationKey: varchar("isolationKey", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  ownerIdx: index("idx_team_owner").on(table.ownerId),
  slugIdx: index("idx_team_slug").on(table.slug),
  isolationIdx: index("idx_team_isolation").on(table.isolationKey),
}));

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// TEAM MEMBERS (User-Team-Role Association)
// ═══════════════════════════════════════════════════════════════════════════

export const teamMembers = mysqlTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  // Custom permission overrides for this user (extends role)
  customPermissions: text("customPermissions"), // JSON: additional permissions
  // Custom permission denials (revokes from role)
  deniedPermissions: text("deniedPermissions"), // JSON: revoked permissions
  // Status
  status: mysqlEnum("memberStatus", ["active", "invited", "suspended", "removed"]).default("active").notNull(),
  // Invitation
  invitedAt: timestamp("invitedAt"),
  joinedAt: timestamp("joinedAt"),
  invitedBy: bigint("invitedBy", { mode: "number", unsigned: true }),
  // Metadata
  metadata: text("metadata"), // JSON: { department, title, location }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  teamIdx: index("idx_team_member_team").on(table.teamId),
  userIdx: index("idx_team_member_user").on(table.userId),
  roleIdx: index("idx_team_member_role").on(table.roleId),
  uniqueMember: index("idx_team_member_unique").on(table.teamId, table.userId),
}));

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// DATA TYPE SCOPES (What data a role can access)
// ═══════════════════════════════════════════════════════════════════════════

export const dataScopes = mysqlTable("data_scopes", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  // Resource type: "stations", "sales", "inventory", etc.
  resourceType: varchar("resourceType", { length: 50 }).notNull(),
  // Filter configuration (JSON): { stationIds: [...], dateRange: {...} }
  filterConfig: text("filterConfig").notNull(),
  // Role this scope applies to
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  // User override (null = applies to all users with this role)
  userId: bigint("userId", { mode: "number", unsigned: true }),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  teamIdx: index("idx_data_scope_team").on(table.teamId),
  resourceIdx: index("idx_data_scope_resource").on(table.resourceType),
  userIdx: index("idx_data_scope_user").on(table.userId),
}));

export type DataScope = typeof dataScopes.$inferSelect;
export type InsertDataScope = typeof dataScopes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCOPES (Fine-grained action limitations)
// ═══════════════════════════════════════════════════════════════════════════

export const actionScopes = mysqlTable("action_scopes", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  // Permission code this scope limits
  permissionCode: varchar("permissionCode", { length: 100 }).notNull(),
  // Limitations (JSON): { maxPerDay: 100, maxPerMonth: 1000 }
  limitations: text("limitations"), // JSON
  // Conditions (JSON): { requireApproval: true, requireMFA: false }
  conditions: text("conditions"), // JSON
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  teamIdx: index("idx_action_scope_team").on(table.teamId),
  permissionIdx: index("idx_action_scope_permission").on(table.permissionCode),
}));

export type ActionScope = typeof actionScopes.$inferSelect;
export type InsertActionScope = typeof actionScopes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// INVITATIONS (Team invitations)
// ═══════════════════════════════════════════════════════════════════════════

export const teamInvitations = mysqlTable("team_invitations", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  roleId: bigint("roleId", { mode: "number", unsigned: true }).notNull(),
  invitedBy: bigint("invitedBy", { mode: "number", unsigned: true }).notNull(),
  // Token for invitation link
  token: varchar("token", { length: 255 }).notNull().unique(),
  // Status
  status: mysqlEnum("invitationStatus", ["pending", "accepted", "declined", "expired"]).default("pending").notNull(),
  // Expiration
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  declinedAt: timestamp("declinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  teamIdx: index("idx_invitation_team").on(table.teamId),
  emailIdx: index("idx_invitation_email").on(table.email),
  tokenIdx: index("idx_invitation_token").on(table.token),
}));

export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type InsertTeamInvitation = typeof teamInvitations.$inferInsert;