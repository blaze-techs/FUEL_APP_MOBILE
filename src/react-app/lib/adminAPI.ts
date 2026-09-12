import { getCurrencySymbol, getDetectedCountryCode } from "./currency";
import { getCountryPrice } from "@/react-app/config/pricing";
/**
 * FuelPro Admin API Client
 * Frontend API client for secure backend communication
 *
 * Uses Firebase Firestore for real-time data storage
 */

import { AdminUser, AdminAPIClient } from "./adminAuth";
import { AuditFilter, AuditLogEntry, auditLog } from "./auditLogger";
import { getFirebaseFirestore } from "@/firebase/client";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════════
// API CLIENT INSTANCE
// ═══════════════════════════════════════════════════════════════════

const api = new AdminAPIClient("/api");

// ═══════════════════════════════════════════════════════════════════
// FIREBASE HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get all users from Firebase Firestore
 */
async function getFirebaseUsers(): Promise<AdminUser[]> {
  try {
    const db = getFirebaseFirestore();
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt:
        doc.data().createdAt instanceof Timestamp
          ? doc.data().createdAt.toDate().toISOString()
          : doc.data().createdAt,
      lastLogin:
        doc.data().lastLogin instanceof Timestamp
          ? doc.data().lastLogin.toDate().toISOString()
          : doc.data().lastLogin,
    })) as AdminUser[];
  } catch (error) {
    console.error("[AdminAPI] Error fetching Firebase users:", error);
    return [];
  }
}

/**
 * Get all stations from Firebase Firestore
 */
async function getFirebaseStations(): Promise<StationData[]> {
  try {
    const db = getFirebaseFirestore();
    const stationsRef = collection(db, "stations");
    const q = query(stationsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as StationData[];
  } catch (error) {
    console.error("[AdminAPI] Error fetching Firebase stations:", error);
    return [];
  }
}

/**
 * Get global settings from Firebase Firestore
 */
async function getFirebaseSettings(): Promise<GlobalSettings | null> {
  try {
    const db = getFirebaseFirestore();
    const settingsRef = doc(db, "settings", "global");
    const snapshot = await getDoc(settingsRef);

    if (snapshot.exists()) {
      return snapshot.data() as GlobalSettings;
    }
    return null;
  } catch (error) {
    console.error("[AdminAPI] Error fetching Firebase settings:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (mirrors backend)
// ═══════════════════════════════════════════════════════════════════

// ─── Settings Types ───
export interface GlobalSettings {
  company: {
    name: string;
    logo?: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
  };
  localization: {
    currency: string;
    currencySymbol: string;
    timezone: string;
    dateFormat: string;
    language: string;
  };
  business: {
    fuelTypes: string[];
    defaultPrices: Record<string, number>;
    taxRate: number;
    kraPin?: string;
    vatRegNo?: string;
  };
  security: {
    sessionTimeout: number;
    passwordMinLength: number;
    mfaRequired: boolean;
    ipWhitelist?: string[];
  };
  integrations: {
    mpesa: {
      enabled: boolean;
      consumerKey?: string;
      environment: "sandbox" | "production";
    };
    firebase: {
      enabled: boolean;
      apiKey?: string;
    };
    supabase: {
      enabled: boolean;
      url?: string;
    };
    seafile: {
      enabled: boolean;
      url?: string;
    };
  };
  features: {
    loyalty: boolean;
    payroll: boolean;
    delivery: boolean;
    creditSales: boolean;
  };
}

// ─── User Types ───
export interface CreateUserRequest {
  email: string;
  name: string;
  role: string;
  stationIds: string[];
  permissions?: string[];
}

export interface UpdateUserRequest {
  name?: string;
  role?: string;
  stationIds?: string[];
  permissions?: string[];
  isActive?: boolean;
}

// ─── Station Types ───
export interface StationData {
  id: string;
  name: string;
  location: string;
  address: string;
  managerId?: string;
  isActive: boolean;
  settings: Record<string, any>;
}

// ─── API Response Types ───
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ═══════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// ─── Auth API ───
// NOTE: These functions previously called /api/admin/auth/* endpoints which don't exist.
// Refactored to use the existing main auth system (/api/auth/*) with founder/admin role checks.
// The separate admin auth system was never fully implemented on the backend.
export const AdminAuthAPI = {
  async login(email: string, password: string, _mfaCode?: string) {
    try {
      // Use the main auth API - founder accounts are identified by their role
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Login failed");
      }

      const data = await response.json();

      // Check if user has admin/founder role
      if (data.user?.role !== "founder" && data.user?.role !== "admin") {
        throw new Error(
          "Admin access required. This account does not have admin privileges.",
        );
      }

      // Store admin token
      if (data.token) {
        localStorage.setItem("fuelpro_admin_token", data.token);
      }

      return data;
    } catch (e) {
      console.error("[AdminAPI] Login error:", e);
      throw e;
    }
  },

  async logout() {
    try {
      // Clear admin token
      localStorage.removeItem("fuelpro_admin_token");

      // Call main auth logout
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      // Ignore logout errors - clear local state anyway
      console.warn("[AdminAPI] Logout warning:", e);
      localStorage.removeItem("fuelpro_admin_token");
    }
  },

  async refreshToken(refreshToken: string) {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        credentials: "include",
      });

      if (!response.ok) {
        localStorage.removeItem("fuelpro_admin_token");
        throw new Error("Token refresh failed");
      }

      const data = await response.json();

      // Update admin token if present
      if (data.token) {
        localStorage.setItem("fuelpro_admin_token", data.token);
      }

      return data;
    } catch (e) {
      console.error("[AdminAPI] Token refresh error:", e);
      localStorage.removeItem("fuelpro_admin_token");
      throw e;
    }
  },

  async getProfile() {
    return api.get<AdminUser>("/admin/profile");
  },

  async updateProfile(data: Partial<AdminUser>) {
    return api.put<AdminUser>("/admin/profile", data);
  },

  async changePassword(currentPassword: string, newPassword: string) {
    return api.post("/admin/auth/change-password", {
      currentPassword,
      newPassword,
    });
  },
};

