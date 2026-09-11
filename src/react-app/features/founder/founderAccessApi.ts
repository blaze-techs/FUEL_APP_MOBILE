/**
 * FounderAccessApi - Real Supabase-backed data access layer for Founder Panel
 *
 * Replaces the stubbed tRPC layer with real Supabase calls.
 * All operations go through Supabase with Row Level Security.
 */

import { supabase } from "@/supabase/client";

// Types
export type AuditSeverity = "info" | "success" | "warning" | "danger";

export interface AuditEntry {
  id: string;
  event: string;
  detail: string;
  user: string;
  severity: AuditSeverity;
  timestamp: string;
}

export interface FounderSessionData {
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  passwordHash: string | null;
}

export interface CloudUser {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  lastActive?: string;
}

export interface CloudStation {
  id: string;
  name: string;
  location: string;
  ownerId: string;
  ownerName: string;
  members: number;
  revenue: number;
  createdAt: string;
  lastActive: string;
}

// ============================================================
// Audit Log Functions
// ============================================================

export interface AuditFilters {
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
}

export async function fetchFounderAuditLog(
  filters: AuditFilters = {},
): Promise<AuditEntry[]> {
  const { limit = 100, offset = 0, action, entityType } = filters;

  let query = supabase
    .from("founder_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) {
    query = query.eq("action", action);
  }
  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching audit log:", error);
    throw error;
  }

  return (data || []).map((entry: any) => ({
    id: entry.id,
    event: entry.action,
    detail: entry.metadata?.detail || "",
    user: entry.actor_id || "SYSTEM",
    severity: (entry.metadata?.severity as AuditSeverity) || "info",
    timestamp: entry.created_at,
  }));
}

export async function writeFounderAudit(
  event: string,
  detail: string,
  severity: AuditSeverity = "info",
  entityType: string = "system",
  entityId: string | null = null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("write_founder_audit", {
    p_action: event,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: { detail, severity },
  });

  if (error) {
    console.error("Error writing audit log:", error);
    return null;
  }

  return data;
}

export async function fetchAuditSummary(): Promise<{
  total: number;
  bySeverity: Record<AuditSeverity, number>;
  recentActivity: { date: string; count: number }[];
}> {
  const { data, error } = await supabase
    .from("founder_audit_log")
    .select("created_at, metadata");

  if (error) {
    console.error("Error fetching audit summary:", error);
    return {
      total: 0,
      bySeverity: { info: 0, success: 0, warning: 0, danger: 0 },
      recentActivity: [],
    };
  }

  const bySeverity: Record<AuditSeverity, number> = {
    info: 0,
    success: 0,
    warning: 0,
    danger: 0,
  };
  const activityMap = new Map<string, number>();

  for (const entry of data || []) {
    const severity = (entry.metadata?.severity as AuditSeverity) || "info";
    bySeverity[severity]++;

    const date = new Date(entry.created_at).toISOString().split("T")[0];
    activityMap.set(date, (activityMap.get(date) || 0) + 1);
  }

  const recentActivity = Array.from(activityMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return {
    total: data?.length || 0,
    bySeverity,
    recentActivity,
  };
}

// ============================================================
// Founder Session Functions
// ============================================================

export async function fetchFounderSession(): Promise<FounderSessionData | null> {
  const { data, error } = await supabase.rpc("get_founder_session");

  if (error) {
    console.error("Error fetching founder session:", error);
    return null;
  }

  if (!data) return null;

  return {
    twoFactorEnabled: data.two_factor_enabled || false,
    twoFactorSecret: data.two_factor_secret || null,
    contactEmail: data.contact_email || null,
    contactPhone: data.contact_phone || null,
    passwordHash: data.password_hash || null,
  };
}

export async function updateFounderSession(
  data: Partial<FounderSessionData>,
): Promise<FounderSessionData | null> {
  const { data: result, error } = await supabase.rpc("update_founder_session", {
    p_two_factor_enabled: data.twoFactorEnabled,
    p_two_factor_secret: data.twoFactorSecret,
    p_contact_email: data.contactEmail,
    p_contact_phone: data.contactPhone,
    p_password_hash: data.passwordHash,
  });

  if (error) {
    console.error("Error updating founder session:", error);
    throw error;
  }

  if (!result) return null;

  return {
    twoFactorEnabled: result.two_factor_enabled || false,
    twoFactorSecret: result.two_factor_secret || null,
    contactEmail: result.contact_email || null,
    contactPhone: result.contact_phone || null,
    passwordHash: result.password_hash || null,
  };
}

// ============================================================
// User Management Functions
// ============================================================

export async function fetchFounderUsers(): Promise<CloudUser[]> {
  // Fetch from profiles table
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (profilesError) {
    console.error("Error fetching profiles:", profilesError);
  }

  // Fetch from auth.users for email and metadata
  const { data: authUsers, error: authError } = await supabase
    .from("auth.users")
    .select("id, email, created_at, last_sign_in_at, raw_user_meta_data");

  if (authError) {
    console.error("Error fetching auth users:", authError);
  }

  // Combine the data
  const users: CloudUser[] = [];
  const authMap = new Map((authUsers || []).map((u: any) => [u.id, u]));

  for (const profile of profiles || []) {
    const authUser = authMap.get(profile.id);
    users.push({
      id: profile.id,
      name: profile.name || profile.email || "Unknown",
      email: profile.email || authUser?.email || "",
      role: profile.role || "user",
      createdAt: profile.created_at,
      lastActive: authUser?.last_sign_in_at || profile.updated_at,
    });
  }

  // If profiles are empty but we have auth users, use those
  if (users.length === 0 && authUsers) {
    for (const authUser of authUsers) {
      users.push({
        id: authUser.id,
        name:
          authUser.raw_user_meta_data?.name ||
          authUser.email?.split("@")[0] ||
          "Unknown",
        email: authUser.email || "",
        role: "user",
        createdAt: authUser.created_at,
        lastActive: authUser.last_sign_in_at,
      });
    }
  }

  return users;
}

export async function updateFounderUserRole(
  userId: string,
  role: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    console.error("Error updating user role:", error);
    throw error;
  }

  return true;
}

