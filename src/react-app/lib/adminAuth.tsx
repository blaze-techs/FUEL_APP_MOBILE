/**
 * FuelPro Admin Authentication & Authorization
 * Secure JWT-based auth with Role-Based Access Control (RBAC)
 */

import { useState, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════

export type UserRole =
  "viewer" | "editor" | "manager" | "admin" | "founder" | "super_admin";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: string[];
  stationIds: string[];
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthToken {
  userId: string;
  email: string;
  role: UserRole;
  permissions: string[];
  stationIds: string[];
  exp: number;
  iat: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AdminUser | null;
  token: string | null;
  expiresAt: number | null;
  isLoading: boolean;
  error: string | null;
}

// ─── Role Hierarchy ───
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  admin: 4,
  founder: 5,
  super_admin: 6,
};

// ─── Permission Definitions ───
export const PERMISSIONS = {
  // Users
  USERS_VIEW: "users:view",
  USERS_CREATE: "users:create",
  USERS_EDIT: "users:edit",
  USERS_DELETE: "users:delete",

  // Stations
  STATIONS_VIEW: "stations:view",
  STATIONS_CREATE: "stations:create",
  STATIONS_EDIT: "stations:edit",
  STATIONS_DELETE: "stations:delete",

  // Sales
  SALES_VIEW: "sales:view",
  SALES_CREATE: "sales:create",
  SALES_EDIT: "sales:edit",
  SALES_DELETE: "sales:delete",

  // Inventory
  INVENTORY_VIEW: "inventory:view",
  INVENTORY_EDIT: "inventory:edit",

  // Settings
  SETTINGS_VIEW: "settings:view",
  SETTINGS_EDIT: "settings:edit",

  // Reports
  REPORTS_VIEW: "reports:view",
  REPORTS_EXPORT: "reports:export",

  // Admin
  ADMIN_ACCESS: "admin:access",
  ADMIN_USERS: "admin:users",
  ADMIN_SETTINGS: "admin:settings",
  ADMIN_AUDIT: "admin:audit",

  // API
  API_ACCESS: "api:access",
  API_ADMIN: "api:admin",
};

// ─── Role Permission Mappings ───
const BASE_PERMISSIONS = [
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.STATIONS_VIEW,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.REPORTS_VIEW,
];

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  viewer: [...BASE_PERMISSIONS],
  editor: [
    ...BASE_PERMISSIONS,
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
  ],
  manager: [
    ...BASE_PERMISSIONS,
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.STATIONS_EDIT,
    PERMISSIONS.REPORTS_EXPORT,
  ],
  admin: [
    ...BASE_PERMISSIONS,
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.STATIONS_EDIT,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_EDIT,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
  ],
  founder: [
    ...BASE_PERMISSIONS,
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.STATIONS_EDIT,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_EDIT,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.STATIONS_CREATE,
    PERMISSIONS.STATIONS_DELETE,
    PERMISSIONS.SALES_DELETE,
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.ADMIN_USERS,
    PERMISSIONS.ADMIN_SETTINGS,
    PERMISSIONS.ADMIN_AUDIT,
    PERMISSIONS.API_ACCESS,
    PERMISSIONS.API_ADMIN,
  ],
  super_admin: Object.values(PERMISSIONS),
};

// ═══════════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

const TOKEN_KEY = "fuelpro_admin_token";
const REFRESH_TOKEN_KEY = "fuelpro_admin_refresh";
const USER_KEY = "fuelpro_admin_user";

export class TokenManager {
  private static instance: TokenManager;

  private constructor() {}

  static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  setToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (e) {
      console.error("[Auth] Failed to store token:", e);
    }
  }

  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setRefreshToken(token: string): void {
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch (e) {
      console.error("[Auth] Failed to store refresh token:", e);
    }
  }

  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setUser(user: AdminUser): void {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
      console.error("[Auth] Failed to store user:", e);
    }
  }

  getUser(): AdminUser | null {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  isTokenExpired(token: string): boolean {
    try {
      const payload = this.decodeToken(token);
      return Date.now() >= payload.exp * 1000;
    } catch {
      return true;
    }
  }

  decodeToken(token: string): AuthToken {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");
    const payload = atob(parts[1]);
    return JSON.parse(payload);
  }

  generateToken(user: AdminUser, expiresIn = 3600): string {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);

    const payload: AuthToken = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      stationIds: user.stationIds,
      exp: now + expiresIn,
      iat: now,
    };

    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "");
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, "");

    // In production, use proper signing with secret key
    const signature = btoa(
      `${encodedHeader}.${encodedPayload}.fuelpro_secret`,
    ).replace(/=/g, "");

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH SERVICE
// ═══════════════════════════════════════════════════════════════════