// ─── Users API ───
export const AdminUsersAPI = {
  async list(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
  }) {
    const query = new URLSearchParams(params as any).toString();
    return api.get<PaginatedResponse<AdminUser>>(
      `/admin/users${query ? `?${query}` : ""}`,
    );
  },

  async get(id: string) {
    return api.get<AdminUser>(`/admin/users/${id}`);
  },

  async create(data: CreateUserRequest) {
    return api.post<AdminUser>("/admin/users", data);
  },

  async update(id: string, data: UpdateUserRequest) {
    return api.put<AdminUser>(`/admin/users/${id}`, data);
  },

  async delete(id: string) {
    return api.delete(`/admin/users/${id}`);
  },

  async resetPassword(id: string) {
    return api.post(`/admin/users/${id}/reset-password`, {});
  },
};

// ─── Stations API ───
export const AdminStationsAPI = {
  async list(params?: { page?: number; limit?: number; search?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return api.get<PaginatedResponse<StationData>>(
      `/admin/stations${query ? `?${query}` : ""}`,
    );
  },

  async get(id: string) {
    return api.get<StationData>(`/admin/stations/${id}`);
  },

  async create(data: Omit<StationData, "id">) {
    return api.post<StationData>("/admin/stations", data);
  },

  async update(id: string, data: Partial<StationData>) {
    return api.put<StationData>(`/admin/stations/${id}`, data);
  },

  async delete(id: string) {
    return api.delete(`/admin/stations/${id}`);
  },

  async getStats(id: string) {
    return api.get<any>(`/admin/stations/${id}/stats`);
  },
};

// ─── Settings API ───
export const AdminSettingsAPI = {
  async get() {
    return api.get<GlobalSettings>("/admin/settings");
  },

  async update(data: Partial<GlobalSettings>) {
    return api.put<GlobalSettings>("/admin/settings", data);
  },

  async getByCategory(category: string) {
    return api.get<any>(`/admin/settings/${category}`);
  },

  async updateCategory(category: string, data: any) {
    return api.put<any>(`/admin/settings/${category}`, data);
  },

  async export() {
    return api.get<{ settings: GlobalSettings; exportedAt: string }>(
      "/admin/settings/export",
    );
  },

  async import(data: GlobalSettings) {
    return api.post("/admin/settings/import", data);
  },
};

// ─── Audit API ───
export const AdminAuditAPI = {
  async list(filter?: AuditFilter) {
    const params = new URLSearchParams(filter as any).toString();
    return api.get<PaginatedResponse<AuditLogEntry>>(
      `/admin/audit${params ? `?${params}` : ""}`,
    );
  },

  async get(id: string) {
    return api.get<AuditLogEntry>(`/admin/audit/${id}`);
  },

  async getStats(dateRange?: { start: string; end: string }) {
    const params = dateRange ? new URLSearchParams(dateRange).toString() : "";
    return api.get<any>(`/admin/audit/stats${params ? `?${params}` : ""}`);
  },

  async export(format: "json" | "csv" = "json") {
    const response = await fetch(`/api/admin/audit/export?format=${format}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("fuelpro_admin_token")}`,
      },
    });
    return response.text();
  },
};

