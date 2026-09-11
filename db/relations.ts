import { relations } from "drizzle-orm";
import {
  users, stations, stationUsers, inventory, sales,
  bankAccounts, mobileMoneyConfigs, additionalPaymentMethods,
  auditLogs, founderSessions, featureFlags, pricingPlans,
  subscriptions, coupons, apiKeys, webhooks, emailTemplates,
  // New access control tables
  permissions, roles, teams, teamMembers, dataScopes, actionScopes, teamInvitations,
  // New audit tables
  auditLogEntries, authEvents, dataAccessLog,
  // New data isolation tables
  tenants, tenantDomains, dataPartitions, crossTenantLinks,
  tenantEncryptionKeys, tenantSettings, dataAccessPolicies,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  stationMemberships: many(stationUsers),
  sales: many(sales),
  auditLogs: many(auditLogs),
  subscriptions: many(subscriptions),
  teamMemberships: many(teamMembers),
}));

export const stationsRelations = relations(stations, ({ many }) => ({
  members: many(stationUsers),
  inventory: many(inventory),
  sales: many(sales),
  bankAccounts: many(bankAccounts),
  mobileMoneyConfigs: many(mobileMoneyConfigs),
  additionalPaymentMethods: many(additionalPaymentMethods),
  auditLogs: many(auditLogs),
}));

export const stationUsersRelations = relations(stationUsers, ({ one }) => ({
  station: one(stations, { fields: [stationUsers.stationId], references: [stations.id] }),
  user: one(users, { fields: [stationUsers.userId], references: [users.id] }),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  station: one(stations, { fields: [sales.stationId], references: [stations.id] }),
  user: one(users, { fields: [sales.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  plan: one(pricingPlans, { fields: [subscriptions.planId], references: [pricingPlans.id] }),
}));

// Access Control Relations
export const rolesRelations = relations(roles, ({ many }) => ({
  teamMembers: many(teamMembers),
  dataScopes: many(dataScopes),
  actionScopes: many(actionScopes),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  dataScopes: many(dataScopes),
  actionScopes: many(actionScopes),
  invitations: many(teamInvitations),
  dataPartitions: many(dataPartitions),
  tenants: many(tenants),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
  role: one(roles, { fields: [teamMembers.roleId], references: [roles.id] }),
}));

// Data Isolation Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  domains: many(tenantDomains),
  settings: many(tenantSettings),
  dataPartitions: many(dataPartitions),
  accessPolicies: many(dataAccessPolicies),
}));

export const dataPartitionsRelations = relations(dataPartitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dataPartitions.tenantId], references: [tenants.id] }),
  parent: one(dataPartitions, { fields: [dataPartitions.parentId], references: [dataPartitions.id], relationName: "parentChild" }),
  children: many(dataPartitions),
}));
