/**
 * Supabase Client Exports
 *
 * This file exports all Supabase-related functionality for the FuelPro application.
 */

export { supabase, getSupabaseClient } from "./client";
export { SupabaseService } from "./SupabaseService";
export type { SupabaseClient } from "./client";

// Re-export types
export type {
  User,
  Session,
  AuthError,
  AuthChangeEvent,
} from "@supabase/supabase-js";
