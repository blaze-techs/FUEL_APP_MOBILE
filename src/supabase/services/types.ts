/**
 * Supabase Database Types
 */

export interface Station {
  id: string;
  name: string;
  location?: string;
  phone?: string;
  email?: string;
  kra_pin?: string;
  etr_serial?: string;
  tax_rate: number;
  theme?: string;
  logo?: string;
  description?: string;
  address?: string;
  city?: string;
  country?: string;
  region?: string;
  currency?: string;
  currency_symbol?: string;
  timezone?: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
  is_active: boolean;
}

export interface FuelType {
  id: string;
  name: string;
  code: string;
  color?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface Pump {
  id: string;
  station_id: string;
  pump_number: string;
  name?: string;
  fuel_type_id?: string;
  price_per_liter: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Inventory {
  id: string;
  station_id: string;
  fuel_type_id: string;
  tank_capacity: number;
  current_level: number;
  min_level_alert: number;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  station_id: string;
  pump_id?: string;
  fuel_type_id?: string;
  quantity: number;
  price_per_liter: number;
  total_amount: number;
  payment_method: string;
  customer_name?: string;
  customer_phone?: string;
  vehicle_plate?: string;
  nozzle_reading_start?: number;
  nozzle_reading_end?: number;
  attendant_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: string;
  station_id: string;
  shift_date: string;
  shift_type: "morning" | "afternoon" | "night";
  opening_cash: number;
  closing_cash?: number;
  opening_reading?: number;
  closing_reading?: number;
  attendant_name?: string;
  attendant_phone?: string;
  notes?: string;
  status: "open" | "closed" | "verified";
  opened_at: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  station_id: string;
  category: string;
  description?: string;
  amount: number;
  expense_date: string;
  receipt_number?: string;
  vendor?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  station_id: string;
  user_id?: string;
  name: string;
  email?: string;
  phone?: string;
  role: "owner" | "manager" | "staff" | "auditor";
  pin?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  station_id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  credit_limit: number;
  current_balance: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  station_id?: string;
  user_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}