// ============================================================
// Station Functions
// ============================================================

export async function fetchFounderStations(): Promise<CloudStation[]> {
  // Fetch all stations (founder can see all)
  const { data: stations, error } = await supabase
    .from("stations")
    .select(
      `
      *,
      owner:profiles!stations_owner_id_fkey(id, name, email)
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching stations:", error);
    throw error;
  }

  // Get member counts for each station
  const stationIds = (stations || []).map((s) => s.id);
  const { data: members } = await supabase
    .from("team_members")
    .select("station_id")
    .in("station_id", stationIds.length > 0 ? stationIds : ["empty"]);

  const memberCountMap = new Map<string, number>();
  for (const member of members || []) {
    memberCountMap.set(
      member.station_id,
      (memberCountMap.get(member.station_id) || 0) + 1,
    );
  }

  // Get sales totals for each station
  const { data: sales } = await supabase
    .from("sales")
    .select("station_id, total_amount")
    .in("station_id", stationIds.length > 0 ? stationIds : ["empty"]);

  const revenueMap = new Map<string, number>();
  for (const sale of sales || []) {
    revenueMap.set(
      sale.station_id,
      (revenueMap.get(sale.station_id) || 0) + (sale.total_amount || 0),
    );
  }

  return (stations || []).map((station: any) => ({
    id: station.id,
    name: station.name,
    location: station.location || station.address || "",
    ownerId: station.owner_id,
    ownerName: station.owner?.name || station.owner?.email || "Unknown",
    members: memberCountMap.get(station.id) || 0,
    revenue: revenueMap.get(station.id) || 0,
    createdAt: station.created_at,
    lastActive: station.updated_at,
  }));
}

// ============================================================
// Sales Analytics Functions
// ============================================================

export async function fetchFounderSalesAnalytics(): Promise<{
  totalSales: number;
  totalRevenue: number;
  averageTransaction: number;
  salesByDay: { date: string; count: number; revenue: number }[];
  salesByFuelType: { fuelType: string; count: number; revenue: number }[];
}> {
  const { data: sales, error } = await supabase
    .from("sales")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching sales analytics:", error);
    return {
      totalSales: 0,
      totalRevenue: 0,
      averageTransaction: 0,
      salesByDay: [],
      salesByFuelType: [],
    };
  }

  const totalSales = sales?.length || 0;
  const totalRevenue =
    sales?.reduce((sum, s) => sum + (s.total_amount || 0), 0) || 0;
  const averageTransaction = totalSales > 0 ? totalRevenue / totalSales : 0;

  // Group by day
  const byDayMap = new Map<string, { count: number; revenue: number }>();
  for (const sale of sales || []) {
    const date = new Date(sale.created_at).toISOString().split("T")[0];
    const existing = byDayMap.get(date) || { count: 0, revenue: 0 };
    byDayMap.set(date, {
      count: existing.count + 1,
      revenue: existing.revenue + (sale.total_amount || 0),
    });
  }
  const salesByDay = Array.from(byDayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  // Group by fuel type (would need to join with fuel_types table)
  const byFuelMap = new Map<string, { count: number; revenue: number }>();
  for (const sale of sales || []) {
    const fuelType = sale.fuel_type_id || "Unknown";
    const existing = byFuelMap.get(fuelType) || { count: 0, revenue: 0 };
    byFuelMap.set(fuelType, {
      count: existing.count + 1,
      revenue: existing.revenue + (sale.total_amount || 0),
    });
  }
  const salesByFuelType = Array.from(byFuelMap.entries()).map(
    ([fuelType, data]) => ({
      fuelType,
      ...data,
    }),
  );

  return {
    totalSales,
    totalRevenue,
    averageTransaction,
    salesByDay,
    salesByFuelType,
  };
}