// ─── API Keys API ───
export const AdminAPIKeysAPI = {
  async list() {
    return api.get<any[]>("/admin/api-keys");
  },

  async create(name: string, permissions: string[], expiresIn?: number) {
    return api.post<{ key: string; name: string; expiresAt: string }>(
      "/admin/api-keys",
      {
        name,
        permissions,
        expiresIn,
      },
    );
  },

  async revoke(id: string) {
    return api.delete(`/admin/api-keys/${id}`);
  },
};

// ─── System API ───
export const AdminSystemAPI = {
  async getHealth() {
    return api.get<{
      status: "healthy" | "degraded" | "down";
      uptime: number;
      version: string;
      services: Record<string, "up" | "down" | "degraded">;
    }>("/admin/system/health");
  },

  async getMetrics() {
    return api.get<any>("/admin/system/metrics");
  },

  async createBackup() {
    return api.post<{ backupId: string; createdAt: string }>(
      "/admin/system/backup",
      {},
    );
  },

  async listBackups() {
    return api.get<any[]>("/admin/system/backups");
  },

  async restoreBackup(backupId: string) {
    return api.post(`/admin/system/restore`, { backupId });
  },
};

// ─── Webhooks API ───
export const AdminWebhooksAPI = {
  async list() {
    return api.get<any[]>("/admin/webhooks");
  },

  async create(data: { url: string; events: string[]; secret?: string }) {
    return api.post<any>("/admin/webhooks", data);
  },

  async update(
    id: string,
    data: Partial<{ url: string; events: string[]; isActive: boolean }>,
  ) {
    return api.put<any>(`/admin/webhooks/${id}`, data);
  },

  async delete(id: string) {
    return api.delete(`/admin/webhooks/${id}`);
  },

  async test(id: string) {
    return api.post<{ success: boolean; response: any }>(
      `/admin/webhooks/${id}/test`,
      {},
    );
  },

  async getDeliveries(webhookId: string) {
    return api.get<any[]>(`/admin/webhooks/${webhookId}/deliveries`);
  },
};

// ═══════════════════════════════════════════════════════════════════
// FRONTEND-ONLY IMPLEMENTATION (for offline/local development)
// In production, all these would be server-side only
// ═══════════════════════════════════════════════════════════════════

export class AdminAPI {
  // Firebase-powered API - Real-time data from Firestore
  // Fallback to API calls when Firebase is not available

  static async simulateResponse<T>(data: T, delay = 0): Promise<T> {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return data;
  }

  /**
   * Get all users - First tries Firebase, then falls back to API
   */
  static async getUsers(): Promise<AdminUser[]> {
    // Try Firebase first
    const firebaseUsers = await getFirebaseUsers();
    if (firebaseUsers.length > 0) {
      console.info("[AdminAPI] Using Firebase users:", firebaseUsers.length);
      return firebaseUsers;
    }

    // Fallback to API
    try {
      return (await AdminUsersAPI.list()).data;
    } catch (error) {
      console.error("[AdminAPI] Error fetching users:", error);
      return [];
    }
  }

