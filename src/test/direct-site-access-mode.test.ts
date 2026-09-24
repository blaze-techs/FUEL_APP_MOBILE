import { describe, expect, it } from "vitest";
import { applyDirectAccessMode } from "@/react-app/context/PermissionContext";

const base = {
  canViewDashboard: true, canViewSales: true, canCreateSales: true, canEditSales: true,
  canViewInventory: true, canManageInventory: true, canViewEmployees: true, canManageEmployees: true,
  canViewPayroll: true, canRunPayroll: true, canViewShifts: true, canManageShifts: true,
  canViewMpesa: true, canProcessMpesa: true, canViewReports: true, canExportReports: true,
  canViewAnalytics: true, canViewAudit: true, canManageAudit: true, canViewDocuments: true,
  canManageDocuments: true, canViewFuelPrices: true, canEditFuelPrices: true, canChangePumpCount: true,
  canManageFuelTypes: true, canViewRegional: true, canViewIntegrations: true, canManageIntegrations: true,
  canViewCloud: true, canManageCloud: true, canViewSettings: true, canManageSettings: true,
  canManageTabs: true, canInviteManager: true, canInviteStaff: true, canInviteAuditor: true,
  canAssignPumps: true, canAssignShifts: true, canRevokeAccess: true, canSetTimeLimits: true,
  canViewAI: true, canUseAI: true, canViewCommunication: true, canViewNews: true,
  canViewPOS: true, canUsePOS: true, canViewLoyalty: true, canManageLoyalty: true,
  canViewCredit: true, canManageCredit: true, canViewDebt: true, canManageDebt: true,
  canViewLiveTransactions: true, isOwner: true, canCreateSubUsers: true, canGrantPermissions: true,
} as any;

describe("Direct Site Access ceiling", () => {
  it("read mode removes all mutation/admin permissions", () => {
    const p = applyDirectAccessMode(base, "read");
    expect(p.canViewSales).toBe(true);
    expect(p.canCreateSales).toBe(false);
    expect(p.canEditSales).toBe(false);
    expect(p.canManageSettings).toBe(false);
    expect(p.canGrantPermissions).toBe(false);
  });
  it("edit mode permits allowed record create/edit but not administration", () => {
    const p = applyDirectAccessMode(base, "edit");
    expect(p.canCreateSales).toBe(true);
    expect(p.canEditSales).toBe(true);
    expect(p.canManageSettings).toBe(false);
    expect(p.canRevokeAccess).toBe(false);
  });
  it("full mode preserves the role permissions", () => {
    expect(applyDirectAccessMode(base, "full")).toBe(base);
  });
});