export class AdminAuthService {
  private baseUrl: string;
  private tokenManager: TokenManager;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
    this.tokenManager = TokenManager.getInstance();
  }

  async login(
    credentials: LoginCredentials,
  ): Promise<{ user: AdminUser; token: string; refreshToken: string }> {
    const response = await fetch(`${this.baseUrl}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Login failed" }));
      throw new Error(error.message || "Login failed");
    }

    const data = await response.json();

    this.tokenManager.setToken(data.token);
    this.tokenManager.setRefreshToken(data.refreshToken);
    this.tokenManager.setUser(data.user);

    return data;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/admin/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      this.tokenManager.clearTokens();
    }
  }

  async refreshToken(): Promise<string> {
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) throw new Error("No refresh token");

    const response = await fetch(`${this.baseUrl}/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      credentials: "include",
    });

    if (!response.ok) {
      this.tokenManager.clearTokens();
      throw new Error("Token refresh failed");
    }

    const data = await response.json();
    this.tokenManager.setToken(data.token);

    return data.token;
  }

  async getCurrentUser(): Promise<AdminUser | null> {
    const token = this.tokenManager.getToken();
    if (!token) return null;

    if (this.tokenManager.isTokenExpired(token)) {
      try {
        await this.refreshToken();
      } catch {
        return null;
      }
    }

    return this.tokenManager.getUser();
  }

  async requestPasswordReset(email: string): Promise<void> {
    await fetch(`${this.baseUrl}/admin/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }

  async verifyMFA(code: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/admin/auth/verify-mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: "include",
    });
    return response.ok;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PERMISSION CHECKER
// ═══════════════════════════════════════════════════════════════════

export class PermissionChecker {
  static hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
  }

  static hasPermission(
    userPermissions: string[],
    requiredPermission: string,
  ): boolean {
    return userPermissions.includes(requiredPermission);
  }

  static hasAnyPermission(
    userPermissions: string[],
    requiredPermissions: string[],
  ): boolean {
    return requiredPermissions.some((p) => userPermissions.includes(p));
  }

  static hasAllPermissions(
    userPermissions: string[],
    requiredPermissions: string[],
  ): boolean {
    return requiredPermissions.every((p) => userPermissions.includes(p));
  }

  static canAccessStation(user: AdminUser, stationId: string): boolean {
    if (user.role === "super_admin" || user.role === "founder") return true;
    return user.stationIds.includes(stationId);
  }

  static getAccessibleStations(user: AdminUser): string[] {
    if (user.role === "super_admin" || user.role === "founder") return ["*"];
    return user.stationIds;
  }
}

// ═══════════════════════════════════════════════════════════════════
// API CLIENT (With Auth)
// ═══════════════════════════════════════════════════════════════════

export class AdminAPIClient {
  private baseUrl: string;
  private tokenManager: TokenManager;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
    this.tokenManager = TokenManager.getInstance();
  }

  private getHeaders(): HeadersInit {
    const token = this.tokenManager.getToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      this.tokenManager.clearTokens();
      window.location.href = "/#/admin/login";
      throw new Error("Unauthorized");
    }

    if (response.status === 403) {
      throw new Error("Forbidden");
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Request failed" }));
      throw new Error(error.message || "Request failed");
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "GET",
      headers: this.getHeaders(),
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(data),
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }

  async put<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(data),
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "DELETE",
      headers: this.getHeaders(),
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }

  async patch<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify(data),
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }
}

// ═══════════════════════════════════════════════════════════════════
// REACT HOOKS
// ═══════════════════════════════════════════════════════════════════

export function useAdminAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    token: null,
    expiresAt: null,
    isLoading: true,
    error: null,
  });

  const tokenManager = TokenManager.getInstance();
  const authService = new AdminAuthService();

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      const token = tokenManager.getToken();
      const user = tokenManager.getUser();

      if (token && user) {
        if (tokenManager.isTokenExpired(token)) {
          try {
            await authService.refreshToken();
            setState({
              isAuthenticated: true,
              user,
              token,
              expiresAt: tokenManager.decodeToken(token).exp * 1000,
              isLoading: false,
              error: null,
            });
          } catch {
            tokenManager.clearTokens();
            setState((prev) => ({ ...prev, isLoading: false }));
          }
        } else {
          setState({
            isAuthenticated: true,
            user,
            token,
            expiresAt: tokenManager.decodeToken(token).exp * 1000,
            isLoading: false,
            error: null,
          });
        }
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    };

    initAuth();
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await authService.login(credentials);
      const newToken = tokenManager.getToken();

      setState({
        isAuthenticated: true,
        user: result.user,
        token: newToken,
        expiresAt: newToken
          ? tokenManager.decodeToken(newToken).exp * 1000
          : null,
        isLoading: false,
        error: null,
      });

      return result;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Login failed";
      setState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      await authService.logout();
    } finally {
      tokenManager.clearTokens();
      setState({
        isAuthenticated: false,
        user: null,
        token: null,
        expiresAt: null,
        isLoading: false,
        error: null,
      });
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!state.user) return false;
      return PermissionChecker.hasPermission(
        state.user.permissions,
        permission,
      );
    },
    [state.user],
  );

  const hasRole = useCallback(
    (role: UserRole): boolean => {
      if (!state.user) return false;
      return PermissionChecker.hasRole(state.user.role, role);
    },
    [state.user],
  );

  const canAccessStation = useCallback(
    (stationId: string): boolean => {
      if (!state.user) return false;
      return PermissionChecker.canAccessStation(state.user, stationId);
    },
    [state.user],
  );

  return {
    ...state,
    login,
    logout,
    hasPermission,
    hasRole,
    canAccessStation,
    api: new AdminAPIClient(),
  };
}

// ─── Protected Route HOC ───
export function withAdminAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  requiredPermission?: string,
  requiredRole?: UserRole,
) {
  return function AdminProtectedComponent(props: P) {
    const { isAuthenticated, isLoading, user, hasPermission, hasRole } =
      useAdminAuth();

    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
        </div>
      );
    }

    if (!isAuthenticated) {
      window.location.href = "/#/admin/login";
      return null;
    }

    if (requiredRole && !hasRole(requiredRole)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="bg-white p-8 rounded-xl shadow-lg text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-2">
              Access Denied
            </h2>
            <p className="text-gray-600">
              You don't have permission to access this page.
            </p>
          </div>
        </div>
      );
    }

    if (requiredPermission && !hasPermission(requiredPermission)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="bg-white p-8 rounded-xl shadow-lg text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-2">
              Insufficient Permissions
            </h2>
            <p className="text-gray-600">
              You need "{requiredPermission}" permission to access this page.
            </p>
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} user={user} />;
  };
}

export default useAdminAuth;
