/**
 * Supabase Database Service
 *
 * Provides typed database operations for FuelPro
 */

import { supabase } from "@/supabase/client";
import type {
  Station,
  FuelType,
  Pump,
  Sale,
  Shift,
  Expense,
  TeamMember,
  Customer,
  Inventory,
} from "./types";

// ============================================================
// STATIONS
// ============================================================

export async function getStations() {
  const { data, error } = await supabase
    .from("stations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Station[];
}

export async function getStation(id: string) {
  const { data, error } = await supabase
    .from("stations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Station;
}

export async function createStation(station: Partial<Station>) {
  const { data, error } = await supabase
    .from("stations")
    .insert(station)
    .select()
    .single();

  if (error) throw error;
  return data as Station;
}

export async function updateStation(id: string, updates: Partial<Station>) {
  const { data, error } = await supabase
    .from("stations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Station;
}

export async function deleteStation(id: string) {
  const { error } = await supabase.from("stations").delete().eq("id", id);

  if (error) throw error;
}

// ============================================================
// FUEL TYPES
// ============================================================

export async function getFuelTypes() {
  const { data, error } = await supabase
    .from("fuel_types")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;
  return data as FuelType[];
}

// ============================================================
// PUMPS
// ============================================================

export async function getPumps(stationId: string) {
  const { data, error } = await supabase
    .from("pumps")
    .select("*, fuel_types(*)")
    .eq("station_id", stationId)
    .eq("is_active", true)
    .order("pump_number");

  if (error) throw error;
  return data as (Pump & { fuel_types: FuelType })[];
}

export async function createPump(pump: Partial<Pump>) {
  const { data, error } = await supabase
    .from("pumps")
    .insert(pump)
    .select()
    .single();

  if (error) throw error;
  return data as Pump;
}

export async function updatePump(id: string, updates: Partial<Pump>) {
  const { data, error } = await supabase
    .from("pumps")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Pump;
}

export async function deletePump(id: string) {
  const { error } = await supabase
    .from("pumps")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

// ============================================================
// INVENTORY
// ============================================================

export async function getInventory(stationId: string) {
  const { data, error } = await supabase
    .from("inventory")
    .select("*, fuel_types(*)")
    .eq("station_id", stationId);

  if (error) throw error;
  return data as (Inventory & { fuel_types: FuelType })[];
}

export async function updateInventory(id: string, updates: Partial<Inventory>) {
  const { data, error } = await supabase
    .from("inventory")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Inventory;
}

// ============================================================
// SALES
// ============================================================

export async function getSales(
  stationId: string,
  options?: { limit?: number; from?: string; to?: string },
) {
  let query = supabase
    .from("sales")
    .select("*, pumps(*), fuel_types(*)")
    .eq("station_id", stationId)
    .order("created_at", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.from) {
    query = query.gte("created_at", options.from);
  }

  if (options?.to) {
    query = query.lte("created_at", options.to);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data as (Sale & { pumps: Pump; fuel_types: FuelType })[];
}

export async function createSale(sale: Partial<Sale>) {
  const { data, error } = await supabase
    .from("sales")
    .insert(sale)
    .select()
    .single();

  if (error) throw error;
  return data as Sale;
}

export async function getSalesSummary(
  stationId: string,
  from: string,
  to: string,
) {
  const { data, error } = await supabase
    .from("sales")
    .select("total_amount, quantity, fuel_types(name)")
    .eq("station_id", stationId)
    .gte("created_at", from)
    .lte("created_at", to);

  if (error) throw error;
  return data;
}

// ============================================================
// SHIFTS
// ============================================================

export async function getShifts(stationId: string) {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("station_id", stationId)
    .order("shift_date", { ascending: false })
    .limit(30);

  if (error) throw error;
  return data as Shift[];
}

export async function createShift(shift: Partial<Shift>) {
  const { data, error } = await supabase
    .from("shifts")
    .insert(shift)
    .select()
    .single();

  if (error) throw error;
  return data as Shift;
}

export async function updateShift(id: string, updates: Partial<Shift>) {
  const { data, error } = await supabase
    .from("shifts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Shift;
}

export async function closeShift(
  id: string,
  closingCash: number,
  closingReading: number,
) {
  return updateShift(id, {
    status: "closed",
    closing_cash: closingCash,
    closing_reading: closingReading,
    closed_at: new Date().toISOString(),
  });
}

// ============================================================
// EXPENSES
// ============================================================

export async function getExpenses(
  stationId: string,
  options?: { limit?: number; from?: string; to?: string },
) {
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("station_id", stationId)
    .order("expense_date", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.from) {
    query = query.gte("expense_date", options.from);
  }

  if (options?.to) {
    query = query.lte("expense_date", options.to);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data as Expense[];
}

export async function createExpense(expense: Partial<Expense>) {
  const { data, error } = await supabase
    .from("expenses")
    .insert(expense)
    .select()
    .single();

  if (error) throw error;
  return data as Expense;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);

  if (error) throw error;
}

// ============================================================
// TEAM MEMBERS
// ============================================================

export async function getTeamMembers(stationId: string) {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("station_id", stationId)
    .eq("is_active", true)
    .order("name");

  if (error) throw error;
  return data as TeamMember[];
}

export async function createTeamMember(member: Partial<TeamMember>) {
  const { data, error } = await supabase
    .from("team_members")
    .insert(member)
    .select()
    .single();

  if (error) throw error;
  return data as TeamMember;
}

export async function updateTeamMember(
  id: string,
  updates: Partial<TeamMember>,
) {
  const { data, error } = await supabase
    .from("team_members")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as TeamMember;
}

export async function deleteTeamMember(id: string) {
  const { error } = await supabase
    .from("team_members")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

// ============================================================
// CUSTOMERS
// ============================================================

export async function getCustomers(
  stationId: string,
  options?: { limit?: number; search?: string },
) {
  let query = supabase
    .from("customers")
    .select("*")
    .eq("station_id", stationId)
    .order("name");

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.search) {
    query = query.or(
      `name.ilike.%${options.search}%,phone.ilike.%${options.search}%`,
    );
  }

  const { data, error } = await query;

  if (error) throw error;
  return data as Customer[];
}

export async function createCustomer(customer: Partial<Customer>) {
  const { data, error } = await supabase
    .from("customers")
    .insert(customer)
    .select()
    .single();

  if (error) throw error;
  return data as Customer;
}

export async function updateCustomer(id: string, updates: Partial<Customer>) {
  const { data, error } = await supabase
    .from("customers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Customer;
}

export async function deleteCustomer(id: string) {
  const { error } = await supabase.from("customers").delete().eq("id", id);

  if (error) throw error;
}

// ============================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================

export function subscribeToSales(
  stationId: string,
  callback: (sale: Sale) => void,
) {
  return supabase
    .channel("sales_changes")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "sales",
        filter: `station_id=eq.${stationId}`,
      },
      (payload) => {
        callback(payload.new as Sale);
      },
    )
    .subscribe();
}

export function subscribeToInventory(
  stationId: string,
  callback: (inventory: Inventory) => void,
) {
  return supabase
    .channel("inventory_changes")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "inventory",
        filter: `station_id=eq.${stationId}`,
      },
      (payload) => {
        callback(payload.new as Inventory);
      },
    )
    .subscribe();
}
