/**
 * FuelPro Admin Audit Logger
 * Comprehensive logging for all administrative actions
 */

import { AdminUser } from "./adminAuth";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type AuditAction =
  // Auth actions
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "MFA_VERIFY"

  // User actions
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "USER_ROLE_CHANGE"
  | "USER_PERMISSION_CHANGE"

  // Station actions
  | "STATION_CREATE"
  | "STATION_UPDATE"
  | "STATION_DELETE"
  | "STATION_SETTINGS_CHANGE"

  // Sales actions
  | "SALE_CREATE"
  | "SALE_UPDATE"
  | "SALE_DELETE"
  | "SALE_REFUND"

  // Settings actions
  | "SETTINGS_UPDATE"
  | "CONFIG_CHANGE"
  | "API_KEY_CREATE"
  | "API_KEY_REVOKE"

  // Data actions
  | "DATA_EXPORT"
  | "DATA_IMPORT"
  | "DATA_DELETE"
  | "BACKUP_CREATE"

  // System actions
  | "SYSTEM_CONFIG"
  | "WEBHOOK_CREATE"
  | "WEBHOOK_DELETE"
  | "INTEGRATION_CHANGE";

export type AuditSeverity = "info" | "warning" | "error" | "critical";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  severity: AuditSeverity;

  // Actor info
  userId: string;
  userEmail: string;
  userRole: string;

  // Target info
  targetType?: string;
  targetId?: string;
  targetName?: string;

  // Request info
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;

  // Action details
  description: string;
  changes?: Record<string, { old: any; new: any }>;
  metadata?: Record<string, any>;

  // Result
  success: boolean;
  errorMessage?: string;
}

