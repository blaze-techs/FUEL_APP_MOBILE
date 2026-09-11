import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo, useState } from "react";

export type AuditSeverity = "info" | "success" | "warning" | "danger";

export interface AuditEntry {
  id: string;
  event: string;
  detail: string;
  user: string;
  severity: "success" | "warning" | "danger" | "info";
  timestamp: string;
}

export interface FounderSessionData {
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  passwordHash: string | null;
}

/**
 * useFounderBackend — Integrates Founder Access with the tRPC backend.
 *
 * Provides:
 *   - Audit logging (persisted to MySQL via audit.log, and localStorage for backup)
 *   - Audit log retrieval (from DB, falls back to localStorage)
 *   - Founder session management (2FA, password, contact via founder_sessions table)
 *   - Station & sales analytics (from DB)
 *
 * Always attempts backend connection - falls back to localStorage only if backend is unavailable.
 */
export function useFounderBackend() {
  const utils = trpc.useUtils();

  // Always try backend - no static mode blocking
  const isStatic = false;

  /* ─── Audit Logging ─── */
  // Skip mutation in static mode - only log to localStorage
  // Note: We intentionally do NOT invalidate queries on audit log mutation
  // to prevent potential cascade effects that could cause batch overflow
  const logMutation = trpc.audit.log.useMutation({
    retry: 1,
    // Don't invalidate on success - audit log mutations should be fire-and-forget
    // This prevents potential cascade effects from invalidating multiple queries
  });

  // `mutate` is guaranteed stable by React Query; depending on it (instead of
  // the whole `logMutation` result object, whose identity changes whenever the
  // mutation's isPending/data state flips) keeps `logAudit` referentially
  // stable. Without this, any effect that lists `logAudit` in its deps
  // re-fires on every mutation state transition, which re-logs and triggers
  // another mutation — an infinite render loop that breaks navigation.
  const { mutate: logMutate } = logMutation;

  const logAudit = useCallback(
    (event: string, detail: string, severity: AuditSeverity = "info") => {
      // Always write to localStorage for immediate UI and offline support
      try {
        const entry: AuditEntry = {
          id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          event,
          detail,
          user: "FOUNDER",
          severity,
          timestamp: new Date().toISOString(),
        };
        const existing = JSON.parse(
          localStorage.getItem("fuelpro_founder_audit") || "[]",
        );
        existing.unshift(entry);
        localStorage.setItem(
          "fuelpro_founder_audit",
          JSON.stringify(existing.slice(0, 1000)),
        );
      } catch {
        /* ignore */
      }

      // Also persist to backend (non-blocking) - only if not static mode
      if (!isStatic) {
        logMutate({ event, detail, severity });
      }
    },
    [logMutate, isStatic],
  );

  /* ─── Audit Log List ─── */
  // Use enabled: false in static mode to skip the query
  const { data: dbAuditLogs, isLoading: auditLoading } =
    trpc.audit.listAll.useQuery(undefined, {
      enabled: !isStatic,
      staleTime: 1000 * 60 * 2,
      retry: 1,
    });

  // Merge DB logs with localStorage fallback
  const auditLog: AuditEntry[] = useMemo(() => {
    if (dbAuditLogs && dbAuditLogs.length > 0) {
      return dbAuditLogs.map((log: any) => ({
        id: String(log.id),
        event: log.event,
        detail: log.detail || "",
        user: "FOUNDER",
        severity: (log.severity as AuditSeverity) || "info",
        timestamp: log.createdAt
          ? new Date(log.createdAt).toISOString()
          : new Date().toISOString(),
      }));
    }
    // Fallback to localStorage
    try {
      const stored = localStorage.getItem("fuelpro_founder_audit");
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return [
      {
        id: "1",
        event: "System Initialized",
        detail: "FuelPro admin panel created",
        user: "SYSTEM",
        severity: "info" as const,
        timestamp: new Date().toISOString(),
      },
    ];
  }, [dbAuditLogs]);

  /* ─── Audit Summary (analytics) ─── */
  const { data: auditSummary } = trpc.audit.summary.useQuery(undefined, {
    enabled: !isStatic,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  /* ─── Founder Session (2FA / Password / Contact) ─── */
  const { data: dbFounderSession } = trpc.audit.getFounderSession.useQuery(
    undefined,
    {
      enabled: !isStatic,
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  );

  const upsertSessionMutation = trpc.audit.upsertFounderSession.useMutation({
    onSuccess: () => {
      utils.audit.getFounderSession.invalidate();
    },
  });
  // Stable mutate fn (same rationale as logMutate above) so saveFounderSession
  // is referentially stable and won't trigger re-fires in any effect that
  // depends on it.
  const { mutate: upsertSessionMutate } = upsertSessionMutation;

  const founderSession: FounderSessionData = useMemo(() => {
    if (dbFounderSession) {
      return {
        twoFactorEnabled: dbFounderSession.twoFactorEnabled || false,
        twoFactorSecret: dbFounderSession.twoFactorSecret || null,
        contactEmail: dbFounderSession.contactEmail || null,
        contactPhone: dbFounderSession.contactPhone || null,
        passwordHash: dbFounderSession.passwordHash || null,
      };
    }
    // Fallback to localStorage
    try {
      const saved = localStorage.getItem("fuelpro_founder_2fa");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          twoFactorEnabled: parsed.enabled || false,
          twoFactorSecret: parsed.secret || null,
          contactEmail: null,
          contactPhone: null,
          passwordHash: null,
        };
      }
    } catch {
      /* ignore */
    }
    return {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      contactEmail: null,
      contactPhone: null,
      passwordHash: null,
    };
  }, [dbFounderSession]);

  const saveFounderSession = useCallback(
    (data: Partial<FounderSessionData>) => {
      // Persist to backend only in non-static mode
      if (!isStatic) {
        upsertSessionMutate({
          twoFactorEnabled: data.twoFactorEnabled,
          twoFactorSecret: data.twoFactorSecret,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          passwordHash: data.passwordHash,
        });
      }

      // Always persist to localStorage for offline fallback
      if (data.twoFactorEnabled !== undefined) {
        try {
          const existing = JSON.parse(
            localStorage.getItem("fuelpro_founder_2fa") || "{}",
          );
          existing.enabled = data.twoFactorEnabled;
          if (data.twoFactorSecret) existing.secret = data.twoFactorSecret;
          localStorage.setItem("fuelpro_founder_2fa", JSON.stringify(existing));
        } catch {
          /* ignore */
        }
      }
      if (data.contactEmail || data.contactPhone) {
        try {
          const existing = JSON.parse(
            localStorage.getItem("fuelpro_founder_contact") || "{}",
          );
          if (data.contactEmail) existing.email = data.contactEmail;
          if (data.contactPhone) existing.phone = data.contactPhone;
          localStorage.setItem(
            "fuelpro_founder_contact",
            JSON.stringify(existing),
          );
        } catch {
          /* ignore */
        }
      }
      if (data.passwordHash) {
        try {
          const existing = JSON.parse(
            localStorage.getItem("fuelpro_founder_password") || "{}",
          );
          existing.password = data.passwordHash;
          localStorage.setItem(
            "fuelpro_founder_password",
            JSON.stringify(existing),
          );
        } catch {
          /* ignore */
        }
      }
    },
    [upsertSessionMutate, isStatic],
  );

  /* ─── Stations (from backend) ─── */
  const { data: stationsData, isLoading: stationsLoading } =
    trpc.station.list.useQuery(undefined, {
      enabled: !isStatic,
      staleTime: 1000 * 60 * 2,
      retry: 1,
    });

  const stationCount = stationsData?.length || 0;

  /* ─── Sales Analytics (from backend) ─── */
  const { data: salesAnalytics } = trpc.sale.analytics.useQuery(undefined, {
    enabled: !isStatic,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });

  /* ─── All Users (from backend founder auth) ─── */
  const { data: allBackendUsers, isLoading: usersLoading } =
    trpc.founderAuth.getAllUsers.useQuery(undefined, {
      enabled: !isStatic,
      staleTime: 1000 * 60 * 2,
      retry: 1,
    });

  /* ─── All Stations (from backend founder auth) ─── */
  const { data: allBackendStations, isLoading: allStationsLoading } =
    trpc.founderAuth.getAllStations.useQuery(undefined, {
      enabled: !isStatic,
      staleTime: 1000 * 60 * 2,
      retry: 1,
    });

  /* ─── Founder stats via /api/founder-stats (Supabase service role) ───
   * The tRPC procedures above are runtime no-ops (no backend configured in
   * this Supabase-only SPA), so allBackendUsers/allBackendStations are always
   * null and the Founder Console showed 0 users / 0 stations. This fetches
   * the REAL cross-owner counts from the serverless endpoint, which uses the
   * service_role key (RLS-bypassing) after verifying the caller is a founder.
   * The endpoint lives ONLY on Vercel (Cloudflare serves the SPA). */
  const [statsUsers, setStatsUsers] = useState<any[] | null>(null);
  const [statsStations, setStatsStations] = useState<any[] | null>(null);
  const [statsTotalRevenue, setStatsTotalRevenue] = useState<number>(0);
  const [statsAnalytics, setStatsAnalytics] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadStats() {
      try {
        // Prefer the FOUNDER's token (stored by loginFounder in
        // fuelpro_founder_token). The app's AuthContext may have restored a
        // DIFFERENT (non-founder) session on the shared Supabase client, so
        // getSupabaseClient().auth.getSession() can return the regular app
        // user's token → /api/founder-stats returns 403 → counts stay at 0.
        const founderToken = localStorage.getItem("fuelpro_founder_token");
        let token = founderToken;
        if (!token) {
          const { getSupabaseClient } = await import("@/supabase/client");
          const client = getSupabaseClient();
          const { data } = await client.auth.getSession();
          token = data.session?.access_token;
        }
        if (!token) return;
        setStatsLoading(true);
        // Prefer a same-origin /api path; on Cloudflare (no /api) fall back to
        // the Vercel origin which has the serverless function.
        const isVercel =
          typeof window !== "undefined" &&
          window.location.hostname.includes("vercel.app");
        const base = isVercel
          ? "/api/founder-stats"
          : "https://fuel-app-mobile.vercel.app/api/founder-stats";
        const res = await fetch(base, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (json?.success) {
          setStatsUsers(json.users || []);
          setStatsStations(json.stations || []);
          setStatsTotalRevenue(Number(json.totalRevenue) || 0);
          // Store analytics (byFuelType, totalSales, avgSale) if the endpoint
          // returns it (enhanced endpoint). Falls back to null otherwise.
          setStatsAnalytics(json.analytics || null);
        }
      } catch {
        /* network / not a founder — silently ignore; tRPC null stays the fallback */
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    // Attempt immediately (covers the case where a session already exists).
    loadStats();

    // The hook mounts BEFORE the founder logs in (the auth gate is rendered
    // by the same component), so getSession() may return null on the first
    // run (the Supabase client hasn't restored the persisted session yet).
    // Subscribe to auth state changes so the fetch re-fires the moment the
    // founder signs in (signInWithPassword emits SIGNED_IN / TOKEN_REFRESHED).
    (async () => {
      try {
        const { getSupabaseClient } = await import("@/supabase/client");
        const client = getSupabaseClient();
        const { data: sub } = client.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
            loadStats();
          }
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      } catch {
        /* ignore */
      }
    })();

    // Polling fallback: if the session wasn't ready on mount AND
    // onAuthStateChange already fired before the subscription attached
    // (a race on slow networks), retry a few times until the session is
    // available. Stops as soon as statsUsers is populated.
    let attempts = 0;
    const poll = () => {
      if (cancelled || statsUsers || attempts >= 8) return;
      attempts++;
      pollTimer = setTimeout(() => {
        loadStats().then(() => {
          if (!cancelled && !statsUsers) poll();
        });
      }, 1500);
    };
    poll();

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, []);

  return {
    // Audit
    logAudit,
    auditLog,
    auditLoading,
    auditSummary,

    // Founder Session (2FA / Password)
    founderSession,
    saveFounderSession,
    sessionSaving: upsertSessionMutation.isPending,

    // Stations
    stationsData,
    stationsLoading,
    stationCount,

    // All Users (for founder dashboard) — prefer /api/founder-stats (real)
    // over the no-op tRPC query which is always null in Supabase-only mode.
    allBackendUsers: statsUsers || allBackendUsers,
    usersLoading: usersLoading || statsLoading,

    // All Stations (for founder dashboard) — same precedence.
    allBackendStations: statsStations || allBackendStations,
    allStationsLoading: allStationsLoading || statsLoading,

    // Total cross-owner revenue from /api/founder-stats
    statsTotalRevenue,

    // Sales Analytics — prefer /api/founder-stats analytics (real, cross-owner)
    // over the no-op tRPC query which is always null in Supabase-only mode.
    salesAnalytics: statsAnalytics || salesAnalytics,

    // Refresh helpers - only works in non-static mode
    refresh: useCallback(() => {
      if (!isStatic) {
        utils.audit.listAll.invalidate();
        utils.audit.summary.invalidate();
        utils.audit.getFounderSession.invalidate();
        utils.station.list.invalidate();
        utils.sale.analytics.invalidate();
        utils.founderAuth.getAllUsers.invalidate();
        utils.founderAuth.getAllStations.invalidate();
      }
    }, [utils, isStatic]),
  };
}
