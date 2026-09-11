/**
 * Supabase Service - Cloud persistence for FuelPro
 *
 * This service replaces Firebase for:
 * - Authentication
 * - Database operations
 * - Real-time subscriptions
 * - Cloud sync
 */

import { supabase } from "./client";
import { User, Session, AuthError } from "@supabase/supabase-js";

// Storage keys
const SUPABASE_AUTH_TOKEN = "supabase-auth-token";
const SUPABASE_LAST_SYNC = "supabase_last_sync";

/**
 * SupabaseService - Main service for Supabase operations
 */
export const SupabaseService = {
  // ============ CONFIGURATION ============

  /**
   * Check if Supabase is configured
   */
  isConfigured(): boolean {
    return !!(
      import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  },

  /**
   * Check if Supabase is enabled
   */
  isEnabled(): boolean {
    return this.isConfigured();
  },

  // ============ AUTHENTICATION ============

  /**
   * Sign up with email and password
   */
  async signUp(
    email: string,
    password: string,
    metadata?: Record<string, any>,
  ): Promise<{
    user: User | null;
    session: Session | null;
    error: AuthError | null;
  }> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
        },
      });
      return { user: data.user, session: data.session, error };
    } catch (err) {
      console.error("Supabase signUp error:", err);
      return { user: null, session: null, error: err as AuthError };
    }
  },

  /**
   * Sign in with email and password
   */
  async signIn(
    email: string,
    password: string,
  ): Promise<{
    user: User | null;
    session: Session | null;
    error: AuthError | null;
  }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { user: data.user, session: data.session, error };
    } catch (err) {
      console.error("Supabase signIn error:", err);
      return { user: null, session: null, error: err as AuthError };
    }
  },

  /**
   * Sign out
   */
  async signOut(): Promise<{ error: AuthError | null }> {
    try {
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (err) {
      console.error("Supabase signOut error:", err);
      return { error: err as AuthError };
    }
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    } catch (err) {
      console.error("Supabase getCurrentUser error:", err);
      return null;
    }
  },

  /**
   * Get current session
   */
  async getCurrentSession(): Promise<Session | null> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session;
    } catch (err) {
      console.error("Supabase getCurrentSession error:", err);
      return null;
    }
  },

  /**
   * Listen to auth state changes
   */
  onAuthStateChange(
    callback: (event: string, session: Session | null) => void,
  ) {
    return supabase.auth.onAuthStateChange(callback);
  },

  // ============ DATABASE OPERATIONS ============

  /**
   * Save data to a table
   */
  async saveData<T>(
    table: string,
    data: T,
    id?: string,
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      if (id) {
        // Update existing record
        const { data: result, error } = await supabase
          .from(table)
          .update(data)
          .eq("id", id)
          .select()
          .single();

        if (error) {
          console.error(`Supabase update error in ${table}:`, error);
          return { success: false, error: error.message };
        }
        return { success: true, data: result };
      } else {
        // Insert new record
        const { data: result, error } = await supabase
          .from(table)
          .insert(data)
          .select()
          .single();

        if (error) {
          console.error(`Supabase insert error in ${table}:`, error);
          return { success: false, error: error.message };
        }
        return { success: true, data: result };
      }
    } catch (err) {
      console.error(`Supabase saveData error in ${table}:`, err);
      return { success: false, error: String(err) };
    }
  },

  /**
   * Get data from a table
   */
  async getData<T>(
    table: string,
    filters?: Record<string, any>,
    orderBy?: { column: string; ascending?: boolean },
  ): Promise<{ success: boolean; data?: T[]; error?: string }> {
    try {
      let query = supabase.from(table).select("*");

      // Apply filters
      if (filters) {
        Object.keys(filters).forEach((key) => {
          query = query.eq(key, filters[key]);
        });
      }

      // Apply ordering
      if (orderBy) {
        query = query.order(orderBy.column, {
          ascending: orderBy.ascending ?? true,
        });
      }

      const { data, error } = await query;

      if (error) {
        console.error(`Supabase getData error in ${table}:`, error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data as T[] };
    } catch (err) {
      console.error(`Supabase getData error in ${table}:`, err);
      return { success: false, error: String(err) };
    }
  },

  /**
   * Delete data from a table
   */
  async deleteData(
    table: string,
    id: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.from(table).delete().eq("id", id);

      if (error) {
        console.error(`Supabase deleteData error in ${table}:`, error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error(`Supabase deleteData error in ${table}:`, err);
      return { success: false, error: String(err) };
    }
  },

  // ============ CLOUD SYNC ============

  /**
   * Sync data to cloud
   */
  async syncToCloud(stationId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn("Supabase not enabled - skipping sync");
      return false;
    }

    try {
      // Get local data
      const localData = localStorage.getItem(`fuelpro_station_${stationId}`);
      if (!localData) {
        console.warn("No local data to sync");
        return false;
      }

      const parsedData = JSON.parse(localData);

      // Save to Supabase
      const { error } = await supabase.from("stations").upsert({
        id: stationId,
        ...parsedData,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error("Supabase sync error:", error);
        return false;
      }

      // Update last sync time
      localStorage.setItem(SUPABASE_LAST_SYNC, new Date().toISOString());

      // Dispatch sync event
      window.dispatchEvent(new CustomEvent("fuelpro-cloud-sync"));

      return true;
    } catch (err) {
      console.error("Supabase syncToCloud error:", err);
      return false;
    }
  },

  /**
   * Restore data from cloud
   */
  async restoreFromCloud(stationId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn("Supabase not enabled - skipping restore");
      return false;
    }

    try {
      const { data, error } = await supabase
        .from("stations")
        .select("*")
        .eq("id", stationId)
        .single();

      if (error || !data) {
        console.warn("No cloud data found for station:", stationId);
        return false;
      }

      // Save to local storage
      localStorage.setItem(
        `fuelpro_station_${stationId}`,
        JSON.stringify(data),
      );
      localStorage.setItem(SUPABASE_LAST_SYNC, new Date().toISOString());

      // Dispatch sync event
      window.dispatchEvent(new CustomEvent("fuelpro-cloud-sync"));

      return true;
    } catch (err) {
      console.error("Supabase restoreFromCloud error:", err);
      return false;
    }
  },

  /**
   * Get last sync time
   */
  getLastSyncTime(): string | null {
    return localStorage.getItem(SUPABASE_LAST_SYNC);
  },

  // ============ REAL-TIME SUBSCRIPTIONS ============

  /**
   * Subscribe to real-time changes on a table
   */
  subscribeToChanges(
    table: string,
    callback: (payload: any) => void,
    filter?: { column: string; value: any },
  ) {
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: table,
          filter: filter ? `${filter.column}=eq.${filter.value}` : undefined,
        },
        callback,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // ============ UTILITY ============

  /**
   * Set encryption key for sensitive data
   */
  setEncryptionKey(key: string) {
    localStorage.setItem("supabase_encryption_key", key);
  },

  /**
   * Get encryption key
   */
  getEncryptionKey(): string | null {
    return localStorage.getItem("supabase_encryption_key");
  },
};

export default SupabaseService;