export interface AuditFilter {
  startDate?: string;
  endDate?: string;
  userId?: string;
  action?: AuditAction;
  severity?: AuditSeverity;
  targetType?: string;
  success?: boolean;
  search?: string;
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGGER CLASS
// ═══════════════════════════════════════════════════════════════════

export class AuditLogger {
  private static instance: AuditLogger;
  private logs: AuditLogEntry[] = [];
  private maxLogs = 1000;
  private storageKey = "fuelpro_audit_logs";
  private listeners: Set<(entry: AuditLogEntry) => void> = new Set();

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      console.error("[Audit] Failed to load logs:", e);
      this.logs = [];
    }
  }

  private saveToStorage(): void {
    try {
      // Keep only the most recent logs
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
      localStorage.setItem(this.storageKey, JSON.stringify(this.logs));
    } catch (e) {
      console.error("[Audit] Failed to save logs:", e);
    }
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private getClientInfo(): { ipAddress?: string; userAgent?: string } {
    // In production, IP would come from server headers
    return {
      ipAddress: "client",
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    };
  }

  // ─── Main Logging Method ───
  log(params: {
    action: AuditAction;
    severity?: AuditSeverity;
    user: AdminUser;
    targetType?: string;
    targetId?: string;
    targetName?: string;
    description: string;
    changes?: Record<string, { old: any; new: any }>;
    metadata?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
  }): AuditLogEntry {
    const { ipAddress, userAgent } = this.getClientInfo();

    const entry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      action: params.action,
      severity: params.severity || this.getDefaultSeverity(params.action),

      userId: params.user.id,
      userEmail: params.user.email,
      userRole: params.user.role,

      targetType: params.targetType,
      targetId: params.targetId,
      targetName: params.targetName,

      ipAddress,
      userAgent,

      description: params.description,
      changes: params.changes,
      metadata: params.metadata,

      success: params.success !== undefined ? params.success : true,
      errorMessage: params.errorMessage,
    };

    // Add to logs
    this.logs.push(entry);
    this.saveToStorage();

    // Notify listeners
    this.listeners.forEach((listener) => listener(entry));

    // Console output in development
    if (import.meta.env.DEV) {
      const color = this.getSeverityColor(entry.severity);
      console.log(`%c[AUDIT] ${entry.action}`, `color: ${color}`, {
        user: entry.userEmail,
        target: entry.targetType
          ? `${entry.targetType}:${entry.targetId}`
          : undefined,
        description: entry.description,
      });
    }

    // Send to server in production
    this.sendToServer(entry);

    return entry;
  }

  private getDefaultSeverity(action: AuditAction): AuditSeverity {
    const criticalActions: AuditAction[] = [
      "USER_DELETE",
      "STATION_DELETE",
      "DATA_DELETE",
      "SYSTEM_CONFIG",
    ];
    const warningActions: AuditAction[] = [
      "LOGIN_FAILED",
      "USER_ROLE_CHANGE",
      "API_KEY_REVOKE",
      "SETTINGS_UPDATE",
    ];

    if (criticalActions.includes(action)) return "critical";
    if (warningActions.includes(action)) return "warning";
    return "info";
  }

  private getSeverityColor(severity: AuditSeverity): string {
    const colors = {
      info: "#3b82f6",
      warning: "#f59e0b",
      error: "#ef4444",
      critical: "#dc2626",
    };
    return colors[severity];
  }

  private async sendToServer(entry: AuditLogEntry): Promise<void> {
    try {
      await fetch("/api/admin/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch {
      // Silently fail - logs are already stored locally
    }
  }

  // ─── Query Methods ───
  getLogs(filter?: AuditFilter): AuditLogEntry[] {
    let results = [...this.logs];

    if (filter) {
      if (filter.startDate) {
        results = results.filter((l) => l.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        results = results.filter((l) => l.timestamp <= filter.endDate!);
      }
      if (filter.userId) {
        results = results.filter((l) => l.userId === filter.userId);
      }
      if (filter.action) {
        results = results.filter((l) => l.action === filter.action);
      }
      if (filter.severity) {
        results = results.filter((l) => l.severity === filter.severity);
      }
      if (filter.targetType) {
        results = results.filter((l) => l.targetType === filter.targetType);
      }
      if (filter.success !== undefined) {
        results = results.filter((l) => l.success === filter.success);
      }
      if (filter.search) {
        const search = filter.search.toLowerCase();
        results = results.filter(
          (l) =>
            l.description.toLowerCase().includes(search) ||
            l.userEmail.toLowerCase().includes(search) ||
            l.action.toLowerCase().includes(search),
        );
      }
    }

    // Sort by timestamp descending (newest first)
    return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  getLogById(id: string): AuditLogEntry | undefined {
    return this.logs.find((l) => l.id === id);
  }

  getLogsByUser(userId: string, limit = 50): AuditLogEntry[] {
    return this.logs
      .filter((l) => l.userId === userId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getLogsByTarget(targetType: string, targetId: string): AuditLogEntry[] {
    return this.logs
      .filter((l) => l.targetType === targetType && l.targetId === targetId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  getRecentLogs(limit = 20): AuditLogEntry[] {
    return this.logs
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getCriticalLogs(): AuditLogEntry[] {
    return this.logs
      .filter((l) => l.severity === "critical" || l.severity === "error")
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  // ─── Statistics ───
  getStats(dateRange?: { start: string; end: string }): {
    total: number;
    byAction: Record<string, number>;
    bySeverity: Record<string, number>;
    byUser: Record<string, number>;
    failedActions: number;
  } {
    let logs = [...this.logs];

    if (dateRange) {
      logs = logs.filter(
        (l) => l.timestamp >= dateRange.start && l.timestamp <= dateRange.end,
      );
    }

    const byAction: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    let failedActions = 0;

    logs.forEach((log) => {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
      byUser[log.userEmail] = (byUser[log.userEmail] || 0) + 1;
      if (!log.success) failedActions++;
    });

    return {
      total: logs.length,
      byAction,
      bySeverity,
      byUser,
      failedActions,
    };
  }

  // ─── Maintenance ───
  clearLogs(): void {
    this.logs = [];
    this.saveToStorage();
  }

  exportLogs(format: "json" | "csv" = "json"): string {
    if (format === "json") {
      return JSON.stringify(this.logs, null, 2);
    }

    // CSV format
    const headers = [
      "ID",
      "Timestamp",
      "Action",
      "Severity",
      "User",
      "Role",
      "Target Type",
      "Target ID",
      "Description",
      "Success",
      "IP Address",
    ];

    const rows = this.logs.map((log) => [
      log.id,
      log.timestamp,
      log.action,
      log.severity,
      log.userEmail,
      log.userRole,
      log.targetType || "",
      log.targetId || "",
      log.description.replace(/,/g, ";"),
      log.success ? "Yes" : "No",
      log.ipAddress || "",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  // ─── Listeners ───
  subscribe(callback: (entry: AuditLogEntry) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

export const auditLog = {
  login: (user: AdminUser, success: boolean) => {
    AuditLogger.getInstance().log({
      action: success ? "LOGIN" : "LOGIN_FAILED",
      user,
      description: `${user.email} ${success ? "logged in" : "failed to log in"}`,
      success,
    });
  },

  logout: (user: AdminUser) => {
    AuditLogger.getInstance().log({
      action: "LOGOUT",
      user,
      description: `${user.email} logged out`,
    });
  },

  userCreate: (
    user: AdminUser,
    newUser: { id: string; email: string; name: string },
  ) => {
    AuditLogger.getInstance().log({
      action: "USER_CREATE",
      user,
      targetType: "user",
      targetId: newUser.id,
      targetName: newUser.email,
      description: `Created user ${newUser.name} (${newUser.email})`,
    });
  },

  userUpdate: (
    user: AdminUser,
    targetUser: { id: string; email: string },
    changes: Record<string, { old: any; new: any }>,
  ) => {
    AuditLogger.getInstance().log({
      action: "USER_UPDATE",
      user,
      targetType: "user",
      targetId: targetUser.id,
      targetName: targetUser.email,
      description: `Updated user ${targetUser.email}`,
      changes,
    });
  },

  userDelete: (user: AdminUser, targetUser: { id: string; email: string }) => {
    AuditLogger.getInstance().log({
      action: "USER_DELETE",
      severity: "critical",
      user,
      targetType: "user",
      targetId: targetUser.id,
      targetName: targetUser.email,
      description: `Deleted user ${targetUser.email}`,
    });
  },

  roleChange: (
    user: AdminUser,
    targetUser: { id: string; email: string },
    oldRole: string,
    newRole: string,
  ) => {
    AuditLogger.getInstance().log({
      action: "USER_ROLE_CHANGE",
      severity: "warning",
      user,
      targetType: "user",
      targetId: targetUser.id,
      targetName: targetUser.email,
      description: `Changed role of ${targetUser.email} from ${oldRole} to ${newRole}`,
      changes: { role: { old: oldRole, new: newRole } },
    });
  },

  settingsUpdate: (
    user: AdminUser,
    changes: Record<string, { old: any; new: any }>,
  ) => {
    AuditLogger.getInstance().log({
      action: "SETTINGS_UPDATE",
      severity: "warning",
      user,
      description: "Updated system settings",
      changes,
    });
  },

  stationCreate: (user: AdminUser, station: { id: string; name: string }) => {
    AuditLogger.getInstance().log({
      action: "STATION_CREATE",
      user,
      targetType: "station",
      targetId: station.id,
      targetName: station.name,
      description: `Created station "${station.name}"`,
    });
  },

  stationUpdate: (
    user: AdminUser,
    station: { id: string; name: string },
    changes: Record<string, { old: any; new: any }>,
  ) => {
    AuditLogger.getInstance().log({
      action: "STATION_UPDATE",
      user,
      targetType: "station",
      targetId: station.id,
      targetName: station.name,
      description: `Updated station "${station.name}"`,
      changes,
    });
  },

  dataExport: (user: AdminUser, dataType: string) => {
    AuditLogger.getInstance().log({
      action: "DATA_EXPORT",
      user,
      targetType: dataType,
      description: `Exported ${dataType} data`,
    });
  },

  apiKeyCreate: (user: AdminUser, keyName: string) => {
    AuditLogger.getInstance().log({
      action: "API_KEY_CREATE",
      severity: "warning",
      user,
      targetType: "api_key",
      targetName: keyName,
      description: `Created API key "${keyName}"`,
    });
  },

  apiKeyRevoke: (user: AdminUser, keyName: string) => {
    AuditLogger.getInstance().log({
      action: "API_KEY_REVOKE",
      severity: "warning",
      user,
      targetType: "api_key",
      targetName: keyName,
      description: `Revoked API key "${keyName}"`,
    });
  },
};

export default AuditLogger;
