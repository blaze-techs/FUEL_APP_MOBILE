/**
 * useFounderConsoleStore — cloud-backed, real-time store for the Founder
 * Access Global Console.
 *
 * Secrets, Feature Flags, the Audit Log and Console Settings used to live in
 * localStorage (fuelpro_founder_secrets / _flags / _audit). That meant a change
 * made on one device NEVER reached another device — defeating the "real-time
 * everywhere" promise of the console.
 *
 * This hook moves all four datasets into the Supabase `app_kv` table via
 * cloudStorageService, and subscribes to Supabase Realtime (postgres_changes)
 * for each key. Result: any change made in the Founder Console on ANY device is
 * written to the cloud row AND broadcast instantly to every other subscribed
 * device, so the console reflects the change in real time with zero polling.
 *
 * Keys (all owner-scoped by cloudStorageService):
 *   - founder_console_secrets
 *   - founder_console_flags
 *   - founder_console_audit   (capped at 500 entries, newest first)
 *   - founder_console_settings
 *
 * localStorage is retained ONLY as a read-through cache (handled inside
 * cloudStorageService) for offline reads — never the source of truth. On
 * first load the legacy localStorage arrays are migrated to the cloud so no
 * existing data is lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export interface ConsoleSecret {
  key: string;
  value: string; // base64-encoded
  createdAt: string;
  updatedAt?: string;
  category?: string;
  lastRotated?: string;
  expiresAt?: string; // when the secret expires
  tags?: string[];
  rotationReminderDays?: number; // remind to rotate every N days
}

export interface ConsoleFeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
  environment?: "all" | "dev" | "staging" | "production";
  rolloutPercentage?: number; // 0-100 gradual rollout
  dependsOn?: string[]; // ids of flags that must be enabled first
  updatedAt?: string;
}

export type AuditSeverity = "success" | "warning" | "danger" | "info";

export interface ConsoleAuditEntry {
  id: string;
  event: string;
  detail: string;
  user: string;
  severity: AuditSeverity;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ConsoleSettings {
  autoRefreshAudit: boolean;
  auditRetention: number; // max entries kept
  flagCategories: string[];
  secretCategories: string[];
  compactMode: boolean;
  showAdvancedControls: boolean;
  accentColor?: string; // hex color for console accent
  defaultLanguage?: string; // default language code
  cacheTtlSec?: number; // cloud cache TTL in seconds
  confirmDangerousActions?: boolean; // require confirm on destructive ops
  emailNotifications?: boolean; // email founders on critical events
  maxApiKeysPerUser?: number;
  webhookTimeoutDefaultMs?: number;
  lastSettingsUpdate?: string;
}

export interface FounderConsoleState {
  secrets: ConsoleSecret[];
  flags: ConsoleFeatureFlag[];
  audit: ConsoleAuditEntry[];
  settings: ConsoleSettings;
}

const KEYS = {
  secrets: "founder_console_secrets",
  flags: "founder_console_flags",
  audit: "founder_console_audit",
  settings: "founder_console_settings",
} as const;

const DEFAULT_FLAGS: ConsoleFeatureFlag[] = [
  {
    id: "pos_system",
    name: "POS System",
    description: "Point of Sale module",
    enabled: true,
    category: "Sales",
    environment: "all",
  },
  {
    id: "mpesa_live",
    name: "M-PESA Live",
    description: "Real-time M-PESA transactions",
    enabled: true,
    category: "Payments",
    environment: "all",
  },
  {
    id: "ai_chatbot",
    name: "AI Chatbot",
    description: "AI assistant for fuel management",
    enabled: true,
    category: "AI",
    environment: "all",
  },
  {
    id: "cloud_sync",
    name: "Cloud Sync",
    description: "Cross-device data synchronization",
    enabled: true,
    category: "Core",
    environment: "all",
  },
  {
    id: "integration_hub",
    name: "Integration Hub",
    description: "KRA, ETR, POS, Payroll connectors",
    enabled: true,
    category: "Integrations",
    environment: "all",
  },
  {
    id: "regional_compliance",
    name: "Regional Compliance",
    description: "Multi-country compliance features",
    enabled: true,
    category: "Compliance",
    environment: "all",
  },
  {
    id: "advanced_analytics",
    name: "Advanced Analytics",
    description: "Deep analytics and forecasting",
    enabled: true,
    category: "Analytics",
    environment: "all",
  },
  {
    id: "customer_loyalty",
    name: "Customer Loyalty",
    description: "Loyalty program management",
    enabled: true,
    category: "Sales",
    environment: "all",
  },
  {
    id: "fuel_quality",
    name: "Fuel Quality Testing",
    description: "Quality control and testing",
    enabled: true,
    category: "Operations",
    environment: "all",
  },
  {
    id: "credit_management",
    name: "Credit Management",
    description: "Credit and debt tracking",
    enabled: true,
    category: "Sales",
    environment: "all",
  },
];

const DEFAULT_SETTINGS: ConsoleSettings = {
  autoRefreshAudit: true,
  auditRetention: 500,
  flagCategories: [
    "Core",
    "Sales",
    "Payments",
    "AI",
    "Integrations",
    "Compliance",
    "Analytics",
    "Operations",
  ],
  secretCategories: [
    "Auth",
    "API",
    "Database",
    "Payments",
    "Integrations",
    "Other",
  ],
  compactMode: false,
  showAdvancedControls: true,
  accentColor: "#f59e0b",
  defaultLanguage: "en",
  cacheTtlSec: 300,
  confirmDangerousActions: true,
  emailNotifications: true,
  maxApiKeysPerUser: 10,
  webhookTimeoutDefaultMs: 10000,
};

/** Migrate legacy localStorage arrays into the cloud on first use. */
async function migrateLegacy(
  key: string,
  parse: (raw: string) => unknown,
): Promise<unknown | null> {
  try {
    const legacyMap: Record<string, string> = {
      [KEYS.secrets]: "fuelpro_founder_secrets",
      [KEYS.flags]: "fuelpro_founder_flags",
      [KEYS.audit]: "fuelpro_founder_audit",
    };
    const lsKey = legacyMap[key];
    if (!lsKey) return null;
    const raw = localStorage.getItem(lsKey);
    if (!raw) return null;
    const parsed = parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFounderConsoleStore(
  stationId?: string,
): FounderConsoleState & {
  loading: boolean;
  lastSync: number;
  /** Add or update a secret (upsert by key). */
  upsertSecret: (secret: ConsoleSecret) => void;
  deleteSecret: (key: string) => void;
  rotateSecret: (key: string) => void;
  /** Add, update or delete a feature flag. */
  upsertFlag: (flag: ConsoleFeatureFlag) => void;
  toggleFlag: (id: string) => void;
  deleteFlag: (id: string) => void;
  bulkSetFlags: (enabled: boolean) => void;
  /** Append an audit entry (capped to settings.auditRetention). */
  addAudit: (
    event: string,
    detail: string,
    severity?: AuditSeverity,
    user?: string,
    metadata?: Record<string, unknown>,
  ) => void;
  clearAudit: () => void;
  updateSettings: (patch: Partial<ConsoleSettings>) => void;
  /** Force a fresh cloud reload for all keys. */
  reload: () => void;
} {
  const [secrets, setSecrets] = useState<ConsoleSecret[]>([]);
  const [flags, setFlags] = useState<ConsoleFeatureFlag[]>([]);
  const [audit, setAudit] = useState<ConsoleAuditEntry[]>([]);
  const [settings, setSettings] = useState<ConsoleSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(0);

  // Echo guards so our own cloud writes don't double-apply via the realtime
  // echo back to us.
  const skipEcho = useRef<Record<string, boolean>>({});

  const loadAll = useCallback(async () => {
    const [cloudSecrets, cloudFlags, cloudAudit, cloudSettings] =
      await Promise.all([
        cloudStorageService.get<ConsoleSecret[]>(KEYS.secrets, stationId),
        cloudStorageService.get<ConsoleFeatureFlag[]>(KEYS.flags, stationId),
        cloudStorageService.get<ConsoleAuditEntry[]>(KEYS.audit, stationId),
        cloudStorageService.get<ConsoleSettings>(KEYS.settings, stationId),
      ]);

    // Secrets: prefer cloud; fall back to migrated legacy.
    if (cloudSecrets && Array.isArray(cloudSecrets)) {
      setSecrets(cloudSecrets);
    } else {
      const legacy = (await migrateLegacy(KEYS.secrets, (r) =>
        JSON.parse(r),
      )) as ConsoleSecret[] | null;
      if (legacy && Array.isArray(legacy) && legacy.length > 0) {
        setSecrets(legacy);
        skipEcho.current[KEYS.secrets] = true; // suppress realtime echo from this write
        cloudStorageService
          .set(KEYS.secrets, legacy, stationId)
          .catch(() => {});
      } else {
        setSecrets([
          {
            key: "ADMIN_SECRET_CODE",
            value: "***CONFIGURED***",
            createdAt: new Date().toISOString(),
            category: "Auth",
          },
          {
            key: "ADMIN_USERNAME",
            value: "***CONFIGURED***",
            createdAt: new Date().toISOString(),
            category: "Auth",
          },
          {
            key: "ADMIN_PASSWORD",
            value: "***CONFIGURED***",
            createdAt: new Date().toISOString(),
            category: "Auth",
          },
        ]);
      }
    }

    if (cloudFlags && Array.isArray(cloudFlags)) {
      setFlags(cloudFlags);
    } else {
      const legacy = (await migrateLegacy(KEYS.flags, (r) => JSON.parse(r))) as
        ConsoleFeatureFlag[] | null;
      const base =
        legacy && Array.isArray(legacy) && legacy.length > 0
          ? legacy
          : DEFAULT_FLAGS;
      setFlags(base);
      skipEcho.current[KEYS.flags] = true; // suppress realtime echo from this write
      cloudStorageService.set(KEYS.flags, base, stationId).catch(() => {});
    }

    if (cloudAudit && Array.isArray(cloudAudit)) {
      setAudit(cloudAudit);
    } else {
      const legacy = (await migrateLegacy(KEYS.audit, (r) => JSON.parse(r))) as
        ConsoleAuditEntry[] | null;
      const base =
        legacy && Array.isArray(legacy) && legacy.length > 0
          ? legacy
          : [
              {
                id: uid(),
                event: "System Initialized",
                detail: "FuelPro admin panel created",
                user: "SYSTEM",
                severity: "info" as AuditSeverity,
                timestamp: new Date().toISOString(),
              },
            ];
      setAudit(base);
      skipEcho.current[KEYS.audit] = true; // suppress realtime echo from this write
      cloudStorageService.set(KEYS.audit, base, stationId).catch(() => {});
    }

    if (cloudSettings && typeof cloudSettings === "object") {
      setSettings({ ...DEFAULT_SETTINGS, ...cloudSettings });
    } else {
      setSettings(DEFAULT_SETTINGS);
    }

    setLoading(false);
    setLastSync(Date.now());
  }, [stationId]);

  // Load once + subscribe to realtime for each key.
  useEffect(() => {
    loadAll();

    const unsubs = [
      cloudStorageService.subscribe<ConsoleSecret[]>(
        KEYS.secrets,
        stationId,
        (value) => {
          if (skipEcho.current[KEYS.secrets]) {
            skipEcho.current[KEYS.secrets] = false;
            return;
          }
          if (value && Array.isArray(value)) setSecrets(value);
          setLastSync(Date.now());
        },
      ),
      cloudStorageService.subscribe<ConsoleFeatureFlag[]>(
        KEYS.flags,
        stationId,
        (value) => {
          if (skipEcho.current[KEYS.flags]) {
            skipEcho.current[KEYS.flags] = false;
            return;
          }
          if (value && Array.isArray(value)) setFlags(value);
          setLastSync(Date.now());
        },
      ),
      cloudStorageService.subscribe<ConsoleAuditEntry[]>(
        KEYS.audit,
        stationId,
        (value) => {
          if (skipEcho.current[KEYS.audit]) {
            skipEcho.current[KEYS.audit] = false;
            return;
          }
          if (value && Array.isArray(value)) setAudit(value);
          setLastSync(Date.now());
        },
      ),
      cloudStorageService.subscribe<ConsoleSettings>(
        KEYS.settings,
        stationId,
        (value) => {
          if (skipEcho.current[KEYS.settings]) {
            skipEcho.current[KEYS.settings] = false;
            return;
          }
          if (value && typeof value === "object")
            setSettings({ ...DEFAULT_SETTINGS, ...value });
          setLastSync(Date.now());
        },
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [loadAll, stationId]);

  const persistSecrets = useCallback(
    (next: ConsoleSecret[]) => {
      skipEcho.current[KEYS.secrets] = true;
      setSecrets(next);
      cloudStorageService.set(KEYS.secrets, next, stationId).catch(() => {});
    },
    [stationId],
  );

  const persistFlags = useCallback(
    (next: ConsoleFeatureFlag[]) => {
      skipEcho.current[KEYS.flags] = true;
      setFlags(next);
      cloudStorageService.set(KEYS.flags, next, stationId).catch(() => {});
    },
    [stationId],
  );

  const persistAudit = useCallback(
    (next: ConsoleAuditEntry[]) => {
      const cap = settings.auditRetention || 500;
      const trimmed = next.length > cap ? next.slice(0, cap) : next;
      skipEcho.current[KEYS.audit] = true;
      setAudit(trimmed);
      cloudStorageService.set(KEYS.audit, trimmed, stationId).catch(() => {});
    },
    [stationId, settings.auditRetention],
  );

  const persistSettings = useCallback(
    (patch: Partial<ConsoleSettings>) => {
      const next = {
        ...settings,
        ...patch,
        lastSettingsUpdate: new Date().toISOString(),
      };
      skipEcho.current[KEYS.settings] = true;
      setSettings(next);
      cloudStorageService.set(KEYS.settings, next, stationId).catch(() => {});
    },
    [settings, stationId],
  );

  const upsertSecret = useCallback(
    (secret: ConsoleSecret) => {
      const exists = secrets.some((s) => s.key === secret.key);
      const next = exists
        ? secrets.map((s) =>
            s.key === secret.key
              ? { ...s, ...secret, updatedAt: new Date().toISOString() }
              : s,
          )
        : [...secrets, secret];
      persistSecrets(next);
    },
    [secrets, persistSecrets],
  );

  const deleteSecret = useCallback(
    (key: string) => {
      persistSecrets(secrets.filter((s) => s.key !== key));
    },
    [secrets, persistSecrets],
  );

  const rotateSecret = useCallback(
    (key: string) => {
      // Generate a random 32-byte value, base64-encoded.
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const rotated = btoa(String.fromCharCode(...bytes));
      const next = secrets.map((s) =>
        s.key === key
          ? {
              ...s,
              value: rotated,
              lastRotated: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : s,
      );
      persistSecrets(next);
    },
    [secrets, persistSecrets],
  );

  const upsertFlag = useCallback(
    (flag: ConsoleFeatureFlag) => {
      const exists = flags.some((f) => f.id === flag.id);
      const next = exists
        ? flags.map((f) =>
            f.id === flag.id
              ? { ...f, ...flag, updatedAt: new Date().toISOString() }
              : f,
          )
        : [...flags, flag];
      persistFlags(next);
    },
    [flags, persistFlags],
  );

  const toggleFlag = useCallback(
    (id: string) => {
      const next = flags.map((f) =>
        f.id === id
          ? { ...f, enabled: !f.enabled, updatedAt: new Date().toISOString() }
          : f,
      );
      persistFlags(next);
    },
    [flags, persistFlags],
  );

  const deleteFlag = useCallback(
    (id: string) => {
      persistFlags(flags.filter((f) => f.id !== id));
    },
    [flags, persistFlags],
  );

  const bulkSetFlags = useCallback(
    (enabled: boolean) => {
      const next = flags.map((f) => ({
        ...f,
        enabled,
        updatedAt: new Date().toISOString(),
      }));
      persistFlags(next);
    },
    [flags, persistFlags],
  );

  const addAudit = useCallback(
    (
      event: string,
      detail: string,
      severity: AuditSeverity = "info",
      user = "FOUNDER",
      metadata?: Record<string, unknown>,
    ) => {
      const entry: ConsoleAuditEntry = {
        id: uid(),
        event,
        detail,
        user,
        severity,
        timestamp: new Date().toISOString(),
        metadata,
      };
      persistAudit([entry, ...audit]);
    },
    [audit, persistAudit],
  );

  const clearAudit = useCallback(() => {
    persistAudit([]);
  }, [persistAudit]);

  const updateSettings = useCallback(
    (patch: Partial<ConsoleSettings>) => {
      persistSettings(patch);
    },
    [persistSettings],
  );

  const reload = useCallback(() => {
    cloudStorageService.invalidate();
    loadAll();
  }, [loadAll]);

  return {
    secrets,
    flags,
    audit,
    settings,
    loading,
    lastSync,
    upsertSecret,
    deleteSecret,
    rotateSecret,
    upsertFlag,
    toggleFlag,
    deleteFlag,
    bulkSetFlags,
    addAudit,
    clearAudit,
    updateSettings,
    reload,
  };
}

export { uid };