  /**
   * Get all stations - First tries Firebase, then falls back to API
   */
  static async getStations(): Promise<StationData[]> {
    // Try Firebase first
    const firebaseStations = await getFirebaseStations();
    if (firebaseStations.length > 0) {
      console.info(
        "[AdminAPI] Using Firebase stations:",
        firebaseStations.length,
      );
      return firebaseStations;
    }

    // Fallback to API
    try {
      return (await AdminStationsAPI.list()).data;
    } catch (error) {
      console.error("[AdminAPI] Error fetching stations:", error);
      return [];
    }
  }

  /**
   * Get global settings - First tries Firebase, then falls back to API/mock
   */
  static async getSettings(): Promise<GlobalSettings> {
    // Try Firebase first
    const firebaseSettings = await getFirebaseSettings();
    if (firebaseSettings) {
      console.info("[AdminAPI] Using Firebase settings");
      return firebaseSettings;
    }

    // Fallback to API
    try {
      return await AdminSettingsAPI.get();
    } catch (error) {
      console.error(
        "[AdminAPI] Error fetching settings, using defaults:",
        error,
      );
      // Country-aware defaults: derive currency/timezone/symbol/prices from
      // the detected station country so a non-Kenya station never inherits
      // Kenyan KSh defaults (Nairobi timezone, mpesa, KSh prices, "FuelPro
      // Kenya").
      const country = getDetectedCountryCode();
      const symbol = getCurrencySymbol();
      const pms = getCountryPrice(country, "petrol");
      const ago = getCountryPrice(country, "diesel");
      const kerosene = getCountryPrice(country, "kerosene");
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const isKenya = country === "KE";
      // Return default settings
      return {
        company: {
          name: isKenya ? "FuelPro Kenya" : "FuelPro",
          address: isKenya ? "123 Business Park, Nairobi" : "",
          phone: isKenya ? "+254 700 000 000" : "",
          email: "info@fuelpro.app",
        },
        localization: {
          currency: pms.currency,
          currencySymbol: symbol,
          timezone,
          dateFormat: "DD/MM/YYYY",
          language: "en",
        },
        business: {
          // Dynamic: derive fuel types from the detected country's canonical set
          // rather than hardcoding PMS/AGO/Kerosene for every station.
          fuelTypes: isKenya
            ? ["PMS", "AGO", "IK"]
            : ["PMS", "AGO", "IK", "LPG"],
          defaultPrices: {
            PMS: pms.price,
            AGO: ago.price,
            Kerosene: kerosene.price,
            IK: kerosene.price,
          },
          taxRate: isKenya ? 0.16 : 0,
        },
        security: {
          sessionTimeout: 3600,
          passwordMinLength: 8,
          mfaRequired: false,
        },
        integrations: {
          // mpesa is Kenya-specific; disable it for non-Kenya stations.
          mpesa: { enabled: isKenya, environment: "production" },
          firebase: { enabled: true },
          supabase: { enabled: false },
          seafile: { enabled: false },
        },
        features: {
          loyalty: true,
          payroll: true,
          delivery: true,
          creditSales: true,
        },
      };
    }
  }

  // Keep legacy mock methods for backwards compatibility
  static getMockUsers(): AdminUser[] {
    console.warn(
      "[AdminAPI] getMockUsers() is deprecated. Use getUsers() instead.",
    );
    return [];
  }

  static getMockSettings(): GlobalSettings {
    console.warn(
      "[AdminAPI] getMockSettings() is deprecated. Use getSettings() instead.",
    );
    return this.getSettings as any;
  }

  static getMockStations(): StationData[] {
    console.warn(
      "[AdminAPI] getMockStations() is deprecated. Use getStations() instead.",
    );
    return [];
  }
}

export default {
  api,
  AdminAuthAPI,
  AdminUsersAPI,
  AdminStationsAPI,
  AdminSettingsAPI,
  AdminAuditAPI,
  AdminAPIKeysAPI,
  AdminSystemAPI,
  AdminWebhooksAPI,
  AdminAPI,
};
